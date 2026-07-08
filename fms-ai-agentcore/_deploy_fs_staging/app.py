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

    # ── No document — answer general question ────────────────────────────
    if not report_id:
        kb_context, citations = retrieve_from_kb(user_message, number_of_results=6)
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

    # ── Load document context ─────────────────────────────────────────────
    report_context  = get_report_context(report_id=report_id, direct_context=direct_context)
    context_summary = build_context_summary(compact_text(report_context, max_chars=18000))

    # ── Detect if follow-up question or full review ───────────────────────
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
        kb_query = "IFRS financial statement review compliance disclosures ratios going concern related party"
        kb_context, citations = retrieve_from_kb(kb_query, number_of_results=8)
        citation_details = format_citations(citations)

        answer = generate_fs_review_output(
            invoke_claude=invoke_claude,
            report_context=context_summary,
            kb_context=kb_context,
        )
    else:
        # Follow-up question about the review
        kb_context, citations = retrieve_from_kb(user_message, number_of_results=5)
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
    system_prompt = """
You are a senior IFRS financial statement reviewer and audit partner with 20+ years experience.
Your job is to review draft financial statements and identify issues across 7 areas.

STRICT OUTPUT RULES:
- Output ONLY the structured review report below — nothing else before or after.
- Use the EXACT section headings provided.
- Every row in every table must have ALL 4 columns populated.
- Risk Rating must be exactly one of: High | Medium | Low
- Use actual numbers, AED amounts, and line items from the document.
- Be specific — reference exact balances, note numbers, and IFRS standards.
- Do NOT generate an audit planning report.
- Do NOT include Engagement Strategy, Materiality, Staffing, or Audit Programs.
- temperature=0 means identical output every time for the same document.
"""

    user_prompt = f"""
Financial statement data from uploaded document:
{report_context or "No document data available."}

IFRS Knowledge Base context:
{kb_context or "No knowledge base results."}

Generate the complete Financial Statement Review Report below.
Use actual figures from the document throughout. Be specific and professional.

# Financial Statement Review Report

---

## 1. IFRS Compliance Review
Review whether the financial statements comply with applicable IFRS standards.

| Issue | Standard Reference | Risk Rating | Recommendation |
|-------|-------------------|-------------|----------------|
[Generate minimum 4 rows using actual document data. Reference specific IFRS standards e.g. IFRS 15, IAS 36, IFRS 9, IAS 1, IFRS 16.]

---

## 2. Missing Disclosures
Identify required disclosures that are absent or incomplete in the notes.

| Issue | Standard Reference | Risk Rating | Recommendation |
|-------|-------------------|-------------|----------------|
[Generate minimum 4 rows. Reference specific disclosure requirements from IFRS standards.]

---

## 3. Note Consistency Checks
Check whether notes to financial statements are consistent with the face of the statements.

| Issue | Standard Reference | Risk Rating | Recommendation |
|-------|-------------------|-------------|----------------|
[Generate minimum 3 rows. Reference specific note numbers and balances from the document.]

---

## 4. Classification Review
Review whether items are correctly classified in the financial statements.

| Issue | Standard Reference | Risk Rating | Recommendation |
|-------|-------------------|-------------|----------------|
[Generate minimum 3 rows. Reference specific line items and IAS 1 classification rules.]

---

## 5. Ratio and Trend Analysis
Calculate key financial ratios using actual figures from the document.

| Ratio | Value | Benchmark | Assessment |
|-------|-------|-----------|------------|
[Generate these exact ratios using document figures:
- Current Ratio (Current Assets / Current Liabilities)
- Gross Margin % (Gross Profit / Revenue x 100)
- Net Margin % (Profit for year / Revenue x 100)
- Debt-to-Equity (Total Liabilities / Total Equity)
- Return on Assets % (Profit for year / Total Assets x 100)
- Receivables Days (Trade Receivables / Revenue x 365)
Show actual calculated values.]

---

## 6. Going Concern Indicators
Assess going concern risks based on the financial data.

| Indicator | Observation | Risk Rating | Recommendation |
|-----------|-------------|-------------|----------------|
[Generate minimum 4 rows covering both positive and negative indicators. Use actual figures.]

---

## 7. Related Party Disclosure Review
Review completeness and adequacy of related party disclosures under IAS 24.

| Issue | Standard Reference | Risk Rating | Recommendation |
|-------|-------------------|-------------|----------------|
[Generate minimum 3 rows. Reference actual related party balances from the document.]

---

## Overall Review Summary
[Write 4-6 sentences summarising: (1) overall quality of the financial statements, (2) the 2-3 most critical issues found, (3) priority actions management must take before finalising the statements. Use specific AED amounts and IFRS references.]
"""

    try:
        result = invoke_claude(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=3500,
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
Answer the user's question clearly using the Knowledge Base context provided.
Maximum 400 words. Use bullet points where helpful.
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
            max_tokens=800,
            temperature=0,
        )
        return (result or "").strip()
    except Exception as exc:
        return f"Unable to retrieve an answer. Error: {str(exc)}"


def answer_followup_question(invoke_claude, user_message, report_context, kb_context):
    system_prompt = """
You are an IFRS financial statement review expert.
The user has already received a full financial statement review report.
They are asking a specific follow-up question about it.

STRICT RULES:
- Answer ONLY the specific question asked.
- Do NOT regenerate the full review report.
- Use actual AED numbers and IFRS references from the document.
- Maximum 500 words. Use bullet points where helpful.
"""
    user_prompt = f"""
Document financial data:
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
            max_tokens=1000,
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