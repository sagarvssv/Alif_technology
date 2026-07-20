import json
import os
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer

AGENT_NAME = "fs_review_agent"
PORT = int(os.environ.get("PORT", "8080"))

GENERATE_TRIGGERS = [
    "review financial statement",
    "review the financial statement",
    "generate financial statement review",
    "generate fs review",
    "run financial statement review",
    "start financial statement review",
    "financial statement review.",
    "financial statement review report",
]

IMPROVE_TRIGGERS = [
    "improve",
    "how to reduce",
    "how to fix",
    "how to address",
    "how to resolve",
    "resolve the issue",
    "fix the issue",
    "address the issue",
    "what can i do about",
    "what should i do about",
    "recommendations for",
    "steps to fix",
    "steps to resolve",
    "remediate",
]


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


def is_generate_request(message: str) -> bool:
    msg = message.lower().strip()
    for trigger in GENERATE_TRIGGERS:
        if trigger in msg:
            return True
    return False


def is_improve_request(message: str) -> bool:
    msg = message.lower().strip()
    for trigger in IMPROVE_TRIGGERS:
        if trigger in msg:
            return True
    return False


def extract_issue_area(message: str) -> str:
    """Extract which finding area the user is asking about."""
    msg = message.lower()
    areas = [
        "ifrs compliance", "disclosure", "note consistency", "classification",
        "ratio", "trend", "going concern", "related party",
    ]
    for area in areas:
        if area in msg:
            return area
    return ""


def run_agent(payload):
    prepare_imports()

    from shared.bedrock import invoke_claude
    from shared.kb import retrieve_from_kb, format_citations
    from shared.report_context import get_combined_report_context, build_context_summary
    from shared.utils import (
        build_response,
        compact_text,
        get_direct_context_from_payload,
        get_message_from_payload,
        get_report_ids_from_payload,
    )

    original_user_message = get_message_from_payload(payload)
    report_ids             = get_report_ids_from_payload(payload)
    direct_context        = get_direct_context_from_payload(payload)

    general_mode = (
        payload.get("generalMode", False)
        or payload.get("general_mode", False)
        or payload.get("selectedAgent") == "general_kb_agent"
        or payload.get("agent") == "general_kb_agent"
    )

    user_message = original_user_message or "Review financial statement."

    # ── GENERAL Q&A MODE ─────────────────────────────────────────────
    if general_mode or not report_ids:
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
            extra={"agentType": "general", "agentName": "General Q&A Agent"},
        )

    # ── Load document context (one or many uploaded files, combined) ──
    report_context  = get_combined_report_context(report_ids=report_ids, direct_context=direct_context)
    max_context_chars = 18000 * min(len(report_ids), 3)
    context_summary = build_context_summary(compact_text(report_context, max_chars=max_context_chars))

    # ── ROUTE ─────────────────────────────────────────────────────────
    if is_generate_request(user_message):
        kb_query = build_kb_query(user_message, report_context, compact_text)
        kb_context, citations = retrieve_from_kb(kb_query, number_of_results=6)
        citation_details = format_citations(citations)

        answer = generate_complete_fs_review_output(
            invoke_claude=invoke_claude,
            user_message=user_message,
            report_context=context_summary,
            kb_context=kb_context,
            citation_details=citation_details,
        )

    elif is_improve_request(user_message):
        issue_area = extract_issue_area(user_message)
        kb_context, citations = retrieve_from_kb(
            f"how to resolve {issue_area} IFRS financial statement issue", number_of_results=6
        )

        answer = generate_issue_resolution_plan(
            invoke_claude=invoke_claude,
            user_message=user_message,
            issue_area=issue_area,
            report_context=context_summary,
            kb_context=kb_context,
        )

    else:
        kb_context, citations = retrieve_from_kb(user_message, number_of_results=5)

        answer = answer_document_question(
            invoke_claude=invoke_claude,
            user_message=user_message,
            report_context=context_summary,
            kb_context=kb_context,
        )

    return build_response(
        answer=answer,
        selected_agent=AGENT_NAME,
        citations=citations,
        extra={"agentType": "sub_agent", "agentName": "Financial Statement Review Agent"},
    )


# ── General KB question (no document) ────────────────────────────────
def answer_general_question(invoke_claude, user_message, kb_context):
    system_prompt = """
You are a UAE financial reporting and IFRS compliance expert assistant.
Answer the user's question clearly and directly using the Knowledge Base context provided.

STRICT RULES:
- Answer ONLY the specific question asked.
- Do NOT generate a financial statement review report.
- Use plain, professional English.
- Maximum 400 words.
- Use bullet points where helpful.
- If not in the knowledge base say: "This detail is not in the available knowledge base. Please consult a qualified professional."
"""
    user_prompt = f"""
Knowledge Base context:
{kb_context or "No knowledge base results found."}

User question:
{user_message}

Answer the question directly and concisely.
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
        return f"Unable to retrieve an answer at this time. Error: {str(exc)}"


# ── Follow-up question about uploaded document ────────────────────────
def answer_document_question(invoke_claude, user_message, report_context,kb_context):
    system_prompt = """
