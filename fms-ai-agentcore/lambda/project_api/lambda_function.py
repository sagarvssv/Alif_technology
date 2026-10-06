import json
import os
import uuid
from datetime import datetime, timezone

import boto3

dynamodb = boto3.resource("dynamodb")

PROJECTS_TABLE_NAME = os.environ.get("PROJECTS_TABLE_NAME", "FmsAiAgentCoreProjects")

projects_table = dynamodb.Table(PROJECTS_TABLE_NAME)

# NOTE: The separate FmsAiAgentCoreProjectHistory table and its logging calls
# are intentionally left out for now — this Lambda only touches the Projects
# table. History is stored simply, embedded directly on the project item
# itself (a "history" list attribute), which is exactly what the frontend
# already sends and expects back. When we build the dedicated Project
# History table/feature, this can be swapped for calls into that table
# without changing anything else here.


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
        },
        "body": json.dumps(body, default=str),
    }


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def get_project_by_id(project_id):
    result = projects_table.get_item(Key={"project_id": project_id})
    return result.get("Item")


def scan_all_projects():
    scan_result = projects_table.scan()
    items = scan_result.get("Items", [])
    while "LastEvaluatedKey" in scan_result:
        scan_result = projects_table.scan(ExclusiveStartKey=scan_result["LastEvaluatedKey"])
        items.extend(scan_result.get("Items", []))
    return items


def create_project(body):
    project_id = body.get("projectId") or str(uuid.uuid4())
    created_at = body.get("createdAt") or now_iso()

    history = body.get("history") or [
        {"timestamp": created_at, "action": "created", "note": "Project created."}
    ]

    item = {
        "project_id": project_id,

        "projectName": body.get("projectName", "").strip(),
        "projectDescription": body.get("projectDescription", "").strip(),

        # Company identity
        "legalName": body.get("legalName", "").strip(),
        "registeredAddress": body.get("registeredAddress", "").strip(),
        "cin": body.get("cin", "").strip(),
        "taxRegistrationNumber": body.get("taxRegistrationNumber", "").strip(),
        "incorporationDate": body.get("incorporationDate", ""),
        "entityType": body.get("entityType", ""),
        "subsidiaries": body.get("subsidiaries", "").strip(),

        # Key officials
        "ceo": body.get("ceo", "").strip(),
        "contactNumber": body.get("contactNumber", "").strip(),
        "principalContact": body.get("principalContact", "").strip(),

        # Demo-only owner tagging — not real access control, see frontend
        # notes on the demo user switcher.
        "ownerId": body.get("ownerId", ""),
        "ownerName": body.get("ownerName", ""),

        # Audit scope
        "auditPeriodStart": body.get("auditPeriodStart", ""),
        "auditPeriodEnd": body.get("auditPeriodEnd", ""),
        "auditDescription": body.get("auditDescription", "").strip(),

        "status": (body.get("status") or "Active").strip() if isinstance(body.get("status", "Active"), str) else "Active",
        "history": history,
        "createdAt": created_at,
        "updatedAt": created_at,
    }

    if not item["projectName"]:
        raise ValueError("projectName is required.")
    if not item["legalName"]:
        raise ValueError("legalName is required.")
    if not item["auditPeriodStart"] or not item["auditPeriodEnd"]:
        raise ValueError("auditPeriodStart and auditPeriodEnd are required.")

    # put_item takes plain attribute names, so reserved words like "status"
    # are fine here; only Update/Condition/Projection expressions need
    # ExpressionAttributeNames.
    projects_table.put_item(Item=item)

    item["projectId"] = project_id
    return item


