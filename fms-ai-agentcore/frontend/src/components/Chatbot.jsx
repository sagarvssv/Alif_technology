import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./Chatbot.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "https://c0feinpvm5.execute-api.eu-central-1.amazonaws.com/prod";

const CHAT_API = `${API_BASE_URL}/chat`;
const CHAT_STATUS_API = (jobId) => `${API_BASE_URL}/chat/status/${jobId}`;
const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 60;

// ─── Per-Risk Review & Supporting Evidence (ADD-ON) ────────────────────
const RISK_API = (riskKey) => `${API_BASE_URL}/risks/${encodeURIComponent(riskKey)}`;
const RISK_ATTACHMENT_URL_API = `${API_BASE_URL}/upload-url`;
const RISK_DOCUMENTS_API = `${API_BASE_URL}/documents`;
const RISK_EVIDENCE_POLL_INTERVAL_MS = 4000;
const RISK_EVIDENCE_MAX_POLL_ATTEMPTS = 45;

function buildRiskKey(reportId, agentId, area) {
  const safeArea = (area || "").trim().toLowerCase().replace(/\s+/g, "-");
  return `${reportId || "no-report"}::${agentId || "no-agent"}::${safeArea}`;
}

const RISK_ITEM_STATUS_LABELS = {
  open:            { label: "Open",             icon: "🔴" },
  in_process:      { label: "In Process",       icon: "🟡" },
  review:          { label: "Review",           icon: "🔵" },
  closed_resolved: { label: "Closed / Resolved", icon: "✅" },
  other:           { label: "Other",            icon: "⚪" },
};

const SECTION_COLOURS = {
  "Engagement Strategy":        { bg: "#eff6ff", border: "#2563eb", text: "#1e40af", icon: "📋" },
  "Planning Memorandum":        { bg: "#f0fdf4", border: "#16a34a", text: "#15803d", icon: "📝" },
  "Materiality Calculation":    { bg: "#fefce8", border: "#ca8a04", text: "#92400e", icon: "🧮" },
  "Risk Assessment":            { bg: "#fff7ed", border: "#ea580c", text: "#9a3412", icon: "⚠️" },
  "Audit Programs":             { bg: "#fdf4ff", border: "#9333ea", text: "#6b21a8", icon: "🔍" },
  "Staffing Recommendations":   { bg: "#f0f9ff", border: "#0891b2", text: "#155e75", icon: "👥" },
  "Audit Planning Deliverables":{ bg: "#f8fafc", border: "#475569", text: "#1e293b", icon: "📊" },
};

// Ordered from lowest to highest risk. Used for deterministic stepping —
// the AI is never asked to pick a new level itself, only to answer two
// yes/no questions; the level change always comes from this fixed table,
// so the same verdict always produces the same outcome, every time.
const RISK_LEVEL_ORDER = ["Low", "Low-Medium", "Medium", "Medium-High", "High"];

// ── CLIENT MANDATORY CHECKLIST (static reference, Excel-sourced) ───────
// This is the client's OWN official Statutory Audit Line Item Checklist
// (their Excel document), used verbatim, deterministically — no AI
// involved, no backend call needed. It is COMPLETELY SEPARATE from the
// interactive "Planned Audit Response" checklist above (which is
// AI-generated and specific to the numbers in the uploaded document,
// with its own upload/checkbox tracking stored per-risk). This one is
// purely a read-only reference reminder of the firm's mandatory
// procedures for this line item — shown in the "Mandatory Checklist"
// section, not tied to any satisfied/checked state at all.
const CLIENT_CHECKLIST_TEMPLATES = [
  { aliases: ["property, plant & equipment", "property plant equipment", "ppe", "fixed assets"], items: [
    "Fixed asset schedule reconciles with GL; material additions/disposals are supported.",
    "Existence and ownership of material assets have been considered.",
    "Depreciation, useful lives and capitalisation are reasonable.",
    "Impairment indicators, if any, have been considered.",
    "Classification and disclosures are appropriate.",
  ]},
  { aliases: ["investments", "investment"], items: [
    "Investment schedule reconciles with GL and ownership/existence is supported.",
    "Nature and classification of investment and applicable accounting treatment are appropriate.",
    "Carrying/fair value and impairment, where applicable, are supported.",
    "Material additions, disposals, income and gains/losses have been verified.",
    "Related-party involvement, restrictions and disclosures have been considered.",
    "AI escalation: Unlisted/material investment, complex valuation, missing ownership evidence or impairment indicator → Senior Review.",
  ]},
  { aliases: ["inventory", "inventory valuation", "stock", "stock valuation"], items: [
    "Inventory listing reconciles with GL and existence has been considered.",
    "Material inventory/counts have been tested where applicable.",
    "Costing and lower of cost/NRV have been considered.",
    "Obsolete, damaged or slow-moving inventory has been considered.",
    "Cut-off and disclosures are appropriate.",
  ]},
  { aliases: ["trade receivables", "accounts receivable", "receivables ageing"], items: [
    "Ageing/listing reconciles with GL.",
    "Material balances are supported by confirmation, subsequent receipts or other evidence.",
    "Long-outstanding/disputed balances and ECL have been considered.",
    "Cut-off and unusual balances have been reviewed.",
    "Classification and disclosures are appropriate.",
  ]},
  { aliases: ["other receivables / advances / prepayments / deposits", "other receivables", "advances", "prepayments", "deposits"], items: [
    "Detailed schedule reconciles with GL.",
    "Material balances are supported and their nature understood.",
    "Recoverability and/or appropriate period allocation has been considered.",
    "Old, unusual or related-party balances have been investigated.",
    "Classification and disclosures are appropriate.",
  ]},
  { aliases: ["cash & bank", "cash and bank", "cash and bank balances", "bank balances", "cash balances", "cash & bank balances"], items: [
    "Bank/cash balances reconcile with GL.",
    "Bank statements/confirmations or other appropriate evidence obtained.",
    "Material/unusual reconciling items have been reviewed.",
    "Restricted, pledged or unusual balances have been considered.",
    "Classification and disclosures are appropriate.",
  ]},
  { aliases: ["share capital & equity", "share capital", "equity"], items: [
    "Share capital agrees with legal/statutory records.",
    "Opening equity agrees with prior-year audited financial statements.",
    "Profit/loss, dividends and other movements reconcile.",
    "Material shareholder/current-account movements are supported, where applicable.",
    "Classification and disclosures are appropriate.",
  ]},
  { aliases: ["bank borrowings / loans", "bank borrowings", "borrowings", "loans payable", "bank loans"], items: [
    "Balances reconcile with GL and are supported by agreements/confirmations.",
    "Material additions, repayments and finance costs have been checked.",
    "Current/non-current classification is appropriate.",
    "Security, guarantees, covenants and significant terms have been considered.",
    "Presentation and disclosures are appropriate.",
  ]},
  { aliases: ["employee end-of-service / employee benefit obligations", "employee end-of-service", "end of service", "eosb", "employee benefit obligations", "gratuity"], items: [
    "Provision reconciles with supporting employee calculations.",
    "Material calculation inputs have been checked.",
    "Provision appears reasonable under applicable requirements.",
    "Material movements/payments during the year have been considered.",
    "Classification and disclosures are appropriate.",
  ]},
  { aliases: ["trade payables", "accounts payable", "supplier payables"], items: [
    "Supplier listing reconciles with GL.",
    "Material balances are supported by statements, subsequent payments or other evidence.",
    "Completeness/unrecorded liabilities have been considered.",
    "Old, debit or unusual balances have been investigated.",
    "Classification and disclosures are appropriate.",
  ]},
  { aliases: ["accruals & other payables", "accruals", "accrued expenses", "accrued", "other payables"], items: [
    "Detailed schedule reconciles with GL.",
    "Material accruals/payables are supported and reasonable.",
    "Subsequent invoices/payments have been considered where relevant.",
    "Old, unusual or significant balances have been investigated.",
    "Classification and disclosures are appropriate.",
  ]},
  { aliases: ["related-party balances", "related party balances", "related parties", "related party"], items: [
    "Related parties and balances have been identified and reconciled.",
    "Material transactions/movements are supported.",
    "Nature, terms and recoverability/settlement have been considered.",
    "Completeness of related parties/transactions has been considered.",
    "Required related-party disclosures are appropriate.",
  ]},
  { aliases: ["vat / indirect tax balances", "vat", "indirect tax"], items: [
    "GL balances reconcile with filed returns/tax records.",
    "Material differences have been investigated.",
    "Payments/refunds and closing balance are supported.",
    "Potential non-compliance/exposure has been considered.",
    "Classification and presentation are appropriate.",
  ]},
  { aliases: ["corporate tax / income tax", "corporate tax", "income tax"], items: [
    "Accounting profit reconciles with tax computation.",
    "Material tax adjustments and applicable tax rate have been reviewed.",
    "Current tax provision/payment reconciles.",
    "Deferred tax applicability has been considered.",
    "Presentation and disclosures are appropriate.",
  ]},
  { aliases: ["provisions / contingencies / commitments", "provisions", "contingencies", "commitments"], items: [
    "Material provisions, guarantees and commitments have been identified.",
    "Supporting information and management/legal assessment have been considered.",
    "Recognition versus disclosure treatment is appropriate.",
    "Subsequent developments have been considered.",
    "Disclosures are adequate.",
  ]},
  { aliases: ["revenue", "revenue cutoff", "revenue recognition", "sales"], items: [
    "Revenue reconciles with GL/supporting records.",
    "Material revenue streams and recognition basis are understood.",
    "Material/sample transactions and year-end cut-off have been tested.",
    "Analytical review performed and significant/unusual movements investigated.",
    "Accounting, VAT/tax and disclosure implications have been considered.",
  ]},
  { aliases: ["cost of revenue / cost of sales", "cost of revenue", "cost of sales", "cogs"], items: [
    "Cost categories reconcile with GL.",
    "Gross margin compared with prior year/expectations.",
    "Material/sample costs are supported.",
    "Completeness and cut-off have been reviewed.",
    "Classification and related-party implications have been considered.",
  ]},
  { aliases: ["salaries & employee costs", "salaries", "employee costs", "payroll"], items: [
    "Payroll reconciles with GL.",
    "Employee/payroll records and sample salaries/payments have been tested.",
    "New joiners/leavers and bonuses/allowances have been checked.",
    "Significant movements and key management costs have been investigated.",
    "Accruals and classification are appropriate.",
  ]},
  { aliases: ["administrative & general expenses", "administrative expenses", "general expenses", "admin expenses"], items: [
    "Material expense categories tested.",
    "Analytical comparison with prior year performed.",
    "Unusual/material transactions investigated.",
    "Business purpose, cut-off and classification considered.",
    "Related-party/VAT/tax implications considered where relevant.",
  ]},
  { aliases: ["management / director remuneration", "director remuneration", "management remuneration"], items: [
    "Amount reconciled with GL.",
    "Approval/agreement and payment supported.",
    "Unusual benefits or personal expenditure considered.",
    "Tax implications considered where relevant.",
    "Related-party/key management disclosure considered.",
  ]},
  { aliases: ["depreciation / amortisation", "depreciation", "amortisation", "amortization"], items: [
    "Expense reconciled with underlying asset schedule.",
    "Calculation and rates/useful lives checked.",
    "Additions/disposals appropriately reflected.",
    "Classification appropriate.",
  ]},
  { aliases: ["finance cost", "interest expense", "finance costs"], items: [
    "Amount reconciled with GL and borrowings.",
    "Material interest expense checked against facility terms.",
    "Significant/unusual charges investigated.",
    "Classification/disclosure appropriate.",
  ]},
  { aliases: ["other income"], items: [
    "Composition reconciled and understood.",
    "Material items supported.",
    "Unusual/non-recurring items investigated.",
    "Recognition and classification appropriate.",
    "Tax/VAT implications considered where relevant.",
  ]},
];

