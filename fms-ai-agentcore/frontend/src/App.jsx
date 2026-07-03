import Chatbot from "./components/Chatbot";
import React, { useEffect, useRef, useState } from "react";
import "./App.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "https://c0feinpvm5.execute-api.eu-central-1.amazonaws.com/prod";

const DOCUMENTS_API  = `${API_BASE_URL}/documents`;
const UPLOAD_URL_API = `${API_BASE_URL}/upload-url`;
const CHAT_API       = `${API_BASE_URL}/chat`;
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

// ─── Progress Bar ─────────────────────────────────────────────────────
function ProcessingProgress({ progress }) {
  return (
    <div className="processing-progress-wrap">
      <div className="processing-progress-header">
        <span>⏳ Processing document…</span>
        <span className="processing-pct">{progress}%</span>
      </div>
      <div className="processing-progress-track">
        <div className="processing-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="processing-progress-label">
        {progress < 30  && "Uploading to secure storage…"}
        {progress >= 30 && progress < 60  && "Extracting text from document…"}
        {progress >= 60 && progress < 85  && "Analysing financial data…"}
        {progress >= 85 && progress < 100 && "Finalising — almost ready…"}
        {progress >= 100 && "✅ Document ready!"}
      </div>
    </div>
  );
}

// ─── Financial Icon SVG ───────────────────────────────────────────────
function FinancialIcon() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={{ margin: "0 auto 12px", display: "block" }}>
      <rect width="64" height="64" rx="16" fill="rgba(255,255,255,0.08)" />
      {/* Bar chart bars */}
      <rect x="10" y="36" width="9" height="16" rx="2" fill="#06b6d4" opacity="0.9"/>
      <rect x="23" y="26" width="9" height="26" rx="2" fill="#1a56db" opacity="0.9"/>
      <rect x="36" y="18" width="9" height="34" rx="2" fill="#06b6d4" opacity="0.9"/>
      <rect x="49" y="10" width="9" height="42" rx="2" fill="#1a56db" opacity="0.9"/>
      {/* Trend line */}
      <polyline points="14,34 27,24 40,16 53,8"
        stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      {/* Dots on trend line */}
      <circle cx="14" cy="34" r="3" fill="#f59e0b"/>
      <circle cx="27" cy="24" r="3" fill="#f59e0b"/>
      <circle cx="40" cy="16" r="3" fill="#f59e0b"/>
      <circle cx="53" cy="8"  r="3" fill="#f59e0b"/>
      {/* AED currency symbol */}
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

  // ── Background audit plan generation ────────────────────────────────
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
            if (statusData.status === "complete") {
              setPreGeneratedReport(statusData);
              return;
            }
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

  function handleDownloadAuditPlan() {
    if (!auditPlanContent) {
      alert("Please wait for the audit plan to generate first.");
      return;
    }
    const filename = `Audit_Plan_${getReportName(selectedReport)}_${new Date().toISOString().slice(0,10)}.txt`;
    const blob = new Blob([auditPlanContent], { type: "text/plain;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  useEffect(() => { return () => stopPolling(); }, []);

  // ── PORTAL SELECTION ─────────────────────────────────────────────────
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

  // ── MAIN APP ──────────────────────────────────────────────────────────
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
          <span className="new-chat-icon">＋</span>
          <span className="new-chat-label">New Chat</span>
        </button>

        {portal === "user" && (
          <label className="sidebar-upload-btn">
            <input ref={sidebarFileRef} type="file"
              accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
              onChange={handleUpload} disabled={uploading || processing} />
            <span className="sidebar-upload-icon">📄</span>
            <span className="sidebar-upload-label">
              {uploading ? "Uploading…" : processing ? "Processing…" : "Upload Document"}
            </span>
          </label>
        )}

        {portal === "manager" && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">All Documents</div>
            {loadingReports && <p className="sidebar-muted">Loading…</p>}
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
            ← Switch Portal
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
              <button className="pill-btn" onClick={handleDownloadAuditPlan}>⬇ Download Audit Plan</button>
            </div>
          )}
        </header>

        {error && (
          <div className="banner banner-error">⚠️ {error}
            <button onClick={() => setError("")}>✕</button>
          </div>
        )}

        {processing && <ProcessingProgress progress={processingProgress} />}

        {/* USER HOME */}
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
            {uploading && <div className="home-status">⬆️ Uploading your document…</div>}
          </div>
        )}

        {/* MANAGER HOME */}
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
            {loadingReports && <p className="manager-loading">Loading documents…</p>}
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
                        {done ? "✅ Ready" : "⏳ Processing"}
                      </div>
                    </div>
                    <div className="manager-doc-open">Open →</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* MANAGER CHAT */}
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

        {/* REPORT ANALYSIS — agent picker */}
        {view === VIEW_UPLOAD && (
          <div className="agent-view">
            <button className="back-nav-btn"
              style={{ alignSelf: "flex-start", margin: "16px" }}
              onClick={() => setView(VIEW_HOME)}>
              ← Back
            </button>

            {/* Master agent card with financial icon */}
            <div className="master-agent-card">
              <div className="master-badge">MASTER AGENT</div>

              {/* Financial chart icon instead of robot */}
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
                      {preGenerating   && <span className="status-pill generating">⏳ Preparing…</span>}
                      {!preGenerating  && preGeneratedReport  && <span className="status-pill ready">✅ Ready</span>}
                      {!preGenerating  && !preGeneratedReport && <span className="status-pill pending">→</span>}
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
              {uploading ? "Uploading…" : processing ? "Processing…" : "⬆ Upload Another Document"}
            </label>
          </div>
        )}

        {/* AUDIT AGENT */}
        {view === VIEW_AGENT && (
          <div className="chatbot-view">
            <div className="chatbot-nav-bar">
              <button className="back-nav-btn"
                onClick={() => setView(VIEW_UPLOAD)}>
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

        {/* GENERAL Q&A */}
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