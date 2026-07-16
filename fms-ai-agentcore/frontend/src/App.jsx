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
const VIEW_MANAGER_CHAT = "manager_chat";
const VIEW_MANAGER_HOME = "manager_home";
const VIEW_PROJECTS     = "projects";
const VIEW_PROJECT_DETAIL = "project_detail";
const VIEW_PROJECT_DASHBOARD = "project_dashboard";
const VIEW_PROJECT_HISTORY = "project_history";
const VIEW_PROJECT_FILES = "project_files";
const VIEW_MASTER_AGENT = "master_agent";

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
    audit_planning_agent: { content: "", preGenerated: null, preGenerating: false, reportId: null },
    fs_review_agent:      { content: "", preGenerated: null, preGenerating: false, reportId: null },
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
function getExtractedText(r)  { return r?.extractedText || r?.documentText || r?.extracted_text || r?.document_text || r?.sourceTextPreview || ""; }
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

// ─── "+" badge shown on every upload control, signaling multi-file support ──
function MultiUploadBadge() {
  return <span className="multi-upload-badge">＋</span>;
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
                    : "Select a document to generate this agent's report and see a summary here."}
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
  // Tracks selectedReportId in a ref (in addition to state) so background
  // async work (report generation that may finish long after the user has
  // clicked to a DIFFERENT document) can check "is my result still for the
  // document currently on screen?" without capturing a stale value from
  // the render it was created in.
  const selectedReportIdRef = useRef("");

  const [view,               setView]               = useState(VIEW_PORTAL);
  const [portal,             setPortal]             = useState(null);
  const [reports,            setReports]            = useState([]);
  const [selectedReport,     setSelectedReport]     = useState(null);
  const [selectedReportId,   setSelectedReportId]   = useState("");
  const [selectedAgent,      setSelectedAgent]      = useState(null);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [agentReports,       setAgentReports]        = useState(emptyAgentReportState());
  // Per-document cache: { [reportId]: emptyAgentReportState()-shaped object }.
  // This is what lets uploading abc.pdf + xyz.pdf (or more) produce
  // genuinely separate Master Agent / Audit Planning / FS Review results
  // instead of one shared slot that the last-generated document overwrites.
  const [agentReportsByDoc,  setAgentReportsByDoc]  = useState({});
  // Which uploaded files currently have their sidebar dropdown expanded.
  const [expandedFileIds,    setExpandedFileIds]    = useState(() => new Set());
  const [qaPopupOpen,        setQaPopupOpen]        = useState(false);
  const [selectedProjectItem, setSelectedProjectItem] = useState(null);
  const [activeProjectAgent, setActiveProjectAgent]   = useState(null);

  const [loadingReports, setLoadingReports] = useState(false);
  const [uploading,      setUploading]      = useState(false);
  const [processing,     setProcessing]     = useState(false);
  const [error,          setError]          = useState("");
  const [sidebarOpen,    setSidebarOpen]    = useState(true);

  useEffect(() => { selectedReportIdRef.current = selectedReportId; }, [selectedReportId]);

  // Patches a single agent's live state (used by openAgent / the Chatbot's
  // onReportGenerated follow-up-chat callback). Also mirrors the patch
  // into the per-document cache for whichever document is currently
  // selected, so a follow-up question answered inside the Audit Planning
  // chat doesn't silently fall out of sync with what the sidebar dropdown
  // would restore later.
  function updateAgentReport(agentId, patch) {
    setAgentReports((prev) => {
      const updated = {
        ...prev,
        [agentId]: { ...(prev[agentId] || { content: "", preGenerated: null, preGenerating: false, reportId: null }), ...patch },
      };
      const docId = selectedReportIdRef.current;
      if (docId) {
        setAgentReportsByDoc((prevByDoc) => ({ ...prevByDoc, [docId]: updated }));
      }
      return updated;
    });
  }

  // Writes a patch for a specific (docId, agentId) into the per-document
  // cache, and — only if that document is the one currently on screen —
  // also mirrors the same patch into the live `agentReports` state that
  // the sidebar / Master Agent view / Chatbot actually render from.
  function updateDocAgentReport(docId, agentId, patch) {
    setAgentReportsByDoc((prev) => {
      const existingDoc   = prev[docId] || emptyAgentReportState();
      const existingAgent = existingDoc[agentId] || { content: "", preGenerated: null, preGenerating: false, reportId: docId };
      const updatedDoc    = { ...existingDoc, [agentId]: { ...existingAgent, ...patch, reportId: docId } };
      const updatedByDoc  = { ...prev, [docId]: updatedDoc };
      if (selectedReportIdRef.current === docId) {
        setAgentReports(updatedDoc);
      }
      return updatedByDoc;
    });
  }

  // ── Real back-navigation history ─────────────────────────────────────
  // Every "forward" navigation (opening a project, an agent, a document,
  // etc.) pushes the CURRENT view onto this stack via navigateTo(). Every
  // "Back" button pops the stack via goBack(fallback), so it always
  // returns to whatever screen was actually open before — not a
  // hardcoded destination. Portal switches / "New Chat" resets clear the
  // stack entirely, since those represent starting a fresh session.
  const historyStackRef = useRef([]);

  function navigateTo(nextView) {
    historyStackRef.current.push(view);
    setView(nextView);
  }

  function goBack(fallback) {
    const stack = historyStackRef.current;
    const target = stack.length > 0 ? stack.pop() : fallback;
    setView(target);
    return target;
  }

  function resetHistory() {
    historyStackRef.current = [];
  }

  // Persist the currently-active document's agent reports into the
  // OWNING project's localStorage record, per document, whenever either
  // changes. Uses a reverse lookup (reportId -> project) rather than
  // trusting whichever project happens to be selected right now, so a
  // background generation that finishes after the user has already
  // switched projects still gets saved against the correct project.
  useEffect(() => {
    if (!selectedReportId) return;
    const projectId = selectedProjectItem?.projectId || findProjectIdForReport(selectedReportId);
    if (!projectId) return;
    persistDocAgentCache(projectId, selectedReportId, selectedReport, agentReports);
  }, [agentReports, selectedReportId, selectedReport, selectedProjectItem]);


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

  // ── Background agent report generation (per document) ───────────────
  // Each uploaded document's Master Agent / Audit Planning / FS Review
  // results are generated and cached completely independently, keyed by
  // reportId — uploading abc.pdf and xyz.pdf never mixes their content.
  async function generateAgentReportInBackground(reportId, agentId, generateMessage) {
    updateDocAgentReport(reportId, agentId, { preGenerating: true, preGenerated: null });
    try {
      const res = await fetch(CHAT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message:       generateMessage,
          question:      generateMessage,
          sessionId:     `bg-${agentId}-${Date.now()}`,
          reportId,
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
              updateDocAgentReport(reportId, agentId, { preGenerated: statusData });
              return;
            }
            if (statusData.status === "failed") throw new Error(statusData.error);
          } catch {}
        }
      } else {
        updateDocAgentReport(reportId, agentId, { preGenerated: data });
      }
    } catch (err) {
      console.error("BG_GENERATE_FAILED:", agentId, err.message);
      updateDocAgentReport(reportId, agentId, { preGenerated: null });
    } finally {
      updateDocAgentReport(reportId, agentId, { preGenerating: false });
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

  // Resolves once a NEW completed document appears (i.e. one whose id
  // differs from previousId). Promise-based (rather than the old
  // interval-with-side-effects version) so multiple files can be
  // uploaded one after another, each fully processed before the next
  // one starts.
  function waitForNewDocument(previousId) {
    return new Promise((resolve, reject) => {
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
              setProcessingProgress(0);
              resolve({ latest, latestId, list });
            }, 800);
          }
          if (attempts >= 60) {
            stopPolling();
            setProcessingProgress(0);
            reject(new Error(`Timed out waiting for "${previousId ? "next" : "first"}" document to finish processing.`));
          }
        } catch {
          // transient network hiccup — keep polling
        }
      }, 10000);
    });
  }

  function recordProjectFile(projectId, reportId, fileMeta) {
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
  }

  function deleteProjectFile(projectId, fileId) {
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
  }

  // ── Per-document agent report cache (per project) ────────────────────
  // Generated reports previously lived ONLY in React state and were keyed
  // per-agent, not per-document — so uploading a second file overwrote
  // the first file's results, and leaving a project reset everything back
  // to empty. These helpers persist EVERY document's agentReports
  // snapshot into the project's localStorage record, keyed by reportId,
  // so: 1) each uploaded document keeps fully independent results, and
  // 2) reopening a project restores results for every document, not just
  // whichever one was open last.

  function loadDocAgentCache(projectId, reportId) {
    try {
      const raw = localStorage.getItem("alif_projects_v1");
      const list = raw ? JSON.parse(raw) : [];
      const proj = list.find((p) => p.projectId === projectId);
      return proj?.agentCachesByDoc?.[reportId] || null;
    } catch { return null; }
  }

  function persistDocAgentCache(projectId, reportId, report, agentReportsForDoc) {
    if (!projectId || !reportId) return;
    try {
      const raw = localStorage.getItem("alif_projects_v1");
      const list = raw ? JSON.parse(raw) : [];
      const updated = list.map((p) => {
        if (p.projectId !== projectId) return p;
        const existingMap = p.agentCachesByDoc || {};
        return {
          ...p,
          agentCachesByDoc: {
            ...existingMap,
            [reportId]: { report, agentReports: agentReportsForDoc },
          },
        };
      });
      localStorage.setItem("alif_projects_v1", JSON.stringify(updated));
    } catch {}
  }

  function findProjectIdForReport(reportId) {
    if (!reportId) return null;
    try {
      const raw = localStorage.getItem("alif_projects_v1");
      const list = raw ? JSON.parse(raw) : [];
      const proj = list.find((p) => (p.files || []).some((f) => f.reportId === reportId));
      return proj?.projectId || null;
    } catch { return null; }
  }

  // ── Multi-document upload ─────────────────────────────────────────────
  // Lets a user select several files at once. Each file is uploaded and
  // Textract-processed individually on the backend, and — each uploaded
  // document ALSO gets its own, fully independent Master Agent / Audit
  // Planning / FS Review analysis. Nothing is combined: uploading
  // "abc.pdf" and "xyz.pdf" produces two separate sets of results,
  // switchable from the sidebar dropdown per document.
  async function handleMultiUpload(event, project) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    // Guard against a second upload starting while one is already being
    // tracked. Without this, starting a new batch calls stopPolling() and
    // silently cancels whatever the previous upload was still waiting on
    // — that upload's document exists and finishes fine on the backend,
    // it just never gets picked up on the frontend, looking exactly like
    // it "never came back."
    if (uploading || processing) {
      setError("Please wait for the current upload to finish before starting another.");
      event.target.value = "";
      return;
    }

    try {
      setUploading(true);
      setError("");
      setActiveProjectAgent(null);

      // Snapshot which reportIds already exist BEFORE this upload starts.
      // Matching later only considers documents NOT in this snapshot, so
      // re-uploading a file with the same original name as an earlier
      // document can never be mistaken for a match — it forces the
      // polling loop to wait for a genuinely new document instead of
      // false-matching an old one that happens to share the same name.
      let existingIds = new Set();
      try {
        const existingRes  = await fetch(`${DOCUMENTS_API}?portal=user`);
        const existingData = await existingRes.json();
        const existingList = existingData.reports || existingData.documents || existingData.items || [];
        existingIds = new Set(existingList.map((d) => getReportId(d)).filter(Boolean));
      } catch {}

      const succeededFiles = [];
      let uploadError = null;

      for (const file of files) {
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
          if (!urlRes.ok) {
            throw new Error(`Could not get an upload link for "${file.name}" (server said: ${urlRes.status} ${urlRes.statusText}).`);
          }
          const urlData   = await urlRes.json();
          const uploadUrl = urlData.uploadUrl || urlData.upload_url || urlData.url || urlData.presignedUrl;
          if (!uploadUrl) throw new Error(`Upload URL not returned for "${file.name}".`);

          const putRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": file.type || "application/pdf" },
            body: file,
          });
          // fetch() only rejects on a true network failure — if S3 itself
          // refuses the upload (expired link, size limit, permissions,
          // anything else), it still resolves normally with a non-2xx
          // status and NO error, so without this check the code would
          // silently carry on as if every file uploaded fine even when
          // one genuinely never reached S3 at all.
          if (!putRes.ok) {
            throw new Error(`Upload of "${file.name}" failed (S3 said: ${putRes.status} ${putRes.statusText}).`);
          }

          succeededFiles.push(file);
        } catch (fileErr) {
          // Stop trying further files once one fails, but keep whatever
          // succeeded BEFORE it — those files really did reach S3 and
          // will finish processing on the backend regardless, so they
          // must still be tracked/polled for, not silently abandoned.
          uploadError = fileErr;
          break;
        }
      }

      if (fileInputRef.current)   fileInputRef.current.value   = "";
      if (sidebarFileRef.current) sidebarFileRef.current.value = "";

      setUploading(false);

      if (succeededFiles.length > 0) {
        setProcessing(true);
        startBatchPolling(succeededFiles.map((f) => f.name), project, existingIds);
      }

      if (uploadError) {
        const okCount = succeededFiles.length;
        const prefix = okCount > 0
          ? `${okCount} of ${files.length} file(s) uploaded successfully, but then: `
          : "";
        setError(prefix + uploadError.message);
      }
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally { setUploading(false); }
  }

  // File names get sanitized somewhere in the upload pipeline (spaces,
  // dashes, etc. often become underscores by the time a document comes
  // back from processing), so comparing the stored name against the raw
  // browser filename via endsWith() can fail even for the correct file.
  // Normalizing both sides to the same "only letters/digits" form before
  // comparing makes the match resilient to that kind of cosmetic rewrite.
  function normalizeFileNameForMatch(name) {
    return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function startBatchPolling(fileNames, project, existingIds) {
    stopPolling();
    startProgressSimulation();
    let attempts = 0;
    const remainingNames = new Set(fileNames);
    const foundDocs = [];
    const seenIds = new Set(existingIds || []);

    pollingRef.current = setInterval(async () => {
      attempts++;
      try {
        const res  = await fetch(`${DOCUMENTS_API}?portal=user`);
        const data = await res.json();
        const list = data.reports || data.documents || data.items || [];

        for (const doc of list) {
          const isDone = ["COMPLETED", "READY"].includes(doc.status || doc.processingStatus);
          if (!isDone) continue;
          const docId = getReportId(doc);
          if (!docId || seenIds.has(docId)) continue; // pre-existing or already matched — skip
          const name = normalizeFileNameForMatch(getReportName(doc));
          const matchedFileName = [...remainingNames].find(
            (fn) => name && name.endsWith(normalizeFileNameForMatch(fn))
          );
          if (matchedFileName) {
            foundDocs.push(doc);
            seenIds.add(docId);
            remainingNames.delete(matchedFileName);
          }
        }

        if (remainingNames.size === 0 || attempts >= 60) {
          stopPolling();
          setProcessingProgress(100);
          setTimeout(() => {
            setProcessing(false);
            setProcessingProgress(0);
            setReports(list);
            finalizeBatchUpload(foundDocs, project);
          }, 800);
        }
      } catch {}
    }, 10000);
  }

  // Every uploaded document is treated INDEPENDENTLY: the first one
  // becomes the active document shown right away, and every document
  // (including the rest of the batch) gets its own background Master /
  // Audit Planning / FS Review generation kicked off immediately, so
  // expanding a different file's dropdown in the sidebar later is
  // instant rather than waiting from scratch.
  async function finalizeBatchUpload(docs, project) {
    if (docs.length === 0) return;

    const first   = docs[0];
    const firstId = getReportId(first);

    setSelectedReport(first);
    setSelectedReportId(firstId);
    setAgentReports(emptyAgentReportState());
    if (!project) navigateTo(VIEW_UPLOAD);

    docs.forEach((d) => {
      const id = getReportId(d);
      if (project) recordProjectFile(project.projectId, id, { name: getReportName(d) });
      generateAgentReportInBackground(id, "audit_planning_agent", AGENT_GENERATE_MESSAGES.audit_planning_agent);
      generateAgentReportInBackground(id, "fs_review_agent", AGENT_GENERATE_MESSAGES.fs_review_agent);
    });

    // Auto-expand every newly uploaded document's sidebar dropdown so the
    // user immediately sees where their new agent reports are appearing.
    if (project) {
      setExpandedFileIds((prev) => {
        const next = new Set(prev);
        docs.forEach((d) => { const id = getReportId(d); if (id) next.add(id); });
        return next;
      });
    }
  }

  async function selectPortal(type) {
    resetHistory();
    setPortal(type);

    // Switching portals always starts completely fresh — leftover
    // project/document state from a previous portal must never bleed
    // into a different portal's sidebar. Without this, opening the User
    // Portal after having worked in the Audit Portal would still show the
    // Audit Portal's uploaded documents and per-document agent dropdowns.
    setSelectedProjectItem(null);
    setActiveProjectAgent(null);
    setSelectedAgent(null);
    setSelectedReport(null);
    setSelectedReportId("");
    setAgentReports(emptyAgentReportState());
    setAgentReportsByDoc({});
    setExpandedFileIds(new Set());

    if (type === "manager") {
      const list = await fetchReports();
      setReports(list);
      setView(VIEW_MANAGER_HOME);
    } else if (type === "audit") {
      setView(VIEW_PROJECTS);
    } else {
      setView(VIEW_HOME);
    }
  }

  function startNewChat() {
    resetHistory();
    if (portal === "manager") {
      setView(VIEW_MANAGER_HOME);
      setSelectedReport(null);
      setSelectedReportId("");
    } else if (portal === "audit") {
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
    navigateTo(VIEW_AGENT);
  }

  // Toggles a single uploaded file's sidebar dropdown open/closed.
  function toggleFileExpanded(docId) {
    if (!docId) return;
    setExpandedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  }

  // Switches the active document to a SPECIFIC uploaded file (from the
  // sidebar dropdown) and jumps straight to the requested agent's view.
  // agentKey is "master", "audit_planning_agent", or "fs_review_agent".
  // Reuses in-memory cache first, then the persisted per-project cache,
  // and only kicks off a fresh generation if neither exists yet.
  function openDocumentAgent(file, agentKey) {
    if (!file?.reportId) return;
    const reportId = file.reportId;

    setSelectedReportId(reportId);
    setSelectedReport(null);

    const cachedInMemory = agentReportsByDoc[reportId];
    if (cachedInMemory) {
      setAgentReports(cachedInMemory);
      fetchReportById(reportId).then((full) => { if (full) setSelectedReport(full); });
    } else {
      const persisted = selectedProjectItem ? loadDocAgentCache(selectedProjectItem.projectId, reportId) : null;
      if (persisted?.agentReports) {
        setAgentReports(persisted.agentReports);
        setAgentReportsByDoc((prev) => ({ ...prev, [reportId]: persisted.agentReports }));
        if (persisted.report) setSelectedReport(persisted.report);
        else fetchReportById(reportId).then((full) => { if (full) setSelectedReport(full); });
      } else {
        setAgentReports(emptyAgentReportState());
        fetchReportById(reportId).then((full) => { if (full) setSelectedReport(full); });
        generateAgentReportInBackground(reportId, "audit_planning_agent", AGENT_GENERATE_MESSAGES.audit_planning_agent);
        generateAgentReportInBackground(reportId, "fs_review_agent", AGENT_GENERATE_MESSAGES.fs_review_agent);
      }
    }

    if (agentKey === "master") {
      setActiveProjectAgent(null);
      setSelectedAgent(null);
      navigateTo(VIEW_MASTER_AGENT);
    } else {
      const agent = SUB_AGENTS.find((a) => a.id === agentKey);
      if (!agent || !agent.available) return;
      setActiveProjectAgent(agent.id);
      setSelectedAgent(agent);
      navigateTo(VIEW_AGENT);
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
    navigateTo(VIEW_MANAGER_CHAT);
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
              {portal === "manager" ? "Manager Portal" : portal === "audit" ? "Audit Portal" : "User Portal"}
            </span>
          </div>
          <button className="sidebar-toggle" onClick={() => setSidebarOpen((o) => !o)}>◀</button>
        </div>

        {portal !== "audit" && (
          <button className="new-chat-btn" onClick={startNewChat}>
            <span className="new-chat-icon">＋</span>
            <span className="new-chat-label">New Chat</span>
          </button>
        )}

        {portal === "user" && (
          <label className="sidebar-upload-btn">
            <input ref={sidebarFileRef} type="file" multiple
              accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
              onChange={handleMultiUpload} disabled={uploading || processing} />
            <span className="sidebar-upload-icon">➕</span>
            <span className="sidebar-upload-label">
              {uploading ? "Uploading…" : processing ? "Processing…" : "Upload Document(s)"}
            </span>
          </label>
        )}

        <button
          className={`sidebar-projects-btn ${view === VIEW_PROJECTS ? "sidebar-projects-active" : ""}`}
          onClick={() => navigateTo(VIEW_PROJECTS)}
        >
          <span className="sidebar-projects-icon">📁</span>
          <span className="sidebar-projects-label">Projects</span>
        </button>

        {portal === "audit" && selectedProjectItem && (
          <div className="sidebar-section sidebar-project-agents">
            <div className="sidebar-section-title">{selectedProjectItem.projectName}</div>

            <button
              className={`sidebar-agent-btn ${view === VIEW_PROJECT_DASHBOARD ? "sidebar-agent-active" : ""}`}
              onClick={() => navigateTo(VIEW_PROJECT_DASHBOARD)}
            >
              <span className="sidebar-agent-icon">📊</span>
              <span className="sidebar-agent-label">Project Dashboard</span>
            </button>

            <button
              className={`sidebar-agent-btn ${view === VIEW_PROJECT_HISTORY ? "sidebar-agent-active" : ""}`}
              onClick={() => navigateTo(VIEW_PROJECT_HISTORY)}
            >
              <span className="sidebar-agent-icon">🕘</span>
              <span className="sidebar-agent-label">Project History</span>
            </button>

            <button
              className={`sidebar-agent-btn ${view === VIEW_PROJECT_FILES ? "sidebar-agent-active" : ""}`}
              onClick={() => navigateTo(VIEW_PROJECT_FILES)}
            >
              <span className="sidebar-agent-icon">📁</span>
              <span className="sidebar-agent-label">Files &amp; Assets</span>
            </button>

            {/* ── Per-document dropdowns ──────────────────────────────
                Every uploaded file gets its own collapsible group here.
                Expanding a file reveals Master Agent / Audit Planning
                Agent / Financial Statement Review Agent, each scoped to
                THAT specific document — clicking a different file's
                dropdown switches the active document, never mixing
                results between files. */}
            {(selectedProjectItem.files || []).length > 0 && (
              <div className="sidebar-doc-list">
                {selectedProjectItem.files.map((f) => {
                  const docId       = f.reportId;
                  const isExpanded  = docId && expandedFileIds.has(docId);
                  const docState    = docId ? agentReportsByDoc[docId] : null;
                  const isActiveDoc = !!docId && docId === selectedReportId;
                  const masterPreparing =
                    !!docState && (docState.audit_planning_agent?.preGenerating || docState.fs_review_agent?.preGenerating);
                  const masterReady =
                    !!docState && !!docState.audit_planning_agent?.preGenerated && !!docState.fs_review_agent?.preGenerated;

                  return (
                    <div className="sidebar-doc-group" key={f.fileId}>
                      <button
                        className={`sidebar-doc-toggle ${isActiveDoc ? "sidebar-doc-toggle-active" : ""}`}
                        onClick={() => toggleFileExpanded(docId)}
                        disabled={!docId}
                        title={docId ? f.name : "Not yet linked to a processed document"}
                      >
                        <span className="sidebar-doc-icon">📄</span>
                        <span className="sidebar-doc-label">{f.name}</span>
                        {masterPreparing && <span className="sidebar-agent-status status-generating">⏳</span>}
                        {!masterPreparing && masterReady && <span className="sidebar-agent-status status-ready">✅</span>}
                        <span className={`sidebar-doc-chevron ${isExpanded ? "sidebar-doc-chevron-open" : ""}`}>▾</span>
                      </button>

                      {isExpanded && docId && (
                        <div className="sidebar-doc-agents">
                          <button
                            className={`sidebar-agent-btn sidebar-agent-btn-nested ${isActiveDoc && view === VIEW_MASTER_AGENT ? "sidebar-agent-active" : ""}`}
                            onClick={() => openDocumentAgent(f, "master")}
                          >
                            <span className="sidebar-agent-icon">🧠</span>
                            <span className="sidebar-agent-label">Master Agent</span>
                            {masterPreparing && <span className="sidebar-agent-status status-generating">Preparing</span>}
                            {!masterPreparing && masterReady && <span className="sidebar-agent-status status-ready">Ready</span>}
                          </button>

                          {SUB_AGENTS.map((agent) => (
                            <button
                              key={agent.id}
                              className={`sidebar-agent-btn sidebar-agent-btn-nested ${isActiveDoc && view === VIEW_AGENT && selectedAgent?.id === agent.id ? "sidebar-agent-active" : ""} ${!agent.available ? "sidebar-agent-disabled" : ""}`}
                              disabled={!agent.available}
                              onClick={() => openDocumentAgent(f, agent.id)}
                            >
                              <span className="sidebar-agent-icon">{agent.icon}</span>
                              <span className="sidebar-agent-label">{agent.label}</span>
                              {agent.available ? (
                                <>
                                  {docState?.[agent.id]?.preGenerating && (
                                    <span className="sidebar-agent-status status-generating">Preparing</span>
                                  )}
                                  {!docState?.[agent.id]?.preGenerating && docState?.[agent.id]?.preGenerated && (
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
                    </div>
                  );
                })}
              </div>
            )}
          </div>
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
            onClick={() => { resetHistory(); setView(VIEW_PORTAL); setPortal(null); }}>
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
              {view === VIEW_MANAGER_CHAT && `Document Q&A — ${getReportName(selectedReport)}`}
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
                <input ref={fileInputRef} type="file" multiple
                  accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                  onChange={handleMultiUpload} disabled={uploading || processing} />
                <div className="option-icon"><UploadBoxIcon /></div>
                <div className="option-body">
                  <div className="option-title">Upload Financial Document(s)</div>
                  <div className="option-desc">
                    Upload one or more financial statements — select several at once
                    with the ➕ picker. Each document gets its own independent Master
                    Agent, Audit Planning, and Financial Statement Review results.
                  </div>
                </div>
                <div className="option-arrow">→</div>
              </label>
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
                onClick={() => { goBack(VIEW_MANAGER_HOME); setSelectedReport(null); setSelectedReportId(""); }}>
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
              onClick={() => goBack(VIEW_HOME)}>
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
                </button>
              ))}
            </div>

            <label className="upload-another-btn">
              <input ref={fileInputRef} type="file" multiple
                accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                onChange={handleMultiUpload} disabled={uploading || processing} />
              {uploading ? "Uploading…" : processing ? "Processing…" : "➕ Upload Document(s)"}
            </label>
          </div>
        )}

        {/* MASTER AGENT */}
        {view === VIEW_MASTER_AGENT && (
          <div className="chatbot-view">
            <div className="chatbot-nav-bar">
              <button className="back-nav-btn"
                onClick={() => goBack(selectedProjectItem ? VIEW_PROJECT_DETAIL : VIEW_HOME)}>
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
                onClick={() => goBack(selectedProjectItem ? VIEW_PROJECT_DETAIL : VIEW_UPLOAD)}>
                {selectedProjectItem ? "← Back to Project" : "← Back to Report Analysis"}
              </button>
            </div>
            <Chatbot
              reportId={selectedReportId}
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
                  const fallback = portal === "manager" ? VIEW_MANAGER_HOME : portal === "audit" ? VIEW_PORTAL : VIEW_HOME;
                  const target = goBack(fallback);
                  if (target === VIEW_PORTAL) setPortal(null);
                }}>
                ← Back
              </button>
            </div>
            <Projects
              onOpenProject={(project) => {
                setSelectedProjectItem(project);
                setActiveProjectAgent(null);

                // Restore EVERY document's cached agent reports for this
                // project (not just the last one), so any file's sidebar
                // dropdown can be expanded and show instantly.
                const cachesByDoc = project.agentCachesByDoc || {};
                const restored = {};
                for (const [docId, entry] of Object.entries(cachesByDoc)) {
                  if (entry?.agentReports) restored[docId] = entry.agentReports;
                }
                setAgentReportsByDoc(restored);
                setExpandedFileIds(new Set());

                const files = project.files || [];
                if (files.length > 0 && files[0].reportId) {
                  const latestId = files[0].reportId;
                  const cached   = restored[latestId];
                  setSelectedReportId(latestId);
                  setAgentReports(cached || emptyAgentReportState());

                  const cachedReport = cachesByDoc[latestId]?.report;
                  if (cachedReport) setSelectedReport(cachedReport);
                  else fetchReportById(latestId).then((full) => { if (full) setSelectedReport(full); });

                  if (!cached) {
                    generateAgentReportInBackground(latestId, "audit_planning_agent", AGENT_GENERATE_MESSAGES.audit_planning_agent);
                    generateAgentReportInBackground(latestId, "fs_review_agent", AGENT_GENERATE_MESSAGES.fs_review_agent);
                  }
                } else {
                  setSelectedReport(null);
                  setSelectedReportId("");
                  setAgentReports(emptyAgentReportState());
                }
                navigateTo(VIEW_PROJECT_DETAIL);
              }}
            />
          </div>
        )}

        {/* PROJECT DETAIL */}
        {view === VIEW_PROJECT_DETAIL && selectedProjectItem && (
          <div className="chatbot-view">
            <div className="chatbot-nav-bar">
              <button className="back-nav-btn" onClick={() => goBack(VIEW_PROJECTS)}>
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

              <button className="pd-files-link" onClick={() => navigateTo(VIEW_PROJECT_FILES)}>
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
              <button className="back-nav-btn" onClick={() => goBack(VIEW_PROJECT_DETAIL)}>
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
              <button className="back-nav-btn" onClick={() => goBack(VIEW_PROJECT_DETAIL)}>
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
              <div className="pd-card">
                <div className="pd-card-header">
                  <div className="pd-hero-icon">📄</div>
                  <div className="pd-hero-text">
                    <div className="pd-hero-eyebrow">Project Overview</div>
                    <div className="pd-hero-name">{selectedProjectItem.projectName}</div>
                    <div className="pd-hero-audit">
                      <span className="pd-avatar">{getInitials(getLegalName(selectedProjectItem))}</span>
                      <span className="pd-audit-sep">·</span>
                      <span>{getLegalName(selectedProjectItem)}</span>
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

              <div className="pd-history-card">
                <div className="pd-section-heading">Full History</div>
                {Array.isArray(selectedProjectItem.history) && selectedProjectItem.history.length > 0 ? (
                  <ul className="pd-timeline">
                    {selectedProjectItem.history.map((h, i) => (
                      <li key={i} className="pd-timeline-item">
                        <span className="pd-timeline-dot" />
                        <div>
                          <div className="pd-timeline-action">{h.note || h.action}</div>
                          <div className="pd-timeline-time">{formatDate(h.timestamp)}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="pdb-card-empty">No history recorded yet.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* PROJECT FILES & ASSETS */}
        {view === VIEW_PROJECT_FILES && selectedProjectItem && (
          <div className="chatbot-view">
            <div className="chatbot-nav-bar">
              <button className="back-nav-btn" onClick={() => goBack(VIEW_PROJECT_DETAIL)}>
                ← Back to Project
              </button>
            </div>

            <div className="pd-view">
              <div className="pf-header">
                <div className="pf-title">Files and Assets</div>
                <div className="pf-subtitle">Documents and attachments that have been uploaded as part of this project. Each file gets its own Master Agent, Audit Planning, and Financial Statement Review results — expand it from the sidebar on the left to view them.</div>
              </div>

              <label className="pf-dropzone">
                <input type="file" multiple
                  accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                  onChange={(e) => handleMultiUpload(e, selectedProjectItem)}
                  disabled={uploading || processing} />
                <UploadBoxIcon size={30} />
                <div className="pf-dropzone-title">
                  {uploading ? "Uploading…" : processing ? "Processing…" : "➕ Click to upload one or more files"}
                </div>
                <div className="pf-dropzone-sub">PDF, DOC, PNG, JPG (max 20MB each) — each file gets its own separate agent analysis</div>
              </label>

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
                    {selectedProjectItem.files.map((f) => {
                      const docState    = f.reportId ? agentReportsByDoc[f.reportId] : null;
                      const isActive    = !!f.reportId && f.reportId === selectedReportId;
                      const isPreparing = !!docState && (docState.audit_planning_agent?.preGenerating || docState.fs_review_agent?.preGenerating);
                      const isReady     = !!docState && !!docState.audit_planning_agent?.preGenerated && !!docState.fs_review_agent?.preGenerated;
                      return (
                        <div className={`pf-table-row ${isActive ? "pf-table-row-active" : ""}`} key={f.fileId}>
                          <div className="pf-file-name">
                            <button
                              className="pf-file-name-btn"
                              onClick={() => openDocumentAgent(f, "master")}
                              disabled={!f.reportId}
                              title={f.reportId ? "View Master / Audit Planning / FS Review results for this document" : "Not linked to a processed document"}
                            >
                              📄 {f.name}
                            </button>
                            {isPreparing && <span className="pf-file-status-pill preparing">⏳ Preparing</span>}
                            {isReady && <span className="pf-file-status-pill ready">✅ Ready</span>}
                          </div>
                          <div className="pf-file-size">{formatFileSize(f.size)}</div>
                          <div className="pf-file-date">{formatDate(f.uploadedAt)}</div>
                          <div className="pf-file-actions">
                            <button
                              className="pf-view-btn"
                              onClick={() => openDocumentAgent(f, "master")}
                              disabled={!f.reportId}
                            >
                              View Agents →
                            </button>
                            <button
                              className="pf-delete-btn"
                              onClick={() => deleteProjectFile(selectedProjectItem.projectId, f.fileId)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
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
