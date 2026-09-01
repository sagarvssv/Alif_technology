import json
import os
import uuid
from datetime import datetime, timezone

import boto3

RISK_REVIEWS_TABLE = os.environ.get("RISK_REVIEWS_TABLE")
ATTACHMENTS_BUCKET = os.environ.get("ATTACHMENTS_BUCKET")
AWS_REGION = os.environ.get("AWS_REGION", "eu-central-1")

dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
s3 = boto3.client("s3", region_name=AWS_REGION)
table = dynamodb.Table(RISK_REVIEWS_TABLE) if RISK_REVIEWS_TABLE else None

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token",
    "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
}

# Current, correct status vocabulary used everywhere in the frontend.
ALLOWED_STATUSES = ["open", "in_process", "review", "closed_resolved", "other"]

# Any risk record created before this vocabulary was introduced may still
# have one of these old values stored in DynamoDB. Map them forward
# automatically instead of rejecting the request, so old records don't
# get permanently stuck erroring on every future update.
LEGACY_STATUS_MAP = {
    "in_review": "review",
    "resolved": "closed_resolved",
    "closed": "closed_resolved",
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {**CORS_HEADERS, "Content-Type": "application/json"},
        "body": json.dumps(body, ensure_ascii=False),
    }


def normalize_status(value):
    """Maps a legacy status value forward to its current equivalent.
    Values that are already current (or unrecognized) pass through
    unchanged."""
    return LEGACY_STATUS_MAP.get(value, value)


def empty_review(risk_key):
    return {
        "riskKey": risk_key,
        "status": "open",
        "customStatusText": "",
        "comments": [],
        "attachments": [],
        "checklistItems": [],
        "checklistBaseLevel": None,
        "mandatoryChecklistItems": [],
        "statusHistory": [
            {"status": "open", "changedBy": "system", "changedAt": now_iso()}
        ],
        "createdAt": now_iso(),
        "lastUpdated": now_iso(),
    }


def get_review(risk_key):
    result = table.get_item(Key={"risk_key": risk_key})
    item = result.get("Item")
    if not item:
        return empty_review(risk_key)
    return {
        "riskKey": item.get("risk_key"),
        # Normalize on read too, so any record saved under the old
        # vocabulary before this fix displays correctly immediately,
        # without needing a write first.
        "status": normalize_status(item.get("status", "open")),
        "customStatusText": item.get("custom_status_text", ""),
        "comments": item.get("comments", []),
        "attachments": item.get("attachments", []),
        "checklistItems": item.get("checklist_items", []),
        "checklistBaseLevel": item.get("checklist_base_level"),
        "mandatoryChecklistItems": item.get("mandatory_checklist_items", []),
        "statusHistory": item.get("status_history", []),
        "createdAt": item.get("created_at"),
        "lastUpdated": item.get("last_updated"),
    }


def handle_get(risk_key):
    if not table:
        return response(500, {"error": "RISK_REVIEWS_TABLE not configured"})
    return response(200, get_review(risk_key))


