import Chatbot from "./components/Chatbot";
import React, { useEffect, useRef, useState } from "react";
import "./App.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "https://c0feinpvm5.execute-api.eu-central-1.amazonaws.com/prod";

const DOCUMENTS_API   = `${API_BASE_URL}/documents`;
const UPLOAD_URL_API  = `${API_BASE_URL}/upload-url`;
const CHAT_API        = `${API_BASE_URL}/chat`;
const CHAT_STATUS_API = (jobId) => `${API_BASE_URL}/chat/status/${jobId}`;

const VIEW_PORTAL       = "portal";
const VIEW_HOME         = "home";
const VIEW_UPLOAD       = "upload";
const VIEW_AGENT        = "agent";
const VIEW_GENERAL      = "general";
const VIEW_MANAGER_CHAT = "manager_chat";
const VIEW_MANAGER_HOME = "manager_home";

const SUB_AGENTS = [
  {
    id:          "audit_planning_agent",
    label:       "Audit Planning Agent",
    description: "Generates engagement strategy, materiality, risk assessment, audit programs, and staffing recommendations from your uploaded financial statements.",
    icon:        "📋",
    available:   true,
  },
  {
    id:          "fs_review_agent",
    label:       "Financial Statement Review Agent",
    description: "Reviews financial statements for IFRS compliance, disclosure gaps, and presentation issues.",
    icon:        "📊",
    available:   false,
  },
  {
    id:          "tax_agent",
    label:       "UAE Tax & VAT Agent",
    description: "Answers questions on UAE Corporate Tax Law, VAT compliance, and transfer pricing regulations.",
    icon:        "🧾",
    available:   false,
  },
];

function formatDate(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch { return value; }
}

function getReportId(r)       { return r?.reportId || r?.documentId || r?.document_id || ""; }
function getReportName(r)     { return r?.source_file || r?.sourceFile || r?.fileName || r?.file_name || r?.company || "Uploaded Report"; }
function getReportMarkdown(r) { return r?.reportMarkdown || r?.report_markdown || r?.markdown || r?.summary || r?.content || ""; }
function sleep(ms)            { return new Promise((res) => setTimeout(res, ms)); }

