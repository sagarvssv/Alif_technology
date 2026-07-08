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
    description: "Reviews financial statements for IFRS compliance, missing disclosures, note consistency, classification, ratios, going concern, and related party disclosures.",
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

function markdownToHtml(markdown = "") {
  const lines  = markdown.split("\n");
  const output = [];
  let i = 0;
  const isSeparator = (line) => /^\|[\s\-:|]+\|/.test(line.trim());
  const isTableRow  = (line) => line.trim().startsWith("|") && line.trim().endsWith("|");
  while (i < lines.length) {
    const line = lines[i].trim();
    if (isTableRow(lines[i]) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const headerCells = lines[i].split("|").map((c) => c.trim()).filter(Boolean);
      i += 2;
      const bodyRows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        bodyRows.push(lines[i].split("|").map((c) => c.trim()).filter(Boolean));
        i++;
      }
      let t = `<table><thead><tr>`;
      headerCells.forEach((c) => { t += `<th>${c}</th>`; });
      t += `</tr></thead><tbody>`;
      bodyRows.forEach((row) => { t += `<tr>`; row.forEach((c) => { t += `<td>${c}</td>`; }); t += `</tr>`; });
      t += `</tbody></table>`;
      output.push(t);
      continue;
    }
    if (line.startsWith("### "))      output.push(`<h3>${line.slice(4)}</h3>`);
    else if (line.startsWith("## "))  output.push(`<h2>${line.slice(3)}</h2>`);
    else if (line.startsWith("# "))   output.push(`<h1>${line.slice(2)}</h1>`);
    else if (line === "---")          output.push(`<hr/>`);
    else if (line.startsWith("- ")) {
      const items = [];
      while (i < lines.length && lines[i].trim().startsWith("- ")) {
        items.push(`<li>${lines[i].trim().slice(2).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</li>`);
        i++;
      }
      output.push(`<ul>${items.join("")}</ul>`);
      continue;
    } else if (line === "") {
      output.push(`<br/>`);
    } else {
      const text = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");
      output.push(`<p>${text}</p>`);
    }
    i++;
  }
  return output.join("\n");
}

