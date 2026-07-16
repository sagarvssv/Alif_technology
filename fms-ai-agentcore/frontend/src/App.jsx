import Chatbot from "./components/Chatbot";
import Projects from "./components/Projects";
import ProjectDashboard from "./components/ProjectDashboard";
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
const VIEW_PROJECTS     = "projects";
const VIEW_PROJECT_DETAIL = "project_detail";
const VIEW_PROJECT_DASHBOARD = "project_dashboard";
const VIEW_PROJECT_HISTORY = "project_history";
const VIEW_PROJECT_FILES = "project_files";
const VIEW_MASTER_AGENT = "master_agent";

// ─── Demo login ──────────────────────────────────────────────────────
// NOTE: this is a lightweight simulation for demo purposes only — the
// credential check happens entirely in the browser, so it is NOT real
// security (same caveat as everything else client-side so far). It exists
// to gate access casually and to give created projects a stable "owner"
// to scope by, not to actually protect anything.
const DEMO_LOGIN = {
  username: "hasini",
  password: "hasini123",
  displayName: "Hasini",
  userId: "hasini",
};

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
    description: "Reviews draft financial statements for IFRS compliance, missing disclosures, note consistency, classification, ratio & trend analysis, going concern indicators, and related party disclosures.",
    icon:        "📊",
    available:   true,
  },
];

const AGENT_GENERATE_MESSAGES = {
  audit_planning_agent: "Generate audit planning.",
  fs_review_agent:      "Review financial statement.",
};

function emptyAgentReportState() {
  return {
    audit_planning_agent: { content: "", preGenerated: null, preGenerating: false },
    fs_review_agent:      { content: "", preGenerated: null, preGenerating: false },
  };
}

function formatDate(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch { return value; }
}

function formatDateOnly(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value));
  } catch { return value; }
}

function formatTimeOnly(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en-IN", { timeStyle: "short" }).format(new Date(value));
  } catch { return value; }
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function historyDateLabel(dateObj) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(dateObj, today)) return "Today";
  if (isSameDay(dateObj, yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(dateObj);
}

// Groups history entries by calendar day (newest first), Chrome-history style.
function groupHistoryByDate(history) {
  const sorted = [...(history || [])].sort(
    (a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0)
  );

  const groups = [];
  for (const entry of sorted) {
    const entryDate = new Date(entry.timestamp || 0);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && isSameDay(lastGroup.dateObj, entryDate)) {
      lastGroup.entries.push(entry);
    } else {
      groups.push({ dateObj: entryDate, label: historyDateLabel(entryDate), entries: [entry] });
    }
  }
  return groups;
}

function getLegalName(project) {
  return project?.legalName || project?.companyAuditName || "";
}

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getReportId(r)       { return r?.reportId || r?.documentId || r?.document_id || ""; }
function getReportName(r)     { return r?.source_file || r?.sourceFile || r?.fileName || r?.file_name || r?.company || "Uploaded Report"; }
function getReportMarkdown(r) { return r?.reportMarkdown || r?.report_markdown || r?.markdown || r?.summary || r?.content || ""; }
function sleep(ms)            { return new Promise((res) => setTimeout(res, ms)); }

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getInitials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function removeSourcesFromAnswer(answer = "") {
  return answer
    .replace(/\n+---\n+\n*## Sources[\s\S]*$/i, "")
    .replace(/\n+## Sources[\s\S]*$/i, "")
    .trim();
}

// ─── Master Agent helpers ──────────────────────────────────────────────
// Both run entirely client-side against whatever markdown the sub-agents
// already generated — no backend calls, no redeploys needed.
function countRiskLevels(markdown = "") {
  let high = 0, medium = 0, low = 0;
  const lines = (markdown || "").split("\n");
  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    if (/^\|[\s|:-]+\|/.test(line.trim())) continue;
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 3) continue;
    const risk = (cells[2] || "").toLowerCase();
    if (risk.includes("high")) high++;
    else if (risk.includes("medium")) medium++;
    else if (risk.includes("low")) low++;
  }
  return { high, medium, low, total: high + medium + low };
}

function extractSection(markdown = "", heading = "") {
  if (!markdown) return "";
  const lines = markdown.split("\n");
  let capturing = false;
  const collected = [];
  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (headingMatch) {
      const title = headingMatch[1].replace(/^\d+\.\s*/, "").trim();
      if (capturing) break;
      if (title.toLowerCase() === heading.toLowerCase()) {
        capturing = true;
      }
      continue;
    }
    if (capturing) {
      if (line.trim() === "---") break;
      if (line.trim()) collected.push(line.trim());
    }
  }
  return collected.join(" ").trim();
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

// ─── Upload Cloud Icon SVG ──────────────────────────────────────────────
function UploadBoxIcon({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0, display: "block" }}>
      <path
        d="M7 18C4.79 18 3 16.21 3 14C3 12.05 4.36 10.42 6.18 10.06C6.6 7.72 8.65 6 11.1 6C13.8 6 16 8.13 16.24 10.81C18.34 11.11 20 12.91 20 15.1C20 17.26 18.29 19 16.14 19H7.5"
        stroke="#94a3b8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M12 20V13M12 13L9.5 15.5M12 13L14.5 15.5"
        stroke="#1a56db" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Project detail rows — clean, aligned label/value list ────────────
