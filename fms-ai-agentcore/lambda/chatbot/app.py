import os
import json
import uuid
import time
import decimal
import traceback
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Attr


REGION = os.environ.get("AWS_REGION", "eu-central-1")

CHAT_HISTORY_TABLE = os.environ.get("CHAT_HISTORY_TABLE", "")
REPORTS_TABLE      = os.environ.get("REPORTS_TABLE", "")
REPORT_BUCKET      = os.environ.get("REPORT_BUCKET", "")
JOBS_TABLE         = os.environ.get("JOBS_TABLE", "")

AUDIT_PLANNING_WORKER_FUNCTION_NAME = os.environ.get(
    "AUDIT_PLANNING_WORKER_FUNCTION_NAME", ""
)

MAX_HISTORY_MESSAGES  = int(os.environ.get("MAX_HISTORY_MESSAGES", "10"))
MAX_REPORT_CONTEXT_CHARS = int(os.environ.get("MAX_REPORT_CONTEXT_CHARS", "18000"))
JOB_TTL_SECONDS = int(os.environ.get("JOB_TTL_SECONDS", str(60 * 60 * 24)))

dynamodb     = boto3.resource("dynamodb", region_name=REGION)
s3           = boto3.client("s3", region_name=REGION)
lambda_client = boto3.client("lambda", region_name=REGION)


def lambda_handler(event, context):
    try:
        print("CHATBOT_EVENT:", json.dumps(event)[:1500])

        http_method = event.get("httpMethod")

        if http_method == "OPTIONS":
            return api_response(200, {"message": "OK"})

        path_params     = event.get("pathParameters") or {}
        job_id_from_path = path_params.get("jobId")

        if http_method == "GET" and job_id_from_path:
            return handle_job_status(job_id_from_path)

        body = parse_body(event)

        user_message = (
            body.get("message")
            or body.get("query")
            or body.get("question")
            or ""
        ).strip()

        if not user_message:
            return api_response(400, {"error": "message is required"})

        session_id     = body.get("sessionId") or body.get("session_id") or str(uuid.uuid4())
        user_id        = body.get("userId")    or body.get("user_id")    or "default-user"
        report_id      = body.get("reportId")  or body.get("report_id")

        # ── Extract selected agent and mode ───────────────────────────────
        selected_agent = (
            body.get("selectedAgent")
            or body.get("selected_agent")
            or body.get("agent")
            or "audit_planning_agent"
        )
        general_mode = (
            body.get("generalMode")
            or body.get("general_mode")
            or selected_agent == "general_kb_agent"
            or False
        )
        manager_mode = body.get("managerMode") or body.get("manager_mode") or False

        print("CHAT_USER_MESSAGE:", user_message)
        print("CHAT_REPORT_ID:", report_id)
        print("CHAT_SELECTED_AGENT:", selected_agent)
        print("CHAT_GENERAL_MODE:", general_mode)

        selected_report_context = get_selected_report_context(body, report_id)
        print("CHAT_CONTEXT_LENGTH:", len(selected_report_context or ""))

        save_chat_message(
            session_id=session_id,
            user_id=user_id,
            role="user",
            content=user_message,
            report_id=report_id,
            metadata={"selectedAgent": selected_agent},
        )

        job_id = create_job(
            session_id=session_id,
            user_id=user_id,
            report_id=report_id,
        )

        invoke_worker_async(
            job_id=job_id,
            user_message=user_message,
            selected_report_context=selected_report_context,
            report_id=report_id,
            session_id=session_id,
            user_id=user_id,
            selected_agent=selected_agent,
            general_mode=general_mode,
            manager_mode=manager_mode,
        )

        return api_response(
            202,
            {
                "status":        "processing",
                "jobId":         job_id,
                "sessionId":     session_id,
                "selectedAgent": selected_agent,
            },
        )

    except Exception as e:
        print("CHATBOT_LAMBDA_ERROR:", str(e))
        print(traceback.format_exc())
        return api_response(
            500,
            {
                "error":   str(e),
                "message": "Chatbot Lambda failed. Check CloudWatch logs.",
            },
        )