function _normalizeAreaText(text) {
  return (text || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
}

// Returns the client's fixed checklist items for this risk area, or
// null if nothing in the official Excel checklist matches it (the
// Mandatory Checklist section simply doesn't render in that case).
function getClientChecklistTemplate(riskArea) {
  const normalized = _normalizeAreaText(riskArea);
  if (!normalized) return null;
  for (const template of CLIENT_CHECKLIST_TEMPLATES) {
    for (const alias of template.aliases) {
      const aliasNorm = _normalizeAreaText(alias);
      if (aliasNorm && (normalized.includes(aliasNorm) || aliasNorm.includes(normalized))) {
        return template.items;
      }
    }
  }
  return null;
}

const RISK_LEVELS = {
  "high":            { pct: 90, bg: "#fee2e2", text: "#991b1b", bar: "#ef4444", needsGap: true  },
  "high (presumed)": { pct: 90, bg: "#fee2e2", text: "#991b1b", bar: "#ef4444", needsGap: true  },
  "medium-high":     { pct: 75, bg: "#fed7aa", text: "#9a3412", bar: "#f97316", needsGap: true  },
  "medium":          { pct: 55, bg: "#fef3c7", text: "#92400e", bar: "#f59e0b", needsGap: true  },
  "low-medium":      { pct: 35, bg: "#d1fae5", text: "#065f46", bar: "#34d399", needsGap: false },
  "low":             { pct: 20, bg: "#dcfce7", text: "#166534", bar: "#22c55e", needsGap: false },
  "to be assessed":  { pct: 50, bg: "#f1f5f9", text: "#475569", bar: "#94a3b8", needsGap: true  },
};

const RISK_SOLUTIONS = {
  "inventory valuation": [
    "Attend the physical stock count and independently verify quantities.",
    "Compare carrying values against recent selling prices to confirm NRV.",
    "Review the write-down allowance and increase if slow-moving stock exceeds it.",
    "Request management to update the inventory ageing report monthly.",
    "Implement a formal obsolescence policy for items older than 180 days.",
  ],
  "revenue cutoff": [
    "Test all sales invoices in the final two weeks of December against delivery notes.",
    "Review credit notes issued in January to identify any year-end reversals.",
    "Ensure the revenue recognition policy requires delivery confirmation before booking.",
    "Implement a cut-off checklist signed by the finance manager at year-end.",
    "Match dispatch records to invoices — any mismatch should be investigated.",
  ],
  "trade receivables": [
    "Send confirmation letters to all customers with material balances.",
    "Review the ECL model — increase the allowance if collection history is poor.",
    "Chase overdue balances older than 120 days with a formal collection process.",
    "Implement a credit policy that limits exposure to any single customer.",
    "Test whether cash was received after year-end to confirm recoverability.",
  ],
  "related party": [
    "Obtain a complete list of related parties and verify it against board minutes.",
    "Compare pricing on related party transactions to third-party market rates.",
    "Ensure all related party transactions are formally approved by the board.",
    "Review financial statement disclosures for completeness under IFRS.",
    "Assess UAE Corporate Tax transfer pricing documentation requirements.",
  ],
  "vat": [
    "Reconcile VAT returns to revenue and purchase ledgers for all periods.",
    "Verify the corporate tax computation is prepared by a qualified tax specialist.",
    "Check for any FTA correspondence, penalties, or outstanding assessments.",
    "Review transfer pricing documentation for related party purchases.",
    "Ensure deferred tax positions are correctly identified and disclosed.",
  ],
  "going concern": [
    "Obtain and critically review management's 12-month cash flow forecast.",
    "Stress-test the forecast — model a scenario where receivables collection delays by 30 days.",
    "Confirm supplier credit terms are still in place and not at risk of withdrawal.",
    "Review post year-end bank statements to verify actual cash movements.",
    "Assess whether going concern disclosures in the financial statements are adequate.",
  ],
  "fraud": [
    "Perform unpredictable journal entry testing around year-end.",
    "Scrutinise all manual adjustments and unsupported entries posted by management.",
    "Apply professional scepticism to all estimates and accruals.",
    "Review related party pricing independently without relying on management representations.",
    "Test a sample of transactions that bypass normal approval workflows.",
  ],
  "accrued": [
    "Obtain the accruals schedule and agree each item to supporting invoices or contracts.",
    "Test completeness by reviewing post year-end payments to identify unrecorded liabilities.",
    "Verify accruals are calculated on a consistent basis year on year.",
    "Challenge any accruals that appear unusually large or without clear supporting evidence.",
    "Confirm that all known liabilities at year-end are included in accrued expenses.",
  ],
  "lease": [
    "Agree lease terms to the original lease contracts.",
    "Recalculate the lease liability using the incremental borrowing rate.",
    "Verify the right-of-use asset amortisation schedule.",
    "Confirm the finance cost split between interest and principal repayment.",
    "Check that all leases are identified — including any that may have been missed.",
  ],
};

function getRiskSolutions(area = "") {
  const key = area.toLowerCase().trim();
  for (const [k, v] of Object.entries(RISK_SOLUTIONS)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return [
    "Perform detailed substantive testing on this area.",
    "Obtain all supporting documentation before the audit begins.",
    "Ensure management has addressed the identified risk before year-end.",
    "Discuss findings with the engagement partner for further guidance.",
  ];
}

function getRisk(raw = "") {
  const key = raw.toLowerCase().trim();
  return RISK_LEVELS[key] || RISK_LEVELS[key.replace("–", "-")] || null;
}

function isUnassessedRisk(raw = "") {
  return (raw || "").toLowerCase().trim() === "to be assessed";
}

// Deterministic level stepping. Same currentLabel + same steps ALWAYS
// produces the same result — no AI involved in this calculation at all.
function stepDownRiskLevel(currentLabel, steps) {
  const normalized = (currentLabel || "").trim();
  let index = RISK_LEVEL_ORDER.findIndex(
    (l) => l.toLowerCase() === normalized.toLowerCase()
  );
  if (index === -1) index = RISK_LEVEL_ORDER.length - 1; // unknown/"To Be Assessed" -> treat as High for stepping purposes
  const newIndex = Math.max(0, index - steps);
  return RISK_LEVEL_ORDER[newIndex];
}

function extractText(node) {
  if (!node && node !== 0) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node?.props?.children !== undefined) return extractText(node.props.children);
  return "";
}

function parseRiskRows(markdown = "") {
  const improved = [];
  const needsAttention = [];
  const lines = markdown.split("\n");
  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    if (/^\|[\s|:-]+\|/.test(line.trim())) continue;
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 3) continue;
    if (/^(risk\s*area|what it means|risk level|dimension|element|benchmark|role|item)/i.test(cells[0])) continue;
    let riskRaw  = cells[2] || "";
    let response = cells[3] || "";
    if (!getRisk(riskRaw) && cells.length >= 4) {
      riskRaw  = cells[3] || "";
      response = cells[4] || "";
    }
    const cfg = getRisk(riskRaw);
    if (!cfg) continue;
    if (isUnassessedRisk(riskRaw)) continue;

    const item = {
      area: cells[0], description: cells[1] || "",
      riskRaw, response,
      pct: cfg.pct, bar: cfg.bar, bg: cfg.bg, text: cfg.text, needsGap: cfg.needsGap,
    };
    if (cfg.needsGap) needsAttention.push(item);
    else improved.push(item);
  }
  return { improved, needsAttention };
}

