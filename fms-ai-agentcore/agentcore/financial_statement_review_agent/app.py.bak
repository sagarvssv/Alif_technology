import json
import os
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer

AGENT_NAME = "financial_statement_review_agent"
PORT = int(os.environ.get("PORT", "8080"))


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


def run_agent(payload):
    prepare_imports()

    from shared.bedrock import invoke_claude
    from shared.kb import retrieve_from_kb, format_citations
    from shared.report_context import get_report_context, build_context_summary
    from shared.utils import (
        build_response,
        compact_text,
        get_direct_context_from_payload,
        get_message_from_payload,
        get_report_id_from_payload,
    )

    original_user_message = get_message_from_payload(payload)
    report_id             = get_report_id_from_payload(payload)
    direct_context        = get_direct_context_from_payload(payload)

    user_message = original_user_message or "Generate financial statement review."

    if not report_id:
        kb_context, citations = retrieve_from_kb(user_message, number_of_results=4)
        answer = answer_general_question(
            invoke_claude=invoke_claude,
            user_message=user_message,
            kb_context=kb_context,
        )
        return build_response(
            answer=answer,
            selected_agent=AGENT_NAME,
            citations=citations,
            extra={"agentType": "fs_review", "agentName": "Financial Statement Review Agent"},
        )

    report_context  = get_report_context(report_id=report_id, direct_context=direct_context)
    # Use smaller context to avoid AgentCore timeout
    context_summary = build_context_summary(compact_text(report_context, max_chars=8000))

    generate_triggers = [
        "generate financial statement review",
        "generate fs review",
        "generate review",
        "financial statement review.",
        "review financial statement",
        "start review",
        "run review",
        "produce review",
    ]

    msg_lower = user_message.lower().strip()
    is_generate = any(t in msg_lower for t in generate_triggers)

    if is_generate:
        kb_context, citations = retrieve_from_kb(
            "IFRS financial statement review compliance disclosures ratios going concern related party",
            number_of_results=4,
        )
        answer = generate_fs_review_output(
            invoke_claude=invoke_claude,
            report_context=context_summary,
            kb_context=kb_context,
        )
    else:
        kb_context, citations = retrieve_from_kb(user_message, number_of_results=4)
        answer = answer_followup_question(
            invoke_claude=invoke_claude,
            user_message=user_message,
            report_context=context_summary,
            kb_context=kb_context,
        )

    return build_response(
        answer=answer,
        selected_agent=AGENT_NAME,
        citations=citations,
        extra={"agentType": "fs_review", "agentName": "Financial Statement Review Agent"},
    )