def handle_job_status(job_id):
    try:
        job = get_job(job_id)

        if not job:
            return api_response(404, {"status": "not_found", "jobId": job_id})

        status = job.get("status", "processing")

        if status == "complete":
            answer       = job.get("answer", "")
            citations    = job.get("citations", [])
            sources      = job.get("sources", [])
            session_id   = job.get("session_id")
            user_id      = job.get("user_id")
            report_id    = job.get("report_id")
            selected_agent = job.get("selected_agent", "audit_planning_agent")

            if not job.get("savedToHistory") and session_id:
                save_chat_message(
                    session_id=session_id,
                    user_id=user_id or "default-user",
                    role="assistant",
                    content=answer,
                    report_id=report_id,
                    metadata={"selectedAgent": selected_agent},
                )
                mark_job_saved_to_history(job_id)

            return api_response(
                200,
                {
                    "status":        "complete",
                    "jobId":         job_id,
                    "answer":        answer,
                    "selectedAgent": selected_agent,
                    "agentOutputs":  {},
                    "citations":     citations,
                    "sources":       sources,
                },
            )

        if status == "failed":
            return api_response(
                200,
                {
                    "status": "failed",
                    "jobId":  job_id,
                    "error":  job.get("error", "Generation failed."),
                },
            )

        return api_response(200, {"status": "processing", "jobId": job_id})

    except Exception as e:
        print("JOB_STATUS_ERROR:", str(e))
        print(traceback.format_exc())
        return api_response(500, {"error": str(e)})


def parse_body(event):
    body = event.get("body", event)
    if isinstance(body, str):
        if not body:
            return {}
        return json.loads(body)
    if isinstance(body, dict):
        return body
    return {}


def api_response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type":                 "application/json",
            "Access-Control-Allow-Origin":  "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token",
            "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
        },
        "body": json.dumps(body, default=json_decimal_default),
    }


