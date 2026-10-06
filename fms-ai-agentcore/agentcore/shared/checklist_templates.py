"""
Client-provided Statutory Audit — Financial Statement Line Item Checklist.

This is the CLIENT'S OWN checklist (their Excel document), not something
the AI is asked to invent. When a risk area's name matches one of these
line items, its checklist items are used VERBATIM, deterministically —
no AI call involved at all. The AI-based decompose_risk_into_checklist()
fallback in each agent is only used for risk areas that don't match
anything here (e.g. Going Concern, Fraud), so those keep working exactly
as before.

Shared by both audit_planning_agent and financial_statement_review_agent
so the same official checklist is used consistently everywhere, rather
than maintaining two copies.
"""

import re

# Each entry: the line item's own checklist items (verbatim from the
# client's Excel), plus a list of ALIASES — alternate phrasings that a
# generated report's Risk Area / Issue name might use instead of the
# exact line item name. Matching is substring-based in both directions
# after normalization, so "Cash and Bank Balances" matches the "Cash &
# Bank" template, "Trade Receivables" matches itself exactly, etc.
CHECKLIST_TEMPLATES = [
    {
        "aliases": ["property, plant & equipment", "property plant equipment", "ppe", "fixed assets"],
        "items": [
            "Fixed asset schedule reconciles with GL; material additions/disposals are supported.",
            "Existence and ownership of material assets have been considered.",
            "Depreciation, useful lives and capitalisation are reasonable.",
            "Impairment indicators, if any, have been considered.",
            "Classification and disclosures are appropriate.",
        ],
    },
    {
        "aliases": ["investments", "investment"],
        "items": [
            "Investment schedule reconciles with GL and ownership/existence is supported.",
            "Nature and classification of investment and applicable accounting treatment are appropriate.",
            "Carrying/fair value and impairment, where applicable, are supported.",
            "Material additions, disposals, income and gains/losses have been verified.",
            "Related-party involvement, restrictions and disclosures have been considered.",
            "AI escalation: Unlisted/material investment, complex valuation, missing ownership evidence or impairment indicator \u2192 Senior Review.",
        ],
    },
    {
        "aliases": ["inventory", "inventory valuation", "stock", "stock valuation"],
        "items": [
            "Inventory listing reconciles with GL and existence has been considered.",
            "Material inventory/counts have been tested where applicable.",
            "Costing and lower of cost/NRV have been considered.",
            "Obsolete, damaged or slow-moving inventory has been considered.",
            "Cut-off and disclosures are appropriate.",
        ],
    },
    {
        # Checked BEFORE "Other Receivables" so a bare "Trade Receivables"
        # area never accidentally matches the other-receivables template.
        "aliases": ["trade receivables", "accounts receivable", "receivables ageing"],
        "items": [
            "Ageing/listing reconciles with GL.",
            "Material balances are supported by confirmation, subsequent receipts or other evidence.",
            "Long-outstanding/disputed balances and ECL have been considered.",
            "Cut-off and unusual balances have been reviewed.",
            "Classification and disclosures are appropriate.",
        ],
    },
    {
        "aliases": [
            "other receivables / advances / prepayments / deposits",
            "other receivables", "advances", "prepayments", "deposits",
        ],
        "items": [
            "Detailed schedule reconciles with GL.",
            "Material balances are supported and their nature understood.",
            "Recoverability and/or appropriate period allocation has been considered.",
            "Old, unusual or related-party balances have been investigated.",
            "Classification and disclosures are appropriate.",
        ],
    },
    {
        "aliases": [
            "cash & bank", "cash and bank", "cash and bank balances",
            "bank balances", "cash balances", "cash & bank balances",
        ],
        "items": [
            "Bank/cash balances reconcile with GL.",
            "Bank statements/confirmations or other appropriate evidence obtained.",
            "Material/unusual reconciling items have been reviewed.",
            "Restricted, pledged or unusual balances have been considered.",
            "Classification and disclosures are appropriate.",
        ],
    },
    {
        "aliases": ["share capital & equity", "share capital", "equity"],
        "items": [
            "Share capital agrees with legal/statutory records.",
            "Opening equity agrees with prior-year audited financial statements.",
            "Profit/loss, dividends and other movements reconcile.",
            "Material shareholder/current-account movements are supported, where applicable.",
            "Classification and disclosures are appropriate.",
        ],
    },
    {
        "aliases": ["bank borrowings / loans", "bank borrowings", "borrowings", "loans payable", "bank loans"],
        "items": [
            "Balances reconcile with GL and are supported by agreements/confirmations.",
            "Material additions, repayments and finance costs have been checked.",
            "Current/non-current classification is appropriate.",
            "Security, guarantees, covenants and significant terms have been considered.",
            "Presentation and disclosures are appropriate.",
        ],
    },
    {
        "aliases": [
            "employee end-of-service / employee benefit obligations",
            "employee end-of-service", "end of service", "eosb",
            "employee benefit obligations", "gratuity",
        ],
        "items": [
            "Provision reconciles with supporting employee calculations.",
            "Material calculation inputs have been checked.",
            "Provision appears reasonable under applicable requirements.",
            "Material movements/payments during the year have been considered.",
            "Classification and disclosures are appropriate.",
        ],
    },
    {
        "aliases": ["trade payables", "accounts payable", "supplier payables"],
        "items": [
            "Supplier listing reconciles with GL.",
            "Material balances are supported by statements, subsequent payments or other evidence.",
            "Completeness/unrecorded liabilities have been considered.",
            "Old, debit or unusual balances have been investigated.",
            "Classification and disclosures are appropriate.",
        ],
    },
    {
        "aliases": ["accruals & other payables", "accruals", "accrued expenses", "accrued", "other payables"],
        "items": [
            "Detailed schedule reconciles with GL.",
            "Material accruals/payables are supported and reasonable.",
            "Subsequent invoices/payments have been considered where relevant.",
            "Old, unusual or significant balances have been investigated.",
            "Classification and disclosures are appropriate.",
        ],
    },
    {
        "aliases": ["related-party balances", "related party balances", "related parties", "related party"],
        "items": [
            "Related parties and balances have been identified and reconciled.",
            "Material transactions/movements are supported.",
            "Nature, terms and recoverability/settlement have been considered.",
            "Completeness of related parties/transactions has been considered.",
            "Required related-party disclosures are appropriate.",
        ],
    },
    {
        "aliases": ["vat / indirect tax balances", "vat", "indirect tax"],
        "items": [
            "GL balances reconcile with filed returns/tax records.",
            "Material differences have been investigated.",
            "Payments/refunds and closing balance are supported.",
            "Potential non-compliance/exposure has been considered.",
            "Classification and presentation are appropriate.",
        ],
    },
    {
        "aliases": ["corporate tax / income tax", "corporate tax", "income tax"],
        "items": [
            "Accounting profit reconciles with tax computation.",
            "Material tax adjustments and applicable tax rate have been reviewed.",
            "Current tax provision/payment reconciles.",
            "Deferred tax applicability has been considered.",
            "Presentation and disclosures are appropriate.",
        ],
    },
    {
        "aliases": ["provisions / contingencies / commitments", "provisions", "contingencies", "commitments"],
        "items": [
            "Material provisions, guarantees and commitments have been identified.",
            "Supporting information and management/legal assessment have been considered.",
            "Recognition versus disclosure treatment is appropriate.",
            "Subsequent developments have been considered.",
            "Disclosures are adequate.",
        ],
    },
    {
        "aliases": ["revenue", "revenue cutoff", "revenue recognition", "sales"],
        "items": [
            "Revenue reconciles with GL/supporting records.",
            "Material revenue streams and recognition basis are understood.",
            "Material/sample transactions and year-end cut-off have been tested.",
            "Analytical review performed and significant/unusual movements investigated.",
            "Accounting, VAT/tax and disclosure implications have been considered.",
        ],
    },
    {
        "aliases": ["cost of revenue / cost of sales", "cost of revenue", "cost of sales", "cogs"],
        "items": [
            "Cost categories reconcile with GL.",
            "Gross margin compared with prior year/expectations.",
            "Material/sample costs are supported.",
            "Completeness and cut-off have been reviewed.",
            "Classification and related-party implications have been considered.",
        ],
    },
    {
        "aliases": ["salaries & employee costs", "salaries", "employee costs", "payroll"],
        "items": [
            "Payroll reconciles with GL.",
            "Employee/payroll records and sample salaries/payments have been tested.",
            "New joiners/leavers and bonuses/allowances have been checked.",
            "Significant movements and key management costs have been investigated.",
            "Accruals and classification are appropriate.",
        ],
    },
    {
        "aliases": ["administrative & general expenses", "administrative expenses", "general expenses", "admin expenses"],
        "items": [
            "Material expense categories tested.",
            "Analytical comparison with prior year performed.",
            "Unusual/material transactions investigated.",
            "Business purpose, cut-off and classification considered.",
            "Related-party/VAT/tax implications considered where relevant.",
        ],
    },
    {
        "aliases": ["management / director remuneration", "director remuneration", "management remuneration"],
        "items": [
            "Amount reconciled with GL.",
            "Approval/agreement and payment supported.",
            "Unusual benefits or personal expenditure considered.",
            "Tax implications considered where relevant.",
            "Related-party/key management disclosure considered.",
        ],
    },
    {
        "aliases": ["depreciation / amortisation", "depreciation", "amortisation", "amortization"],
        "items": [
            "Expense reconciled with underlying asset schedule.",
            "Calculation and rates/useful lives checked.",
            "Additions/disposals appropriately reflected.",
            "Classification appropriate.",
        ],
    },
    {
        "aliases": ["finance cost", "interest expense", "finance costs"],
        "items": [
            "Amount reconciled with GL and borrowings.",
            "Material interest expense checked against facility terms.",
            "Significant/unusual charges investigated.",
            "Classification/disclosure appropriate.",
        ],
    },
    {
        "aliases": ["other income"],
        "items": [
            "Composition reconciled and understood.",
            "Material items supported.",
            "Unusual/non-recurring items investigated.",
            "Recognition and classification appropriate.",
            "Tax/VAT implications considered where relevant.",
        ],
    },
]


def _normalize(text):
    return re.sub(r"[^a-z0-9 ]", " ", (text or "").lower()).strip()


def get_template_checklist(risk_area):
    """
    Returns the client's fixed checklist items for this risk area, or
    None if no line item in the official checklist matches it (the
    caller should fall back to AI-based decomposition in that case).
    Matching is substring-based in both directions after normalizing
    punctuation/case, so small wording differences between the report's
    generated Risk Area name and the client's exact line item name still
    match correctly.
    """
    normalized = _normalize(risk_area)
    if not normalized:
        return None
    for template in CHECKLIST_TEMPLATES:
        for alias in template["aliases"]:
            alias_norm = _normalize(alias)
            if alias_norm and (alias_norm in normalized or normalized in alias_norm):
                return list(template["items"])
    return None