function removeSourcesFromAnswer(answer = "") {
  return answer
    .replace(/\n+---\n+\n*## Sources[\s\S]*$/i, "")
    .replace(/\n+## Sources[\s\S]*$/i, "")
    .trim();
}

function isAuditReport(content = "") {
  return content.includes("Risk Assessment") || content.includes("Engagement Strategy") ||
    content.includes("Standard Reference") || content.includes("Risk Rating");
}

function getReportName(report) {
  return report?.source_file || report?.sourceFile || report?.fileName ||
    report?.file_name || report?.company || "selected report";
}

function createSessionId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Table row helpers, shared by the row-rewrite logic below ──────────
function isTableRowLine(line) {
  if (!line.trim().startsWith("|")) return false;
  if (/^\|[\s|:-]+\|/.test(line.trim())) return false;
  const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
  return cells.length >= 3;
}

function getRowArea(line) {
  const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
  return (cells[0] || "").trim().toLowerCase();
}

function findTableRowLineIndex(lines, targetArea) {
  const normalize = (s) => (s || "").trim().toLowerCase();
  const target = normalize(targetArea);
  for (let i = 0; i < lines.length; i++) {
    if (!isTableRowLine(lines[i])) continue;
    if (getRowArea(lines[i]) === target) return i;
  }
  return -1;
}

// FIX (Bug B): the old note strings applyRiskVerdictToReport used to
// write are fixed and known, so any previous one can be safely stripped
// before appending the current verdict's note — preventing old and new
// notes from piling up together in the same cell.
const KNOWN_VERDICT_NOTES = [
  "Resolved by uploaded evidence — fully addresses the planned response.",
  "Partially addressed by uploaded evidence — some items remain outstanding.",
  "Note: the uploaded document does not appear related to this risk — no change made.",
];

// SPECIFIC-GAP FEATURE: notes are now built dynamically from the AI's
// specifically_addressed / still_outstanding fields (see
// buildVerdictNote below), so they can no longer be matched against a
// small fixed list. Every note we write is prefixed with this marker so
// it can always be found and stripped, regardless of its exact wording.
const VERDICT_NOTE_MARKER = "🤖 Evidence check —";

function stripPreviousVerdictNote(text) {
  let cleaned = text;
  // New marker-based notes (this version onward): cut everything from
  // the marker to the end of the cell.
  const markerIndex = cleaned.indexOf(`— ${VERDICT_NOTE_MARKER}`);
  if (markerIndex !== -1) {
    cleaned = cleaned.slice(0, markerIndex);
  }
  // Legacy fixed-string notes (rows saved before this version) — kept
  // for backward compatibility with reports generated previously.
  for (const note of KNOWN_VERDICT_NOTES) {
    cleaned = cleaned.split(` — ${note}`).join("");
  }
  return cleaned.trim();
}

// SPECIFIC-GAP FEATURE: builds a note that names the concrete fact the
// evidence confirmed and, if the risk isn't fully resolved, the concrete
// gap that remains — instead of a generic "partially addressed" label.
// Falls back to the old generic wording if the agent hasn't been
// updated yet or returns these fields empty, so this stays compatible
// with the currently deployed agent.
function buildVerdictNote(verdict) {
  if (!verdict.relevant) {
    return "the uploaded document does not appear related to this risk — no change made.";
  }

  const addressed   = (verdict.specifically_addressed || "").trim();
  const outstanding = (verdict.still_outstanding || "").trim();

  if (verdict.resolves_risk) {
    return addressed
      ? `Resolved — confirmed: ${addressed}.`
      : "Resolved by uploaded evidence — fully addresses the planned response.";
  }

  if (addressed && outstanding) {
    return `Partially addressed — confirmed: ${addressed}. Still outstanding: ${outstanding}.`;
  }
  if (addressed) {
    return `Partially addressed — confirmed: ${addressed}. Some items remain outstanding.`;
  }
  return "Partially addressed by uploaded evidence — some items remain outstanding.";
}

// FIX: the risk LEVEL and the note both update as checklist items get
// satisfied, but the "what it means simply" DESCRIPTION cell was never
// touched by any rewrite path — so a risk could drop from 90% to 35%
// while its description still read like the original unresolved
// problem statement. This marker-based helper lets the checklist-
// progress flow (only) also refresh that cell with a short status
// summary, using the same strip-before-append pattern as the note
// marker so repeated updates never pile up old status text.
const DESCRIPTION_UPDATE_MARKER = "📌 Status update —";

function stripPreviousDescriptionUpdate(text) {
  const markerIndex = text.indexOf(`— ${DESCRIPTION_UPDATE_MARKER}`);
  if (markerIndex !== -1) return text.slice(0, markerIndex).trim();
  return text.trim();
}

// ── Deterministic row rewrite ───────────────────────────────────────────
// Directly edits ONE table row's risk-level cell (and appends a short
// note to the last cell) using plain string manipulation — no AI
// involved in producing the new text at all. This guarantees: (a) every
// OTHER row in the report is byte-for-byte untouched, and (b) the same
// verdict always produces the exact same row text.
//
// descriptionUpdateText is OPTIONAL and only ever passed by the
// checklist-progress flow (applyChecklistProgressToReport) — the
// original whole-document verdict flow (applyRiskVerdictToReport) never
// passes it, so that flow's behavior is completely unchanged.
function rewriteRiskRow(line, newLevelLabel, noteText, descriptionUpdateText) {
  // Raw split preserves the leading/trailing empty strings from a
  // well-formed "| a | b | c | d |" row, so positions stay predictable.
  const parts = line.split("|");
  let riskCellIndex = -1;
  for (let i = 1; i < parts.length - 1; i++) {
    if (getRisk(parts[i].trim())) {
      riskCellIndex = i;
      break;
    }
  }
  if (riskCellIndex !== -1) {
    parts[riskCellIndex] = ` ${newLevelLabel} `;
  }
  // The description cell ("what it means simply") always immediately
  // precedes the risk-level cell in the standard 4-column table.
  if (descriptionUpdateText && riskCellIndex > 1) {
    const descIndex = riskCellIndex - 1;
    const existingDesc = stripPreviousDescriptionUpdate(parts[descIndex].trim());
    parts[descIndex] = ` ${existingDesc} — ${DESCRIPTION_UPDATE_MARKER} ${descriptionUpdateText} `;
  }
  // Append the note to the last real (non-empty-trailing) cell — this is
  // always the "What the auditor will check" / Response column.
  let lastRealIndex = parts.length - 2; // parts[len-1] is the trailing "" after the final pipe
  if (lastRealIndex >= 1 && noteText) {
    const existing = stripPreviousVerdictNote(parts[lastRealIndex].trim());
    parts[lastRealIndex] = ` ${existing} — ${VERDICT_NOTE_MARKER} ${noteText} `;
  }
  return parts.join("|");
}

function applyRiskVerdictToReport(oldMarkdown, targetArea, verdict, currentLevelLabel) {
  if (!oldMarkdown) return oldMarkdown;
  const lines = oldMarkdown.split("\n");
  const rowIndex = findTableRowLineIndex(lines, targetArea);
  if (rowIndex === -1) return oldMarkdown;

  let newLevelLabel = currentLevelLabel;

  if (!verdict.relevant) {
    newLevelLabel = currentLevelLabel; // unchanged
  } else if (verdict.resolves_risk) {
    newLevelLabel = stepDownRiskLevel(currentLevelLabel, 2);
  } else {
    newLevelLabel = stepDownRiskLevel(currentLevelLabel, 1);
  }

  const note = buildVerdictNote(verdict);
  lines[rowIndex] = rewriteRiskRow(lines[rowIndex], newLevelLabel, note);
  return lines.join("\n");
}

// ── CHECKLIST FEATURE: progress-based row rewrite ──────────────────────
// Instead of one all-or-nothing verdict, a risk can now have several
// independent checklist items. This computes how many are done out of
// the total and steps the risk level down from its ORIGINAL level
// (checklistBaseLevel, captured once when the checklist was first
// generated) — never from whatever the level currently is — so repeated
// updates never compound on top of each other. The note names exactly
// which items are still pending, satisfying the "show all risks, then
// show which are still pending" requirement.
// UPDATED: now combines BOTH checklists — the AI-generated "Planned
// Audit Response" items AND the client's "Mandatory Checklist" items —
// into ONE overall progress count, since together they represent the
// total evidence gathered for this risk. Satisfying an item in EITHER
// checklist counts toward the same risk-level reduction.
function summarizeChecklistProgress(items, mandatoryItems = []) {
  const allItems = [...(items || []), ...(mandatoryItems || [])];
  const total = allItems.length;
  const doneItems = allItems.filter((i) => i.satisfied || i.manuallyChecked);
  const pendingItems = allItems.filter((i) => !(i.satisfied || i.manuallyChecked));
  const doneCount = doneItems.length;

  let note;
  if (total === 0) {
    note = "";
  } else if (doneCount === 0) {
    note = `0 of ${total} checklist items satisfied yet.`;
  } else if (doneCount === total) {
    note = `All ${total} checklist items satisfied.`;
  } else {
    const pendingText = pendingItems.map((i) => i.text).join("; ");
    note = `${doneCount} of ${total} checklist items satisfied. Still pending: ${pendingText}.`;
  }

  return { total, doneCount, note };
}

// FIX: the old flat two-tier scheme (1 step for "some done", 2 steps
// only if "all done") meant 1-of-5 and 4-of-5 satisfied produced the
// EXACT SAME risk level — clearly wrong, since 4/5 should read as
// nearly resolved. This computes steps PROPORTIONALLY to how much of
// the checklist is actually done, scaled against how many levels
// separate the risk's ORIGINAL level from "Low" (never from whatever
// the level currently is, so repeated updates never compound). Partial
// completion is capped one step short of the fully-resolved level, so
// "4 of 5 done" can never look identical to "5 of 5 done" — only a
// complete checklist can reach the bottom level.
function computeStepsFromChecklistProgress(baseLevel, doneCount, total) {
  if (total === 0 || doneCount === 0) return 0;

  const baseIndex = RISK_LEVEL_ORDER.findIndex(
    (l) => l.toLowerCase() === (baseLevel || "").trim().toLowerCase()
  );
  const maxSteps = baseIndex === -1 ? RISK_LEVEL_ORDER.length - 1 : baseIndex;
  if (maxSteps === 0) return 0; // already at the lowest level

  if (doneCount === total) return maxSteps; // fully resolved -> drop straight to Low

  const proportional = Math.round((doneCount / total) * maxSteps);
  return Math.min(proportional, maxSteps - 1);
}

// FIX: builds a short status line reflecting how much of the checklist
// is actually done, so the "what it means simply" description keeps up
// with reality instead of forever reading like the original unresolved
// problem — e.g. a risk sitting at 35% after 4/5 items confirmed should
// no longer show a description that still sounds like nothing's been
// done. Returns an empty string when nothing is done yet, so the
// original description is left completely untouched in that case.
function buildDescriptionStatusUpdate(doneCount, total) {
  if (total === 0 || doneCount === 0) return "";
  if (doneCount === total) {
    return "All checklist items have now been confirmed — this risk has been substantially resolved.";
  }
  return `${doneCount} of ${total} checklist items confirmed so far — largely addressed, with the remaining item(s) still outstanding.`;
}

function applyChecklistProgressToReport(oldMarkdown, targetArea, baseLevel, items, mandatoryItems = []) {
  if (!oldMarkdown) return oldMarkdown;
  const lines = oldMarkdown.split("\n");
  const rowIndex = findTableRowLineIndex(lines, targetArea);
  if (rowIndex === -1) return oldMarkdown;

  const { total, doneCount, note } = summarizeChecklistProgress(items, mandatoryItems);
  if (total === 0) return oldMarkdown;

  const steps = computeStepsFromChecklistProgress(baseLevel, doneCount, total);
  const newLevelLabel = stepDownRiskLevel(baseLevel, steps);
  const descriptionUpdate = buildDescriptionStatusUpdate(doneCount, total);
  lines[rowIndex] = rewriteRiskRow(lines[rowIndex], newLevelLabel, note, descriptionUpdate);
  return lines.join("\n");
}

// ─── Item Modal with Solutions ────────────────────────────────────────
function ItemModal({ item, onClose, reportId, agentId, currentReportContent, onRiskEvidenceRegenerated }) {
  const [showSolutions, setShowSolutions] = useState(false);
  const [showMandatoryChecklist, setShowMandatoryChecklist] = useState(false);
  if (!item) return null;
  const cfg       = getRisk(item.riskRaw);
  const solutions = getRiskSolutions(item.area);

  const riskKey = buildRiskKey(reportId, agentId, item.area);
  const [review, setReview]           = useState(null);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [reviewError, setReviewError] = useState("");
  const [saving, setSaving]           = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [uploadStage, setUploadStage] = useState("");
  const [lastVerdict, setLastVerdict] = useState(null);

  // ── CHECKLIST FEATURE: local state ──────────────────────────────────
  const checklistRequestedRef              = useRef(false);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [checklistError, setChecklistError]     = useState("");
  const [itemUploadState, setItemUploadState]   = useState({}); // { [checklistItemId]: { uploading, stage } }
  // FIX: uploading several files at once for one item used to collapse
  // down to a SINGLE aggregate verdict, so there was no way to see
  // "file A satisfied this, file B was unrelated" — just one combined
  // message. Now each file's own result is tracked separately.
  // { [checklistItemId]: [{ fileName, s3Key, relevant, resolves_risk, reason }, ...] }
  const [itemFileResults, setItemFileResults]   = useState({});
  const [justificationOpenId, setJustificationOpenId] = useState(null);
  const [justificationDraft, setJustificationDraft]   = useState("");

  // ── MANDATORY CHECKLIST: local state (fully independent from the
  // dynamic checklist above — separate storage field, separate state,
  // separate handlers, never interacts with checklistItems). ─────────
  const mandatoryChecklistRequestedRef = useRef(false);
  const [mandatoryItemUploadState, setMandatoryItemUploadState] = useState({});
  const [mandatoryItemFileResults, setMandatoryItemFileResults] = useState({});
  const [mandatoryJustificationOpenId, setMandatoryJustificationOpenId] = useState(null);
  const [mandatoryJustificationDraft, setMandatoryJustificationDraft]   = useState("");

  useEffect(() => {
    let cancelled = false;
    checklistRequestedRef.current = false;
    mandatoryChecklistRequestedRef.current = false;
    setReviewLoading(true);
    setReviewError("");
    setChecklistError("");
    setItemUploadState({});
    setItemFileResults({});
    setJustificationOpenId(null);
    setJustificationDraft("");
    setMandatoryItemUploadState({});
    setMandatoryItemFileResults({});
    setMandatoryJustificationOpenId(null);
    setMandatoryJustificationDraft("");
    fetch(RISK_API(riskKey))
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setReview(data);
        // CHECKLIST FEATURE: generate the checklist exactly once, the
        // first time this risk is opened with none saved yet. Reopening
        // later will find checklistItems already populated and skip
        // straight past this.
        if (item.needsGap && (!data.checklistItems || data.checklistItems.length === 0)) {
          generateChecklist();
        }
        // MANDATORY CHECKLIST: initialize once from the static client
        // Excel template (no AI call — the text is already known
        // client-side), only if this risk area has a matching line item
        // and nothing has been saved for it yet.
        if (
          item.needsGap &&
          (!data.mandatoryChecklistItems || data.mandatoryChecklistItems.length === 0) &&
          !mandatoryChecklistRequestedRef.current
        ) {
          const templateItems = getClientChecklistTemplate(item.area);
          if (templateItems && templateItems.length > 0) {
            mandatoryChecklistRequestedRef.current = true;
            saveRiskUpdate({ setMandatoryChecklist: templateItems });
          }
        }
      })
      .catch(() => { if (!cancelled) setReviewError("Could not load review status for this risk."); })
      .finally(() => { if (!cancelled) setReviewLoading(false); });
    return () => { cancelled = true; };
  }, [riskKey]);

  async function saveRiskUpdate(patch) {
    setSaving(true);
    setReviewError("");
    try {
      const res = await fetch(RISK_API(riskKey), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save.");
      setReview(data);
      return data;
    } catch (err) {
      setReviewError(err.message || "Failed to save your update. Please try again.");
      return null;
    } finally {
      setSaving(false);
    }
  }

  function handleStatusChange(e) {
    saveRiskUpdate({ status: e.target.value });
  }

  const [customStatusText, setCustomStatusText] = useState("");

  useEffect(() => {
    setCustomStatusText(review?.customStatusText || "");
  }, [review?.customStatusText]);

  function handleCustomStatusBlur() {
    if (review?.status === "other") {
      saveRiskUpdate({ status: "other", customStatusText });
    }
  }

  const [newComment, setNewComment] = useState("");
  const [savedConfirmation, setSavedConfirmation] = useState(false);

  function handleAddComment() {
    const text = newComment.trim();
    if (!text) return;
    saveRiskUpdate({ newComment: { author: "User", text } });
    setNewComment("");
  }

  async function waitForRiskEvidenceDocument(fileName, existingIds) {
    const normalize = (n) => (n || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    for (let attempt = 0; attempt < RISK_EVIDENCE_MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(RISK_EVIDENCE_POLL_INTERVAL_MS);
      setUploadStage(`Extracting text from document… (${attempt + 1})`);
      try {
        const res  = await fetch(`${RISK_DOCUMENTS_API}?portal=user`);
        const data = await res.json();
        const list = data.reports || data.documents || data.items || [];
        const match = list.find((doc) => {
          const id = doc.reportId || doc.documentId || doc.document_id || "";
          if (!id || existingIds.has(id)) return false;
          const isDone = ["COMPLETED", "READY"].includes(doc.status || doc.processingStatus);
          if (!isDone) return false;
          const name = normalize(doc.source_file || doc.sourceFile || doc.fileName || doc.file_name || "");
          return name && name.endsWith(normalize(fileName));
        });
        if (match) return match.reportId || match.documentId || match.document_id;
      } catch {}
    }
    throw new Error("Document took too long to process. Please try again.");
  }

  // Generic job poller, shared by the whole-risk relevance check, the
  // checklist-decomposition request, and per-item relevance checks.
  // onTick (optional) is called once per poll attempt so the caller can
  // update whatever stage indicator is relevant to it.
  async function pollAgentJob(jobId, onTick) {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);
      if (onTick) onTick(attempt);
      let res;
      try { res = await fetch(CHAT_STATUS_API(jobId)); } catch { continue; }
      if (!res.ok && res.status !== 404) continue;
      const data = await res.json();
      if (data.status === "complete") return data;
      if (data.status === "failed") throw new Error(data.error || "Request failed.");
    }
    throw new Error("This is taking longer than expected. Please check back shortly.");
  }

  // ── Deterministic relevance check for ONE newly uploaded document ────
  // Calls the agent's narrow relevanceCheck route (see agentcore
  // audit_planning_agent/app.py) which returns { relevant, resolves_risk,
  // reason, specifically_addressed, still_outstanding } — never a full
  // report. The frontend then computes the new risk level itself via a
  // fixed lookup table (stepDownRiskLevel) and edits ONLY this risk's
  // table row directly.
  //
  // IMPORTANT FIX: every other call to CHAT_API in this codebase always
  // includes non-empty "message" and "question" fields. The upstream
  // Lambda chain validates this and returns 400 Bad Request if they are
  // missing — this call previously omitted them, which was the root
  // cause of the "risk not reducing" bug. They are included below even
  // though the agent's relevanceCheck branch itself does not read them.
  async function checkRelevanceAndApply(evidenceReportId) {
    setUploadStage("Checking whether this evidence resolves the risk…");
    const placeholderMessage = `Check evidence relevance for "${item.area}".`;
    const chatRes = await fetch(CHAT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: placeholderMessage,
        question: placeholderMessage,
        sessionId: `risk-relevance-${Date.now()}`,
        reportId: evidenceReportId,
        reportIds: [evidenceReportId],
        selectedAgent: agentId,
        agent: agentId,
        generalMode: false,
        general_mode: false,
        relevanceCheck: {
          riskArea: item.area,
          riskDescription: item.description,
          plannedResponse: item.response || "",
        },
      }),
    });
    const chatData = await chatRes.json();
    if (!chatRes.ok && chatRes.status !== 202) {
      throw new Error(chatData.message || chatData.error || `Relevance check request failed (${chatRes.status}).`);
    }
    let final = chatData;
    if (chatData.status === "processing" && chatData.jobId) {
      final = await pollAgentJob(chatData.jobId, () =>
        setUploadStage("Checking whether this evidence resolves the risk…")
      );
    }
    const rawAnswer = final.answer || final.response || final.message || "";
    let verdict;
    try {
      verdict = JSON.parse(rawAnswer);
    } catch {
      verdict = {
        relevant: false,
        resolves_risk: false,
        reason: "Could not read the assessment result.",
        specifically_addressed: "",
        still_outstanding: "",
      };
    }
    setLastVerdict(verdict);

    const mergedContent = applyRiskVerdictToReport(
      currentReportContent,
      item.area,
      verdict,
      item.riskRaw
    );
    onRiskEvidenceRegenerated?.(mergedContent);
    return verdict;
  }

  // ── Upload: saves file(s) as evidence, THEN runs the deterministic
  // relevance check on each one and applies the result immediately.
  // Supports multiple files at once.
  async function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !reportId) return;
    setUploading(true);
    setReviewError("");
    setLastVerdict(null);
    try {
      let existingIds = new Set();
      try {
        const snapRes  = await fetch(`${RISK_DOCUMENTS_API}?portal=user`);
        const snapData = await snapRes.json();
        const snapList = snapData.reports || snapData.documents || snapData.items || [];
        existingIds = new Set(
          snapList.map((d) => d.reportId || d.documentId || d.document_id).filter(Boolean)
        );
      } catch {}

      for (const file of files) {
        setUploadStage(`Uploading ${file.name}…`);
        const urlRes = await fetch(RISK_ATTACHMENT_URL_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_name: file.name, content_type: file.type || "application/pdf" }),
        });
        const urlData   = await urlRes.json();
        const uploadUrl = urlData.uploadUrl || urlData.upload_url || urlData.url || urlData.presignedUrl;
        if (!uploadUrl) throw new Error(`Could not get an upload link for ${file.name}.`);

        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/pdf" },
          body: file,
        });
        if (!putRes.ok) throw new Error(`Uploading ${file.name} to storage failed.`);

        setUploadStage(`Extracting text from ${file.name}…`);
        const evidenceReportId = await waitForRiskEvidenceDocument(file.name, existingIds);
        existingIds.add(evidenceReportId);

        await saveRiskUpdate({ newAttachment: { fileName: file.name, s3Key: evidenceReportId } });

        // Run the deterministic relevance check for THIS document right
        // away. If multiple files are uploaded together, each is
        // checked in turn and the last one's verdict determines the
        // final risk row state.
        await checkRelevanceAndApply(evidenceReportId);
      }
    } catch (err) {
      setReviewError(err.message || "Failed to attach the document. Please try again.");
    } finally {
      setUploading(false);
      setUploadStage("");
      e.target.value = "";
    }
  }

  // ── Remove a wrongly-attached document ──────────────────────────────
  async function handleRemoveAttachment(s3Key) {
    await saveRiskUpdate({ removeAttachment: { s3Key } });
  }

  // Save now ONLY handles status/comments — it never triggers a
  // re-analysis. Relevance checking happens automatically and exactly
  // once per uploaded document, at upload time (see handleFileSelect).
  async function handleManualSave() {
    const pendingComment = newComment.trim();
    const patch = { status: review?.status || "open" };
    if (review?.status === "other") patch.customStatusText = customStatusText;
    if (pendingComment) patch.newComment = { author: "User", text: pendingComment };
    const result = await saveRiskUpdate(patch);
    if (result) {
      if (pendingComment) setNewComment("");
      setSavedConfirmation(true);
      setTimeout(() => setSavedConfirmation(false), 2500);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHECKLIST FEATURE
  // ═══════════════════════════════════════════════════════════════════

  // Breaks this risk's Planned Response into a checklist of individually
  // checkable items via the agent's riskChecklist route, then persists
  // it. Guarded so it only ever runs once per risk (setChecklist on the
  // backend also no-ops if a checklist already exists, as a second
  // layer of protection against duplicate generation).
  async function generateChecklist() {
    if (checklistRequestedRef.current) return;
    checklistRequestedRef.current = true;
    setChecklistLoading(true);
    setChecklistError("");
    try {
      const placeholderMessage = `Generate risk checklist for "${item.area}".`;
      const chatRes = await fetch(CHAT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: placeholderMessage,
          question: placeholderMessage,
          sessionId: `risk-checklist-${Date.now()}`,
          reportId: reportId || null,
          reportIds: reportId ? [reportId] : [],
          selectedAgent: agentId,
          agent: agentId,
          generalMode: false,
          general_mode: false,
          riskChecklist: {
            riskArea: item.area,
            riskDescription: item.description,
            plannedResponse: item.response || "",
          },
        }),
      });
      const chatData = await chatRes.json();
      if (!chatRes.ok && chatRes.status !== 202) {
        throw new Error(chatData.message || chatData.error || `Checklist request failed (${chatRes.status}).`);
      }
      let final = chatData;
      if (chatData.status === "processing" && chatData.jobId) {
        final = await pollAgentJob(chatData.jobId);
      }
      const rawAnswer = final.answer || final.response || final.message || "";
      let parsed;
      try { parsed = JSON.parse(rawAnswer); } catch { parsed = {}; }
      const items = Array.isArray(parsed.items)
        ? parsed.items.map((i) => String(i).trim()).filter(Boolean)
        : [];
      if (items.length === 0) {
        setChecklistError("Could not break this risk into a checklist. Showing the standard planned response instead.");
        return;
      }
      await saveRiskUpdate({ setChecklist: items, baseRiskLevel: item.riskRaw });
    } catch (err) {
      setChecklistError(err.message || "Failed to generate a checklist for this risk. Showing the standard planned response instead.");
    } finally {
      setChecklistLoading(false);
    }
  }

  // Applies an update to ONE checklist item, then recomputes the risk's
  // overall level/note from the FULL updated checklist and pushes that
  // into the report — reusing applyChecklistProgressToReport so this is
  // always derived fresh from all items' current state, never adjusted
  // incrementally (which could drift or compound).
  async function saveChecklistItemUpdate(itemId, patch) {
    const result = await saveRiskUpdate({ updateChecklistItem: { id: itemId, ...patch } });
    if (result) {
      const baseLevel = result.checklistBaseLevel || item.riskRaw;
      const mergedContent = applyChecklistProgressToReport(
        currentReportContent,
        item.area,
        baseLevel,
        result.checklistItems || [],
        result.mandatoryChecklistItems || []
      );
      onRiskEvidenceRegenerated?.(mergedContent);
    }
    return result;
  }

  // Checkbox click behaviour:
  // - Evidence-satisfied items are locked; clicking does nothing.
  // - Manually-checked items can be unchecked directly, no justification
  //   needed to remove a manual override.
  // - Unchecked items open the inline justification box instead of
  //   toggling immediately, since a manual check requires an explanation.
  function handleItemCheckboxClick(checklistItem) {
    if (checklistItem.satisfied) return;
    const isDone = checklistItem.satisfied || checklistItem.manuallyChecked;
    if (isDone) {
      saveChecklistItemUpdate(checklistItem.id, {
        manuallyChecked: false,
        satisfied: false,
        justification: "",
      });
      return;
    }
    setJustificationOpenId(checklistItem.id);
    setJustificationDraft("");
  }

  async function handleSaveJustification(checklistItem) {
    const text = justificationDraft.trim();
    if (!text) return;
    await saveChecklistItemUpdate(checklistItem.id, {
      manuallyChecked: true,
      satisfied: true,
      justification: text,
    });
    setJustificationOpenId(null);
    setJustificationDraft("");
  }

  // Undoes a checklist item that was satisfied by the WRONG document (or
  // a manual confirmation the user wants to retract). Resets the item
  // back to unchecked/manual AND removes the associated attachment (if
  // any) from the risk's attachment record in the same request, so a
  // wrongly-uploaded file doesn't linger in the audit trail looking like
  // valid evidence for this item.
  async function handleCancelChecklistItem(checklistItem) {
    const patch = {
      updateChecklistItem: {
        id: checklistItem.id,
        satisfied: false,
        satisfiedBy: null,
        manuallyChecked: false,
        justification: "",
      },
    };
    if (checklistItem.satisfiedBy) {
      patch.removeAttachment = { s3Key: checklistItem.satisfiedBy };
    }
    const result = await saveRiskUpdate(patch);
    setItemFileResults((prev) => ({ ...prev, [checklistItem.id]: [] }));
    if (result) {
      const baseLevel = result.checklistBaseLevel || item.riskRaw;
      const mergedContent = applyChecklistProgressToReport(
        currentReportContent,
        item.area,
        baseLevel,
        result.checklistItems || [],
        result.mandatoryChecklistItems || []
      );
      onRiskEvidenceRegenerated?.(mergedContent);
    }
  }

  // Runs the same deterministic relevanceCheck route as the whole-risk
  // upload, but scoped to ONE checklist item's text as the "planned
  // response" being assessed — so the document is judged only against
  // that single item, not the whole risk.
  async function checkChecklistItemRelevance(checklistItem, evidenceReportId) {
    const placeholderMessage = `Check evidence relevance for one checklist item under "${item.area}".`;
    const chatRes = await fetch(CHAT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: placeholderMessage,
        question: placeholderMessage,
        sessionId: `risk-item-relevance-${Date.now()}`,
        reportId: evidenceReportId,
        reportIds: [evidenceReportId],
        selectedAgent: agentId,
        agent: agentId,
        generalMode: false,
        general_mode: false,
        relevanceCheck: {
          riskArea: item.area,
          riskDescription: item.description,
          plannedResponse: checklistItem.text,
        },
      }),
    });
    const chatData = await chatRes.json();
    if (!chatRes.ok && chatRes.status !== 202) {
      throw new Error(chatData.message || chatData.error || `Relevance check failed (${chatRes.status}).`);
    }
    let final = chatData;
    if (chatData.status === "processing" && chatData.jobId) {
      final = await pollAgentJob(chatData.jobId, () =>
        setItemUploadState((prev) => ({
          ...prev,
          [checklistItem.id]: { uploading: true, stage: "Checking this item against the document…" },
        }))
      );
    }
    const rawAnswer = final.answer || final.response || final.message || "";
    try {
      return JSON.parse(rawAnswer);
    } catch {
      return {
        relevant: false,
        resolves_risk: false,
        reason: "Could not read the assessment result.",
        specifically_addressed: "",
        still_outstanding: "",
      };
    }
  }

  // Upload scoped to ONE checklist item. Saves the file as an
  // attachment (so it still shows in the overall Supporting Documents
  // list) AND checks it only against this one item's requirement.
  async function handleItemFileSelect(checklistItem, e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !reportId) return;
    setItemUploadState((prev) => ({ ...prev, [checklistItem.id]: { uploading: true, stage: "" } }));
    // Fresh results list for this upload batch, so old results from a
    // previous session don't linger mixed in with new ones.
    setItemFileResults((prev) => ({ ...prev, [checklistItem.id]: [] }));
    try {
      let existingIds = new Set();
      try {
        const snapRes  = await fetch(`${RISK_DOCUMENTS_API}?portal=user`);
        const snapData = await snapRes.json();
        const snapList = snapData.reports || snapData.documents || snapData.items || [];
        existingIds = new Set(
          snapList.map((d) => d.reportId || d.documentId || d.document_id).filter(Boolean)
        );
      } catch {}

      // Every file is checked individually and its OWN result is kept
      // and shown separately — so uploading 2 files at once clearly
      // shows "this one satisfied it, that one didn't" instead of one
      // collapsed message. The item's saved satisfied/satisfiedBy state
      // can only ever move from false -> true within this batch, never
      // back down — so a later unrelated file can never undo an earlier
      // one that genuinely satisfied the item.
      let satisfiedNow   = !!checklistItem.satisfied;
      let satisfiedByNow = checklistItem.satisfiedBy || null;

      for (const file of files) {
        setItemUploadState((prev) => ({
          ...prev,
          [checklistItem.id]: { uploading: true, stage: `Uploading ${file.name}…` },
        }));
        const urlRes = await fetch(RISK_ATTACHMENT_URL_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_name: file.name, content_type: file.type || "application/pdf" }),
        });
        const urlData   = await urlRes.json();
        const uploadUrl = urlData.uploadUrl || urlData.upload_url || urlData.url || urlData.presignedUrl;
        if (!uploadUrl) throw new Error(`Could not get an upload link for ${file.name}.`);

        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/pdf" },
          body: file,
        });
        if (!putRes.ok) throw new Error(`Uploading ${file.name} to storage failed.`);

        setItemUploadState((prev) => ({
          ...prev,
          [checklistItem.id]: { uploading: true, stage: `Extracting text from ${file.name}…` },
        }));
        const evidenceReportId = await waitForRiskEvidenceDocument(file.name, existingIds);
        existingIds.add(evidenceReportId);

        setItemUploadState((prev) => ({
          ...prev,
          [checklistItem.id]: { uploading: true, stage: `Checking ${file.name} against this item…` },
        }));
        const verdict = await checkChecklistItemRelevance(checklistItem, evidenceReportId);

        setItemFileResults((prev) => ({
          ...prev,
          [checklistItem.id]: [
            ...(prev[checklistItem.id] || []),
            {
              fileName: file.name,
              s3Key: evidenceReportId,
              relevant: verdict.relevant,
              resolves_risk: verdict.resolves_risk,
              reason: verdict.reason,
              stillOutstanding: verdict.still_outstanding || "",
            },
          ],
        }));

        const fileSatisfies = !!(verdict.relevant && verdict.resolves_risk);
        if (fileSatisfies && !satisfiedNow) {
          satisfiedNow   = true;
          satisfiedByNow = evidenceReportId;
        }

        const patchItem = { id: checklistItem.id, satisfied: satisfiedNow };
        if (satisfiedNow) patchItem.satisfiedBy = satisfiedByNow;
        if (fileSatisfies) patchItem.justification = verdict.reason || "";

        const result = await saveRiskUpdate({
          newAttachment: { fileName: file.name, s3Key: evidenceReportId },
          updateChecklistItem: patchItem,
        });
        if (result) {
          const baseLevel = result.checklistBaseLevel || item.riskRaw;
          const mergedContent = applyChecklistProgressToReport(
            currentReportContent,
            item.area,
            baseLevel,
            result.checklistItems || [],
            result.mandatoryChecklistItems || []
          );
          onRiskEvidenceRegenerated?.(mergedContent);
        }
      }
    } catch (err) {
      setReviewError(err.message || "Failed to attach the document for this item. Please try again.");
    } finally {
      setItemUploadState((prev) => ({ ...prev, [checklistItem.id]: { uploading: false, stage: "" } }));
      e.target.value = "";
    }
  }

  // Removes ONE specific unrelated file's result from the display and
  // deletes its attachment record — for cleaning up a wrongly-uploaded
  // document that didn't satisfy this item, without touching the item's
  // own satisfied state (it never contributed to it in the first place).
  async function handleCancelFileResult(checklistItemId, fileResult) {
    if (fileResult.s3Key) {
      await saveRiskUpdate({ removeAttachment: { s3Key: fileResult.s3Key } });
    }
    setItemFileResults((prev) => ({
      ...prev,
      [checklistItemId]: (prev[checklistItemId] || []).filter((r) => r.s3Key !== fileResult.s3Key),
    }));
  }

  // ═══════════════════════════════════════════════════════════════════
  // MANDATORY CHECKLIST — same interaction pattern as the dynamic
  // checklist above (checkbox/lock, per-item upload, per-file results,
  // Cancel, manual justification), but targeting mandatoryChecklistItems
  // instead. Deliberately does NOT call applyChecklistProgressToReport
  // UPDATED: Mandatory Checklist items now DO contribute to the risk
  // level — combined with the dynamic checklist's progress via
  // applyChecklistProgressToReport's mandatoryItems parameter — since
  // satisfying either checklist represents real evidence gathered for
  // this risk. Uses checklistBaseLevel (the risk's ORIGINAL level,
  // captured once) so combining two checklists never compounds
  // incorrectly, exactly like the dynamic checklist's own math.
  // ═══════════════════════════════════════════════════════════════════

  async function saveMandatoryChecklistItemUpdate(itemId, patch) {
    const result = await saveRiskUpdate({ updateMandatoryChecklistItem: { id: itemId, ...patch } });
    if (result) {
      const baseLevel = result.checklistBaseLevel || item.riskRaw;
      const mergedContent = applyChecklistProgressToReport(
        currentReportContent,
        item.area,
        baseLevel,
        result.checklistItems || [],
        result.mandatoryChecklistItems || []
      );
      onRiskEvidenceRegenerated?.(mergedContent);
    }
    return result;
  }

  function handleMandatoryItemCheckboxClick(checklistItem) {
    if (checklistItem.satisfied) return;
    const isDone = checklistItem.satisfied || checklistItem.manuallyChecked;
    if (isDone) {
      saveMandatoryChecklistItemUpdate(checklistItem.id, {
        manuallyChecked: false,
        satisfied: false,
        justification: "",
      });
      return;
    }
    setMandatoryJustificationOpenId(checklistItem.id);
    setMandatoryJustificationDraft("");
  }

  async function handleSaveMandatoryJustification(checklistItem) {
    const text = mandatoryJustificationDraft.trim();
    if (!text) return;
    await saveMandatoryChecklistItemUpdate(checklistItem.id, {
      manuallyChecked: true,
      satisfied: true,
      justification: text,
    });
    setMandatoryJustificationOpenId(null);
    setMandatoryJustificationDraft("");
  }

  async function handleCancelMandatoryChecklistItem(checklistItem) {
    const patch = {
      updateMandatoryChecklistItem: {
        id: checklistItem.id,
        satisfied: false,
        satisfiedBy: null,
        manuallyChecked: false,
        justification: "",
      },
    };
    if (checklistItem.satisfiedBy) {
      patch.removeAttachment = { s3Key: checklistItem.satisfiedBy };
    }
    const result = await saveRiskUpdate(patch);
    setMandatoryItemFileResults((prev) => ({ ...prev, [checklistItem.id]: [] }));
    if (result) {
      const baseLevel = result.checklistBaseLevel || item.riskRaw;
      const mergedContent = applyChecklistProgressToReport(
        currentReportContent,
        item.area,
        baseLevel,
        result.checklistItems || [],
        result.mandatoryChecklistItems || []
      );
      onRiskEvidenceRegenerated?.(mergedContent);
    }
  }

  async function checkMandatoryChecklistItemRelevance(checklistItem, evidenceReportId) {
    const placeholderMessage = `Check evidence relevance for one mandatory checklist item under "${item.area}".`;
    const chatRes = await fetch(CHAT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: placeholderMessage,
        question: placeholderMessage,
        sessionId: `risk-mandatory-relevance-${Date.now()}`,
        reportId: evidenceReportId,
        reportIds: [evidenceReportId],
        selectedAgent: agentId,
        agent: agentId,
        generalMode: false,
        general_mode: false,
        relevanceCheck: {
          riskArea: item.area,
          riskDescription: item.description,
          plannedResponse: checklistItem.text,
        },
      }),
    });
    const chatData = await chatRes.json();
    if (!chatRes.ok && chatRes.status !== 202) {
      throw new Error(chatData.message || chatData.error || `Relevance check failed (${chatRes.status}).`);
    }
    let final = chatData;
    if (chatData.status === "processing" && chatData.jobId) {
      final = await pollAgentJob(chatData.jobId, () =>
        setMandatoryItemUploadState((prev) => ({
          ...prev,
          [checklistItem.id]: { uploading: true, stage: "Checking this item against the document…" },
        }))
      );
    }
    const rawAnswer = final.answer || final.response || final.message || "";
    try {
      return JSON.parse(rawAnswer);
    } catch {
      return {
        relevant: false,
        resolves_risk: false,
        reason: "Could not read the assessment result.",
        specifically_addressed: "",
        still_outstanding: "",
      };
    }
  }

  async function handleMandatoryItemFileSelect(checklistItem, e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !reportId) return;
    setMandatoryItemUploadState((prev) => ({ ...prev, [checklistItem.id]: { uploading: true, stage: "" } }));
    setMandatoryItemFileResults((prev) => ({ ...prev, [checklistItem.id]: [] }));
    try {
      let existingIds = new Set();
      try {
        const snapRes  = await fetch(`${RISK_DOCUMENTS_API}?portal=user`);
        const snapData = await snapRes.json();
        const snapList = snapData.reports || snapData.documents || snapData.items || [];
        existingIds = new Set(
          snapList.map((d) => d.reportId || d.documentId || d.document_id).filter(Boolean)
        );
      } catch {}

      let satisfiedNow   = !!checklistItem.satisfied;
      let satisfiedByNow = checklistItem.satisfiedBy || null;

      for (const file of files) {
        setMandatoryItemUploadState((prev) => ({
          ...prev,
          [checklistItem.id]: { uploading: true, stage: `Uploading ${file.name}…` },
        }));
        const urlRes = await fetch(RISK_ATTACHMENT_URL_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_name: file.name, content_type: file.type || "application/pdf" }),
        });
        const urlData   = await urlRes.json();
        const uploadUrl = urlData.uploadUrl || urlData.upload_url || urlData.url || urlData.presignedUrl;
        if (!uploadUrl) throw new Error(`Could not get an upload link for ${file.name}.`);

        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/pdf" },
          body: file,
        });
        if (!putRes.ok) throw new Error(`Uploading ${file.name} to storage failed.`);

        setMandatoryItemUploadState((prev) => ({
          ...prev,
          [checklistItem.id]: { uploading: true, stage: `Extracting text from ${file.name}…` },
        }));
        const evidenceReportId = await waitForRiskEvidenceDocument(file.name, existingIds);
        existingIds.add(evidenceReportId);

        setMandatoryItemUploadState((prev) => ({
          ...prev,
          [checklistItem.id]: { uploading: true, stage: `Checking ${file.name} against this item…` },
        }));
        const verdict = await checkMandatoryChecklistItemRelevance(checklistItem, evidenceReportId);

        setMandatoryItemFileResults((prev) => ({
          ...prev,
          [checklistItem.id]: [
            ...(prev[checklistItem.id] || []),
            {
              fileName: file.name,
              s3Key: evidenceReportId,
              relevant: verdict.relevant,
              resolves_risk: verdict.resolves_risk,
              reason: verdict.reason,
              stillOutstanding: verdict.still_outstanding || "",
            },
          ],
        }));

        const fileSatisfies = !!(verdict.relevant && verdict.resolves_risk);
        if (fileSatisfies && !satisfiedNow) {
          satisfiedNow   = true;
          satisfiedByNow = evidenceReportId;
        }

        const patchItem = { id: checklistItem.id, satisfied: satisfiedNow };
        if (satisfiedNow) patchItem.satisfiedBy = satisfiedByNow;
        if (fileSatisfies) patchItem.justification = verdict.reason || "";

        const result = await saveRiskUpdate({
          newAttachment: { fileName: file.name, s3Key: evidenceReportId },
          updateMandatoryChecklistItem: patchItem,
        });
        if (result) {
          const baseLevel = result.checklistBaseLevel || item.riskRaw;
          const mergedContent = applyChecklistProgressToReport(
            currentReportContent,
            item.area,
            baseLevel,
            result.checklistItems || [],
            result.mandatoryChecklistItems || []
          );
          onRiskEvidenceRegenerated?.(mergedContent);
        }
      }
    } catch (err) {
      setReviewError(err.message || "Failed to attach the document for this item. Please try again.");
    } finally {
      setMandatoryItemUploadState((prev) => ({ ...prev, [checklistItem.id]: { uploading: false, stage: "" } }));
      e.target.value = "";
    }
  }

  async function handleCancelMandatoryFileResult(checklistItemId, fileResult) {
    if (fileResult.s3Key) {
      await saveRiskUpdate({ removeAttachment: { s3Key: fileResult.s3Key } });
    }
    setMandatoryItemFileResults((prev) => ({
      ...prev,
      [checklistItemId]: (prev[checklistItemId] || []).filter((r) => r.s3Key !== fileResult.s3Key),
    }));
  }

  return (
    <div className="gap-modal-overlay" onClick={onClose}>
      <div className="gap-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gap-modal-header"
          style={{ background: item.needsGap ? "#7f1d1d" : "#14532d" }}>
          <div className="gap-modal-title">{item.needsGap ? "⚠️" : "✅"} {item.area}</div>
          <div className="gap-modal-desc">{item.description}</div>
          <button className="gap-modal-close" onClick={onClose}>← Back to Report</button>
        </div>

        <div style={{ padding: "20px" }}>
          <div className="single-risk-meter"
            style={{
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: "14px 16px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}>
            <div className="single-risk-label"
              style={{ fontWeight: 700, fontSize: 13, color: "#334155", letterSpacing: 0.3, textTransform: "uppercase" }}>
              Risk Level
            </div>
            <div className="single-risk-bar-track"
              style={{
                background: "#f1f5f9",
                borderRadius: 999,
                height: 12,
                overflow: "hidden",
                marginTop: 8,
                boxShadow: "inset 0 1px 2px rgba(0,0,0,0.08)",
              }}>
              <div className="single-risk-bar-fill"
                style={{
                  width: `${item.pct}%`,
                  background: `linear-gradient(90deg, ${cfg?.bar}cc, ${cfg?.bar})`,
                  height: "100%",
                  borderRadius: 999,
                  transition: "width 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
                  boxShadow: `0 0 6px ${cfg?.bar}66`,
                }} />
            </div>
            <div className="single-risk-pct"
              style={{ color: item.text, fontWeight: 700, fontSize: 14, marginTop: 6 }}>
              {item.pct}% risk
            </div>
          </div>

          <div className="single-section">
            <div className="single-section-label">📄 Risk Description</div>
            <div className="single-section-body">{item.description}</div>
          </div>

          {/* ══════════════════════════════════════════════════════════
              CHECKLIST FEATURE: sits right after Risk Description, so every
              sub-item making up this risk (with its own upload button) is
              visible immediately. Falls back to the plain Planned
              Response text if the checklist couldn't be generated, so
              the modal never breaks.
              ══════════════════════════════════════════════════════════ */}
          {item.needsGap && (
            <div className="single-section attention-section">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div className="single-section-label" style={{ margin: 0 }}>📌 Planned Audit Response — Risk Areas</div>
                {!checklistLoading && review?.checklistItems?.length > 0 && (() => {
                  const { total, doneCount } = summarizeChecklistProgress(review.checklistItems);
                  return (
                    <span style={{
                      fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                      background: doneCount === total ? "#dcfce7" : "#fef3c7",
                      color: doneCount === total ? "#166534" : "#92400e",
                    }}>
                      {doneCount} / {total} satisfied
                    </span>
                  );
                })()}
              </div>

              {!checklistLoading && review?.checklistItems?.length > 0 && (() => {
                const { total, doneCount } = summarizeChecklistProgress(review.checklistItems);
                const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
                return (
                  <div style={{
                    background: "#fef3c7", borderRadius: 999, height: 6, overflow: "hidden",
                    marginTop: 10, marginBottom: 4,
                  }}>
                    <div style={{
                      width: `${pct}%`, height: "100%", borderRadius: 999,
                      background: doneCount === total ? "#22c55e" : "#f59e0b",
                      transition: "width 0.4s ease",
                    }} />
                  </div>
                );
              })()}

              {checklistLoading && (
                <div className="single-section-body">Breaking this risk into checkable items…</div>
              )}

              {!checklistLoading && checklistError && (
                <div className="single-section-body">
                  {item.response}
                  <div style={{ marginTop: 8, color: "#b91c1c", fontSize: 13 }}>⚠️ {checklistError}</div>
                </div>
              )}

              {!checklistLoading && !checklistError && (!review?.checklistItems || review.checklistItems.length === 0) && (
                <div className="single-section-body">{item.response}</div>
              )}

              {!checklistLoading && review?.checklistItems?.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {review.checklistItems.map((ci) => {
                    const isDone = ci.satisfied || ci.manuallyChecked;
                    const isLocked = ci.satisfied;
                    const uploadState = itemUploadState[ci.id] || {};
                    return (
                      <div key={ci.id}
                        style={{
                          display: "flex", flexDirection: "column", gap: 8,
                          padding: "13px 15px",
                          marginBottom: 9,
                          borderRadius: 10,
                          border: isDone ? "1px solid #86efac" : "1px solid #fcd9a0",
                          background: isDone ? "#f0fdf4" : "#fffaf0",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                          transition: "background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease",
                        }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                          {isDone ? (
                            <span
                              title={isLocked ? "Automatically satisfied by uploaded evidence" : "Manually confirmed"}
                              style={{
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                width: 22, height: 22, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                                background: isLocked ? "#16a34a" : "#d97706",
                                color: "#fff", fontSize: 13, fontWeight: 700,
                                boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
                              }}
                            >
                              ✓
                            </span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={false}
                              disabled={uploadState.uploading || saving}
                              onChange={() => handleItemCheckboxClick(ci)}
                              style={{ marginTop: 3, width: 17, height: 17, flexShrink: 0, cursor: "pointer", accentColor: "#f59e0b" }}
                            />
                          )}
                          <div style={{ flex: 1 }}>
                            <div style={{
                              fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
                              fontSize: 14.5,
                              fontWeight: 500,
                              lineHeight: 1.5,
                              color: isDone ? "#14532d" : "#1f2937",
                            }}>
                              {ci.text}
                            </div>

                            {(ci.satisfied || (ci.manuallyChecked && !ci.satisfied)) && (
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                                {ci.satisfied && (
                                  <div style={{
                                    display: "inline-flex", alignItems: "center", gap: 4,
                                    padding: "2px 9px", borderRadius: 999,
                                    background: "#dcfce7", color: "#166534",
                                    fontSize: 11.5, fontWeight: 600, letterSpacing: 0.2,
                                  }}>
                                    ✅ Satisfied by uploaded evidence
                                  </div>
                                )}
                                {ci.manuallyChecked && !ci.satisfied && (
                                  <div style={{
                                    display: "inline-flex", alignItems: "center", gap: 4,
                                    padding: "2px 9px", borderRadius: 999,
                                    background: "#fef3c7", color: "#92400e",
                                    fontSize: 11.5, fontWeight: 600, letterSpacing: 0.2,
                                  }}>
                                    ✍️ Manually confirmed
                                  </div>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleCancelChecklistItem(ci)}
                                  disabled={saving}
                                  title="Uploaded the wrong document? Undo this item."
                                  style={{
                                    fontSize: 11.5, fontWeight: 600, color: "#b91c1c",
                                    background: "transparent", border: "1px solid #fca5a5",
                                    borderRadius: 999, padding: "2px 9px", cursor: "pointer",
                                  }}
                                >
                                  ✕ Cancel
                                </button>
                              </div>
                            )}
                            {ci.manuallyChecked && !ci.satisfied && ci.justification && (
                              <div style={{ marginTop: 5, fontSize: 12.5, color: "#78350f", fontStyle: "italic" }}>
                                “{ci.justification}”
                              </div>
                            )}

                            {!isDone && (
                              <label className="risk-review-upload-btn"
                                style={{ marginTop: 8, display: "inline-block", fontSize: 12, padding: "4px 10px" }}>
                                <input
                                  type="file"
                                  multiple
                                  onChange={(e) => handleItemFileSelect(ci, e)}
                                  disabled={uploadState.uploading}
                                  style={{ display: "none" }}
                                />
                                {uploadState.uploading ? (uploadState.stage || "Processing…") : "📎 Upload for this item"}
                              </label>
                            )}

                            {(itemFileResults[ci.id] || []).length > 0 && (
                              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                                {itemFileResults[ci.id].map((fr) => {
                                  const isMatch    = fr.relevant && fr.resolves_risk;
                                  const isPartial  = fr.relevant && !fr.resolves_risk;
                                  const notRelated = !fr.relevant;
                                  const boxStyle = isMatch
                                    ? { background: "#f0fdf4", border: "1px solid #86efac" }
                                    : isPartial
                                      ? { background: "#fffbeb", border: "1px solid #fcd34d" }
                                      : { background: "#fef2f2", border: "1px solid #fca5a5" };
                                  return (
                                    <div key={fr.s3Key} style={{
                                      ...boxStyle, borderRadius: 8, padding: "8px 10px",
                                    }}>
                                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                                        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1e293b", display: "flex", alignItems: "center", gap: 6 }}>
                                          <span>{isMatch ? "✅" : isPartial ? "🟡" : "⚠️"}</span>
                                          <span>{fr.fileName}</span>
                                        </div>
                                        {notRelated && (
                                          <button
                                            type="button"
                                            onClick={() => handleCancelFileResult(ci.id, fr)}
                                            disabled={saving}
                                            title="Remove this unrelated document"
                                            style={{
                                              fontSize: 11, fontWeight: 600, color: "#b91c1c",
                                              background: "transparent", border: "1px solid #fca5a5",
                                              borderRadius: 999, padding: "1px 8px", cursor: "pointer",
                                            }}
                                          >
                                            ✕ Cancel
                                          </button>
                                        )}
                                      </div>
                                      <div style={{ fontSize: 12, color: "#475569", marginTop: 3 }}>
                                        {isMatch && "Related — this document satisfies this item."}
                                        {isPartial && `Related, but not conclusive yet — ${fr.stillOutstanding || fr.reason}`}
                                        {notRelated && "Not related to this specific item."}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>

                        {justificationOpenId === ci.id && (
                          <div style={{ marginLeft: 34, display: "flex", flexDirection: "column", gap: 6 }}>
                            <textarea
                              className="risk-review-textarea"
                              placeholder="Explain why this item is being marked done without uploaded evidence…"
                              value={justificationDraft}
                              onChange={(e) => setJustificationDraft(e.target.value)}
                              rows={2}
                            />
                            <div style={{ display: "flex", gap: 8 }}>
                              <button
                                className="risk-review-comment-btn"
                                onClick={() => handleSaveJustification(ci)}
                                disabled={!justificationDraft.trim() || saving}
                              >
                                {saving ? "Saving…" : "Confirm"}
                              </button>
                              <button
                                className="risk-review-attachment-remove"
                                onClick={() => { setJustificationOpenId(null); setJustificationDraft(""); }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {/* ── END CHECKLIST FEATURE ─────────────────────────────────── */}

          {item.needsGap ? (
            <>
              <div className="single-section attention-section">
                <div className="single-section-label">⚠️ Audit Significance</div>
                <div className="single-section-body">
                  This area carries a <strong>{item.pct}% risk</strong> of material misstatement.
                  The audit team has assessed this as requiring substantive testing procedures
                  before an audit opinion can be issued.
                </div>
              </div>

              <div className="single-section"
                style={{ background: "#fef2f2", borderColor: "#fca5a5" }}>
                <div className="single-section-label">🔴 Management Action Required</div>
                <div className="single-section-body">
                  Ensure all supporting documentation for this area is compiled and available
                  prior to fieldwork. Incomplete records may result in audit delays or qualified findings.
                </div>
              </div>
              <button className="solutions-toggle-btn"
                onClick={() => setShowSolutions((s) => !s)}>
                {showSolutions ? "▲ Hide Solutions" : "💡 How to Overcome This Risk →"}
              </button>
              {showSolutions && (
                <div className="solutions-panel">
                  <div className="solutions-title">💡 Recommended Solutions</div>
                  <div className="solutions-desc">
                    Practical steps to reduce or eliminate this risk before and during the audit:
                  </div>
                  <ol className="solutions-list">
                    {solutions.map((s, i) => (
                      <li key={i} className="solution-item">
                        <span className="solution-num">{i + 1}</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="single-section ok-section">
                <div className="single-section-label">✅ Audit Assessment</div>
                <div className="single-section-body">
                  This area has been assessed at <strong>{item.pct}% risk</strong>.
                  No significant concerns identified. Standard audit procedures will be applied.
                </div>
              </div>
              {item.response && (
                <div className="single-section ok-section">
                  <div className="single-section-label">📋 Planned Audit Procedures</div>
                  <div className="single-section-body">{item.response}</div>
                </div>
              )}
              <div className="single-section"
                style={{ background: "#f0fdf4", borderColor: "#86efac" }}>
                <div className="single-section-label">🟢 Management Action Required</div>
                <div className="single-section-body">
                  No significant action required. Ensure relevant records and schedules
                  are available for standard verification during the audit.
                </div>
              </div>
            </>
          )}

          {/* ══════════════════════════════════════════════════════════
              ── ADD-ON: Per-Risk Review Status & Supporting Evidence ──
              Everything below is new. Nothing above this line changed.
              ══════════════════════════════════════════════════════════ */}

          {lastVerdict && (
            <div className="single-section"
              style={{
                background: lastVerdict.relevant ? "#eff6ff" : "#fffbeb",
                borderColor: lastVerdict.relevant ? "#93c5fd" : "#fcd34d",
              }}>
              <div className="single-section-label">
                {lastVerdict.relevant ? "🤖 AI Relevance Check — Relevant" : "🤖 AI Relevance Check — Not Related"}
              </div>
              <div className="single-section-body">
                {!lastVerdict.relevant && (
                  <strong>Note: this document does not appear related to this risk. Risk level unchanged.</strong>
                )}
                {lastVerdict.relevant && lastVerdict.resolves_risk && (
                  <strong>This document fully resolves the risk. Risk level reduced by two steps (e.g. High → Medium).</strong>
                )}
                {lastVerdict.relevant && !lastVerdict.resolves_risk && (
                  <strong>This document partially addresses the risk. Risk level reduced one step.</strong>
                )}
                <div style={{ marginTop: 6, fontStyle: "italic" }}>{lastVerdict.reason}</div>

                {/* SPECIFIC-GAP FEATURE: show exactly what was confirmed
                    and what's still missing, when the agent provides it.
                    Safe to render even against the older deployed agent —
                    these fields will simply be absent/empty and nothing
                    extra shows. */}
                {lastVerdict.relevant && lastVerdict.specifically_addressed && (
                  <div style={{ marginTop: 8 }}>
                    <strong>✅ Confirmed:</strong> {lastVerdict.specifically_addressed}
                  </div>
                )}
                {lastVerdict.relevant && !lastVerdict.resolves_risk && lastVerdict.still_outstanding && (
                  <div style={{ marginTop: 4 }}>
                    <strong>⏳ Still outstanding:</strong> {lastVerdict.still_outstanding}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* NOTE: the redundant "Attached Document(s)" history list that
              used to live here has been removed — each checklist item
              (in both Planned Audit Response and Mandatory Checklist)
              already shows its own per-file result directly under it,
              so a separate global attachment list was just duplicating
              that information. reviewError is kept visible here since
              this was the only place it was shown. */}
          {reviewError && (
            <div className="single-section risk-item-review-section">
              <div className="risk-review-error">⚠️ {reviewError}</div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              "Mandatory Checklist" — the CLIENT'S OWN official Excel
              checklist for this line item, shown as a collapsible,
              read-only reference. Completely independent from the
              interactive "Planned Audit Response" checklist above: no
              shared storage, no satisfied/checked state, no AI
              involvement — just the firm's mandatory procedures for
              this specific line item, looked up client-side by risk
              area name. Renders nothing if no line item matches, or
              while the items are still being saved on first open.
              ══════════════════════════════════════════════════════════ */}
          {item.needsGap && review?.mandatoryChecklistItems?.length > 0 && (
            <div className="single-section risk-item-review-section">
              <button
                type="button"
                onClick={() => setShowMandatoryChecklist((v) => !v)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  width: "100%", background: "transparent", border: "none", cursor: "pointer",
                  padding: 0,
                }}
              >
                <span className="single-section-label" style={{ margin: 0 }}>📋 Mandatory Checklist</span>
                <span style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>
                  {showMandatoryChecklist ? "▲ Hide" : "▾ Show"}
                </span>
              </button>
              {showMandatoryChecklist && (
                <div style={{ marginTop: 10 }}>
                  {review.mandatoryChecklistItems.map((ci) => {
                    const isDone = ci.satisfied || ci.manuallyChecked;
                    const isLocked = ci.satisfied;
                    const uploadState = mandatoryItemUploadState[ci.id] || {};
                    return (
                      <div key={ci.id}
                        style={{
                          display: "flex", flexDirection: "column", gap: 8,
                          padding: "13px 15px",
                          marginBottom: 9,
                          borderRadius: 10,
                          border: isDone ? "1px solid #86efac" : "1px solid #e2e8f0",
                          background: isDone ? "#f0fdf4" : "#f8fafc",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                        }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                          {isDone ? (
                            <span
                              title={isLocked ? "Automatically satisfied by uploaded evidence" : "Manually confirmed"}
                              style={{
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                width: 22, height: 22, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                                background: isLocked ? "#16a34a" : "#d97706",
                                color: "#fff", fontSize: 13, fontWeight: 700,
                                boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
                              }}
                            >
                              ✓
                            </span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={false}
                              disabled={uploadState.uploading || saving}
                              onChange={() => handleMandatoryItemCheckboxClick(ci)}
                              style={{ marginTop: 3, width: 17, height: 17, flexShrink: 0, cursor: "pointer", accentColor: "#f59e0b" }}
                            />
                          )}
                          <div style={{ flex: 1 }}>
                            <div style={{
                              fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
                              fontSize: 14, fontWeight: 500, lineHeight: 1.5,
                              color: isDone ? "#14532d" : "#1f2937",
                            }}>
                              {ci.text}
                            </div>

                            {(ci.satisfied || (ci.manuallyChecked && !ci.satisfied)) && (
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                                {ci.satisfied && (
                                  <div style={{
                                    display: "inline-flex", alignItems: "center", gap: 4,
                                    padding: "2px 9px", borderRadius: 999,
                                    background: "#dcfce7", color: "#166534",
                                    fontSize: 11.5, fontWeight: 600, letterSpacing: 0.2,
                                  }}>
                                    ✅ Satisfied by uploaded evidence
                                  </div>
                                )}
                                {ci.manuallyChecked && !ci.satisfied && (
                                  <div style={{
                                    display: "inline-flex", alignItems: "center", gap: 4,
                                    padding: "2px 9px", borderRadius: 999,
                                    background: "#fef3c7", color: "#92400e",
                                    fontSize: 11.5, fontWeight: 600, letterSpacing: 0.2,
                                  }}>
                                    ✍️ Manually confirmed
                                  </div>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleCancelMandatoryChecklistItem(ci)}
                                  disabled={saving}
                                  title="Uploaded the wrong document? Undo this item."
                                  style={{
                                    fontSize: 11.5, fontWeight: 600, color: "#b91c1c",
                                    background: "transparent", border: "1px solid #fca5a5",
                                    borderRadius: 999, padding: "2px 9px", cursor: "pointer",
                                  }}
                                >
                                  ✕ Cancel
                                </button>
                              </div>
                            )}
                            {ci.manuallyChecked && !ci.satisfied && ci.justification && (
                              <div style={{ marginTop: 5, fontSize: 12.5, color: "#78350f", fontStyle: "italic" }}>
                                “{ci.justification}”
                              </div>
                            )}

                            {!isDone && (
                              <label className="risk-review-upload-btn"
                                style={{ marginTop: 8, display: "inline-block", fontSize: 12, padding: "4px 10px" }}>
                                <input
                                  type="file"
                                  multiple
                                  onChange={(e) => handleMandatoryItemFileSelect(ci, e)}
                                  disabled={uploadState.uploading}
                                  style={{ display: "none" }}
                                />
                                {uploadState.uploading ? (uploadState.stage || "Processing…") : "📎 Upload for this item"}
                              </label>
                            )}

                            {(mandatoryItemFileResults[ci.id] || []).length > 0 && (
                              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                                {mandatoryItemFileResults[ci.id].map((fr) => {
                                  const isMatch    = fr.relevant && fr.resolves_risk;
                                  const isPartial  = fr.relevant && !fr.resolves_risk;
                                  const notRelated = !fr.relevant;
                                  const boxStyle = isMatch
                                    ? { background: "#f0fdf4", border: "1px solid #86efac" }
                                    : isPartial
                                      ? { background: "#fffbeb", border: "1px solid #fcd34d" }
                                      : { background: "#fef2f2", border: "1px solid #fca5a5" };
                                  return (
                                    <div key={fr.s3Key} style={{ ...boxStyle, borderRadius: 8, padding: "8px 10px" }}>
                                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                                        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1e293b", display: "flex", alignItems: "center", gap: 6 }}>
                                          <span>{isMatch ? "✅" : isPartial ? "🟡" : "⚠️"}</span>
                                          <span>{fr.fileName}</span>
                                        </div>
                                        {notRelated && (
                                          <button
                                            type="button"
                                            onClick={() => handleCancelMandatoryFileResult(ci.id, fr)}
                                            disabled={saving}
                                            title="Remove this unrelated document"
                                            style={{
                                              fontSize: 11, fontWeight: 600, color: "#b91c1c",
                                              background: "transparent", border: "1px solid #fca5a5",
                                              borderRadius: 999, padding: "1px 8px", cursor: "pointer",
                                            }}
                                          >
                                            ✕ Cancel
                                          </button>
                                        )}
                                      </div>
                                      <div style={{ fontSize: 12, color: "#475569", marginTop: 3 }}>
                                        {isMatch && "Related — this document satisfies this item."}
                                        {isPartial && `Related, but not conclusive yet — ${fr.stillOutstanding || fr.reason}`}
                                        {notRelated && "Not related to this specific item."}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>

                        {mandatoryJustificationOpenId === ci.id && (
                          <div style={{ marginLeft: 34, display: "flex", flexDirection: "column", gap: 6 }}>
                            <textarea
                              className="risk-review-textarea"
                              placeholder="Explain why this item is being marked done without uploaded evidence…"
                              value={mandatoryJustificationDraft}
                              onChange={(e) => setMandatoryJustificationDraft(e.target.value)}
                              rows={2}
                            />
                            <div style={{ display: "flex", gap: 8 }}>
                              <button
                                className="risk-review-comment-btn"
                                onClick={() => handleSaveMandatoryJustification(ci)}
                                disabled={!mandatoryJustificationDraft.trim() || saving}
                              >
                                {saving ? "Saving…" : "Confirm"}
                              </button>
                              <button
                                className="risk-review-attachment-remove"
                                onClick={() => { setMandatoryJustificationOpenId(null); setMandatoryJustificationDraft(""); }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="single-section risk-item-review-section">
            <div className="single-section-label">🗂️ Review Status</div>
            {!reviewLoading && (
              <>
                <select
                  className="risk-review-select"
                  value={review?.status || "open"}
                  onChange={handleStatusChange}
                  disabled={saving}
                >
                  {Object.entries(RISK_ITEM_STATUS_LABELS).map(([value, { label, icon }]) => (
                    <option key={value} value={value}>{icon} {label}</option>
                  ))}
                </select>
                {review?.status === "other" && (
                  <input
                    type="text"
                    className="risk-review-input"
                    placeholder="Enter a custom status…"
                    value={customStatusText}
                    onChange={(e) => setCustomStatusText(e.target.value)}
                    onBlur={handleCustomStatusBlur}
                    style={{ marginTop: "8px" }}
                  />
                )}
              </>
            )}
          </div>

          <div className="single-section risk-item-review-section">
            <div className="single-section-label">📝 Comments &amp; Justification</div>
            {!reviewLoading && (
              <>
                {review?.comments?.length > 0 && (
                  <div className="risk-review-comment-list">
                    {review.comments.map((c, i) => (
                      <div key={i} className="risk-review-comment">
                        <div className="risk-review-comment-meta">
                          <strong>{c.author}</strong> · {new Date(c.timestamp).toLocaleString()}
                        </div>
                        <div className="risk-review-comment-text">{c.text}</div>
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  className="risk-review-textarea"
                  placeholder="Enter your response, justification, or management comments…"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  rows={3}
                />
                <button
                  className="risk-review-comment-btn"
                  onClick={handleAddComment}
                  disabled={saving || !newComment.trim()}
                >
                  {saving ? "Saving…" : "Add comment"}
                </button>
              </>
            )}
          </div>

          <div className="risk-review-save-row">
            <button className="risk-review-save-btn" onClick={handleManualSave} disabled={saving || uploading}>
              {saving ? "Saving…" : "💾 Save"}
            </button>
            {savedConfirmation && <span className="risk-review-saved-note">✅ Saved</span>}
          </div>
          {/* ── END ADD-ON ─────────────────────────────────────────── */}

          <button className="back-btn" onClick={onClose}>← Back to Report</button>
        </div>
      </div>
    </div>
  );
}

// ─── Gap Analysis Panel ───────────────────────────────────────────────
function GapAnalysisPanel({ riskData, onItemClick }) {
  const [filter, setFilter] = useState("all");
  if (!riskData) return null;
  const { improved, needsAttention } = riskData;
  if (!improved.length && !needsAttention.length) return null;
  const showAttention = filter === "all" || filter === "attention";
  const showImproved  = filter === "all" || filter === "improved";

  return (
    <div className="gap-panel">
      <div className="gap-panel-header">
        <div className="gap-panel-title">📊 Audit Gap Analysis — Full Summary</div>
        <div className="gap-panel-desc">
          Click a scorecard to filter, or click any card to view details and solutions.
        </div>
        <div className="gap-scorecard">
          <button
            className={`gap-score attention-score ${filter === "attention" ? "score-active" : ""}`}
            onClick={() => setFilter(filter === "attention" ? "all" : "attention")}>
            <span className="score-num">{needsAttention.length}</span>
            <span className="score-label">⚠️ Needs Attention</span>
          </button>
          <button
            className={`gap-score ok-score ${filter === "improved" ? "score-active" : ""}`}
            onClick={() => setFilter(filter === "improved" ? "all" : "improved")}>
            <span className="score-num">{improved.length}</span>
            <span className="score-label">✅ Improved / Low Risk</span>
          </button>
        </div>
      </div>

      {showAttention && needsAttention.length > 0 && (
        <div className="gap-section">
          <div className="gap-section-title attention-title">
            ⚠️ Needs Attention — {needsAttention.length} area{needsAttention.length > 1 ? "s" : ""} require priority audit focus
          </div>
          <div className="gap-grid">
            {needsAttention.map((g, i) => (
              <div key={i} className="gap-card attention-card gap-card-clickable"
                onClick={() => onItemClick(g)}>
                <div className="gap-card-header">
                  <span className="gap-card-area">{g.area}</span>
                  <span className="gap-pct-pill" style={{ background: g.bg, color: g.text }}>
                    <span className="gap-mini-track">
                      <span className="gap-mini-fill" style={{ width: `${g.pct}%`, background: g.bar }} />
                    </span>
                    {g.pct}% risk
                  </span>
                </div>
                <p className="gap-card-fact">{g.description}</p>
                {g.response && (
                  <div className="gap-card-action">
                    <span className="gap-action-label">📌 Planned Response:</span>
                    {g.response}
                  </div>
                )}
                <button className="gap-card-btn attention-btn"
                  onClick={(e) => { e.stopPropagation(); onItemClick(g); }}>
                  ⚠️ View Details & Solutions
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showImproved && improved.length > 0 && (
        <div className="gap-section">
          <div className="gap-section-title ok-title">
            ✅ Improved / Low Risk — {improved.length} area{improved.length > 1 ? "s" : ""} are well controlled
          </div>
          <div className="gap-grid">
            {improved.map((g, i) => (
              <div key={i} className="gap-card ok-card gap-card-clickable"
                onClick={() => onItemClick(g)}>
                <div className="gap-card-header">
                  <span className="gap-card-area">{g.area}</span>
                  <span className="gap-pct-pill" style={{ background: g.bg, color: g.text }}>
                    <span className="gap-mini-track">
                      <span className="gap-mini-fill" style={{ width: `${g.pct}%`, background: g.bar }} />
                    </span>
                    {g.pct}% risk
                  </span>
                </div>
                <p className="gap-card-fact">{g.description}</p>
                <div className="gap-card-ok">✅ Standard audit procedures apply.</div>
                <button className="gap-card-btn ok-btn-card"
                  onClick={(e) => { e.stopPropagation(); onItemClick(g); }}>
                  ✅ View Full Details
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Risk Badge ───────────────────────────────────────────────────────
function RiskBadge({ rawText, onBadgeClick }) {
  const cfg = getRisk(rawText);
  if (!cfg) return <span>{rawText}</span>;

  if (isUnassessedRisk(rawText)) {
    return (
      <span className="risk-badge" style={{ background: cfg.bg, color: cfg.text }}>
        <span className="risk-bar-wrap">
          <span className="risk-bar" style={{ width: `${cfg.pct}%`, background: cfg.bar }} />
        </span>
        <strong className="risk-pct">N/A</strong>
      </span>
    );
  }

  return (
    <span className="risk-badge" style={{ background: cfg.bg, color: cfg.text }}>
      <span className="risk-bar-wrap">
        <span className="risk-bar" style={{ width: `${cfg.pct}%`, background: cfg.bar }} />
      </span>
      <strong className="risk-pct">{cfg.pct}%</strong>
      <button className={cfg.needsGap ? "needs-btn" : "ok-btn"} onClick={onBadgeClick}>
        {cfg.needsGap ? "⚠️ Details" : "✅ Details"}
      </button>
    </span>
  );
}

function AuditHeading({ tag: Tag, children }) {
  const title = extractText(children);
  const cfg   = SECTION_COLOURS[title] || SECTION_COLOURS["Audit Planning Deliverables"];
  return (
    <Tag className="audit-section-heading"
      style={{ background: cfg.bg, borderLeftColor: cfg.border, color: cfg.text }}>
      <span className="section-icon" aria-hidden="true">{cfg.icon}</span>
      <span>{children}</span>
    </Tag>
  );
}

function buildComponents(isAudit, riskData, onBadgeClick) {
  const allItems   = [...(riskData?.needsAttention || []), ...(riskData?.improved || [])];
  const itemByArea = new Map(allItems.map((item) => [item.area.toLowerCase().trim(), item]));
  let pendingArea  = "";

  const headingComponents = {
    h1: ({ children }) => <AuditHeading tag="h2">{children}</AuditHeading>,
    h2: ({ children }) => <AuditHeading tag="h3">{children}</AuditHeading>,
    h3: ({ children }) => <AuditHeading tag="h4">{children}</AuditHeading>,
  };

  if (!isAudit) return headingComponents;

  return {
    ...headingComponents,
    tr: ({ children }) => {
      const cells = React.Children.toArray(children);
      if (cells.length > 0) {
        const txt = extractText(cells[0]).trim().toLowerCase();
        if (txt && itemByArea.has(txt)) pendingArea = txt;
      }
      return <tr>{children}</tr>;
    },
    td: ({ children }) => {
      const raw = extractText(children).trim();
      const cfg = getRisk(raw);
      if (cfg) {
        const item = itemByArea.get(pendingArea);
        return (
          <td className="risk-cell">
            <RiskBadge rawText={raw} onBadgeClick={() => item && onBadgeClick(item)} />
          </td>
        );
      }
      return <td>{children}</td>;
    },
  };
}

// ─── Main Chatbot ─────────────────────────────────────────────────────
function Chatbot({
  reportId,
  reportIds,
  selectedReport,
  generalMode,
  managerMode,
  preGeneratedReport,
  preGenerating,
  onReportGenerated,
  agentId = "audit_planning_agent",
  agentLabel = "Audit Planning Agent",
  generateMessage = "Generate audit planning.",
  // Set (from the sidebar's Gap Analysis dropdown in App.jsx) when the
  // user clicked a SPECIFIC risk area rather than just the agent itself.
  // Once this report's riskData is available, the effect below opens
  // that risk's detail modal directly and calls onRiskAreaOpened() to
  // clear the pending request in the parent.
  openRiskArea = null,
  onRiskAreaOpened,
}) {
  const inputRef       = useRef(null);
  const messagesEndRef = useRef(null);
  const preShownRef    = useRef(false);
  const sendOnceRef    = useRef(false);
  const wasGeneratingRef = useRef(false);

  const [sessionId,    setSessionId]    = useState(createSessionId());
  const [messages,     setMessages]     = useState([]);
  const [question,     setQuestion]     = useState("");
  const [loading,      setLoading]      = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("");
  const [modalItem,    setModalItem]    = useState(null);

  // Jump straight to a specific risk's modal when navigated here from
  // the sidebar's Gap Analysis dropdown, instead of leaving the user to
  // scroll through the report and find it themselves.
  useEffect(() => {
    if (!openRiskArea) return;
    const reportMsg = [...messages].reverse().find((m) => m.isAuditReport && m.riskData);
    if (!reportMsg) return;
    const allItems = [...reportMsg.riskData.needsAttention, ...reportMsg.riskData.improved];
    const target = allItems.find(
      (it) => it.area.toLowerCase().trim() === openRiskArea.toLowerCase().trim()
    );
    if (target) {
      setModalItem(target);
      onRiskAreaOpened?.();
    }
  }, [openRiskArea, messages]);

  function getWelcomeMessage() {
    if (generalMode) return "Hi 👋 Ask me anything about UAE Corporate Tax, VAT, IFRS, audit standards, or general financial compliance. I will answer from the Knowledge Base only.";
    if (managerMode && selectedReport) return `Hi 👋 You are viewing **${getReportName(selectedReport)}**. Ask me any questions about this document.`;
    if (reportId) return `Hi 👋 I'm the ${agentLabel}. Your report for **${getReportName(selectedReport)}** is ready.`;
    return "Hi 👋 Upload or select a financial statement to get started.";
  }

  function processAndShowReport(reportData) {
    const raw     = reportData?.answer || reportData?.response || reportData?.message || "";
    const content = removeSourcesFromAnswer(raw);
    if (!content) return;
    const audit    = isAuditReport(content);
    const riskData = audit ? parseRiskRows(content) : null;
    if (audit && onReportGenerated) onReportGenerated(content);
    setMessages([
      {
        role:    "assistant",
        content: `Hi 👋 Here is the generated report for **${getReportName(selectedReport)}**.`,
      },
      {
        role:          "assistant",
        content,
        isAuditReport: audit,
        riskData,
      },
    ]);
  }

  // Called from a risk's detail modal once the deterministic relevance
  // check has updated this specific risk's row. Updates the currently
  // displayed report message in place (re-parsing risk rows so the Gap
  // Analysis panel reflects the change), and persists the new version
  // via the same onReportGenerated callback normal generation already
  // uses — which also keeps the Master Agent overview in sync.
  function handleRiskEvidenceRegenerated(newRawContent) {
    const content  = removeSourcesFromAnswer(newRawContent);
    const audit    = isAuditReport(content);
    const riskData = audit ? parseRiskRows(content) : null;
    if (audit && onReportGenerated) onReportGenerated(content);
    setMessages((prev) => {
      const lastAuditIndex = [...prev].reverse().findIndex((m) => m.isAuditReport);
      if (lastAuditIndex === -1) return prev;
      const realIndex = prev.length - 1 - lastAuditIndex;
      return prev.map((m, i) => (i === realIndex ? { ...m, content, isAuditReport: audit, riskData } : m));
    });

    // FIX (Bug A): refresh the currently-open modal's item so its risk
    // bar/pct/response update immediately instead of only on next open.
    if (riskData && modalItem) {
      const allItems = [...riskData.needsAttention, ...riskData.improved];
      const updated = allItems.find(
        (it) => it.area.toLowerCase().trim() === modalItem.area.toLowerCase().trim()
      );
      if (updated) setModalItem(updated);
    }
  }

  // ── Mount / reportId change ──────────────────────────────────────────
  useEffect(() => {
    preShownRef.current = false;
    sendOnceRef.current = false;
    wasGeneratingRef.current = false;
    setLoading(false);
    setLoadingLabel("");
    setSessionId(createSessionId());
    setQuestion("");

    if (generalMode || managerMode) {
      setMessages([{ role: "assistant", content: getWelcomeMessage() }]);
      return;
    }

    if (!reportId) {
      setMessages([{ role: "assistant", content: getWelcomeMessage() }]);
      return;
    }

    if (preGeneratedReport) {
      preShownRef.current = true;
      setMessages([{ role: "assistant", content: `Hi 👋 Here is the generated report for **${getReportName(selectedReport)}**.` }]);
      setTimeout(() => processAndShowReport(preGeneratedReport), 200);
      return;
    }

    if (preGenerating) {
      setMessages([{ role: "assistant", content: `Hi 👋 Your report for **${getReportName(selectedReport)}** is being prepared — please wait...` }]);
      setLoading(true);
      setLoadingLabel("Your report is being prepared — please wait…");
      return;
    }

    setMessages([{ role: "assistant", content: `Hi 👋 Generating your report for **${getReportName(selectedReport)}**...` }]);
    if (!sendOnceRef.current) {
      sendOnceRef.current = true;
      setTimeout(() => sendMessage(generateMessage), 300);
    }
  }, [reportId, generalMode, managerMode, agentId]);

  // ── Pre-generated report arrives after agent opened ──────────────────
  useEffect(() => {
    if (!preGeneratedReport) return;
    if (generalMode || managerMode) return;
    if (preShownRef.current) return;
    preShownRef.current = true;
    setLoading(false);
    setLoadingLabel("");
    processAndShowReport(preGeneratedReport);
  }, [preGeneratedReport]);

  // ── Keep spinner while background still running ──────────────────────
  useEffect(() => {
    if (generalMode || managerMode) return;
    if (preShownRef.current) return;
    if (preGenerating) {
      wasGeneratingRef.current = true;
      setLoading(true);
      setLoadingLabel("Your report is being prepared — please wait…");
      return;
    }

    if (wasGeneratingRef.current && !preGeneratedReport && !preShownRef.current) {
      wasGeneratingRef.current = false;
      if (!sendOnceRef.current) {
        sendOnceRef.current = true;
        setLoadingLabel("Taking longer than expected — retrying…");
        sendMessage(generateMessage);
      }
    }
  }, [preGenerating, preGeneratedReport]);

  async function pollJobStatus(jobId) {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);
      setLoadingLabel(
        attempt < 4  ? "Reviewing the financial statement..." :
        attempt < 12 ? "Drafting the audit planning sections..." :
                       "Still working — nearly there..."
      );
      let response;
      try { response = await fetch(CHAT_STATUS_API(jobId)); } catch { continue; }
      if (!response.ok && response.status !== 404) continue;
      const data = await response.json();
      if (data.status === "complete") return data;
      if (data.status === "failed") throw new Error(data.error || "Generation failed.");
    }
    throw new Error("Taking longer than expected. Please try again.");
  }

  async function sendMessage(overrideQuestion) {
    const q = (overrideQuestion || question).trim();
    if (!q || loading) return;

    if (!overrideQuestion) {
      setMessages((prev) => [...prev, { role: "user", content: q }]);
      setQuestion("");
    }

    setLoading(true);
    setLoadingLabel("Sending your request...");

    try {
      const res = await fetch(CHAT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message:       q,
          question:      q,
          sessionId,
          reportId:      generalMode ? null : reportId,
          reportIds:     generalMode ? [] : (Array.isArray(reportIds) && reportIds.length ? reportIds : (reportId ? [reportId] : [])),
          selectedAgent: generalMode ? "general_kb_agent" : agentId,
          agent:         generalMode ? "general_kb_agent" : agentId,
          generalMode:   generalMode  || false,
          general_mode:  generalMode  || false,
          managerMode:   managerMode  || false,
        }),
      });

      const data = await res.json();
      if (!res.ok && res.status !== 202)
        throw new Error(data.message || data.error || "Request failed");

      let final = data;
      if (data.status === "processing" && data.jobId)
        final = await pollJobStatus(data.jobId);

      const content = removeSourcesFromAnswer(
        final.answer || final.response || final.message || "No answer returned."
      );

      const audit    = !generalMode && isAuditReport(content);
      const riskData = audit ? parseRiskRows(content) : null;
      if (audit && onReportGenerated) onReportGenerated(content);

      setMessages((prev) => [...prev, {
        role:          "assistant",
        content,
        isAuditReport: audit,
        riskData,
      }]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        role:    "assistant",
        content: `❌ ${err.message || "Something went wrong."}`,
      }]);
    } finally {
      setLoading(false);
      setLoadingLabel("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  return (
    <section className={generalMode ? "chatbot-card chatbot-card-general" : "chatbot-card"}>
      {modalItem && (
        <ItemModal
          item={modalItem}
          onClose={() => setModalItem(null)}
          reportId={reportId}
          agentId={agentId}
          currentReportContent={[...messages].reverse().find((m) => m.isAuditReport)?.content || ""}
          onRiskEvidenceRegenerated={handleRiskEvidenceRegenerated}
        />
      )}

      <div className="chatbot-messages">
        {messages.map((msg, i) => (
          <div key={`${msg.role}-${i}`}
            className={msg.role === "user" ? "chat-message-row user-row" : "chat-message-row assistant-row"}>
            <div className="message-avatar">
              {msg.role === "user" ? "You" : <img src="/ai-assistant-avatar.png" alt="AI" className="ai-avatar-img" />}
            </div>
            <div className={msg.role === "user" ? "chat-message user-message" : "chat-message assistant-message"}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}
                components={buildComponents(msg.isAuditReport, msg.riskData, (item) => setModalItem(item))}>
                {msg.content}
              </ReactMarkdown>
              {msg.isAuditReport && (
                <GapAnalysisPanel
                  riskData={msg.riskData}
                  onItemClick={(item) => setModalItem(item)}
                />
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="chat-message-row assistant-row">
            <div className="message-avatar"><img src="/ai-assistant-avatar.png" alt="AI" className="ai-avatar-img" /></div>
            <div className="loading-message">
              <span className="typing-dots" aria-label="AI is thinking">
                <span></span><span></span><span></span>
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chatbot-input-row">
        <textarea
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            generalMode ? "Ask about UAE Corporate Tax, VAT, IFRS, audit standards..." :
            managerMode ? `Ask a question about ${getReportName(selectedReport)}...` :
            reportId    ? "Ask a follow-up question about the report..." :
                          "Upload or select a report first..."
          }
          rows={2}
          disabled={loading}
        />
        <button className="send-btn" onClick={() => sendMessage()}
          disabled={loading || !question.trim()}>
          {loading ? "Sending..." : "Send"}
        </button>
      </div>
    </section>
  );
}

export default Chatbot;