def handle_put(risk_key, body):
    """
    Body may include any of:
      status: "open" | "in_process" | "review" | "closed_resolved" | "other"
      customStatusText: string (only meaningful when status is "other",
        but accepted independently too so it can be updated without
        also resending status on every keystroke/blur)
      newComment: { author, text }
      newAttachment: { fileName, s3Key }
      removeAttachment: { s3Key } — removes a previously attached
        document, e.g. one added by mistake, before re-analysis is run.
      setChecklist: [ "item text 1", "item text 2", ... ] — initializes
        this risk's checklist the FIRST time it's generated. Ignored if
        a checklist already exists, so re-opening the modal never wipes
        progress already made. Each item is stored with a stable id and
        starts unsatisfied/unchecked.
    updateChecklistItem: { id, satisfied?, satisfiedBy?,
        manuallyChecked?, justification? } — patches ONE existing
        checklist item by id. Only the fields provided are changed.
    setMandatoryChecklist: [ "item text 1", ... ] — same pattern as
        setChecklist, but for the CLIENT'S static Excel checklist
        (completely independent storage/list from checklistItems above
        — the two never interact).
    updateMandatoryChecklistItem: { id, satisfied?, satisfiedBy?,
        manuallyChecked?, justification? } — same pattern as
        updateChecklistItem, but patches mandatoryChecklistItems instead.
    changedBy: string (who made this update, for status history)
    Each field is applied additively — a PUT only touches the fields it
    includes, so the frontend can update status and add a comment in the
    same call, or just one of them, without clobbering the other.
    """
    if not table:
        return response(500, {"error": "RISK_REVIEWS_TABLE not configured"})

    existing = get_review(risk_key)
    changed_by = body.get("changedBy") or "unknown"

    new_status = body.get("status")
    if new_status is not None:
        new_status = normalize_status(new_status)
        if new_status not in ALLOWED_STATUSES:
            return response(400, {"error": f"status must be one of {ALLOWED_STATUSES}"})
        if new_status != existing["status"]:
            existing["statusHistory"].append(
                {"status": new_status, "changedBy": changed_by, "changedAt": now_iso()}
            )
        existing["status"] = new_status

    custom_status_text = body.get("customStatusText")
    if custom_status_text is not None:
        existing["customStatusText"] = custom_status_text

    new_comment = body.get("newComment")
    if new_comment and isinstance(new_comment, dict) and new_comment.get("text"):
        existing["comments"].append(
            {
                "author": new_comment.get("author") or changed_by,
                "text": new_comment["text"],
                "timestamp": now_iso(),
            }
        )

    new_attachment = body.get("newAttachment")
    if new_attachment and isinstance(new_attachment, dict) and new_attachment.get("fileName"):
        existing["attachments"].append(
            {
                "fileName": new_attachment["fileName"],
                "s3Key": new_attachment.get("s3Key", ""),
                "uploadedBy": changed_by,
                "uploadedAt": now_iso(),
            }
        )

    remove_attachment = body.get("removeAttachment")
    if remove_attachment and isinstance(remove_attachment, dict) and remove_attachment.get("s3Key"):
        existing["attachments"] = [
            a for a in existing["attachments"] if a.get("s3Key") != remove_attachment["s3Key"]
        ]

    set_checklist = body.get("setChecklist")
    if set_checklist and isinstance(set_checklist, list) and not existing.get("checklistItems"):
        existing["checklistItems"] = [
            {
                "id": uuid.uuid4().hex,
                "text": str(text).strip(),
                "satisfied": False,
                "satisfiedBy": None,
                "manuallyChecked": False,
                "justification": "",
            }
            for text in set_checklist
            if str(text).strip()
        ]
        base_level = body.get("baseRiskLevel")
        if base_level and not existing.get("checklistBaseLevel"):
            existing["checklistBaseLevel"] = str(base_level)

    update_checklist_item = body.get("updateChecklistItem")
    if update_checklist_item and isinstance(update_checklist_item, dict) and update_checklist_item.get("id"):
        target_id = update_checklist_item["id"]
        for checklist_item in existing.get("checklistItems", []):
            if checklist_item.get("id") != target_id:
                continue
            if "satisfied" in update_checklist_item:
                checklist_item["satisfied"] = bool(update_checklist_item["satisfied"])
            if "satisfiedBy" in update_checklist_item:
                checklist_item["satisfiedBy"] = update_checklist_item["satisfiedBy"]
            if "manuallyChecked" in update_checklist_item:
                checklist_item["manuallyChecked"] = bool(update_checklist_item["manuallyChecked"])
            if "justification" in update_checklist_item:
                checklist_item["justification"] = str(update_checklist_item["justification"])
            break

    # Mandatory Checklist (client's static Excel checklist) — mirrors the
    # setChecklist/updateChecklistItem pattern above exactly, but reads
    # and writes mandatoryChecklistItems, a COMPLETELY SEPARATE list.
    # The two checklists never share ids, state, or storage.
    set_mandatory_checklist = body.get("setMandatoryChecklist")
    if set_mandatory_checklist and isinstance(set_mandatory_checklist, list) and not existing.get("mandatoryChecklistItems"):
        existing["mandatoryChecklistItems"] = [
            {
                "id": uuid.uuid4().hex,
                "text": str(text).strip(),
                "satisfied": False,
                "satisfiedBy": None,
                "manuallyChecked": False,
                "justification": "",
            }
            for text in set_mandatory_checklist
            if str(text).strip()
        ]

    update_mandatory_checklist_item = body.get("updateMandatoryChecklistItem")
    if update_mandatory_checklist_item and isinstance(update_mandatory_checklist_item, dict) and update_mandatory_checklist_item.get("id"):
        target_id = update_mandatory_checklist_item["id"]
        for checklist_item in existing.get("mandatoryChecklistItems", []):
            if checklist_item.get("id") != target_id:
                continue
            if "satisfied" in update_mandatory_checklist_item:
                checklist_item["satisfied"] = bool(update_mandatory_checklist_item["satisfied"])
            if "satisfiedBy" in update_mandatory_checklist_item:
                checklist_item["satisfiedBy"] = update_mandatory_checklist_item["satisfiedBy"]
            if "manuallyChecked" in update_mandatory_checklist_item:
                checklist_item["manuallyChecked"] = bool(update_mandatory_checklist_item["manuallyChecked"])
            if "justification" in update_mandatory_checklist_item:
                checklist_item["justification"] = str(update_mandatory_checklist_item["justification"])
            break

    existing["lastUpdated"] = now_iso()
    if not existing.get("createdAt"):
        existing["createdAt"] = existing["lastUpdated"]

    table.put_item(
        Item={
            "risk_key": risk_key,
            "status": existing["status"],
            "custom_status_text": existing.get("customStatusText", ""),
            "comments": existing["comments"],
            "attachments": existing["attachments"],
            "checklist_items": existing.get("checklistItems", []),
            "checklist_base_level": existing.get("checklistBaseLevel"),
            "mandatory_checklist_items": existing.get("mandatoryChecklistItems", []),
            "status_history": existing["statusHistory"],
            "created_at": existing["createdAt"],
            "last_updated": existing["lastUpdated"],
        }
    )

    return response(200, existing)


