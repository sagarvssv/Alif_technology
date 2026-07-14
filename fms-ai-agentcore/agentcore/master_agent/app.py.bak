import json
import os
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer

import boto3

AGENT_NAME = "master_agent"
PORT = int(os.environ.get("PORT", "8080"))

AGENTCORE_REGION = os.environ.get("AGENTCORE_REGION", "eu-central-1")
QUALIFIER = os.environ.get("MASTER_AGENT_QUALIFIER", "DEFAULT")

AUDIT_PLANNING_AGENT_RUNTIME_ARN = os.environ.get(
    "AUDIT_PLANNING_AGENT_RUNTIME_ARN",
    "arn:aws:bedrock-agentcore:eu-central-1:497675597422:runtime/AuditPlanningAgent-ZKNs0d8l0Y",
)

FS_REVIEW_AGENT_RUNTIME_ARN = os.environ.get(
    "FS_REVIEW_AGENT_RUNTIME_ARN",
    "arn:aws:bedrock-agentcore:eu-central-1:497675597422:runtime/FinancialStatementReviewAgent-zFomoS7l0t",
)

agentcore_runtime = boto3.client("bedrock-agentcore", region_name=AGENTCORE_REGION)

# ── Sub-agent registry ──────────────────────────────────────────────────
SUB_AGENT_REGISTRY = {
    "audit_planning_agent": {
        "display_name": "Audit Planning Agent",
        "runtime_arn": AUDIT_PLANNING_AGENT_RUNTIME_ARN,
        "status": "working",
        "description": (
            "Generates engagement strategy, materiality calculations, risk "
            "assessment, audit programs, and staffing recommendations from "
            "an uploaded financial statement."
        ),
        "generate_triggers": [
            "generate audit planning",
            "generate audit plan",
            "generate the audit",
            "create audit plan",
            "create audit planning",
            "produce audit plan",
            "start audit planning",
            "run audit planning",
            "audit planning.",
            "audit planning report",
        ],
    },
    "fs_review_agent": {
        "display_name": "Financial Statement Review Agent",
        "runtime_arn": FS_REVIEW_AGENT_RUNTIME_ARN,
        "status": "working",
        "description": (
            "Reviews financial statements for IFRS compliance, missing "
            "disclosures, note consistency, classification issues, ratio "
            "and trend analysis, going concern indicators, and related "
            "party disclosures."
        ),
        "generate_triggers": [
            "generate financial statement review",
            "generate fs review",
            "generate review",
            "financial statement review.",
            "review financial statement",
            "start review",
            "run review",
            "produce review",
        ],
    },
}

SUMMARIZE_KEYWORDS = ["sub-agent", "sub agent", "both reports", "both agent"]


def safe_json_dumps(data):
    return json.dumps(data, ensure_ascii=False)


def safe_json_loads(value, default=None):
    if default is None:
        default = {}
    if not value:
        return default
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="ignore")
    try:
        return json.loads(value)
    except Exception:
        return default


def prepare_imports():
    import sys
    current_dir = os.path.dirname(os.path.abspath(__file__))
    agentcore_dir = os.path.abspath(os.path.join(current_dir, ".."))
    if agentcore_dir not in sys.path:
        sys.path.append(agentcore_dir)


def detect_target_agent(user_message):
    """Return the sub-agent key this message should route to, or None if
    this looks like a general/meta question rather than a task request."""
    msg_lower = (user_message or "").lower().strip()
    for agent_key, info in SUB_AGENT_REGISTRY.items():
        if any(trigger in msg_lower for trigger in info["generate_triggers"]):
            return agent_key
    return None


def is_summarize_request(user_message):
    msg_lower = (user_message or "").lower()
    return "summarize" in msg_lower and any(k in msg_lower for k in SUMMARIZE_KEYWORDS)


def split_combined_reports(combined_text):
    """Frontend sends both raw reports joined with a marker in the same
    directContext field normally used for a single document's text."""
    marker = "===FS_REPORT_RAW==="
    text = combined_text or ""
    if marker in text:
        before, after = text.split(marker, 1)
        audit_part = before.replace("===AUDIT_REPORT_RAW===", "", 1).strip()
        fs_part = after.strip()
        return audit_part, fs_part
    return text, ""