def generate_fs_review_output(invoke_claude, report_context, kb_context):
    """Generate complete FS review as single call with enough tokens to avoid truncation."""

    system_prompt = """
You are an IFRS financial statement reviewer who writes for a business owner
or manager who is NOT an accountant — use plain, simple English.

RULES:
- Every table row must have ALL 4 columns filled.
- Risk Rating: must be exactly one of these words only — High | Medium | Low.
  Do NOT output a percentage or any other word. The interface converts this
  word into a risk percentage automatically, so it MUST match exactly.
- Column 1 ("Issue"): a SHORT plain-English label only, 4-8 words, like a
  headline. No numbers, no dollar signs, no punctuation beyond spaces.
  Examples: "Missing Revenue Recognition Policy", "Unexplained Margin Jump",
  "No Related Party Disclosure". This label becomes the report card title,
  so it MUST be short — never a full sentence.
- Column 2 ("What This Means"): the full plain-English explanation of the
  issue, written in short sentences (max 18 words per sentence) a
  non-accountant can understand. Use actual figures from the document.
  End the cell with the applicable standard in parentheses, e.g. "(IFRS 15)"
  or "(IAS 24)". This is the ONLY place the standard reference should appear.
- Column 3: Risk Rating (High/Medium/Low, see above).
- Column 4: Recommendation — a plain-English, actionable next step.
- Keep column 2 and column 4 concise: maximum 30 words per cell.
- Maximum 3 rows per section (except section 5 which needs exactly 6 ratios).
- Do NOT add explanations outside the tables.
- CRITICAL: You MUST complete all 7 sections AND the Overall Review Summary.
  If you are running low on space, shorten or trim earlier sections first —
  never stop mid-sentence and never leave the Overall Review Summary incomplete.
  A shorter but complete report is always better than a longer but truncated one.
"""

    user_prompt = f"""
Financial statement data:
{report_context or "No document data available."}

Knowledge Base:
{kb_context or "No knowledge base results."}

Generate the complete Financial Statement Review Report with all 7 sections below.
Use actual USD figures from the document.
Column 1 must be a short 4-8 word label (the card title) — for example
"Missing Revenue Recognition Policy" — with NO numbers or figures in it.
Column 2 must contain the full plain-English explanation with actual figures,
ending with the standard in parentheses — for example: "Revenue jumped from
$20.2M to $56.3M but no policy explains how sales are recorded. (IFRS 15)"
You must reach and fully complete the Overall Review Summary at the end.

# Financial Statement Review Report

---

## 1. IFRS Compliance Review
| Issue | What This Means | Risk Rating | Recommendation |
|-------|-----------------|-------------|----------------|
[3 specific issues with actual figures]

---

## 2. Missing Disclosures
| Issue | What This Means | Risk Rating | Recommendation |
|-------|-----------------|-------------|----------------|
[3 specific missing disclosures]

---

## 3. Note Consistency Checks
| Issue | What This Means | Risk Rating | Recommendation |
|-------|-----------------|-------------|----------------|
[2 specific inconsistencies]

---

## 4. Classification Review
| Issue | What This Means | Risk Rating | Recommendation |
|-------|-----------------|-------------|----------------|
[2 classification issues]

---

## 5. Ratio and Trend Analysis
| Ratio | Value | Benchmark | Assessment |
|-------|-------|-----------|------------|
[Calculate exactly these 6 ratios using actual figures:
Current Ratio | Gross Margin % | Net Margin % | Debt-to-Equity | Return on Assets % | Receivables Days]

---

## 6. Going Concern Indicators
| Indicator | What This Means | Risk Rating | Recommendation |
|-----------|-----------------|-------------|----------------|
[3 indicators — mix of positive and negative, short 4-8 word labels]

---

## 7. Related Party Disclosure Review
| Issue | What This Means | Risk Rating | Recommendation |
|-------|-----------------|-------------|----------------|
[2 related party disclosure issues]

---

## Overall Review Summary
[3-4 sentences: overall quality, top 2 critical issues, priority action. Use specific amounts.
This section MUST be present and complete — do not stop before finishing it.]
"""

    try:
        result = invoke_claude(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=4000,
            temperature=0,
        )
        answer = (result or "").strip()
    except Exception as exc:
        return f"# Financial Statement Review Report\n\n_Could not be generated: {str(exc)}_"

    if not answer.lstrip().startswith("# Financial Statement Review"):
        answer = "# Financial Statement Review Report\n\n---\n\n" + answer.lstrip()

    return answer


def answer_general_question(invoke_claude, user_message, kb_context):
    system_prompt = """
You are an IFRS financial statement review expert.
Answer the user's question clearly. Maximum 300 words.
Do NOT generate a full financial statement review report.
"""
    user_prompt = f"""
Knowledge Base:
{kb_context or "No knowledge base results found."}

User question: {user_message}

Answer directly and concisely.
"""
    try:
        result = invoke_claude(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=600,
            temperature=0,
        )
        return (result or "").strip()
    except Exception as exc:
        return f"Unable to retrieve an answer. Error: {str(exc)}"


def answer_followup_question(invoke_claude, user_message, report_context, kb_context):
    system_prompt = """
You are an IFRS financial statement review expert.
Answer the user's specific follow-up question.
Do NOT regenerate the full review report.
Maximum 400 words.
"""
    user_prompt = f"""
Document data:
{report_context or "No document context available."}

Knowledge Base:
{kb_context or "No knowledge base results."}

User question: {user_message}

Answer this specific question using the document data above.
"""
    try:
        result = invoke_claude(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=800,
            temperature=0,
        )
        return (result or "").strip()
    except Exception as exc:
        return f"Unable to answer this question. Error: {str(exc)}"


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
            "message": "Financial Statement Review AgentCore runtime is running.",
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
                "answer": f"Agent failed: {str(exc)}",
                "error": str(exc),
                "traceback": traceback.format_exc(),
                "selectedAgent": AGENT_NAME,
                "citations": [],
                "sources": [],
            })


def main():
    server = HTTPServer(("0.0.0.0", PORT), AgentCoreHTTPHandler)
    server.timeout = 120
    print(f"Financial Statement Review AgentCore runtime running on port {PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()