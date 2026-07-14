import json
import os
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer

AGENT_NAME = "audit_planning_agent"
PORT = int(os.environ.get("PORT", "8080"))

GENERATE_TRIGGERS = [
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
]

IMPROVE_TRIGGERS = [
    "improve",
    "how to reduce",
    "how to fix",
    "how to address",
    "how to mitigate",
    "reduce the risk",
    "fix the risk",
    "address the risk",
    "mitigate the risk",
    "what can i do about",
    "what should i do about",
    "recommendations for",
    "action plan for",
    "steps to improve",
    "steps to fix",
    "steps to reduce",
    "overcome",
    "solve",
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


def extract_risk_area(message: str) -> str:
    msg = message.lower()
    risk_areas = [
        "corporate tax", "vat", "inventory", "revenue", "receivables",
        "related party", "going concern", "lease", "fraud", "accrual",
        "disclosure", "materiality", "staffing", "engagement",
    ]
    for area in risk_areas:
        if area in msg:
            return area
    return ""


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

    general_mode = (
        payload.get("generalMode", False)
        or payload.get("general_mode", False)
        or payload.get("selectedAgent") == "general_kb_agent"
        or payload.get("agent") == "general_kb_agent"
    )

    user_message = original_user_message or "Generate audit planning."

    # ── GENERAL Q&A MODE ─────────────────────────────────────────────────
    if general_mode or not report_id:
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

    # ── Load document context ─────────────────────────────────────────────
    report_context  = get_report_context(report_id=report_id, direct_context=direct_context)
    context_summary = build_context_summary(compact_text(report_context, max_chars=18000))

    # ── ROUTE ─────────────────────────────────────────────────────────────
    if is_generate_request(user_message):
        kb_query = build_kb_query(user_message, report_context, compact_text)
        kb_context, citations = retrieve_from_kb(kb_query, number_of_results=6)
        citation_details = format_citations(citations)

        answer = generate_complete_audit_planning_output(
            invoke_claude=invoke_claude,
            user_message=user_message,
            report_context=context_summary,
            kb_context=kb_context,
            citation_details=citation_details,
        )

    elif is_improve_request(user_message):
        risk_area = extract_risk_area(user_message)
        kb_context, citations = retrieve_from_kb(
            f"how to improve {risk_area} audit risk UAE IFRS ISA", number_of_results=6
        )
        answer = generate_risk_improvement_plan(
            invoke_claude=invoke_claude,
            user_message=user_message,
            risk_area=risk_area,
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
        extra={"agentType": "sub_agent", "agentName": "Audit Planning Agent"},
    )


def answer_general_question(invoke_claude, user_message, kb_context):
    system_prompt = """
You are a UAE financial and audit compliance expert assistant.
Answer the user's question clearly and directly using the Knowledge Base context provided.

STRICT RULES:
- Answer ONLY the specific question asked.
- Do NOT generate an audit planning report.
- Do NOT produce sections like Engagement Strategy, Risk Assessment, Audit Programs, Staffing.
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


def answer_document_question(invoke_claude, user_message, report_context, kb_context):
    system_prompt = """
You are an expert audit and financial analyst assistant.
The user has an uploaded financial document and has already seen the full audit plan.
They are now asking a specific follow-up question about it.

STRICT RULES:
- Answer ONLY the specific question asked.
- Do NOT regenerate the full audit plan.
- Do NOT produce the full report sections.
- Use the financial data from the document context to give accurate, specific answers.
- Use actual AED numbers from the document where relevant.
- Maximum 500 words. Use bullet points where helpful.
- Be direct, specific, and professional.
"""
    user_prompt = f"""
Document financial data:
{report_context or "No document context available."}

Knowledge Base guidance:
{kb_context or "No knowledge base results found."}

User question:
{user_message}

Answer this specific question using the document data above.
Do NOT generate a full audit plan. Give a focused, helpful answer.
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


def generate_risk_improvement_plan(
    invoke_claude, user_message, risk_area, report_context, kb_context
):
    system_prompt = """
You are a senior audit expert and risk management specialist.
The user wants a detailed, actionable improvement plan for a specific risk area
identified in their audit planning report.

FORMAT RULES:
- Give a structured, professional improvement plan.
- Use clear headings and numbered steps.
- Include specific actions management should take.
- Include what the auditor will verify after improvements.
- Use actual numbers from the document where available.
- Maximum 600 words.
- Do NOT regenerate the full audit plan.
- Focus ONLY on the specific risk area asked about.
"""
    area_label = risk_area.title() if risk_area else "the identified risk area"
    user_prompt = f"""
Document financial data:
{report_context or "No document context available."}

Knowledge Base guidance:
{kb_context or "No knowledge base results found."}

User request:
{user_message}

The user wants to improve the **{area_label}** risk area.

Generate a detailed improvement plan with this structure:

## 🎯 Risk Area: {area_label}

### Current Risk Status
Briefly describe the current risk level and why it exists based on the document data.

### 📋 Management Action Plan
Numbered list of specific steps management must take to reduce this risk.
Use actual document figures where relevant (AED amounts, percentages, dates).

### ✅ How the Auditor Will Verify Improvement
Numbered list of what the auditor will check to confirm the risk has been reduced.

### 📊 Expected Outcome
Brief statement on what risk level this area should reach after improvements are implemented.

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
        return f"Unable to generate improvement plan. Error: {str(exc)}"


def build_kb_query(user_message, report_context, compact_text):
    query = user_message
    if report_context:
        query += "\n\nUploaded document context summary:\n"
        query += compact_text(report_context, max_chars=3000)
    query += "\n\nFind audit planning guidance: ISA, IFRS, materiality, risk, audit programs."
    return query


def base_system_prompt():
    return """
You are a plain-English audit planning assistant. Write for a business owner or manager
who is NOT an accountant.

STRICT RULES:
- Use simple, short sentences. Maximum 15 words per sentence.
- Use actual numbers from the document (AED amounts).
- If data is missing write: Not available.
- Use markdown tables exactly as specified.
- Use bullet points for lists.
- Follow the template sections exactly, including the final summary section.
- Do NOT change the risk levels assigned to you.
- Output must be IDENTICAL every time for the same document.
"""


def combined_prompt(user_message, report_context, kb_context, citation_details):
    return f"""
Financial statement context:
{report_context}

Knowledge Base:
{kb_context or "None."}

Generate a complete audit planning report using ONLY the data above.
Follow ALL instructions EXACTLY. Do not add, remove, or change any section.

Each section must use the exact heading shown. Separate sections with: ---

# Engagement Strategy
Table format:
| Item | Detail |
Rows: Client, What is audited, Reporting framework, Year-end date, Total assets, Revenue, Main risks.
Use exact values from the document. Maximum 7 rows.

# Planning Memorandum
Table format:
| Item | Detail |
Rows: Audit goal, What is covered, Key risk areas, Year-end date, Who leads, Tax consideration.
Maximum 6 rows.

# Materiality Calculation
Table format:
| Benchmark | Amount (AED) | % Used | Materiality (AED) |
ALWAYS include these exact 3 rows in this exact order:
Row 1: Profit before tax | [value from doc] | 5% | [5% of value]
Row 2: Revenue | [value from doc] | 0.5% | [0.5% of value]
Row 3: Total assets | [value from doc] | 1% | [1% of value]
Then:
- Overall materiality: AED [lowest of the three]
- Performance materiality: AED [75% of overall]
- Trivial threshold: AED [5% of overall]
- Why this benchmark was chosen: [one sentence about profit before tax]

# Risk Assessment
CRITICAL: You MUST output EXACTLY these risk areas in EXACTLY this order with EXACTLY these risk levels every time.
Do NOT change the order. Do NOT change the risk levels. Do NOT add or remove rows.

| Risk Area | What it means simply | Risk Level | What the auditor will check |
| Inventory valuation | Stock may be overvalued or unsellable | High | Count stock, check slow-moving items and NRV |
| Trade receivables | Some customers may not pay | High | Review overdue balances and ECL allowance |
| Revenue cutoff | Sales may be recorded in wrong period | High | Test December invoices and delivery notes |
| Related party payable | Supplier linked to company needs scrutiny | High | Check approval, pricing, and disclosure |
| Going concern | Business needs cash to keep running | Medium | Review cash forecast and receivables collection |
| Inventory write-down | Write-down allowance may be insufficient | Medium | Compare allowance to slow-moving stock value |
| Corporate tax | Tax calculation needs careful review | Medium | Check tax expense calculation and compliance |
| VAT compliance | VAT filings must match revenue recorded | Medium | Reconcile VAT returns to reported revenue |

Use the EXACT risk levels shown above (High or Medium). Never use Low for any of these areas.
Replace the generic descriptions with actual AED numbers from the document where available.

# Audit Programs
For each area write exactly 3 short bullets. Areas in this order:
Inventory, Revenue, Trade Receivables, Related Parties, Tax/VAT, Going Concern, Disclosures.
Keep each bullet under 12 words. Use actual AED numbers where relevant.

# Staffing Recommendations
Table format:
| Role | Main Job | Hours |
ALWAYS use these exact roles in this exact order with these exact hours:
| Partner | Review, sign-off, and quality control | 15 |
| Manager | Plan and supervise fieldwork | 30 |
| Senior | Lead testing on key risk areas | 50 |
| Assistant | Support testing and documentation | 40 |
| Tax Specialist | Review VAT and corporate tax compliance | 15 |
Total estimated hours: 150

# Overall Audit Planning Summary
Write 3-4 short sentences in plain English summarising this engagement:
what the entity does, its scale (use actual revenue/asset figures from the
document), the overall materiality figure, and the top 1-2 risk areas that
will get the most audit attention. This section MUST be present and complete.

Do not write anything after the Overall Audit Planning Summary section.
"""


SECTION_HEADINGS = [
    "Engagement Strategy",
    "Planning Memorandum",
    "Materiality Calculation",
    "Risk Assessment",
    "Audit Programs",
    "Staffing Recommendations",
    "Overall Audit Planning Summary",
]


def ensure_all_sections_present(answer):
    missing = [h for h in SECTION_HEADINGS if f"# {h}" not in answer]
    if not missing:
        return answer
    placeholders = "\n\n---\n\n".join(
        f"# {h}\n\n_Could not be generated._" for h in missing
    )
    return f"{answer.strip()}\n\n---\n\n{placeholders}"


def generate_complete_audit_planning_output(
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
            max_tokens=3000,
            temperature=0,
        )
        answer = (result or "").strip()
    except Exception as exc:
        answer = (
            "# Audit Planning Deliverables\n\n"
            f"_Could not be generated: {str(exc)}_"
        )
        return answer

    answer = ensure_all_sections_present(answer)

    if not answer.lstrip().startswith("# Audit Planning Deliverables"):
        answer = "# Audit Planning Deliverables\n\n---\n\n" + answer.lstrip()

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
            "message": "Audit Planning AgentCore runtime is running.",
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
    print(f"Audit Planning AgentCore runtime running on port {PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()