function buildPdfHtml(content, reportName) {
  const body = markdownToHtml(content);
  const date = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const year = new Date().getFullYear();
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Report - ${reportName}</title>
<style>
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #111827; padding: 20mm 15mm; line-height: 1.6; }
  .header { background: #0f1b2d !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; color: white; padding: 20px 24px; border-radius: 8px; margin-bottom: 24px; }
  .header-title { font-size: 18pt; font-weight: 900; color: white; margin-bottom: 6px; }
  .header-sub { font-size: 10pt; color: rgba(255,255,255,0.75); }
  h1 { font-size: 14pt; font-weight: 900; color: #0f1b2d; background: #dbeafe !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; border-left: 5px solid #1d4ed8; padding: 8px 12px; margin: 20px 0 10px; border-radius: 4px; }
  h2 { font-size: 12pt; font-weight: 800; color: #1e40af; background: #eff6ff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; border-left: 4px solid #2563eb; padding: 6px 10px; margin: 14px 0 8px; border-radius: 4px; }
  h3 { font-size: 11pt; font-weight: 700; color: #374151; margin: 10px 0 6px; }
  p { margin: 4px 0 8px; font-size: 10pt; }
  ul { margin: 6px 0 10px 20px; } li { margin-bottom: 4px; font-size: 10pt; }
  hr { border: none; border-top: 1px solid #d1d5db; margin: 14px 0; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0 16px; font-size: 9.5pt; page-break-inside: avoid; }
  th { background: #1d4ed8 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; color: white !important; font-weight: 700; padding: 7px 10px; text-align: left; border: 1px solid #1e40af; }
  td { padding: 6px 10px; border: 1px solid #d1d5db; vertical-align: top; background: white; }
  tr:nth-child(even) td { background: #f8fafc !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 8pt; color: #9ca3af; text-align: center; }
</style></head><body>
<div class="header">
  <div class="header-title">FMS AI AgentCore — Report</div>
  <div class="header-sub">Document: ${reportName}</div>
  <div class="header-sub">Generated: ${date} | Prepared by Alif Technology</div>
</div>
${body}
<div class="footer">Generated automatically by FMS AI AgentCore. For audit planning purposes only. &copy; Alif Technology ${year}</div>
</body></html>`;
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
      <polyline points="14,34 27,24 40,16 53,8" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <circle cx="14" cy="34" r="3" fill="#f59e0b"/>
      <circle cx="27" cy="24" r="3" fill="#f59e0b"/>
      <circle cx="40" cy="16" r="3" fill="#f59e0b"/>
      <circle cx="53" cy="8"  r="3" fill="#f59e0b"/>
      <text x="8" y="62" fontSize="9" fill="rgba(255,255,255,0.5)" fontFamily="sans-serif" fontWeight="bold">AED</text>
    </svg>
  );
}

// ─── Chat Popup ───────────────────────────────────────────────────────
function ChatPopup() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="chat-popup-btn" onClick={() => setOpen((o) => !o)} title="Ask a question">
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        )}
        {!open && <span className="chat-popup-label">Ask a Question</span>}
      </button>
      {open && (
        <div className="chat-popup-window">
          <div className="chat-popup-header">
            <div className="chat-popup-header-left">
              <div className="chat-popup-avatar">AT</div>
              <div>
                <div className="chat-popup-title">FMS AI Assistant</div>
                <div className="chat-popup-subtitle">UAE Finance & Audit Knowledge Base</div>
              </div>
            </div>
            <button className="chat-popup-close" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="chat-popup-body">
            <Chatbot reportId={null} selectedReport={null} generalMode popupMode />
          </div>
        </div>
      )}
    </>
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

  // Separate pre-generated reports per agent
  const [preGeneratedAuditReport,    setPreGeneratedAuditReport]    = useState(null);
  const [preGeneratedFsReport,       setPreGeneratedFsReport]       = useState(null);
  const [preGeneratingAudit,         setPreGeneratingAudit]         = useState(false);
  const [preGeneratingFs,            setPreGeneratingFs]            = useState(false);

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

  async function generateInBackground(reportId, agentId) {
    const isAudit = agentId === "audit_planning_agent";
    const isFsRev = agentId === "fs_review_agent";

    if (isAudit) setPreGeneratingAudit(true);
    if (isFsRev) setPreGeneratingFs(true);

    const message = isFsRev
      ? "Generate financial statement review."
      : "Generate audit planning.";

    try {
      const res = await fetch(CHAT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message, question: message,
          sessionId: `bg-${Date.now()}`,
          reportId, selectedAgent: agentId, agent: agentId,
          generalMode: false, general_mode: false,
        }),
      });
      const data = await res.json();

      if (data.status === "processing" && data.jobId) {
        for (let attempt = 0; attempt < 60; attempt++) {
          await sleep(2500);
          try {
            const statusRes  = await fetch(CHAT_STATUS_API(data.jobId));
            const statusData = await statusRes.json();
            if (statusData.status === "complete") {
              if (isAudit) setPreGeneratedAuditReport(statusData);
              if (isFsRev) setPreGeneratedFsReport(statusData);
              return;
            }
            if (statusData.status === "failed") throw new Error(statusData.error);
          } catch {}
        }
      } else {
        if (isAudit) setPreGeneratedAuditReport(data);
        if (isFsRev) setPreGeneratedFsReport(data);
      }
    } catch (err) {
      console.error("BG_GENERATE_FAILED:", err.message);
    } finally {
      if (isAudit) setPreGeneratingAudit(false);
      if (isFsRev) setPreGeneratingFs(false);
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
            // Reset both pre-generated reports
            setPreGeneratedAuditReport(null);
            setPreGeneratedFsReport(null);
            setView(VIEW_UPLOAD);
            // Only pre-generate audit planning in background
            generateInBackground(latestId, "audit_planning_agent");
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
      setPreGeneratedAuditReport(null);
      setPreGeneratedFsReport(null);
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
    setError("");
  }

  function openAgent(agent) {
    if (!agent.available) return;
    setSelectedAgent(agent);
    setAuditPlanContent("");
    setView(VIEW_AGENT);

    const isAudit = agent.id === "audit_planning_agent";
    const isFsRev = agent.id === "fs_review_agent";

    // Only generate if not already generated or generating
    if (isAudit && !preGeneratedAuditReport && !preGeneratingAudit && selectedReportId) {
      generateInBackground(selectedReportId, "audit_planning_agent");
    }
    if (isFsRev && !preGeneratedFsReport && !preGeneratingFs && selectedReportId) {
      generateInBackground(selectedReportId, "fs_review_agent");
    }
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

  function handleDownloadAuditPlan() {
    if (!auditPlanContent) {
      alert("Please wait for the report to generate first.");
      return;
    }
    const reportName  = getReportName(selectedReport);
    const htmlContent = buildPdfHtml(auditPlanContent, reportName);
    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) { alert("Please allow popups for this site to download the PDF."); return; }
    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); }, 800);
  }

  useEffect(() => { return () => stopPolling(); }, []);

  // Compute what to show on agent cards
  const auditStatus = preGeneratingAudit ? "preparing" : preGeneratedAuditReport ? "ready" : "idle";
  const fsStatus    = preGeneratingFs    ? "preparing" : preGeneratedFsReport    ? "ready" : "idle";

  function getAgentStatus(agentId) {
    if (agentId === "audit_planning_agent") return auditStatus;
    if (agentId === "fs_review_agent")      return fsStatus;
    return "idle";
  }

  function getPreGeneratedReport() {
    if (!selectedAgent) return null;
    if (selectedAgent.id === "audit_planning_agent") return preGeneratedAuditReport;
    if (selectedAgent.id === "fs_review_agent")      return preGeneratedFsReport;
    return null;
  }

  function getPreGenerating() {
    if (!selectedAgent) return false;
    if (selectedAgent.id === "audit_planning_agent") return preGeneratingAudit;
    if (selectedAgent.id === "fs_review_agent")      return preGeneratingFs;
    return false;
  }

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
              <div className="portal-card-desc">Upload your financial document and generate audit planning reports. Ask questions about your own uploaded documents only.</div>
            </div>
            <div className="portal-card-arrow">→</div>
          </button>
          <button className="portal-card manager-portal" onClick={() => selectPortal("manager")}>
            <div className="portal-card-icon">🏢</div>
            <div className="portal-card-body">
              <div className="portal-card-title">Manager Portal</div>
              <div className="portal-card-desc">View all uploaded documents. Select any document and ask the AI assistant questions based on that specific document.</div>
            </div>
            <div className="portal-card-arrow">→</div>
          </button>
        </div>
        <ChatPopup />
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
          <button className="switch-portal-btn" onClick={() => { setView(VIEW_PORTAL); setPortal(null); }}>
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
              {view === VIEW_AGENT        && (selectedAgent?.label || "Agent")}
              {view === VIEW_MANAGER_CHAT && `Document Q&A — ${getReportName(selectedReport)}`}
            </div>
          </div>
          {selectedReport && view === VIEW_AGENT && (
            <div className="topbar-report-pill">
              <span className="pill-icon">📑</span>
              <span className="pill-name">{getReportName(selectedReport)}</span>
              <button className="pill-btn" onClick={handleDownloadAuditPlan}>Download PDF</button>
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
                  <div className="option-desc">Upload a financial statement. The AI agents will automatically generate audit planning, risk assessments, and recommendations.</div>
                </div>
                <div className="option-arrow">→</div>
              </label>
            </div>
            {uploading && <div className="home-status">Uploading your document...</div>}
          </div>
        )}

        {view === VIEW_MANAGER_HOME && (
          <div className="manager-home-view">
            <div className="manager-home-hero">
              <div className="manager-home-icon">🏢</div>
              <h2 className="manager-home-title">Manager Portal</h2>
              <p className="manager-home-desc">Select a document from the list below to open it and ask questions.</p>
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
              <div className="master-desc">Your document has been processed. Select an agent below to view the generated report instantly.</div>
              {selectedReport && (
                <div className="master-doc-pill">📑 {getReportName(selectedReport)}</div>
              )}
            </div>

            <div className="sub-agents-label">Report Analysis</div>

            <div className="sub-agents-grid">
              {SUB_AGENTS.map((agent) => {
                const status = getAgentStatus(agent.id);
                return (
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
                        {status === "preparing" && <span className="status-pill generating">⏳ Preparing…</span>}
                        {status === "ready"     && <span className="status-pill ready">✅ Ready</span>}
                        {status === "idle"      && <span className="status-pill pending">→</span>}
                      </div>
                    ) : (
                      <div className="sub-agent-soon">Coming Soon</div>
                    )}
                  </button>
                );
              })}
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
              selectedAgent={selectedAgent}
              preGeneratedReport={getPreGeneratedReport()}
              preGenerating={getPreGenerating()}
              onReportGenerated={(content) => setAuditPlanContent(content)}
            />
          </div>
        )}

      </main>

      <ChatPopup />
    </div>
  );
}

export default App;