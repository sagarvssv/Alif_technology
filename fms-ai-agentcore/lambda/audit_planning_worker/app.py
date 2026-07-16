import os
import json
import time
import decimal
import traceback
from datetime import datetime, timezone

import boto3


REGION = os.environ.get("AWS_REGION", "eu-central-1")
JOBS_TABLE = os.environ.get("JOBS_TABLE", "")

AGENTCORE_REGION = os.environ.get("AGENTCORE_REGION", "eu-central-1")
AUDIT_PLANNING_AGENT_RUNTIME_ARN = os.environ.get(
    "AUDIT_PLANNING_AGENT_RUNTIME_ARN",
    "arn:aws:bedrock-agentcore:eu-central-1:497675597422:runtime/AuditPlanningAgent-ZKNs0d8l0Y",
)
AUDIT_PLANNING_AGENT_QUALIFIER = os.environ.get(
    "AUDIT_PLANNING_AGENT_QUALIFIER",
    "DEFAULT",
)

# Financial Statement Review Agent — deploy the agentcore/financial_statement_review_agent
# container as its own Bedrock AgentCore Runtime, then set this ARN (and qualifier,
# if different from DEFAULT) via Lambda environment variables.
FS_REVIEW_AGENT_RUNTIME_ARN = os.environ.get(
    "FS_REVIEW_AGENT_RUNTIME_ARN",
    "",
)
FS_REVIEW_AGENT_QUALIFIER = os.environ.get(
    "FS_REVIEW_AGENT_QUALIFIER",
    "DEFAULT",
)

# Maps the frontend's selectedAgent value to the runtime ARN/qualifier to invoke.
AGENT_RUNTIME_CONFIG = {
    "audit_planning_agent": {
        "arn": AUDIT_PLANNING_AGENT_RUNTIME_ARN,
        "qualifier": AUDIT_PLANNING_AGENT_QUALIFIER,
    },
    "fs_review_agent": {
        "arn": FS_REVIEW_AGENT_RUNTIME_ARN,
        "qualifier": FS_REVIEW_AGENT_QUALIFIER,
    },
}

JOB_TTL_SECONDS = int(os.environ.get("JOB_TTL_SECONDS", str(60 * 60 * 24)))  # 24h

MAX_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 15

dynamodb = boto3.resource("dynamodb", region_name=REGION)
agentcore_runtime = boto3.client("bedrock-agentcore", region_name=AGENTCORE_REGION)


def lambda_handler(event, context):
    job_id = event.get("job_id")

    print("WORKER_INVOKED_FOR_JOB:", job_id)

    if not job_id:
        print("WORKER_ERROR: missing job_id in event")
        return

    last_error = None

    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            print(f"WORKER_ATTEMPT_{attempt}_FOR_JOB:", job_id)

            answer, citations, sources = invoke_agentcore_agent(
                user_message=event.get("user_message", ""),
                selected_report_context=event.get("selected_report_context", ""),
                report_id=event.get("report_id"),
                report_ids=event.get("report_ids"),
                selected_agent=event.get("selected_agent", "audit_planning_agent"),
                general_mode=event.get("general_mode", False),
            )

            update_job(
                job_id,
                status="complete",
                answer=answer,
                citations=citations,
                sources=sources,
            )

            print("WORKER_JOB_COMPLETE:", job_id)
            return

        except Exception as e:
            last_error = str(e)
            print(f"WORKER_ATTEMPT_{attempt}_FAILED:", job_id, last_error)

            is_retryable = (
                "502" in last_error
                or "initialization" in last_error.lower()
                or "RuntimeClientError" in last_error
                or "runtime" in last_error.lower()
            )

            if attempt < MAX_ATTEMPTS and is_retryable:
                print(f"RETRYING in {RETRY_DELAY_SECONDS}s (attempt {attempt}/{MAX_ATTEMPTS})...")
                time.sleep(RETRY_DELAY_SECONDS)
                continue

            print("WORKER_JOB_FAILED:", job_id, last_error)
            print(traceback.format_exc())
            update_job(job_id, status="failed", error=last_error)
            return