def get_any_context_field(payload):
    """Pull the document context out of whichever field name it arrived
    under. Different upstream callers (Worker Lambda, frontend, etc.) use
    different field names, so check all of them rather than just one or two."""
    return (
        payload.get("directContext")
        or payload.get("direct_context")
        or payload.get("documentText")
        or payload.get("document_text")
        or payload.get("selectedReportContext")
        or payload.get("selected_report_context")
        or ""
    )


def invoke_sub_agent(agent_key, payload):
    info = SUB_AGENT_REGISTRY[agent_key]
    runtime_arn = info["runtime_arn"]

    response = agentcore_runtime.invoke_agent_runtime(
        agentRuntimeArn=runtime_arn,
        qualifier=QUALIFIER,
        payload=json.dumps(payload).encode("utf-8"),
    )

    body = response.get("response") or response.get("body") or response.get("payload")

    if hasattr(body, "read"):
        body = body.read()
    if isinstance(body, bytes):
        body = body.decode("utf-8", errors="ignore")

    if isinstance(body, str):
        parsed = json.loads(body)
    elif isinstance(body, dict):
        parsed = body
    else:
        parsed = {}

    return parsed


def build_registry_context():
    lines = []
    for agent_key, info in SUB_AGENT_REGISTRY.items():
        lines.append(
            f"- {info['display_name']} (key: {agent_key}, status: {info['status']}): "
            f"{info['description']}"
        )
    return "\n".join(lines)


def summarize_sub_reports(invoke_claude, audit_text, fs_text):
    """Master Agent actually reads and analyses both raw sub-agent reports
    and writes its own original summary for each — not a copy-paste."""
    system_prompt = """
You are the Master Agent for an audit intelligence platform. You have been
given the full raw output of two specialist agent reports. Read each one
and write your own plain-English summary — do not copy sentences verbatim,
synthesise the key points as if briefing a business owner who is not an
accountant.

STRICT RULES:
- Summarize the Audit Planning report in 3-4 short sentences: what the
  engagement covers, the overall materiality figure, and the top 1-2 risk
  areas needing the most attention. Use actual figures if present.
- Summarize the Financial Statement Review report in 3-4 short sentences:
  overall disclosure quality, and the top 1-2 most critical issues found.
  Use actual figures if present.
- If a report is missing or empty, say so plainly in 1 sentence instead.
- Do NOT repeat tables, bullet lists, or headings from the original reports.
- Output EXACTLY in this format, nothing else, no extra commentary:

## AUDIT_SUMMARY
<your 3-4 sentence summary here>

## FS_SUMMARY
<your 3-4 sentence summary here>
"""
    user_prompt = f"""
AUDIT PLANNING REPORT (raw):
{audit_text or "No audit planning report has been generated yet."}

---

FINANCIAL STATEMENT REVIEW REPORT (raw):
{fs_text or "No financial statement review report has been generated yet."}

Analyse and summarize both reports following the exact format instructed.
"""
    try:
        result = invoke_claude(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=700,
            temperature=0,
        )
        return (result or "").strip()
    except Exception as exc:
        return (
            f"## AUDIT_SUMMARY\nUnable to generate summary. Error: {str(exc)}\n\n"
            f"## FS_SUMMARY\nUnable to generate summary. Error: {str(exc)}"
        )


def answer_meta_question(invoke_claude, user_message):
    system_prompt = """
You are the Master Agent for an audit intelligence platform. You oversee
two sub-agents and can answer questions about what each one does, which
one a user should use, or how they compare.

STRICT RULES:
- Answer ONLY using the sub-agent information provided below.
- Do NOT generate an audit plan or a financial statement review yourself.
- If the user's request is actually a task (e.g. "generate my audit plan"),
  tell them you'll route it to the right agent rather than answering it here.
- Use plain, simple English. Maximum 300 words.
"""
    user_prompt = f"""
Sub-agents available on this platform:
{build_registry_context()}

User question:
{user_message}

Answer the question directly using only the information above.
"""
    try:
        result = invoke_claude(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=500,
            temperature=0,
        )
        return (result or "").strip()
    except Exception as exc:
        return f"Unable to answer this question. Error: {str(exc)}"