def json_decimal_default(obj):
    if isinstance(obj, decimal.Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    raise TypeError


def create_job(session_id, user_id, report_id):
    job_id = str(uuid.uuid4())

    if not JOBS_TABLE:
        print("JOBS_TABLE not configured; job tracking will not work")
        return job_id

    table = dynamodb.Table(JOBS_TABLE)

    now_ms    = int(time.time() * 1000)
    ttl_epoch = int(time.time()) + JOB_TTL_SECONDS

    table.put_item(
        Item={
            "job_id":     job_id,
            "status":     "processing",
            "session_id": session_id,
            "user_id":    user_id,
            "report_id":  report_id or "",
            "createdAt":  datetime.now(timezone.utc).isoformat(),
            "createdAtMs": now_ms,
            "ttl":        ttl_epoch,
        }
    )

    return job_id


def get_job(job_id):
    if not JOBS_TABLE:
        return None
    table    = dynamodb.Table(JOBS_TABLE)
    response = table.get_item(Key={"job_id": job_id})
    return response.get("Item")


def mark_job_saved_to_history(job_id):
    if not JOBS_TABLE:
        return
    try:
        table = dynamodb.Table(JOBS_TABLE)
        table.update_item(
            Key={"job_id": job_id},
            UpdateExpression="SET savedToHistory = :v",
            ExpressionAttributeValues={":v": True},
        )
    except Exception as e:
        print("Failed to mark job saved to history:", str(e))


def invoke_worker_async(
    job_id,
    user_message,
    selected_report_context,
    report_id,
    session_id,
    user_id,
    selected_agent="audit_planning_agent",
    general_mode=False,
    manager_mode=False,
):
    if not AUDIT_PLANNING_WORKER_FUNCTION_NAME:
        raise RuntimeError(
            "AUDIT_PLANNING_WORKER_FUNCTION_NAME is not configured."
        )

    payload = {
        "job_id":                   job_id,
        "user_message":             user_message,
        "selected_report_context":  selected_report_context or "",
        "report_id":                report_id,
        "session_id":               session_id,
        "user_id":                  user_id,
        "selected_agent":           selected_agent,
        "general_mode":             general_mode,
        "manager_mode":             manager_mode,
    }

    print("DISPATCHING_WORKER_JOB:", job_id)
    print("WORKER_SELECTED_AGENT:", selected_agent)
    print("WORKER_GENERAL_MODE:", general_mode)

    lambda_client.invoke(
        FunctionName=AUDIT_PLANNING_WORKER_FUNCTION_NAME,
        InvocationType="Event",
        Payload=json.dumps(payload).encode("utf-8"),
    )


def get_selected_report_context(body, report_id):
    direct_context = (
        body.get("selectedReportContext")
        or body.get("selected_report_context")
        or body.get("reportContext")
        or body.get("report_context")
        or body.get("extractedText")
        or body.get("extracted_text")
        or body.get("documentText")
        or body.get("document_text")
    )

    if direct_context:
        return str(direct_context)[:MAX_REPORT_CONTEXT_CHARS]

    if not report_id:
        return ""

    return get_report_context_from_dynamodb(report_id)[:MAX_REPORT_CONTEXT_CHARS]


def get_report_context_from_dynamodb(report_id):
    if not REPORTS_TABLE:
        print("REPORTS_TABLE not configured")
        return ""

    try:
        table    = dynamodb.Table(REPORTS_TABLE)
        response = table.get_item(Key={"document_id": report_id})
        item     = response.get("Item", {})

        print("REPORT_ITEM_FOUND:", bool(item))

        if not item:
            return ""

        for field in [
            "extractedText", "extracted_text", "documentText",
            "document_text", "reportMarkdown", "markdown", "sourceTextPreview",
        ]:
            if item.get(field):
                value = str(item[field])
                print("REPORT_CONTEXT_FIELD_USED:", field)
                print("REPORT_CONTEXT_LENGTH:", len(value))
                return value

        bucket = (
            item.get("extractedTextBucket")
            or item.get("extracted_text_bucket")
            or item.get("source_bucket")
            or item.get("sourceBucket")
            or REPORT_BUCKET
        )
        key = (
            item.get("extractedTextKey")
            or item.get("extracted_text_key")
            or item.get("source_key")
            or item.get("sourceKey")
        )

        if bucket and key:
            print("READING_REPORT_CONTEXT_FROM_S3 BUCKET:", bucket, "KEY:", key)
            s3_object = s3.get_object(Bucket=bucket, Key=key)
            value     = s3_object["Body"].read().decode("utf-8", errors="ignore")
            print("S3_CONTEXT_LENGTH:", len(value))
            return value

    except Exception as e:
        print("Report context retrieval failed:", str(e))
        print(traceback.format_exc())

    return ""


def get_chat_history(session_id):
    if not CHAT_HISTORY_TABLE:
        return []
    try:
        table    = dynamodb.Table(CHAT_HISTORY_TABLE)
        response = table.scan(
            FilterExpression=Attr("sessionId").eq(session_id),
            Limit=MAX_HISTORY_MESSAGES,
        )
        items = sorted(response.get("Items", []), key=lambda x: int(x.get("timestamp", 0)))
        return [{"role": i.get("role", ""), "content": i.get("content", "")} for i in items[-MAX_HISTORY_MESSAGES:]]
    except Exception as e:
        print("Chat history retrieval failed:", str(e))
        print(traceback.format_exc())
        return []


def save_chat_message(session_id, user_id, role, content, report_id=None, metadata=None):
    if not CHAT_HISTORY_TABLE:
        return
    try:
        table  = dynamodb.Table(CHAT_HISTORY_TABLE)
        now_ms = int(time.time() * 1000)
        log_id = f"{session_id}#{now_ms}#{uuid.uuid4()}"
        table.put_item(
            Item={
                "log_id":    log_id,
                "sessionId": session_id,
                "timestamp": now_ms,
                "messageId": str(uuid.uuid4()),
                "userId":    user_id,
                "role":      role,
                "content":   content,
                "reportId":  report_id or "",
                "metadata":  metadata or {},
                "createdAt": datetime.now(timezone.utc).isoformat(),
            }
        )
    except Exception as e:
        print("Chat history save failed:", str(e))
        print(traceback.format_exc())