You are an expert IFRS financial statement reviewer.
The user has an uploaded draft financial statement and has already seen the full
review report. They are now asking a specific follow-up question about it.

STRICT RULES:
- Answer ONLY the specific question asked.
- Do NOT regenerate the full review report.
- Use the financial data from the document context to give accurate, specific answers.
- Use actual AED numbers from the document where relevant.
- Cite the relevant IFRS/IAS standard where applicable.
- Maximum 500 words. Use bullet points where helpful.
"""
    user_prompt = f"""
Document financial data:
{report_context or "No document context available."}

Knowledge Base guidance:
{kb_context or "No knowledge base results found."}

User question:
{user_message}

Answer the question directly and concisely.
"""
    try:
        result = invoke_claude(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=900,
            temperature=0,
        )
        return (result or "").strip()
    except Exception as exc:
        return f"Unable to retrieve an answer at this time. Error: {str(exc)}"


# ── Resolution plan for a specific flagged issue ────────────────────────
def generate_issue_resolution_plan(invoke_claude, user_message, issue_area, report_context, kb_context):
    system_prompt = """
You are a senior IFRS technical accounting specialist.
The user wants a detailed, actionable resolution plan for a specific issue
identified in their financial statement review report.

FORMAT RULES:
- Give a structured, professional resolution plan.
- Use clear headings and numbered steps.
- Include the specific IFRS/IAS standard reference.
- Include what management should change in the financial statements.
- Include what the reviewer will re-check after the fix.
- Use actual numbers from the document where available.
- Maximum 600 words.
- Do NOT regenerate the full review report.
- Focus ONLY on the specific issue area asked about.
"""
    area_label = issue_area.title() if issue_area else "the identified issue"
    user_prompt = f"""
Document financial data:
{report_context or "No document context available."}

Knowledge Base guidance:
{kb_context or "No knowledge base results found."}

User request:
{user_message}

The user wants to resolve the **{area_label}** issue.

Generate a resolution plan with this structure:

## 🎯 Issue: {area_label}

### Standard Reference
State the exact IFRS/IAS standard that applies.

### What Needs to Change
Numbered list of specific changes to the financial statements or disclosures.

### ✅ How the Reviewer Will Verify the Fix
Numbered list of what will be checked to confirm the issue is resolved.

Be specific, practical, and use plain English.
"""
    try:
        result = invoke_claude(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=1200,
            temperature=0,
        )
        return (result or "").strip()
    except Exception as exc:
        return f"Unable to generate resolution plan. Error: {str(exc)}"


def build_kb_query(user_message, report_context, compact_text):
    query = user_message
    if report_context:
        query += "\n\nUploaded document context summary:\n"
        query += compact_text(report_context, max_chars=3000)
    query += "\n\nFind IFRS/IAS guidance: disclosures, presentation, classification, going concern, related parties."
    return query


def base_system_prompt():
    return """
You are a senior IFRS financial statement reviewer. Write for a business owner or
manager who is NOT an accountant. Follow these strict rules:

LANGUAGE RULES:
- Use simple, short sentences. Maximum 15 words per sentence.
- No jargon without a plain explanation.
- No long paragraphs. Use short bullet points only.
- Use actual numbers from the document (e.g. AED 3,100,000).
- If data is missing, write: Not available.
- NEVER assign a specific Risk Rating to a finding that requires
  financial data (ratios, balances, classification amounts) the
  document does not contain — use "To Be Assessed" for those instead
  of guessing a number or level. Always use that exact phrase, not
  "N/A" or other wording, so it is handled consistently everywhere it
  appears in the report.
- The ABSENCE of required financial statements, disclosures, or
  supporting data IS itself a legitimate finding and may correctly be
  rated High risk — that is reporting a real gap, not fabrication.
  Fabrication means inventing a specific financial conclusion (a ratio
  value, a balance issue, a classification judgment) the document
  gives no evidence for either way.

FORMAT RULES:
- Use markdown tables where requested.
- Keep tables to maximum 8 rows.
- Do NOT write long explanations.
- Do NOT repeat information.
"""


def combined_prompt(user_message, report_context, kb_context, citation_details):
    return f"""
Financial statement context:
{report_context}

Knowledge Base:
{kb_context or "None."}

Generate a SHORT, SIMPLE financial statement review report. Write for a non-accountant.
Use plain English. No long paragraphs.

Review the draft financial statements across exactly these seven functions,
each as its OWN separate section with its OWN table — do not combine
functions into one shared table, and do not skip any function even if it
produced only one finding (or zero — see the "no issues" rule below).

Each section must start with the exact heading shown. Separate sections with: ---

# Review Summary
A simple table:
| Item | Detail |
Show: Client name, Period reviewed, Overall opinion (one short sentence),Number of issues found.
Maximum 5 rows.

# IFRS Compliance Review
Show this table exactly:
| Issue | Standard Reference | Risk Rating | Recommendation |
Only issues about whether the submission complies with IFRS presentation
and reporting requirements generally (e.g. IAS 1 overall compliance).
Maximum 3 rows.