def update_project(project_id, body):
    existing = get_project_by_id(project_id)
    if not existing:
        return None

    updatable_fields = [
        "projectName", "projectDescription",
        "legalName", "registeredAddress", "cin", "taxRegistrationNumber",
        "incorporationDate", "entityType", "subsidiaries",
        "ceo", "contactNumber", "principalContact",
        "auditPeriodStart", "auditPeriodEnd", "auditDescription",
        "status",
    ]

    # FIX: every attribute name goes through a "#name" placeholder
    # (ExpressionAttributeNames). DynamoDB rejects reserved words such as
    # "status" when they appear directly in an UpdateExpression, which is
    # what caused the HTTP 500. Using placeholders for ALL fields means no
    # current or future field name can trigger the same error.
    update_expr_parts = []
    expr_names = {}
    expr_values = {}

    for index, field in enumerate(updatable_fields):
        if field not in body:
            continue
        value = body[field]
        if field == "status":
            if not isinstance(value, str) or not value.strip():
                raise ValueError("status must be a non-empty string.")
            value = value.strip()
        update_expr_parts.append(f"#f{index} = :v{index}")
        expr_names[f"#f{index}"] = field
        expr_values[f":v{index}"] = value

    # Append a history entry alongside whatever else changed, embedded
    # directly on the item (see note at top of file). Callers can pass a
    # specific historyNote/historyAction (e.g. "Uploaded document: x.pdf")
    # instead of the generic message — used for file uploads, agent report
    # generation, etc. A status change gets its own clear note when the
    # caller didn't supply one.
    updated_at = now_iso()
    history_note = body.get("historyNote")
    history_action = body.get("historyAction") or "updated"
    if not history_note:
        old_status = existing.get("status")
        new_status = expr_values.get(f":v{updatable_fields.index('status')}")
        if new_status is not None and new_status != old_status:
            history_note = f"Status changed from '{old_status or 'none'}' to '{new_status}'."
            if body.get("historyAction") is None:
                history_action = "status_changed"
        else:
            history_note = "Project details updated."
    new_history_entry = {"timestamp": updated_at, "action": history_action, "note": history_note}
    updated_history = (existing.get("history") or []) + [new_history_entry]

    update_expr_parts.append("#history = :history")
    expr_names["#history"] = "history"
    expr_values[":history"] = updated_history

    update_expr_parts.append("#updatedAt = :updatedAt")
    expr_names["#updatedAt"] = "updatedAt"
    expr_values[":updatedAt"] = updated_at

    projects_table.update_item(
        Key={"project_id": project_id},
        UpdateExpression="SET " + ", ".join(update_expr_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )

    return get_project_by_id(project_id)


def handler(event, context):
    try:
        method = event.get("httpMethod", "GET")

        if method == "OPTIONS":
            return response(200, {"message": "OK"})

        path_parameters = event.get("pathParameters") or {}
        project_id = path_parameters.get("project_id") or path_parameters.get("projectId")

        # ── GET /projects or /projects/{project_id} ──────────────────────
        if method == "GET":
            if project_id:
                item = get_project_by_id(project_id)
                if not item:
                    return response(404, {"message": "Project not found."})
                item["projectId"] = project_id
                return response(200, {"project": item})

            items = scan_all_projects()
            for it in items:
                it["projectId"] = it.get("project_id")
            items = sorted(items, key=lambda i: i.get("createdAt") or "", reverse=True)
            return response(200, {"projects": items})

        # ── POST /projects ────────────────────────────────────────────────
        if method == "POST":
            body = json.loads(event.get("body") or "{}")
            try:
                item = create_project(body)
            except ValueError as ve:
                return response(400, {"message": str(ve)})
            return response(201, {"project": item})

        # ── PUT /projects/{project_id} ──────────────────────────────────
        if method == "PUT":
            if not project_id:
                return response(400, {"message": "project_id is required."})
            body = json.loads(event.get("body") or "{}")
            try:
                updated = update_project(project_id, body)
            except ValueError as ve:
                return response(400, {"message": str(ve)})
            if not updated:
                return response(404, {"message": "Project not found."})
            updated["projectId"] = project_id
            return response(200, {"project": updated})

        # ── DELETE /projects/{project_id} ───────────────────────────────
        if method == "DELETE":
            if not project_id:
                return response(400, {"message": "project_id is required."})
            projects_table.delete_item(Key={"project_id": project_id})
            return response(200, {"message": "Project deleted."})

        return response(405, {"message": "Method not allowed."})

    except Exception as error:
        print("ERROR:", str(error))
        return response(500, {"message": "Projects API failed.", "error": str(error)})


lambda_handler = handler