def invoke_agentcore_agent(
    user_message,
    selected_report_context="",
    report_id=None,
    report_ids=None,
    selected_agent=None,
    general_mode=False,
):
    agent_key = selected_agent or "audit_planning_agent"
    runtime_config = AGENT_RUNTIME_CONFIG.get(agent_key) or AGENT_RUNTIME_CONFIG["audit_planning_agent"]
    runtime_arn = runtime_config["arn"]
    runtime_qualifier = runtime_config["qualifier"]

    if not runtime_arn:
        raise RuntimeError(
            f"No AgentCore Runtime ARN configured for agent '{agent_key}'. "
            "Set the corresponding *_RUNTIME_ARN environment variable on this Lambda."
        )

    # Support both a single report_id (backward compatible) and a
    # report_ids list (multi-document upload/analysis).
    resolved_report_ids = report_ids if isinstance(report_ids, list) and report_ids else (
        [report_id] if report_id else []
    )

    payload = {
        "message":       user_message,
        "question":      user_message,
        "selectedAgent": agent_key,
        "agent":         agent_key,
        "generalMode":   general_mode or False,
        "general_mode":  general_mode or False,
        "reportId":      resolved_report_ids[0] if resolved_report_ids else None,
        "report_id":     resolved_report_ids[0] if resolved_report_ids else None,
        "reportIds":     resolved_report_ids,
        "report_ids":    resolved_report_ids,
        "directContext":  selected_report_context or "",
        "direct_context": selected_report_context or "",
        "documentText":   selected_report_context or "",
        "document_text":  selected_report_context or "",
    }

    print("WORKER_INVOKING_AGENTCORE_AGENT:", agent_key)
    print("AGENTCORE_RUNTIME_ARN:", runtime_arn)
    print("AGENTCORE_QUALIFIER:", runtime_qualifier)
    print("REPORT_IDS:", resolved_report_ids)
    print("SELECTED_AGENT:", selected_agent)
    print("GENERAL_MODE:", general_mode)
    print("CONTEXT_LENGTH:", len(selected_report_context or ""))

    response = agentcore_runtime.invoke_agent_runtime(
        agentRuntimeArn=runtime_arn,
        qualifier=runtime_qualifier,
        payload=json.dumps(payload).encode("utf-8"),
    )

    body = response.get("response") or response.get("body") or response.get("payload")

    if hasattr(body, "read"):
        body = body.read()

    if isinstance(body, bytes):
        body = body.decode("utf-8", errors="ignore")

    print("WORKER_AGENTCORE_RAW_RESPONSE:", str(body)[:2000])

    if isinstance(body, str):
        parsed = json.loads(body)
    elif isinstance(body, dict):
        parsed = body
    else:
        parsed = {}

    answer = (
        parsed.get("answer")
        or parsed.get("response")
        or parsed.get("message")
        or json.dumps(parsed)
    )

    citations = parsed.get("citations") or []
    sources   = parsed.get("sources")   or []

    return answer, citations, sources


def update_job(job_id, status, answer=None, citations=None, sources=None, error=None):
    if not JOBS_TABLE:
        print("JOBS_TABLE not configured, cannot persist job result")
        return

    table = dynamodb.Table(JOBS_TABLE)

    now_ms     = int(time.time() * 1000)
    ttl_epoch  = int(time.time()) + JOB_TTL_SECONDS

    item = {
        "job_id":      job_id,
        "status":      status,
        "updatedAt":   datetime.now(timezone.utc).isoformat(),
        "updatedAtMs": now_ms,
        "ttl":         ttl_epoch,
    }

    if answer    is not None: item["answer"]    = answer
    if citations is not None: item["citations"] = citations
    if sources   is not None: item["sources"]   = sources
    if error     is not None: item["error"]     = error

    try:
        table.put_item(Item=clean_for_dynamodb(item))
    except Exception as e:
        print("Failed to update job record:", str(e))
        print(traceback.format_exc())


def clean_for_dynamodb(value):
    if isinstance(value, float):
        return decimal.Decimal(str(value))
    if isinstance(value, dict):
        return {k: clean_for_dynamodb(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean_for_dynamodb(v) for v in value]
    return value