# Missing Disclosures
Show this table exactly:
| Issue | Standard Reference | Risk Rating | Recommendation |
Only issues about disclosures/notes/statements that are absent (balance
sheet, income statement, cash flow statement, accounting policy notes,
tax disclosures, entity information, etc.).
Maximum 4 rows.

# Note Consistency Checks
Show this table exactly:
| Issue | Standard Reference | Risk Rating | Recommendation |
Only issues about whether dates, figures, or references in the document
are internally consistent with each other (e.g. period-end mismatches,
currency inconsistencies, reference numbers not matching elsewhere).
Maximum 3 rows.

# Classification Review
Show this table exactly:
| Issue | Standard Reference | Risk Rating | Recommendation |
Only issues about whether amounts are correctly classified (current vs
non-current, asset vs liability, VAT/tax classification, entity type
treatment, revenue classification).
Maximum 3 rows.

# Ratio and Trend Analysis
Show this table exactly:
| Issue | Standard Reference | Risk Rating | Recommendation |
Frame each standard ratio (current ratio, gross margin, net margin,
debt-to-equity, return on assets, receivables days, etc.) as an "Issue"
row — e.g. "Current Ratio cannot be assessed — no balance sheet data."
If the document contains a real relevant figure (e.g. a VAT return
revenue amount), note it in the Issue and use that to inform the Risk
Rating; otherwise the Risk Rating must be "To Be Assessed" — never
invent a ratio value or trend the document does not support.
Maximum 6 rows.

# Going Concern Indicators
Show this table exactly:
| Issue | Standard Reference | Risk Rating | Recommendation |
Only issues about the entity's ability to continue operating (cash
position, liabilities, forecast, trading activity evidence).
Maximum 3 rows.

# Related Party Disclosure Review
Show this table exactly:
| Issue | Standard Reference | Risk Rating | Recommendation |
Only issues about related party relationships, transactions, ownership
structure, or group structure disclosures.
Maximum 3 rows.

RULES THAT APPLY TO EVERY TABLE ABOVE:
- Standard Reference must cite the specific IFRS/IAS standard (e.g. "IAS 1.54",
  "IFRS 7.31", "IAS 24.18").
- Risk Rating must be exactly one of: High, Medium-High, Medium, Low-Medium, Low, To Be Assessed.
- Recommendation must be one short, specific, actionable sentence.
- A finding about MISSING documentation itself (e.g. "No Financial
  Statements Provided") is a real, valid finding and can be rated High —
  flagging an absence is not fabrication.
- A finding that requires judging a SPECIFIC financial detail (a ratio
  value, a balance classification, an accrual adequacy) must use Risk
  Rating "To Be Assessed" if the document does not contain the
  underlying figures needed to make that judgment. Never guess a
  High/Medium/Low rating for a conclusion the document gives no basis for.
- Always use the exact phrase "To Be Assessed" — never "N/A" or any
  other wording — so it is handled consistently.
- If a function genuinely has zero findings (nothing wrong and nothing
  missing in that area), include exactly one row stating
  "No issues identified in this area." with Risk Rating "Low" instead
  of leaving the table empty or omitting the section.

# Overall Review Summary
Write one short paragraph (3-4 sentences). Cover:
- What was actually submitted (name the client and state clearly
  whether this was a proper set of financial statements or something
  else, e.g. a tax payment slip or single transaction record).
- The overall opinion in plain terms, and how many issues were found.
- The single most important next step for management (usually:
  prepare and submit full IFRS financial statements).
Do not repeat the tables above. Write this as plain narrative text.

Do not write anything after the last section.
"""


SECTION_HEADINGS = [
    "Review Summary",
    "IFRS Compliance Review",
    "Missing Disclosures",
    "Note Consistency Checks",
    "Classification Review",
    "Ratio and Trend Analysis",
    "Going Concern Indicators",
    "Related Party Disclosure Review",
    "Overall Review Summary",
]


def ensure_all_sections_present(answer):
    missing = [h for h in SECTION_HEADINGS if f"# {h}" not in answer]
    if not missing:
        return answer
    placeholders = "\n\n---\n\n".join(
        f"# {h}\n\n_Could not be generated._" for h in missing
    )
    return f"{answer.strip()}\n\n---\n\n{placeholders}"


def generate_complete_fs_review_output(
    invoke_claude, user_message, report_context, kb_context, citation_details,
):
    try:
        result = invoke_claude(
            system_prompt=base_system_prompt(),
            user_prompt=combined_prompt(
                user_message=user_message,
                report_context=report_context,
                kb_context=kb_context,
                citation_details=citation_details,
            ),
            max_tokens=2500,
            temperature=0,
        )
        answer = (result or "").strip()
    except Exception as exc:
        answer = (
            "# Financial Statement Review\n\n"
            f"_Could not be generated: {str(exc)}_"
        )
        return answer

    answer = ensure_all_sections_present(answer)

    if not answer.lstrip().startswith("# Financial Statement Review"):
        answer = "# Financial Statement Review\n\n---\n\n" + answer.lstrip()

    return answer


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