def handle_attachment_url(risk_key, body):
    """
    Generates a presigned S3 PUT URL for uploading a supporting document
    against a specific risk, under a dedicated key prefix so these never
    collide with normal document uploads. Mirrors the existing
    upload-url pattern used for document uploads, but scoped per-risk.
    """
    if not ATTACHMENTS_BUCKET:
        return response(500, {"error": "ATTACHMENTS_BUCKET not configured"})

    file_name = body.get("fileName") or f"attachment-{uuid.uuid4().hex}"
    content_type = body.get("contentType") or "application/octet-stream"
    safe_name = "".join(c for c in file_name if c.isalnum() or c in "._-") or "attachment"
    s3_key = f"risk-attachments/{risk_key}/{uuid.uuid4().hex}-{safe_name}"

    upload_url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": ATTACHMENTS_BUCKET, "Key": s3_key, "ContentType": content_type},
        ExpiresIn=300,
    )

    return response(200, {"uploadUrl": upload_url, "s3Key": s3_key, "fileName": file_name})


def lambda_handler(event, context):
    try:
        method = event.get("httpMethod", "GET")
        path_params = event.get("pathParameters") or {}
        risk_key = path_params.get("riskKey", "")

        if method == "OPTIONS":
            return response(200, {})

        if not risk_key:
            return response(400, {"error": "riskKey is required in the URL path"})

        raw_body = event.get("body") or "{}"
        try:
            body = json.loads(raw_body) if isinstance(raw_body, str) else (raw_body or {})
        except Exception:
            body = {}

        resource_path = event.get("resource", "") or event.get("path", "")

        if method == "GET":
            return handle_get(risk_key)

        if method == "PUT":
            return handle_put(risk_key, body)

        if method == "POST" and "attachment-url" in resource_path:
            return handle_attachment_url(risk_key, body)

        return response(405, {"error": f"Method {method} not supported on this resource"})

    except Exception as exc:
        return response(500, {"error": str(exc)})