function removeSourcesFromAnswer(answer = "") {
  return answer
    .replace(/\n+---\n+\n*## Sources[\s\S]*$/i, "")
    .replace(/\n+## Sources[\s\S]*$/i, "")
    .trim();
}

// ─── Markdown → HTML for PDF ──────────────────────────────────────────
function markdownToHtml(markdown = "") {
  const lines  = markdown.split("\n");
  const output = [];
  let i = 0;

  const parseTableRow = (row, tag) => {
    const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
    return "<tr>" + cells.map((c) => `<${tag}>${c}</${tag}>`).join("") + "</tr>";
  };

  const isSeparator = (line) => /^\|[\s\-:|]+\|/.test(line.trim());
  const isTableRow  = (line) => line.trim().startsWith("|") && line.trim().endsWith("|");

  while (i < lines.length) {
    const line = lines[i].trim();

    // Table detection
    if (isTableRow(lines[i]) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const headerRow = lines[i];
      i += 2; // skip header + separator

      const bodyRows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        bodyRows.push(lines[i]);
        i++;
      }

      let table = '<table>';
      table += '<thead>' + parseTableRow(headerRow, "th") + '</thead>';
      table += '<tbody>' + bodyRows.map((r) => parseTableRow(r, "td")).join("") + '</tbody>';
      table += '</table>';
      output.push(table);
      continue;
    }

    // Headings
    if (line.startsWith("### ")) {
      output.push(`<h3>${line.slice(4)}</h3>`);
    } else if (line.startsWith("## ")) {
      output.push(`<h2>${line.slice(3)}</h2>`);
    } else if (line.startsWith("# ")) {
      output.push(`<h1>${line.slice(2)}</h1>`);
    } else if (line === "---") {
      output.push("<hr/>");
    } else if (line.startsWith("- ")) {
      // Collect consecutive list items
      const items = [];
      while (i < lines.length && lines[i].trim().startsWith("- ")) {
        items.push(`<li>${lines[i].trim().slice(2)}</li>`);
        i++;
      }
      output.push(`<ul>${items.join("")}</ul>`);
      continue;
    } else if (line === "") {
      output.push("");
    } else {
      // Apply inline formatting
      let text = line
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>");
      output.push(`<p>${text}</p>`);
    }

    i++;
  }

  return output.join("\n");
}

function buildPdfHtml(content, reportName) {
  const bodyHtml = markdownToHtml(content);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111827; padding: 32px 40px; line-height: 1.6; }
  .pdf-header { background: #0f1b2d; color: #fff; padding: 24px 28px; border-radius: 8px; margin-bottom: 28px; }
  .pdf-header h1 { font-size: 20px; font-weight: 900; color: #fff; border: none; margin: 0 0 4px; padding: 0; background: none; }
  .pdf-header p { font-size: 12px; color: rgba(255,255,255,0.7); margin: 0; }
  h1 { font-size: 16px; font-weight: 900; color: #0f1b2d; border-left: 5px solid #1a56db; padding: 8px 12px; background: #eff6ff; margin: 20px 0 12px; border-radius: 4px; }
  h2 { font-size: 14px; font-weight: 800; color: #1e40af; border-left: 4px solid #2563eb; padding: 6px 10px; background: #f0f9ff; margin: 16px 0 10px; border-radius: 4px; }
  h3 { font-size: 12px; font-weight: 700; color: #374151; margin: 12px 0 6px; }
  p { margin: 4px 0 8px; font-size: 11px; }
  ul { margin: 6px 0 10px 20px; }
  li { margin-bottom: 4px; font-size: 11px; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 16px 0; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0 16px; font-size: 10.5px; }
  th { background: #1a56db; color: #fff; font-weight: 700; padding: 7px 10px; text-align: left; border: 1px solid #1e40af; }
  td { padding: 6px 10px; border: 1px solid #d1d5db; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  tr:nth-child(odd) td { background: #ffffff; }
  strong { font-weight: 700; }
  .pdf-footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 9px; color: #9ca3af; text-align: center; }
</style>
</head>
<body>
<div class="pdf-header">
  <h1>FMS AI AgentCore - Audit Planning Report</h1>
  <p>Document: ${reportName} | Generated: ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</p>
  <p>Prepared by Alif Technology - Enterprise Audit Intelligence Platform</p>
</div>
${bodyHtml}
<div class="pdf-footer">
  This report was generated automatically by FMS AI AgentCore. It is intended for audit planning purposes only.
  Alif Technology (c) ${new Date().getFullYear()}
</div>
</body>
</html>`;
}

// ─── Progress Bar ─────────────────────────────────────────────────────
function ProcessingProgress({ progress }) {
  return (
    <div className="processing-progress-wrap">
      <div className="processing-progress-header">
        <span>Processing document...</span>
        <span className="processing-pct">{progress}%</span>
      </div>
      <div className="processing-progress-track">
        <div className="processing-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="processing-progress-label">
        {progress < 30  && "Uploading to secure storage..."}
        {progress >= 30 && progress < 60  && "Extracting text from document..."}
        {progress >= 60 && progress < 85  && "Analysing financial data..."}
        {progress >= 85 && progress < 100 && "Finalising - almost ready..."}
        {progress >= 100 && "Document ready!"}
      </div>
    </div>
  );
}

// ─── Financial Icon SVG ───────────────────────────────────────────────
function FinancialIcon() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ margin: "0 auto 12px", display: "block" }}>
      <rect width="64" height="64" rx="16" fill="rgba(255,255,255,0.08)" />
      <rect x="10" y="36" width="9" height="16" rx="2" fill="#06b6d4" opacity="0.9"/>
      <rect x="23" y="26" width="9" height="26" rx="2" fill="#1a56db" opacity="0.9"/>
      <rect x="36" y="18" width="9" height="34" rx="2" fill="#06b6d4" opacity="0.9"/>
      <rect x="49" y="10" width="9" height="42" rx="2" fill="#1a56db" opacity="0.9"/>
      <polyline points="14,34 27,24 40,16 53,8"
        stroke="#f59e0b" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <circle cx="14" cy="34" r="3" fill="#f59e0b"/>
      <circle cx="27" cy="24" r="3" fill="#f59e0b"/>
      <circle cx="40" cy="16" r="3" fill="#f59e0b"/>
      <circle cx="53" cy="8"  r="3" fill="#f59e0b"/>
      <text x="8" y="62" fontSize="9" fill="rgba(255,255,255,0.5)"
        fontFamily="sans-serif" fontWeight="bold">AED</text>
    </svg>
  );
}

function App() {
  const fileInputRef   = useRef(null);
  const sidebarFileRef = useRef(null);
  const pollingRef     = useRef(null);
  const progressRef    = useRef(null);

  const [view,               setView]               = useState(VIEW_PORTAL);
  const [portal,             setPortal]             = useState(null);
  const [reports,            setReports]            = useState([]);
  const [selectedReport,     setSelectedReport]     = useState(null);
  const [selectedReportId,   setSelectedReportId]   = useState("");
  const [selectedAgent,      setSelectedAgent]      = useState(null);
  const [auditPlanContent,   setAuditPlanContent]   = useState("");
  const [processingProgress, setProcessingProgress] = useState(0);
  const [preGeneratedReport, setPreGeneratedReport] = useState(null);
  const [preGenerating,      setPreGenerating]      = useState(false);
  const [downloading,        setDownloading]        = useState(false);

  const [loadingReports, setLoadingReports] = useState(false);
  const [uploading,      setUploading]      = useState(false);
  const [processing,     setProcessing]     = useState(false);
  const [error,          setError]          = useState("");
  const [sidebarOpen,    setSidebarOpen]    = useState(true);

  function stopPolling() {
    if (pollingRef.current)  { clearInterval(pollingRef.current);  pollingRef.current  = null; }
    if (progressRef.current) { clearInterval(progressRef.current); progressRef.current = null; }
  }

  function startProgressSimulation() {
    setProcessingProgress(5);
    const steps = [15, 25, 35, 45, 55, 65, 75, 82, 88, 92, 95];
    let i = 0;
    progressRef.current = setInterval(() => {
      if (i < steps.length) { setProcessingProgress(steps[i]); i++; }
      else clearInterval(progressRef.current);
    }, 4000);
  }

  async function generateAuditPlanInBackground(reportId) {
    setPreGenerating(true);
    setPreGeneratedReport(null);
    try {
      const res = await fetch(CHAT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message:       "Generate audit planning.",
          question:      "Generate audit planning.",
          sessionId:     `bg-${Date.now()}`,
          reportId,
          selectedAgent: "audit_planning_agent",
          agent:         "audit_planning_agent",
          generalMode:   false,
          general_mode:  false,
        }),
      });
      const data = await res.json();
      if (data.status === "processing" && data.jobId) {
        for (let attempt = 0; attempt < 60; attempt++) {
          await sleep(2500);
          try {
            const statusRes  = await fetch(CHAT_STATUS_API(data.jobId));
            const statusData = await statusRes.json();
            if (statusData.status === "complete") { setPreGeneratedReport(statusData); return; }
            if (statusData.status === "failed") throw new Error(statusData.error);
          } catch {}
        }
      } else {
        setPreGeneratedReport(data);
      }
    } catch (err) {
      console.error("BG_GENERATE_FAILED:", err.message);
      setPreGeneratedReport(null);
    } finally {
      setPreGenerating(false);
    }
  }

  async function fetchReports() {
    try {
      setLoadingReports(true);
      const res  = await fetch(`${DOCUMENTS_API}?portal=user`);
      const data = await res.json();
      const list = data.reports || data.documents || data.items || [];
      setReports(list);
      return list;
    } catch { return []; }
    finally { setLoadingReports(false); }
  }

  async function fetchReportById(reportId) {
    if (!reportId) return null;
    try {
      const res  = await fetch(`${DOCUMENTS_API}/${reportId}`);
      const data = await res.json();
      return data.report || data.document || data.item || data;
    } catch { return null; }
  }

  function startPolling(previousId) {
    stopPolling();
    startProgressSimulation();
    let attempts = 0;
    pollingRef.current = setInterval(async () => {
      attempts++;
      try {
        const res  = await fetch(`${DOCUMENTS_API}?portal=user`);
        const data = await res.json();
        const list = data.reports || data.documents || data.items || [];
        const latest = list[0];
        if (!latest) return;
        const latestId = getReportId(latest);
        const isNew    = latestId && latestId !== previousId;
        const isDone   = ["COMPLETED","READY"].includes(latest.status || latest.processingStatus);
        if (isNew && isDone) {
          stopPolling();
          setProcessingProgress(100);
          setTimeout(() => {
            setProcessing(false);
            setProcessingProgress(0);
            setReports(list);
            setSelectedReport(latest);
            setSelectedReportId(latestId);
            setView(VIEW_UPLOAD);
            generateAuditPlanInBackground(latestId);
          }, 800);
        }
        if (attempts >= 60) { stopPolling(); setProcessing(false); setProcessingProgress(0); }
      } catch {}
    }, 10000);
  }

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setUploading(true);
      setError("");
      setPreGeneratedReport(null);
      setPreGenerating(false);
      const prevId = getReportId(selectedReport);

      const urlRes    = await fetch(UPLOAD_URL_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_name: file.name, content_type: file.type || "application/pdf" }),
      });
      const urlData   = await urlRes.json();
      const uploadUrl = urlData.uploadUrl || urlData.upload_url || urlData.url || urlData.presignedUrl;
      if (!uploadUrl) throw new Error("Upload URL not returned");

      await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/pdf" },
        body: file,
      });

      if (fileInputRef.current)   fileInputRef.current.value   = "";
      if (sidebarFileRef.current) sidebarFileRef.current.value = "";

      setUploading(false);
      setProcessing(true);
      setView(VIEW_UPLOAD);
      startPolling(prevId);
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally { setUploading(false); }
  }

  async function selectPortal(type) {
    setPortal(type);
    if (type === "manager") {
      const list = await fetchReports();
      setReports(list);
      setView(VIEW_MANAGER_HOME);
    } else {
      setView(VIEW_HOME);
    }
  }

  function startNewChat() {
    if (portal === "manager") {
      setView(VIEW_MANAGER_HOME);
      setSelectedReport(null);
      setSelectedReportId("");
    } else {
      setView(VIEW_HOME);
    }
    setSelectedAgent(null);
    setAuditPlanContent("");
    setPreGeneratedReport(null);
    setError("");
  }

  function openAgent(agent) {
    if (!agent.available) return;
    setSelectedAgent(agent);
    setAuditPlanContent("");
    setView(VIEW_AGENT);
  }

  async function openManagerChat(report) {
    const id = getReportId(report);
    setSelectedReportId(id);
    let fullReport = report;
    if (!getReportMarkdown(report)) {
      const fetched = await fetchReportById(id);
      if (fetched) fullReport = fetched;
    }
    setSelectedReport(fullReport);
    setView(VIEW_MANAGER_CHAT);
  }

  async function handleDownloadAuditPlan() {
    if (!auditPlanContent) {
      alert("Please wait for the audit plan to generate first.");
      return;
    }
    setDownloading(true);
    try {
      const html2pdf   = (await import("html2pdf.js")).default;
      const reportName = getReportName(selectedReport);
      const htmlContent = buildPdfHtml(auditPlanContent, reportName);
      const filename   = `Audit_Plan_${reportName}_${new Date().toISOString().slice(0,10)}.pdf`;

      await html2pdf()
        .set({
          margin:      [10, 10, 10, 10],
          filename,
          image:       { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, logging: false, allowTaint: true },
          jsPDF:       { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak:   { mode: ["avoid-all", "css", "legacy"] },
        })
        .from(htmlContent)
        .save();
    } catch (err) {
      console.error("PDF generation failed:", err);
      alert("PDF generation failed: " + err.message);
    } finally {
      setDownloading(false);
    }
  }

  useEffect(() => { return () => stopPolling(); }, []);

  if (view === VIEW_PORTAL) {
    return (
      <div className="portal-screen">
        <div className="portal-hero">
          <div className="portal-logo">AT</div>
          <h1 className="portal-title">Alif Technology</h1>
          <p className="portal-sub">FMS AI AgentCore — Enterprise Audit Intelligence Platform</p>
        </div>
        <p className="portal-prompt">Select your portal to continue</p>
        <div className="portal-cards">
          <button className="portal-card user-portal" onClick={() => selectPortal("user")}>
            <div className="portal-card-icon">👤</div>
            <div className="portal-card-body">
              <div className="portal-card-title">User Portal</div>
              <div className="portal-card-desc">
                Upload your financial document and generate audit planning reports.
                Ask questions about your own uploaded documents only.
              </div>
            </div>
            <div className="portal-card-arrow">→</div>
          </button>
          <button className="portal-card manager-portal" onClick={() => selectPortal("manager")}>
            <div className="portal-card-icon">🏢</div>
            <div className="portal-card-body">
              <div className="portal-card-title">Manager Portal</div>
              <div className="portal-card-desc">
                View all uploaded documents. Select any document and ask the AI
                assistant questions based on that specific document.
              </div>
            </div>
            <div className="portal-card-arrow">→</div>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>

      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-logo-circle">AT</div>
          <div className="brand-text">
            <span className="brand-name">Alif Technology</span>
            <span className="brand-sub">{portal === "manager" ? "Manager Portal" : "User Portal"}</span>
          </div>
          <button className="sidebar-toggle" onClick={() => setSidebarOpen((o) => !o)}>◀</button>
        </div>

        <button className="new-chat-btn" onClick={startNewChat}>
          <span className="new-chat-icon">+</span>
          <span className="new-chat-label">New Chat</span>
        </button>

        {portal === "user" && (
          <label className="sidebar-upload-btn">
            <input ref={sidebarFileRef} type="file"
              accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
              onChange={handleUpload} disabled={uploading || processing} />
            <span className="sidebar-upload-icon">📄</span>
            <span className="sidebar-upload-label">
              {uploading ? "Uploading..." : processing ? "Processing..." : "Upload Document"}
            </span>
          </label>
        )}

        {portal === "manager" && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">All Documents</div>
            {loadingReports && <p className="sidebar-muted">Loading...</p>}
            {!loadingReports && reports.length === 0 && (
              <p className="sidebar-muted">No documents uploaded yet.</p>
            )}
            {reports.map((r) => {
              const id = getReportId(r);
              return (
                <button key={id}
                  className={`report-item ${selectedReportId === id ? "report-item-active" : ""}`}
                  onClick={() => openManagerChat(r)}>
                  <span className="report-item-icon">📑</span>
                  <div className="report-item-text">
                    <span className="report-item-name">{getReportName(r)}</span>
                    <span className="report-item-date">{formatDate(r.createdAt || r.created_at)}</span>
                  </div>
                  <span className={`report-status-dot ${["COMPLETED","READY"].includes(r.status) ? "dot-green" : "dot-yellow"}`} />
                </button>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: "auto" }}>
          <button className="switch-portal-btn"
            onClick={() => { setView(VIEW_PORTAL); setPortal(null); }}>
            Switch Portal
          </button>
        </div>
      </aside>

      <main className="main-content">

        <header className="topbar">
          <div className="topbar-left">
            {!sidebarOpen && (
              <button className="topbar-toggle" onClick={() => setSidebarOpen(true)}>☰</button>
            )}
            <div className="topbar-title">
              {view === VIEW_HOME         && "Welcome — What would you like to do?"}
              {view === VIEW_MANAGER_HOME && "Manager Portal — Select a Document"}
              {view === VIEW_UPLOAD       && "Report Analysis"}
              {view === VIEW_AGENT        && (selectedAgent?.label || "Audit Planning Agent")}
              {view === VIEW_GENERAL      && "General Q&A — UAE Finance & Law"}
              {view === VIEW_MANAGER_CHAT && `Document Q&A — ${getReportName(selectedReport)}`}
            </div>
          </div>

          {selectedReport && view === VIEW_AGENT && (
            <div className="topbar-report-pill">
              <span className="pill-icon">📑</span>
              <span className="pill-name">{getReportName(selectedReport)}</span>
              <button className="pill-btn" onClick={handleDownloadAuditPlan} disabled={downloading}>
                {downloading ? "Generating PDF..." : "Download PDF"}
              </button>
            </div>
          )}
        </header>

        {error && (
          <div className="banner banner-error">⚠️ {error}
            <button onClick={() => setError("")}>✕</button>
          </div>
        )}

        {processing && <ProcessingProgress progress={processingProgress} />}

        {view === VIEW_HOME && (
          <div className="home-view">
            <div className="home-hero">
              <div className="home-hero-logo">AT</div>
              <h1 className="home-hero-title">Alif Technology</h1>
              <p className="home-hero-sub">FMS AI AgentCore — Enterprise Audit Intelligence Platform</p>
              <div className="portal-badge">👤 User Portal</div>
            </div>
            <p className="home-prompt">What would you like to do today?</p>
            <div className="home-options">
              <label className="home-option-card upload-card">
                <input ref={fileInputRef} type="file"
                  accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                  onChange={handleUpload} disabled={uploading || processing} />
                <div className="option-icon">📄</div>
                <div className="option-body">
                  <div className="option-title">Upload a Financial Document</div>
                  <div className="option-desc">
                    Upload a financial statement. The AI agents will automatically
                    generate audit planning, risk assessments, and recommendations.
                  </div>
                </div>
                <div className="option-arrow">→</div>
              </label>
              <button className="home-option-card qa-card" onClick={() => setView(VIEW_GENERAL)}>
                <div className="option-icon">💬</div>
                <div className="option-body">
                  <div className="option-title">Ask a Question</div>
                  <div className="option-desc">
                    Ask anything about UAE Corporate Tax, VAT regulations, IFRS standards,
                    audit procedures, or general financial compliance topics.
                  </div>
                </div>
                <div className="option-arrow">→</div>
              </button>
            </div>
            {uploading && <div className="home-status">Uploading your document...</div>}
          </div>
        )}

        {view === VIEW_MANAGER_HOME && (
          <div className="manager-home-view">
            <div className="manager-home-hero">
              <div className="manager-home-icon">🏢</div>
              <h2 className="manager-home-title">Manager Portal</h2>
              <p className="manager-home-desc">
                Select a document from the list below to open it and ask questions.
                The AI will answer based on that specific document only.
              </p>
            </div>
            {loadingReports && <p className="manager-loading">Loading documents...</p>}
            {!loadingReports && reports.length === 0 && (
              <div className="manager-empty">
                <div className="manager-empty-icon">📭</div>
                <p>No documents have been uploaded yet.</p>
              </div>
            )}
            <div className="manager-doc-grid">
              {reports.map((r) => {
                const id   = getReportId(r);
                const done = ["COMPLETED","READY"].includes(r.status || r.processingStatus);
                return (
                  <button key={id} className="manager-doc-card" onClick={() => openManagerChat(r)}>
                    <div className="manager-doc-icon">📑</div>
                    <div className="manager-doc-body">
                      <div className="manager-doc-name">{getReportName(r)}</div>
                      <div className="manager-doc-date">{formatDate(r.createdAt || r.created_at)}</div>
                      <div className={`manager-doc-status ${done ? "status-done" : "status-pending"}`}>
                        {done ? "✅ Ready" : "Processing"}
                      </div>
                    </div>
                    <div className="manager-doc-open">Open →</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {view === VIEW_MANAGER_CHAT && (
          <div className="chatbot-view">
            <div className="chatbot-nav-bar">
              <button className="back-nav-btn"
                onClick={() => { setView(VIEW_MANAGER_HOME); setSelectedReport(null); setSelectedReportId(""); }}>
                ← Back to Documents
              </button>
            </div>
            <Chatbot reportId={selectedReportId} selectedReport={selectedReport} managerMode />
          </div>
        )}

        {view === VIEW_UPLOAD && (
          <div className="agent-view">
            <button className="back-nav-btn"
              style={{ alignSelf: "flex-start", margin: "16px" }}
              onClick={() => setView(VIEW_HOME)}>
              ← Back
            </button>
            <div className="master-agent-card">
              <div className="master-badge">MASTER AGENT</div>
              <FinancialIcon />
              <div className="master-title">FMS AI AgentCore</div>
              <div className="master-desc">
                Your document has been processed. Select an agent below to view
                the generated report instantly.
              </div>
              {selectedReport && (
                <div className="master-doc-pill">📑 {getReportName(selectedReport)}</div>
              )}
            </div>

            <div className="sub-agents-label">Report Analysis</div>

            <div className="sub-agents-grid">
              {SUB_AGENTS.map((agent) => (
                <button key={agent.id}
                  className={`sub-agent-card ${!agent.available ? "sub-agent-disabled" : ""}`}
                  onClick={() => openAgent(agent)}
                  disabled={!agent.available}>
                  <div className="sub-agent-icon">{agent.icon}</div>
                  <div className="sub-agent-body">
                    <div className="sub-agent-name">{agent.label}</div>
                    <div className="sub-agent-desc">{agent.description}</div>
                  </div>
                  {agent.available ? (
                    <div className="sub-agent-status-pill">
                      {preGenerating  && <span className="status-pill generating">Preparing...</span>}
                      {!preGenerating && preGeneratedReport  && <span className="status-pill ready">✅ Ready</span>}
                      {!preGenerating && !preGeneratedReport && <span className="status-pill pending">→</span>}
                    </div>
                  ) : (
                    <div className="sub-agent-soon">Coming Soon</div>
                  )}
                </button>
              ))}
            </div>

            <label className="upload-another-btn">
              <input ref={fileInputRef} type="file"
                accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                onChange={handleUpload} disabled={uploading || processing} />
              {uploading ? "Uploading..." : processing ? "Processing..." : "Upload Another Document"}
            </label>
          </div>
        )}

        {view === VIEW_AGENT && (
          <div className="chatbot-view">
            <div className="chatbot-nav-bar">
              <button className="back-nav-btn" onClick={() => setView(VIEW_UPLOAD)}>
                ← Back to Report Analysis
              </button>
            </div>
            <Chatbot
              reportId={selectedReportId}
              selectedReport={selectedReport}
              preGeneratedReport={preGeneratedReport}
              preGenerating={preGenerating}
              onReportGenerated={(content) => setAuditPlanContent(content)}
            />
          </div>
        )}

        {view === VIEW_GENERAL && (
          <div className="chatbot-view">
            <div className="chatbot-nav-bar">
              <button className="back-nav-btn" onClick={() => setView(VIEW_HOME)}>← Back</button>
            </div>
            <Chatbot reportId={null} selectedReport={null} generalMode />
          </div>
        )}

      </main>
    </div>
  );
}

export default App;