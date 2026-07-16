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

const SECTION_COLOURS = {
  "Engagement Strategy":        { bg: "#eff6ff", border: "#2563eb", text: "#1e40af", icon: "📋" },
  "Planning Memorandum":        { bg: "#f0fdf4", border: "#16a34a", text: "#15803d", icon: "📝" },
  "Materiality Calculation":    { bg: "#fefce8", border: "#ca8a04", text: "#92400e", icon: "🧮" },
  "Risk Assessment":            { bg: "#fff7ed", border: "#ea580c", text: "#9a3412", icon: "⚠️" },
  "Audit Programs":             { bg: "#fdf4ff", border: "#9333ea", text: "#6b21a8", icon: "🔍" },
  "Staffing Recommendations":   { bg: "#f0f9ff", border: "#0891b2", text: "#155e75", icon: "👥" },
  "Audit Planning Deliverables":{ bg: "#f8fafc", border: "#475569", text: "#1e293b", icon: "📊" },
};

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

// ─── Item Modal with Solutions ────────────────────────────────────────
function ItemModal({ item, onClose }) {
  const [showSolutions, setShowSolutions] = useState(false);
  if (!item) return null;
  const cfg       = getRisk(item.riskRaw);
  const solutions = getRiskSolutions(item.area);

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
          <div className="single-risk-meter">
            <div className="single-risk-label">Risk Level</div>
            <div className="single-risk-bar-track">
              <div className="single-risk-bar-fill"
                style={{ width: `${item.pct}%`, background: cfg?.bar }} />
            </div>
            <div className="single-risk-pct" style={{ color: item.text }}>{item.pct}% risk</div>
          </div>

          <div className="single-section">
            <div className="single-section-label">📄 Risk Description</div>
            <div className="single-section-body">{item.description}</div>
          </div>

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
              {item.response && (
                <div className="single-section attention-section">
                  <div className="single-section-label">📌 Planned Audit Response</div>
                  <div className="single-section-body">{item.response}</div>
                </div>
              )}
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
      {modalItem && <ItemModal item={modalItem} onClose={() => setModalItem(null)} />}

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