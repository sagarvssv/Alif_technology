import json
import decimal
from datetime import datetime, timezone


def json_decimal_default(obj):
    if isinstance(obj, decimal.Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)

    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


def safe_json_dumps(data):
    return json.dumps(data, default=json_decimal_default, ensure_ascii=False)


def safe_json_loads(value, default=None):
    if default is None:
        default = {}

    if not value:
        return default

    if isinstance(value, dict):
        return value

    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="ignore")

    try:
        return json.loads(value)
    except Exception:
        return default


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def normalize_agent_name(agent_name):
    allowed_agents = [
        "master_agent",
        "audit_planning_agent",
        "financial_statement_review_agent",
    ]

    if agent_name in allowed_agents:
        return agent_name

    return "master_agent"


def build_response(answer, selected_agent="master_agent", citations=None, extra=None):
    payload = {
        "answer": answer or "",
        "selectedAgent": selected_agent,
        "citations": citations or [],
        "sources": citations or [],
    }

    if extra:
        payload.update(extra)

    return payload


def parse_agentcore_event(event):
    if not event:
        return {}

    if isinstance(event, bytes):
        return safe_json_loads(event, {})

    if isinstance(event, str):
        return safe_json_loads(event, {})

    if not isinstance(event, dict):
        return {}

    if "body" in event:
        body = event.get("body")
        return safe_json_loads(body, {}) if isinstance(body, (str, bytes)) else body or {}

    if "payload" in event:
        payload = event.get("payload")
        return safe_json_loads(payload, {}) if isinstance(payload, (str, bytes)) else payload or {}

    return event


def get_message_from_payload(payload):
    if not isinstance(payload, dict):
        return ""

    return (
        payload.get("message")
        or payload.get("question")
        or payload.get("query")
        or ""
    ).strip()


def get_report_id_from_payload(payload):
    if not isinstance(payload, dict):
        return ""

    return (
        payload.get("reportId")
        or payload.get("report_id")
        or payload.get("documentId")
        or payload.get("document_id")
        or ""
    )


def get_direct_context_from_payload(payload):
    if not isinstance(payload, dict):
        return ""

    return (
        payload.get("selectedReportContext")
        or payload.get("selected_report_context")
        or payload.get("reportContext")
        or payload.get("report_context")
        or payload.get("documentText")
        or payload.get("document_text")
        or payload.get("extractedText")
        or payload.get("extracted_text")
        or ""
    )


def compact_text(text, max_chars=12000):
    if not text:
        return ""

    text = str(text).strip()

    if len(text) <= max_chars:
        return text

    return text[:max_chars] + "\n\n[Context truncated for length.]"