def run_agent(payload):
    prepare_imports()
    from shared.bedrock import invoke_claude
    from shared.utils import get_direct_context_from_payload, get_message_from_payload

    user_message = get_message_from_payload(payload) or "What can you help me with?"

    # ── Summarize both sub-agent reports (Master Agent does the analysis) ──
    if is_summarize_request(user_message):
        combined_context = get_direct_context_from_payload(payload) or get_any_context_field(payload)
        audit_text, fs_text = split_combined_reports(combined_context)
        raw_summary = summarize_sub_reports(invoke_claude, audit_text, fs_text)
        return {
            "answer": raw_summary,
            "citations": [],
            "sources": [],
            "selectedAgent": AGENT_NAME,
            "agentType": "master_summary",
            "agentName": "Master Agent",
        }

    target_agent = detect_target_agent(user_message)

    if target_agent:
        # Forward the context under EVERY field name variant, no matter
        # which one it originally arrived as. This is the fix: previously
        # only directContext/direct_context were forwarded, silently
        # dropping documentText/document_text — which is what Worker
        # Lambda actually sends, causing sub-agents to see no document
        # context at all even though it was present in the request.
        context_value = get_any_context_field(payload)

        sub_payload = {
            "message":                 user_message,
            "question":                user_message,
            "selectedAgent":           target_agent,
            "agent":                   target_agent,
            "generalMode":             payload.get("generalMode", False),
            "general_mode":            payload.get("general_mode", False),
            "reportId":                payload.get("reportId") or payload.get("report_id"),
            "report_id":               payload.get("reportId") or payload.get("report_id"),
            "directContext":           context_value,
            "direct_context":          context_value,
            "documentText":            context_value,
            "document_text":          context_value,
            "selectedReportContext":   context_value,
            "selected_report_context": context_value,
        }

        try:
            parsed = invoke_sub_agent(target_agent, sub_payload)
        except Exception as exc:
            return {
                "answer": f"Master Agent could not reach {SUB_AGENT_REGISTRY[target_agent]['display_name']}. Error: {str(exc)}",
                "error": str(exc),
                "selectedAgent": AGENT_NAME,
                "routedTo": target_agent,
                "citations": [],
                "sources": [],
            }

        answer    = parsed.get("answer") or parsed.get("response") or parsed.get("message") or json.dumps(parsed)
        citations = parsed.get("citations") or []
        sources   = parsed.get("sources")   or []

        return {
            "answer": answer,
            "citations": citations,
            "sources": sources,
            "selectedAgent": AGENT_NAME,
            "routedTo": target_agent,
            "agentType": "master_routed",
            "agentName": f"Master Agent -> {SUB_AGENT_REGISTRY[target_agent]['display_name']}",
        }

    answer = answer_meta_question(invoke_claude, user_message)
    return {
        "answer": answer,
        "citations": [],
        "sources": [],
        "selectedAgent": AGENT_NAME,
        "routedTo": None,
        "agentType": "master_meta",
        "agentName": "Master Agent",
    }


class AgentCoreHTTPHandler(BaseHTTPRequestHandler):
    timeout = 120

    def _send_json(self, status_code, payload):
        body = safe_json_dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send_json(200, {
            "status": "ok",
            "agent": AGENT_NAME,
            "message": "Master AgentCore runtime is running.",
            "sub_agents": list(SUB_AGENT_REGISTRY.keys()),
        })

    def do_POST(self):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length).decode("utf-8")
            payload = safe_json_loads(raw_body, {})
            result = run_agent(payload)
            self._send_json(200, result)
        except Exception as exc:
            self._send_json(200, {
                "answer": f"Master Agent failed: {str(exc)}",
                "error": str(exc),
                "traceback": traceback.format_exc(),
                "selectedAgent": AGENT_NAME,
                "citations": [],
                "sources": [],
            })


def main():
    server = HTTPServer(("0.0.0.0", PORT), AgentCoreHTTPHandler)
    server.timeout = 120
    print(f"Master AgentCore runtime running on port {PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()