function ProjectDetailRows({ project }) {
  if (!project) return null;

  const rows = [
    { icon: "📝", label: "Project Description", value: project.projectDescription },
    { icon: "📋", label: "Audit Description", value: project.auditDescription },
    { icon: "🏢", label: "Entity Type", value: project.entityType },
    { icon: "📆", label: "Incorporation Date", value: formatDateOnly(project.incorporationDate) },
    { icon: "🔢", label: "CIN", value: project.cin },
    { icon: "🧾", label: "Tax Registration No.", value: project.taxRegistrationNumber },
    { icon: "📍", label: "Registered Address", value: project.registeredAddress },
    { icon: "🏗️", label: "Subsidiaries / Branches", value: project.subsidiaries },
    { icon: "👤", label: "CEO", value: project.ceo },
    { icon: "📞", label: "Contact Number", value: project.contactNumber },
    { icon: "📇", label: "Principal Contact", value: project.principalContact },
  ].filter((row) => row.value);

  if (rows.length === 0) return null;

  return (
    <div className="pd-detail-list">
      {rows.map((row) => (
        <div className="pd-detail-row" key={row.label}>
          <div className="pd-detail-label">{row.icon} {row.label}</div>
          <div className="pd-detail-value">{row.value}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Audit Shield Icon SVG ──────────────────────────────────────────────
function AuditShieldIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0, display: "block" }}>
      <path
        d="M12 2.5L19.5 5.5V11C19.5 15.5 16.5 19.5 12 21.5C7.5 19.5 4.5 15.5 4.5 11V5.5L12 2.5Z"
        fill="#f59e0b" opacity="0.15" stroke="#f59e0b" strokeWidth="1.4" strokeLinejoin="round" />
      <path
        d="M8.5 12L11 14.5L15.5 9.5"
        stroke="#f59e0b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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

// ─── Master Agent Overview ─────────────────────────────────────────────
function MasterAgentOverview({ agentReports, reportName, onViewDetails }) {
  const cards = [
    {
      id:      "audit_planning_agent",
      label:   "Audit Planning Agent",
      icon:    "📋",
      heading: "Overall Audit Planning Summary",
    },
    {
      id:      "fs_review_agent",
      label:   "Financial Statement Review Agent",
      icon:    "📊",
      heading: "Overall Review Summary",
    },
  ];

  return (
    <div className="master-overview">
      <div className="master-overview-intro">
        I'm the Master Agent. Here's a summary of both specialist agents' findings
        {reportName ? <> for <strong>{reportName}</strong></> : ""}.
      </div>
      {cards.map((c) => {
        const state       = agentReports[c.id] || {};
        const content     = removeSourcesFromAnswer(
          state.preGenerated?.answer || state.preGenerated?.response || state.preGenerated?.message || ""
        );
        const status      = state.preGenerating ? "preparing" : state.preGenerated ? "ready" : "idle";
        const counts      = countRiskLevels(content);
        const summaryText = extractSection(content, c.heading);
        const hasSummary  = summaryText.length > 0;
        const hasStats    = counts.total > 0;

        return (
          <div key={c.id} className="master-overview-card">
            <div className="master-overview-card-header">
              <span className="master-overview-icon">{c.icon}</span>
              <span className="master-overview-title">{c.label}</span>
              {status === "ready"     && <span className="status-pill ready">✅ Ready</span>}
              {status === "preparing" && <span className="status-pill generating">⏳ Preparing…</span>}
            </div>

            {hasSummary ? (
              <p className="master-overview-desc">{summaryText}</p>
            ) : (
              <p className="master-overview-desc">
                {status === "preparing"
                  ? "Analysing your document — the summary will appear here shortly."
                  : status === "ready"
                    ? "Report generated. Open the full report below for details."
                    : "Upload a document for this project to see a summary from this agent here."}
              </p>
            )}

            {hasStats && (
              <div className="master-overview-stats">
                {counts.high > 0 && (
                  <span className="master-overview-stat stat-high">
                    🔴 {counts.high} High risk area{counts.high > 1 ? "s" : ""}
                  </span>
                )}
                {counts.medium > 0 && (
                  <span className="master-overview-stat stat-medium">
                    🟡 {counts.medium} Medium risk area{counts.medium > 1 ? "s" : ""}
                  </span>
                )}
                {counts.low > 0 && (
                  <span className="master-overview-stat stat-low">
                    🟢 {counts.low} Low risk area{counts.low > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            )}

            <button className="master-overview-btn" onClick={() => onViewDetails(c.id)}>
              View Details →
            </button>
          </div>
        );
      })}
    </div>
  );
}

function App() {
  const fileInputRef   = useRef(null);
  const sidebarFileRef = useRef(null);
  const pollingRef     = useRef(null);
  const progressRef    = useRef(null);

  const [isLoggedIn, setIsLoggedIn] = useState(
    () => sessionStorage.getItem("alif_logged_in") === "true"
  );
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  function handleLogin(e) {
    e.preventDefault();
    const usernameMatches = loginUsername.trim().toLowerCase() === DEMO_LOGIN.username;
    const passwordMatches = loginPassword === DEMO_LOGIN.password;
    if (usernameMatches && passwordMatches) {
      sessionStorage.setItem("alif_logged_in", "true");
      setIsLoggedIn(true);
      setLoginError("");
    } else {
      setLoginError("Incorrect username or password.");
    }
  }

  function handleLogout() {
    sessionStorage.removeItem("alif_logged_in");
    setIsLoggedIn(false);
    setLoginUsername("");
    setLoginPassword("");
    setSelectedProjectItem(null);
    setActiveProjectAgent(null);
    setView(VIEW_PORTAL);
    setPortal(null);
  }

  const [view,               setView]               = useState(VIEW_PORTAL);
  const [portal,             setPortal]             = useState(null);
  const [selectedReport,     setSelectedReport]     = useState(null);
  const [selectedReportId,   setSelectedReportId]   = useState("");
  const [selectedReportIds,  setSelectedReportIds]  = useState([]);
  const [stagedFiles,        setStagedFiles]        = useState([]);
  const [selectedAgent,      setSelectedAgent]      = useState(null);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [agentReports,       setAgentReports]        = useState(emptyAgentReportState());
  const [registryLoading, setRegistryLoading] = useState(false);
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);
  const [qaPopupOpen,        setQaPopupOpen]        = useState(false);
  const [selectedProjectItem, setSelectedProjectItem] = useState(null);
  const [activeProjectAgent, setActiveProjectAgent]   = useState(null);

  const [uploading,      setUploading]      = useState(false);
  const [processing,     setProcessing]     = useState(false);
  const [error,          setError]          = useState("");
  const [sidebarOpen,    setSidebarOpen]    = useState(true);

  function updateAgentReport(agentId, patch) {
    setAgentReports((prev) => ({
      ...prev,
      [agentId]: { ...(prev[agentId] || { content: "", preGenerated: null, preGenerating: false }), ...patch },
    }));
  }


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

  // ── Background agent report generation ──────────────────────────────
  async function generateAgentReportInBackground(reportIds, agentId, generateMessage, project) {
    updateAgentReport(agentId, { preGenerating: true, preGenerated: null });
    const agentLabel = SUB_AGENTS.find((a) => a.id === agentId)?.label || agentId;
    const idsArray = Array.isArray(reportIds) ? reportIds : [reportIds];
    try {
      const res = await fetch(CHAT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message:       generateMessage,
          question:      generateMessage,
          sessionId:     `bg-${agentId}-${Date.now()}`,
          reportId:      idsArray[0],
          reportIds:     idsArray,
          selectedAgent: agentId,
          agent:         agentId,
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
              updateAgentReport(agentId, { preGenerated: statusData });
              if (project) logProjectHistory(project, `${agentLabel} report generated.`, "agent_generated");
              return;
            }
            if (statusData.status === "failed") throw new Error(statusData.error);
          } catch {}
        }
      } else {
        updateAgentReport(agentId, { preGenerated: data });
        if (project) logProjectHistory(project, `${agentLabel} report generated.`, "agent_generated");
      }
    } catch (err) {
      console.error("BG_GENERATE_FAILED:", agentId, err.message);
      updateAgentReport(agentId, { preGenerated: null });
    } finally {
      updateAgentReport(agentId, { preGenerating: false });
    }
  }

  async function fetchReportById(reportId) {
    if (!reportId) return null;
    try {
      const res  = await fetch(`${DOCUMENTS_API}/${reportId}`);
      const data = await res.json();
      return data.report || data.document || data.item || data;
    } catch { return null; }
  }

  function startPolling(existingIds, project, staged) {
    stopPolling();
    startProgressSimulation();
    let attempts = 0;
    const expectedCount = staged.length;
    pollingRef.current = setInterval(async () => {
      attempts++;
      try {
        const res  = await fetch(`${DOCUMENTS_API}?portal=user`);
        const data = await res.json();
        const list = data.reports || data.documents || data.items || [];
        const newlyDone = list.filter((r) => {
          const id     = getReportId(r);
          const isNew  = id && !existingIds.has(id);
          const isDone = ["COMPLETED","READY"].includes(r.status || r.processingStatus);
          return isNew && isDone;
        });

        if (newlyDone.length >= expectedCount) {
          stopPolling();
          setProcessingProgress(100);
          const doneSlice = newlyDone.slice(0, expectedCount);
          const ids = doneSlice.map(getReportId);
          setTimeout(() => {
            setProcessing(false);
            setProcessingProgress(0);
            setSelectedReport(doneSlice[0]);
            setSelectedReportId(ids[0]);
            setSelectedReportIds(ids);
            setStagedFiles((prev) => prev.map((f) => ({ ...f, status: "ready" })));
            if (!project) setView(VIEW_UPLOAD);
            if (project) {
              doneSlice.forEach((r, i) => {
                const meta = staged[i] ? { name: staged[i].name, size: staged[i].size } : null;
                recordProjectFile(project.projectId, ids[i], meta, project);
              });
            }
            generateAgentReportInBackground(ids, "audit_planning_agent", AGENT_GENERATE_MESSAGES.audit_planning_agent, project);
            generateAgentReportInBackground(ids, "fs_review_agent", AGENT_GENERATE_MESSAGES.fs_review_agent, project);
          }, 800);
        }
        if (attempts >= 60) { stopPolling(); setProcessing(false); setProcessingProgress(0); }
      } catch {}
    }, 10000);
  }

  // Logs a specific, descriptive history entry for a project — tries the
  // real backend first (so it shows up for everyone, permanently), falling
  // back to the local cache if the backend isn't reachable.
  async function logProjectHistory(project, note, action = "updated") {
    if (!project?.projectId) return;
    const localEntry = { timestamp: new Date().toISOString(), action, note };
    try {
      const res = await fetch(`${API_BASE_URL}/projects/${project.projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ historyNote: note, historyAction: action }),
      });
      if (!res.ok) throw new Error("API not available");
      const data = await res.json();
      const updatedHistory = data.project?.history;
      if (updatedHistory) {
        setSelectedProjectItem((prev) =>
          prev && prev.projectId === project.projectId ? { ...prev, history: updatedHistory } : prev
        );
      }
    } catch {
      try {
        const raw = localStorage.getItem("alif_projects_v1");
        const list = raw ? JSON.parse(raw) : [];
        const updated = list.map((p) =>
          p.projectId === project.projectId ? { ...p, history: [localEntry, ...(p.history || [])] } : p
        );
        localStorage.setItem("alif_projects_v1", JSON.stringify(updated));
      } catch {}
      setSelectedProjectItem((prev) =>
        prev && prev.projectId === project.projectId
          ? { ...prev, history: [localEntry, ...(prev.history || [])] }
          : prev
      );
    }
  }

  function recordProjectFile(projectId, reportId, fileMeta, project) {
    const fileRecord = {
      fileId: reportId || `file-${Date.now()}`,
      name: fileMeta?.name || "Uploaded document",
      size: fileMeta?.size ?? null,
      uploadedAt: new Date().toISOString(),
      reportId,
    };
    try {
      const raw = localStorage.getItem("alif_projects_v1");
      const list = raw ? JSON.parse(raw) : [];
      const updated = list.map((p) =>
        p.projectId === projectId ? { ...p, files: [fileRecord, ...(p.files || [])] } : p
      );
      localStorage.setItem("alif_projects_v1", JSON.stringify(updated));
    } catch {}
    setSelectedProjectItem((prev) =>
      prev && prev.projectId === projectId
        ? { ...prev, files: [fileRecord, ...(prev.files || [])] }
        : prev
    );

    if (project) {
      logProjectHistory(project, `Uploaded document: ${fileRecord.name}`, "file_uploaded");
    }
  }

  function deleteProjectFile(project, fileId) {
    const projectId = project?.projectId;
    if (!projectId) return;

    const fileName = (project.files || []).find((f) => f.fileId === fileId)?.name || "file";

    try {
      const raw = localStorage.getItem("alif_projects_v1");
      const list = raw ? JSON.parse(raw) : [];
      const updated = list.map((p) =>
        p.projectId === projectId
          ? { ...p, files: (p.files || []).filter((f) => f.fileId !== fileId) }
          : p
      );
      localStorage.setItem("alif_projects_v1", JSON.stringify(updated));
    } catch {}
    setSelectedProjectItem((prev) =>
      prev && prev.projectId === projectId
        ? { ...prev, files: (prev.files || []).filter((f) => f.fileId !== fileId) }
        : prev
    );

    logProjectHistory(project, `Deleted document: ${fileName}`, "file_deleted");
  }

  async function handleUpload(event, project) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    try {
      setUploading(true);
      setError("");
      setAgentReports(emptyAgentReportState());
      setActiveProjectAgent(null);

      // Snapshot which reports already exist before we start, so we can
      // reliably tell which ones are newly finished processing — needed to
      // track several simultaneous uploads instead of just "the latest one".
      let existingIds = new Set();
      try {
        const snapRes  = await fetch(`${DOCUMENTS_API}?portal=user`);
        const snapData = await snapRes.json();
        const snapList = snapData.reports || snapData.documents || snapData.items || [];
        existingIds = new Set(snapList.map(getReportId).filter(Boolean));
      } catch {}

      const staged = files.map((file, i) => ({
        id: `staged-${Date.now()}-${i}`,
        name: file.name,
        size: file.size,
        status: "uploading",
      }));
      setStagedFiles(staged);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const stagedId = staged[i].id;
        try {
          const urlRes = await fetch(UPLOAD_URL_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              file_name: file.name,
              content_type: file.type || "application/pdf",
              project_id: project?.projectId || null,
              project_name: project?.projectName || null,
            }),
          });
          const urlData   = await urlRes.json();
          const uploadUrl = urlData.uploadUrl || urlData.upload_url || urlData.url || urlData.presignedUrl;
          if (!uploadUrl) throw new Error("Upload URL not returned");

          await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": file.type || "application/pdf" },
            body: file,
          });

          setStagedFiles((prev) => prev.map((f) => (f.id === stagedId ? { ...f, status: "processing" } : f)));
        } catch (fileErr) {
          setStagedFiles((prev) => prev.map((f) => (f.id === stagedId ? { ...f, status: "error" } : f)));
        }
      }

      if (fileInputRef.current)   fileInputRef.current.value   = "";
      if (sidebarFileRef.current) sidebarFileRef.current.value = "";

      setUploading(false);
      setProcessing(true);
      if (!project) setView(VIEW_UPLOAD);
      startPolling(existingIds, project, staged);
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function selectPortal(type) {
    setPortal(type);
    if (type === "audit") {
      setSelectedProjectItem(null);
      setActiveProjectAgent(null);
      setView(VIEW_PROJECTS);
    } else {
      setView(VIEW_HOME);
    }
  }

  function startNewChat() {
    if (portal === "audit") {
      setView(VIEW_PROJECTS);
      setSelectedProjectItem(null);
      setActiveProjectAgent(null);
    } else {
      setView(VIEW_HOME);
    }
    setSelectedAgent(null);
    setAgentReports(emptyAgentReportState());
    setError("");
  }

  function openAgent(agent) {
    if (!agent.available) return;
    setSelectedAgent(agent);
    updateAgentReport(agent.id, { content: "" });
    setView(VIEW_AGENT);
  }

  function handleDownloadAuditPlan() {
    const content = agentReports.audit_planning_agent?.content;
    if (!content) {
      alert("Please wait for the audit plan to generate first.");
      return;
    }
    const filename = `Audit_Plan_${getReportName(selectedReport)}_${new Date().toISOString().slice(0,10)}.txt`;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleDownloadProjectHistory(project) {
    if (!project) return;

    const historyItems = Array.isArray(project.history) ? project.history : [];
    const historyHtml = historyItems.length
      ? historyItems
          .map(
            (h) => `
              <div style="padding:10px 0;border-top:1px solid #e2e8f0;">
                <div style="font-weight:700;font-size:13px;color:#0f172a;">${escapeHtml(h.note || h.action || "")}</div>
                <div style="font-size:11px;color:#64748b;margin-top:2px;">${escapeHtml(formatDate(h.timestamp))}</div>
              </div>`
          )
          .join("")
      : `<div style="font-size:13px;color:#64748b;">No history recorded yet.</div>`;

    const container = document.createElement("div");
    container.style.width = "700px";
    container.style.padding = "8px";
    container.style.fontFamily = "Arial, Helvetica, sans-serif";
    container.style.color = "#0f172a";

    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;">
        <div style="width:34px;height:34px;border-radius:8px;background:linear-gradient(135deg,#1a56db,#06b6d4);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;">AT</div>
        <div style="font-weight:800;font-size:15px;">Alif Technologies — Project History</div>
      </div>

      <div style="border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;margin-bottom:22px;">
        <div style="background:linear-gradient(135deg,#0f2744,#1e3a5f);padding:20px 24px;color:#fff;">
          <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;">Project Overview</div>
          <div style="font-size:19px;font-weight:800;">${escapeHtml(project.projectName || "")}</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:6px;">🏢 ${escapeHtml(getLegalName(project))}</div>
        </div>
        <div style="padding:20px 24px;background:#fff;">
          <table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:14px;">
            <tr><td style="padding:5px 0;color:#64748b;width:180px;">Status</td><td style="padding:5px 0;font-weight:700;">${escapeHtml(project.status || "Active")}</td></tr>
            <tr><td style="padding:5px 0;color:#64748b;">Created</td><td style="padding:5px 0;font-weight:700;">${escapeHtml(formatDate(project.createdAt))}</td></tr>
            ${project.auditPeriodStart || project.auditPeriodEnd ? `<tr><td style="padding:5px 0;color:#64748b;">Audited Period</td><td style="padding:5px 0;font-weight:700;">${escapeHtml(formatDateOnly(project.auditPeriodStart))} – ${escapeHtml(formatDateOnly(project.auditPeriodEnd))}</td></tr>` : ""}
            ${project.entityType ? `<tr><td style="padding:5px 0;color:#64748b;">Entity Type</td><td style="padding:5px 0;font-weight:700;">${escapeHtml(project.entityType)}</td></tr>` : ""}
            ${project.incorporationDate ? `<tr><td style="padding:5px 0;color:#64748b;">Incorporation Date</td><td style="padding:5px 0;font-weight:700;">${escapeHtml(formatDateOnly(project.incorporationDate))}</td></tr>` : ""}
            ${project.cin ? `<tr><td style="padding:5px 0;color:#64748b;">CIN</td><td style="padding:5px 0;font-weight:700;">${escapeHtml(project.cin)}</td></tr>` : ""}
            ${project.taxRegistrationNumber ? `<tr><td style="padding:5px 0;color:#64748b;">Tax Registration No.</td><td style="padding:5px 0;font-weight:700;">${escapeHtml(project.taxRegistrationNumber)}</td></tr>` : ""}
            ${project.registeredAddress ? `<tr><td style="padding:5px 0;color:#64748b;vertical-align:top;">Registered Address</td><td style="padding:5px 0;font-weight:700;">${escapeHtml(project.registeredAddress)}</td></tr>` : ""}
            ${project.subsidiaries ? `<tr><td style="padding:5px 0;color:#64748b;vertical-align:top;">Subsidiaries / Branches</td><td style="padding:5px 0;font-weight:700;">${escapeHtml(project.subsidiaries)}</td></tr>` : ""}
            ${project.ceo ? `<tr><td style="padding:5px 0;color:#64748b;">CEO</td><td style="padding:5px 0;font-weight:700;">${escapeHtml(project.ceo)}</td></tr>` : ""}
            ${project.contactNumber ? `<tr><td style="padding:5px 0;color:#64748b;">Contact Number</td><td style="padding:5px 0;font-weight:700;">${escapeHtml(project.contactNumber)}</td></tr>` : ""}
            ${project.principalContact ? `<tr><td style="padding:5px 0;color:#64748b;">Principal Contact</td><td style="padding:5px 0;font-weight:700;">${escapeHtml(project.principalContact)}</td></tr>` : ""}
          </table>
          ${
            project.projectDescription
              ? `<div style="margin-bottom:14px;"><div style="font-size:11px;font-weight:800;color:#1a56db;text-transform:uppercase;margin-bottom:4px;">Project Description</div><div style="font-size:13px;line-height:1.6;">${escapeHtml(project.projectDescription)}</div></div>`
              : ""
          }
          ${
            project.auditDescription
              ? `<div><div style="font-size:11px;font-weight:800;color:#1a56db;text-transform:uppercase;margin-bottom:4px;">Audit Description</div><div style="font-size:13px;line-height:1.6;">${escapeHtml(project.auditDescription)}</div></div>`
              : ""
          }
        </div>
      </div>

      <div style="font-size:14px;font-weight:800;margin-bottom:8px;">Project History</div>
      <div style="border:1px solid #e2e8f0;border-radius:12px;padding:0 20px;background:#fff;">
        ${historyHtml}
      </div>
    `;

    document.body.appendChild(container);

    try {
      const { default: html2pdf } = await import("html2pdf.js");
      await html2pdf()
        .set({
          margin: 10,
          filename: `${(project.projectName || "Project").replace(/[^a-z0-9]+/gi, "_")}_History.pdf`,
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .from(container)
        .save();
    } finally {
      document.body.removeChild(container);
    }
  }

  useEffect(() => { return () => stopPolling(); }, []);

  // ── Refresh this project's own history (Project History page) ───────
  useEffect(() => {
    if (view !== VIEW_PROJECT_HISTORY || !selectedProjectItem?.projectId) return;
    const projectId = selectedProjectItem.projectId;
    let cancelled = false;
    (async () => {
      setRegistryLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/projects/${projectId}`);
        if (!res.ok) throw new Error("API not available");
        const data = await res.json();
        if (!cancelled && data.project) {
          setSelectedProjectItem((prev) =>
            prev && prev.projectId === projectId ? { ...prev, ...data.project } : prev
          );
        }
      } catch {
        // Backend not reachable — keep whatever's already loaded locally
        // (created/updated entries logged so far still show).
      } finally {
        if (!cancelled) setRegistryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [view, historyRefreshToken, selectedProjectItem?.projectId]);

  // ── LOGIN GATE ────────────────────────────────────────────────────────
  if (!isLoggedIn) {
    return (
      <div className="login-screen">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="login-logo">AT</div>
          <h1 className="login-title">Alif Technologies</h1>
          <p className="login-sub">Sign in to continue</p>

          {loginError && <div className="login-error">⚠️ {loginError}</div>}

          <div className="login-field">
            <label>Username</label>
            <input
              type="text"
              autoFocus
              value={loginUsername}
              onChange={(e) => setLoginUsername(e.target.value)}
            />
          </div>

          <div className="login-field">
            <label>Password</label>
            <input
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
            />
          </div>

          <button type="submit" className="login-submit">Sign In</button>
        </form>
      </div>
    );
  }

  // ── PORTAL SELECTION ─────────────────────────────────────────────────
  if (view === VIEW_PORTAL) {
    return (
      <div className="portal-screen">
        <div className="portal-hero">
          <div className="portal-logo">AT</div>
          <h1 className="portal-title">Alif Technologies</h1>
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
          <button className="portal-card audit-portal" onClick={() => selectPortal("audit")}>
            <div className="portal-card-icon"><AuditShieldIcon size={28} /></div>
            <div className="portal-card-body">
              <div className="portal-card-title">Audit Portal</div>
              <div className="portal-card-desc">
                Organize your work by project. Create or open a project, then upload
                documents and run agents scoped to that project.
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
          <div className={`brand-logo-circle ${portal === "audit" ? "brand-logo-audit" : ""}`}>
            {portal === "audit" ? <AuditShieldIcon size={20} /> : "AT"}
          </div>
          <div className="brand-text">
            <span className="brand-name">Alif Technologies</span>
            <span className="brand-sub">
              {portal === "audit" ? "Audit Portal" : "User Portal"}
            </span>
          </div>
          <button className="sidebar-toggle" onClick={() => setSidebarOpen((o) => !o)}>◀</button>
        </div>

        {(portal === "audit" || portal === "user") && (
          <div className="demo-user-switcher">
            <span className="demo-user-icon">👤</span>
            <span className="demo-user-name">{DEMO_LOGIN.displayName}</span>
            <button className="demo-user-logout" onClick={handleLogout}>Log out</button>
          </div>
        )}

        {portal !== "audit" && (
          <button className="new-chat-btn" onClick={startNewChat}>
            <span className="new-chat-icon">＋</span>
            <span className="new-chat-label">New Chat</span>
          </button>
        )}

        {portal === "user" && (
          <label className="sidebar-upload-btn" title="Add file(s)">
            <input ref={sidebarFileRef} type="file"
              accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg" multiple
              onChange={handleUpload} disabled={uploading || processing} />
            <span className="sidebar-upload-icon">＋</span>
            <span className="sidebar-upload-label">
              {uploading ? "Uploading…" : processing ? "Processing…" : "Add files"}
            </span>
          </label>
        )}

        <button
          className={`sidebar-projects-btn ${view === VIEW_PROJECTS ? "sidebar-projects-active" : ""}`}
          onClick={() => setView(VIEW_PROJECTS)}
        >
          <span className="sidebar-projects-icon">📁</span>
          <span className="sidebar-projects-label">Projects</span>
        </button>

        {portal === "user" && selectedReportId && (
          <div className="sidebar-section sidebar-project-agents">
            <div className="sidebar-section-title">Your Document</div>

            <button
              className={`sidebar-agent-btn ${view === VIEW_MASTER_AGENT ? "sidebar-agent-active" : ""}`}
              onClick={() => setView(VIEW_MASTER_AGENT)}
            >
              <span className="sidebar-agent-icon">🧠</span>
              <span className="sidebar-agent-label">Master Agent</span>
              {(agentReports.audit_planning_agent?.preGenerating || agentReports.fs_review_agent?.preGenerating) && (
                <span className="sidebar-agent-status status-generating">Preparing</span>
              )}
              {!(agentReports.audit_planning_agent?.preGenerating || agentReports.fs_review_agent?.preGenerating) &&
                agentReports.audit_planning_agent?.preGenerated && agentReports.fs_review_agent?.preGenerated && (
                <span className="sidebar-agent-status status-ready">Ready</span>
              )}
            </button>

            {SUB_AGENTS.map((agent) => (
              <button
                key={agent.id}
                className={`sidebar-agent-btn ${selectedAgent?.id === agent.id && view === VIEW_AGENT ? "sidebar-agent-active" : ""} ${!agent.available ? "sidebar-agent-disabled" : ""}`}
                disabled={!agent.available}
                onClick={() => openAgent(agent)}
              >
                <span className="sidebar-agent-icon">{agent.icon}</span>
                <span className="sidebar-agent-label">{agent.label}</span>
                {agent.available ? (
                  <>
                    {agentReports[agent.id]?.preGenerating && (
                      <span className="sidebar-agent-status status-generating">Preparing</span>
                    )}
                    {!agentReports[agent.id]?.preGenerating && agentReports[agent.id]?.preGenerated && (
                      <span className="sidebar-agent-status status-ready">Ready</span>
                    )}
                  </>
                ) : (
                  <span className="sidebar-agent-status status-soon">Soon</span>
                )}
              </button>
            ))}
          </div>
        )}

        {selectedProjectItem && (
          <div className="sidebar-section sidebar-project-agents">
            <div className="sidebar-section-title">{selectedProjectItem.projectName}</div>

            <button
              className={`sidebar-agent-btn ${view === VIEW_PROJECT_DASHBOARD ? "sidebar-agent-active" : ""}`}
              onClick={() => setView(VIEW_PROJECT_DASHBOARD)}
            >
              <span className="sidebar-agent-icon">📊</span>
              <span className="sidebar-agent-label">Project Dashboard</span>
            </button>

            <button
              className={`sidebar-agent-btn ${view === VIEW_PROJECT_HISTORY ? "sidebar-agent-active" : ""}`}
              onClick={() => { setHistoryRefreshToken((t) => t + 1); setView(VIEW_PROJECT_HISTORY); }}
            >
              <span className="sidebar-agent-icon">🕘</span>
              <span className="sidebar-agent-label">Project History</span>
            </button>

            <button
              className={`sidebar-agent-btn ${view === VIEW_PROJECT_FILES ? "sidebar-agent-active" : ""}`}
              onClick={() => setView(VIEW_PROJECT_FILES)}
            >
              <span className="sidebar-agent-icon">📁</span>
              <span className="sidebar-agent-label">Files &amp; Assets</span>
            </button>

            {selectedReportId && (
              <button
                className={`sidebar-agent-btn ${view === VIEW_MASTER_AGENT ? "sidebar-agent-active" : ""}`}
                onClick={() => setView(VIEW_MASTER_AGENT)}
              >
                <span className="sidebar-agent-icon">🧠</span>
                <span className="sidebar-agent-label">Master Agent</span>
                {(agentReports.audit_planning_agent?.preGenerating || agentReports.fs_review_agent?.preGenerating) && (
                  <span className="sidebar-agent-status status-generating">Preparing</span>
                )}
                {!(agentReports.audit_planning_agent?.preGenerating || agentReports.fs_review_agent?.preGenerating) &&
                  agentReports.audit_planning_agent?.preGenerated && agentReports.fs_review_agent?.preGenerated && (
                  <span className="sidebar-agent-status status-ready">Ready</span>
                )}
              </button>
            )}

            {selectedReportId && SUB_AGENTS.map((agent) => (
              <button
                key={agent.id}
                className={`sidebar-agent-btn ${activeProjectAgent === agent.id ? "sidebar-agent-active" : ""} ${!agent.available ? "sidebar-agent-disabled" : ""}`}
                disabled={!agent.available}
                onClick={() => {
                  if (!agent.available) return;
                  setActiveProjectAgent(agent.id);
                  setSelectedAgent(agent);
                  updateAgentReport(agent.id, { content: "" });
                  setView(VIEW_AGENT);
                }}
              >
                <span className="sidebar-agent-icon">{agent.icon}</span>
                <span className="sidebar-agent-label">{agent.label}</span>
                {agent.available ? (
                  <>
                    {agentReports[agent.id]?.preGenerating && (
                      <span className="sidebar-agent-status status-generating">Preparing</span>
                    )}
                    {!agentReports[agent.id]?.preGenerating && agentReports[agent.id]?.preGenerated && (
                      <span className="sidebar-agent-status status-ready">Ready</span>
                    )}
                  </>
                ) : (
                  <span className="sidebar-agent-status status-soon">Soon</span>
                )}
              </button>
            ))}
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
              {view === VIEW_UPLOAD       && "Report Analysis"}
              {view === VIEW_AGENT        && (selectedAgent?.label || "Audit Planning Agent")}
              {view === VIEW_PROJECTS     && "Projects"}
              {view === VIEW_MASTER_AGENT && "Master Agent"}
              {view === VIEW_PROJECT_DETAIL && (selectedProjectItem?.projectName || "Project")}
              {view === VIEW_PROJECT_DASHBOARD && `${selectedProjectItem?.projectName || "Project"} — Dashboard`}
              {view === VIEW_PROJECT_HISTORY && `${selectedProjectItem?.projectName || "Project"} — History`}
              {view === VIEW_PROJECT_FILES && `${selectedProjectItem?.projectName || "Project"} — Files & Assets`}
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
              <h1 className="home-hero-title">Alif Technologies</h1>
              <p className="home-hero-sub">FMS AI AgentCore — Enterprise Audit Intelligence Platform</p>
              <div className="portal-badge">👤 User Portal</div>
            </div>
            <p className="home-prompt">What would you like to do today?</p>
            <div className="home-options">
              <label className="home-option-card upload-card">
                <input ref={fileInputRef} type="file"
                  accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg" multiple
                  onChange={handleUpload} disabled={uploading || processing} />
                <div className="option-icon"><UploadBoxIcon /></div>
                <div className="option-body">
                  <div className="option-title">Upload a Financial Document</div>
                  <div className="option-desc">
                    Upload a financial statement. The AI agents will automatically
                    generate audit planning, risk assessments, and recommendations.
                  </div>
                </div>
                <div className="option-arrow">→</div>
              </label>
            </div>
            {uploading && <div className="home-status">⬆️ Uploading your document…</div>}
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
                  {!agent.available && (
                    <div className="sub-agent-soon">Coming Soon</div>
                  )}
                </button>
              ))}
            </div>

            <label className="upload-another-btn">
              <input ref={fileInputRef} type="file"
                accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg" multiple
                onChange={handleUpload} disabled={uploading || processing} />
              {uploading ? "Uploading…" : processing ? "Processing…" : "⬆ Upload Another Document"}
            </label>
          </div>
        )}

        {/* MASTER AGENT */}
        {view === VIEW_MASTER_AGENT && (
          <div className="chatbot-view">
            <div className="chatbot-nav-bar">
              <button className="back-nav-btn"
                onClick={() => setView(selectedProjectItem ? VIEW_PROJECT_DETAIL : VIEW_HOME)}>
                {selectedProjectItem ? "← Back to Project" : "← Back"}
              </button>
            </div>
            {selectedReportId ? (
              <MasterAgentOverview
                agentReports={agentReports}
                reportName={selectedReport ? getReportName(selectedReport) : ""}
                onViewDetails={(agentId) => {
                  const agent = SUB_AGENTS.find((a) => a.id === agentId);
                  if (agent) openAgent(agent);
                }}
              />
            ) : (
              <div className="master-overview">
                <p className="master-overview-desc">
                  No document selected yet. Upload or select a document
                  {selectedProjectItem ? " for this project" : ""} to see a summary
                  from both specialist agents here.
                </p>
              </div>
            )}
          </div>
        )}

        {/* AUDIT AGENT */}
        {view === VIEW_AGENT && (
          <div className="chatbot-view">
            <div className="chatbot-nav-bar">
              <button className="back-nav-btn"
                onClick={() => setView(selectedProjectItem ? VIEW_PROJECT_DETAIL : VIEW_UPLOAD)}>
                {selectedProjectItem ? "← Back to Project" : "← Back to Report Analysis"}
              </button>
            </div>
            <Chatbot
              reportId={selectedReportId}
              reportIds={selectedReportIds}
              selectedReport={selectedReport}
              agentId={selectedAgent?.id || "audit_planning_agent"}
              agentLabel={selectedAgent?.label || "Audit Planning Agent"}
              generateMessage={AGENT_GENERATE_MESSAGES[selectedAgent?.id] || "Generate audit planning."}
              preGeneratedReport={agentReports[selectedAgent?.id || "audit_planning_agent"]?.preGenerated}
              preGenerating={agentReports[selectedAgent?.id || "audit_planning_agent"]?.preGenerating}
              onReportGenerated={(content) => updateAgentReport(selectedAgent?.id || "audit_planning_agent", { content })}
            />
          </div>
        )}

        {/* PROJECTS */}
        {view === VIEW_PROJECTS && (
          <div className="chatbot-view">
            <div className="chatbot-nav-bar">
              <button className="back-nav-btn"
                onClick={() => {
                  if (portal === "audit") { setView(VIEW_PORTAL); setPortal(null); }
                  else setView(VIEW_HOME);
                }}>
                ← Back
              </button>
            </div>
            <Projects
              currentUserId={DEMO_LOGIN.userId}
              currentUserName={DEMO_LOGIN.displayName}
              onOpenProject={(project) => {
                setSelectedProjectItem(project);
                setActiveProjectAgent(null);
                // Restore this project's most recent document + agent state
                // (if any) instead of always resetting to empty — otherwise
                // reopening a project that already has files makes both the
                // Master Agent and sub-agents disappear from the sidebar
                // even though there's a perfectly good document to show.
                const files = project.files || [];
                if (files.length > 0 && files[0].reportId) {
                  const latestId = files[0].reportId;
                  setSelectedReportId(latestId);
                  setSelectedReportIds([latestId]);
                  setAgentReports(emptyAgentReportState());
                  fetchReportById(latestId).then((full) => {
                    if (full) setSelectedReport(full);
                  });
                } else {
                  setSelectedReport(null);
                  setSelectedReportId("");
                  setSelectedReportIds([]);
                  setAgentReports(emptyAgentReportState());
                }
                setView(VIEW_PROJECT_DETAIL);
              }}
            />
          </div>
        )}

        {/* PROJECT DETAIL */}
        {view === VIEW_PROJECT_DETAIL && selectedProjectItem && (
          <div className="chatbot-view">
            <div className="chatbot-nav-bar">
              <button className="back-nav-btn" onClick={() => setView(VIEW_PROJECTS)}>
                ← Back to Projects
              </button>
            </div>

            <div className="pd-view">
              {/* Unified project card */}
              <div className="pd-card">
                <div className="pd-card-header">
                  <svg className="pd-header-watermark" width="180" height="90" viewBox="0 0 180 90" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="18" y="46" width="14" height="30" rx="3" fill="#06b6d4" />
                    <rect x="40" y="30" width="14" height="46" rx="3" fill="#1a56db" />
                    <rect x="62" y="14" width="14" height="62" rx="3" fill="#06b6d4" />
                    <rect x="84" y="0"  width="14" height="76" rx="3" fill="#1a56db" />
                    <polyline points="25,46 47,30 69,14 91,0" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    <circle cx="25" cy="46" r="4" fill="#f59e0b" />
                    <circle cx="47" cy="30" r="4" fill="#f59e0b" />
                    <circle cx="69" cy="14" r="4" fill="#f59e0b" />
                    <circle cx="91" cy="0"  r="4" fill="#f59e0b" />
                  </svg>
                  <div className="pd-hero-icon">📄</div>
                  <div className="pd-hero-text">
                    <div className="pd-hero-eyebrow">Project Overview</div>
                    <div className="pd-hero-name">{selectedProjectItem.projectName}</div>
                    <div className="pd-hero-audit">
                      <span className="pd-avatar">{getInitials(getLegalName(selectedProjectItem))}</span>
                      <span className="pd-audit-sep">·</span>
                      <span>{getLegalName(selectedProjectItem)}</span>
                      {(selectedProjectItem.auditPeriodStart || selectedProjectItem.auditPeriodEnd) && (
                        <>
                          <span className="pd-audit-sep">·</span>
                          <span>
                            📅 {formatDateOnly(selectedProjectItem.auditPeriodStart)} – {formatDateOnly(selectedProjectItem.auditPeriodEnd)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className={`pd-status pd-status-${(selectedProjectItem.status || "active").toLowerCase()}`}>
                    ● {selectedProjectItem.status || "Active"}
                  </span>
                </div>

                <div className="pd-card-body">
                  <ProjectDetailRows project={selectedProjectItem} />

                  <div className="pd-meta">
                    <span className="pd-meta-icon">🕒</span> Created {formatDate(selectedProjectItem.createdAt)}
                  </div>
                </div>
              </div>

              <button className="pd-files-link" onClick={() => setView(VIEW_PROJECT_FILES)}>
                <div className="pd-files-link-icon"><UploadBoxIcon size={22} /></div>
                <div className="pd-files-link-text">
                  <div className="pd-files-link-title">Files &amp; Assets</div>
                  <div className="pd-files-link-sub">Upload and manage documents for this project</div>
                </div>
                <span className="pd-files-link-arrow">→</span>
              </button>
            </div>
          </div>
        )}

        {/* PROJECT DASHBOARD */}
        {view === VIEW_PROJECT_DASHBOARD && selectedProjectItem && (
          <div className="chatbot-view">
            <div className="chatbot-nav-bar">
              <button className="back-nav-btn" onClick={() => setView(VIEW_PROJECT_DETAIL)}>
                ← Back to Project
              </button>
            </div>
            <ProjectDashboard
              project={selectedProjectItem}
              reportMarkdown={[agentReports.audit_planning_agent?.content, agentReports.fs_review_agent?.content]
                .filter(Boolean)
                .join("\n\n---\n\n")}
              onUpdateProject={(updates) =>
                setSelectedProjectItem((prev) => ({ ...prev, ...updates }))
              }
            />
          </div>
        )}

        {/* PROJECT HISTORY */}
        {view === VIEW_PROJECT_HISTORY && selectedProjectItem && (
          <div className="chatbot-view">
            <div className="chatbot-nav-bar chatbot-nav-bar-split">
              <button className="back-nav-btn" onClick={() => setView(VIEW_PROJECT_DETAIL)}>
                ← Back to Project
              </button>
              <button
                className="download-history-btn"
                onClick={() => handleDownloadProjectHistory(selectedProjectItem)}
              >
                ⬇ Download PDF
              </button>
            </div>

            <div className="pd-view">
              <div className="pf-header">
                <div className="pf-title">Project History</div>
                <div className="pf-subtitle">
                  Every action performed on <strong>{selectedProjectItem.projectName}</strong>.
                </div>
              </div>

              {registryLoading && <p className="pdb-card-empty">Loading history…</p>}

              {!registryLoading && (() => {
                const history = selectedProjectItem.history || [];

                if (history.length === 0) {
                  return <p className="pdb-card-empty">No history recorded yet.</p>;
                }

                return (
                  <div className="pd-history-card">
                    <div className="chrome-history">
                      {groupHistoryByDate(history).map((group) => (
                        <div className="chrome-history-group" key={group.dateObj.toISOString()}>
                          <div className="chrome-history-date">{group.label}</div>
                          <ul className="chrome-history-list">
                            {group.entries.map((h, i) => (
                              <li className="chrome-history-row" key={i}>
                                <span className="chrome-history-time">{formatTimeOnly(h.timestamp)}</span>
                                <span className="chrome-history-dot" />
                                <span className="chrome-history-text">{h.note || h.action}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* PROJECT FILES & ASSETS */}
        {view === VIEW_PROJECT_FILES && selectedProjectItem && (
          <div className="chatbot-view">
            <div className="chatbot-nav-bar">
              <button className="back-nav-btn" onClick={() => setView(VIEW_PROJECT_DETAIL)}>
                ← Back to Project
              </button>
            </div>

            <div className="pd-view">
              <div className="pf-header">
                <div className="pf-title">Files and Assets</div>
                <div className="pf-subtitle">Documents and attachments that have been uploaded as part of this project.</div>
              </div>

              <label className="pf-dropzone">
                <input type="file"
                  accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg" multiple
                  onChange={(e) => handleUpload(e, selectedProjectItem)}
                  disabled={uploading || processing} />
                <UploadBoxIcon size={30} />
                <div className="pf-dropzone-title">
                  {uploading ? "Uploading…" : processing ? "Processing…" : "Click to upload or drag and drop"}
                </div>
                <div className="pf-dropzone-sub">PDF, DOC, PNG, JPG — select multiple files at once (max 20MB each)</div>
              </label>

              {stagedFiles.length > 0 && (uploading || processing) && (
                <div className="pf-staged-list">
                  {stagedFiles.map((f) => (
                    <div className="pf-staged-item" key={f.id}>
                      <span className="pf-staged-icon">📄</span>
                      <span className="pf-staged-name">{f.name}</span>
                      <span className={`pf-staged-status pf-staged-${f.status}`}>
                        {f.status === "uploading" && "Uploading…"}
                        {f.status === "processing" && "Processing…"}
                        {f.status === "ready" && "✅ Ready"}
                        {f.status === "error" && "⚠️ Failed"}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="pf-files-section">
                <div className="pd-section-heading">Attached Files</div>

                {(!selectedProjectItem.files || selectedProjectItem.files.length === 0) ? (
                  <p className="pdb-card-empty">No files uploaded yet.</p>
                ) : (
                  <div className="pf-table">
                    <div className="pf-table-header">
                      <div>File Name</div>
                      <div>Size</div>
                      <div>Uploaded</div>
                      <div></div>
                    </div>
                    {selectedProjectItem.files.map((f) => (
                      <div className="pf-table-row" key={f.fileId}>
                        <div className="pf-file-name">📄 {f.name}</div>
                        <div className="pf-file-size">{formatFileSize(f.size)}</div>
                        <div className="pf-file-date">{formatDate(f.uploadedAt)}</div>
                        <div className="pf-file-actions">
                          <button
                            className="pf-delete-btn"
                            onClick={() => deleteProjectFile(selectedProjectItem, f.fileId)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </main>

      {/* FLOATING AI ASSISTANT CHAT LAUNCHER */}
      {!qaPopupOpen && (
        <button
          className="qa-fab"
          onClick={() => setQaPopupOpen(true)}
          aria-label="Open AI Assistant"
        >
          <img src="/ai-assistant-avatar.png" alt="AI Assistant" className="qa-fab-img" />
        </button>
      )}

      {/* SIDE-DOCKED GENERAL Q&A CHAT PANEL */}
      {qaPopupOpen && (
        <div className="qa-side-panel">
          <div className="qa-popup-header">
            <div className="qa-popup-title">
              <img src="/ai-assistant-avatar.png" alt="AI Assistant" className="qa-popup-icon-img" />
              <span>AI Assistant</span>
            </div>
            <button className="qa-popup-close" onClick={() => setQaPopupOpen(false)}>✕</button>
          </div>
          <div className="qa-popup-body">
            <Chatbot reportId={null} selectedReport={null} generalMode />
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
