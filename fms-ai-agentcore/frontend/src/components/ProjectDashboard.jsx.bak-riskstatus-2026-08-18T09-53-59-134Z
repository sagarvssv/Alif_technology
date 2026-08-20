import React, { useMemo, useState } from "react";
import "./ProjectDashboard.css";

// ─── Risk parsing (mirrors the logic in Chatbot.jsx so the dashboard can
// summarize whatever the Audit Planning Agent — or any future agent —
// has generated, without needing to touch the chat rendering code) ────────

const RISK_LEVELS = {
  "high":            { pct: 90, bar: "#ef4444", label: "High",        needsGap: true  },
  "high (presumed)": { pct: 90, bar: "#ef4444", label: "High",        needsGap: true  },
  "medium-high":     { pct: 75, bar: "#f97316", label: "Medium-High", needsGap: true  },
  "medium":          { pct: 55, bar: "#f59e0b", label: "Medium",      needsGap: true  },
  "low-medium":      { pct: 35, bar: "#34d399", label: "Low-Medium",  needsGap: false },
  "low":             { pct: 20, bar: "#22c55e", label: "Low",         needsGap: false },
  "to be assessed":  { pct: 50, bar: "#94a3b8", label: "To Be Assessed", needsGap: true },
};

function getRisk(raw = "") {
  const key = raw.toLowerCase().trim();
  return RISK_LEVELS[key] || RISK_LEVELS[key.replace("–", "-")] || null;
}

function parseRiskRows(markdown = "") {
  const rows = [];
  const lines = markdown.split("\n");
  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    if (/^\|[\s|:-]+\|/.test(line.trim())) continue;
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 3) continue;
    if (/^(risk\s*area|what it means|risk level|dimension|element|benchmark|role|item)/i.test(cells[0])) continue;
    let riskRaw = cells[2] || "";
    let response = cells[3] || "";
    if (!getRisk(riskRaw) && cells.length >= 4) {
      riskRaw = cells[3] || "";
      response = cells[4] || "";
    }
    const cfg = getRisk(riskRaw);
    if (!cfg) continue;
    rows.push({ area: cells[0], description: cells[1] || "", riskRaw, response, ...cfg });
  }
  return rows;
}

function extractSection(markdown = "", heading) {
  const regex = new RegExp(`#{1,4}\\s*${heading}[^\\n]*\\n+([\\s\\S]*?)(?=\\n#{1,4}\\s|$)`, "i");
  const match = markdown.match(regex);
  if (!match) return "";
  return match[1]
    .replace(/\|.*\|/g, "")           // strip table rows
    .replace(/^-{2,}$/gm, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ")
    .slice(0, 320);
}

function complianceScoreFromRisks(rows) {
  if (rows.length === 0) return null;
  const avgPct = rows.reduce((sum, r) => sum + r.pct, 0) / rows.length;
  return Math.max(0, Math.round(100 - avgPct));
}

function scoreColor(score) {
  if (score >= 75) return "#16a34a";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

function formatDateTime(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

// ─── Local persistence for manual metrics (budget %, notes) ──────────────
// Mirrors Projects.jsx's temporary localStorage approach — see that file
// for the migration path to a real backend.
const LOCAL_KEY = "alif_projects_v1";

function persistProjectFields(projectId, updates) {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const updated = list.map((p) => (p.projectId === projectId ? { ...p, ...updates } : p));
    localStorage.setItem(LOCAL_KEY, JSON.stringify(updated));
  } catch {}
}

function ProjectDashboard({ project, reportMarkdown, onUpdateProject }) {
  const [budgetInput, setBudgetInput] = useState(project?.budgetUtilization ?? "");
  const [editingBudget, setEditingBudget] = useState(false);
  const [complianceInput, setComplianceInput] = useState(project?.complianceScore ?? "");
  const [editingCompliance, setEditingCompliance] = useState(false);
  const [noteText, setNoteText] = useState("");

  const hasReport = Boolean(reportMarkdown && reportMarkdown.trim());

  const riskRows = useMemo(() => (hasReport ? parseRiskRows(reportMarkdown) : []), [reportMarkdown, hasReport]);
  const outstandingIssues = useMemo(() => riskRows.filter((r) => r.needsGap), [riskRows]);
  const rankedRisks = useMemo(
    () => [...riskRows].sort((a, b) => b.pct - a.pct),
    [riskRows]
  );

  const engagementSummary = useMemo(() => {
    if (!hasReport) return "";
    return extractSection(reportMarkdown, "Engagement Strategy");
  }, [reportMarkdown, hasReport]);

  const suggestedCompliance = useMemo(() => complianceScoreFromRisks(riskRows), [riskRows]);
  const complianceScore = project?.complianceScore ?? suggestedCompliance;
  const budgetUtilization = project?.budgetUtilization ?? null;

  const reviewNotes = project?.reviewNotes || [];

  function saveBudget() {
    const num = Math.max(0, Math.min(100, Number(budgetInput) || 0));
    persistProjectFields(project.projectId, { budgetUtilization: num });
    onUpdateProject?.({ budgetUtilization: num });
    setEditingBudget(false);
  }

  function saveCompliance() {
    const num = Math.max(0, Math.min(100, Number(complianceInput) || 0));
    persistProjectFields(project.projectId, { complianceScore: num });
    onUpdateProject?.({ complianceScore: num });
    setEditingCompliance(false);
  }

  function addNote() {
    const text = noteText.trim();
    if (!text) return;
    const note = { text, timestamp: new Date().toISOString() };
    const updatedNotes = [note, ...reviewNotes];
    persistProjectFields(project.projectId, { reviewNotes: updatedNotes });
    onUpdateProject?.({ reviewNotes: updatedNotes });
    setNoteText("");
  }

  if (!project) return null;

  return (
    <div className="pdb-view">
      <div className="pdb-header">
        <div className="pdb-title">📊 Project Dashboard</div>
        <div className="pdb-subtitle">{project.projectName}</div>
      </div>

      {!hasReport && (
        <div className="pdb-empty-banner">
          No agent report has been generated yet for this project. Run the Audit Planning
          Agent to automatically populate Engagement Status, Outstanding Issues, and Risk
          Rankings below.
        </div>
      )}

      <div className="pdb-grid">
        {/* Engagement Status */}
        <div className="pdb-card">
          <div className="pdb-card-label">📋 Engagement Status</div>
          {engagementSummary ? (
            <p className="pdb-card-text">{engagementSummary}</p>
          ) : (
            <p className="pdb-card-empty">
              Status: <strong>{project.status || "Active"}</strong>. Detailed engagement
              strategy will appear here once the Audit Planning Agent report is generated.
            </p>
          )}
        </div>

        {/* Budget Utilization */}
        <div className="pdb-card">
          <div className="pdb-card-label">💰 Budget Utilization</div>
          {budgetUtilization !== null && !editingBudget ? (
            <>
              <div className="pdb-metric-row">
                <span className="pdb-metric-value">{budgetUtilization}%</span>
                <button className="pdb-edit-btn" onClick={() => setEditingBudget(true)}>Edit</button>
              </div>
              <div className="pdb-bar-track">
                <div className="pdb-bar-fill" style={{ width: `${budgetUtilization}%`, background: "var(--at-blue)" }} />
              </div>
            </>
          ) : (
            <div className="pdb-edit-row">
              <input
                type="number" min="0" max="100"
                placeholder="0-100"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
              />
              <button className="pdb-save-btn" onClick={saveBudget}>Save</button>
            </div>
          )}
          <p className="pdb-card-hint">Tracked manually — not generated by an agent yet.</p>
        </div>

        {/* Compliance Score */}
        <div className="pdb-card">
          <div className="pdb-card-label">✅ Compliance Score</div>
          {complianceScore !== null && !editingCompliance ? (
            <>
              <div className="pdb-metric-row">
                <span className="pdb-metric-value" style={{ color: scoreColor(complianceScore) }}>
                  {complianceScore}%
                </span>
                <button className="pdb-edit-btn" onClick={() => { setComplianceInput(complianceScore); setEditingCompliance(true); }}>
                  {project?.complianceScore != null ? "Edit" : "Override"}
                </button>
              </div>
              <div className="pdb-bar-track">
                <div className="pdb-bar-fill" style={{ width: `${complianceScore}%`, background: scoreColor(complianceScore) }} />
              </div>
              {project?.complianceScore == null && (
                <p className="pdb-card-hint">Suggested from parsed risk levels — adjust if needed.</p>
              )}
            </>
          ) : (
            <div className="pdb-edit-row">
              <input
                type="number" min="0" max="100"
                placeholder="0-100"
                value={complianceInput}
                onChange={(e) => setComplianceInput(e.target.value)}
              />
              <button className="pdb-save-btn" onClick={saveCompliance}>Save</button>
            </div>
          )}
          {complianceScore === null && (
            <p className="pdb-card-empty">No risk data yet — generate a report or set manually.</p>
          )}
        </div>

        {/* Outstanding Issues */}
        <div className="pdb-card pdb-card-wide">
          <div className="pdb-card-label">⚠️ Outstanding Issues</div>
          {outstandingIssues.length > 0 ? (
            <ul className="pdb-issue-list">
              {outstandingIssues.map((item, i) => (
                <li key={i}>
                  <span className="pdb-risk-dot" style={{ background: item.bar }} />
                  <div>
                    <div className="pdb-issue-area">{item.area}</div>
                    {item.response && <div className="pdb-issue-response">{item.response}</div>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pdb-card-empty">
              {hasReport ? "No outstanding issues flagged in the current report." : "Nothing to show yet."}
            </p>
          )}
        </div>

        {/* Risk Rankings */}
        <div className="pdb-card pdb-card-wide">
          <div className="pdb-card-label">📈 Risk Rankings</div>
          {rankedRisks.length > 0 ? (
            <ul className="pdb-risk-list">
              {rankedRisks.map((item, i) => (
                <li key={i}>
                  <span className="pdb-risk-area">{item.area}</span>
                  <div className="pdb-risk-bar-track">
                    <div className="pdb-risk-bar-fill" style={{ width: `${item.pct}%`, background: item.bar }} />
                  </div>
                  <span className="pdb-risk-badge" style={{ background: item.bar }}>{item.label}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pdb-card-empty">
              {hasReport ? "No risk table found in the current report." : "Nothing to show yet."}
            </p>
          )}
        </div>

        {/* Review Notes */}
        <div className="pdb-card pdb-card-wide">
          <div className="pdb-card-label">📝 Review Notes</div>
          <div className="pdb-note-input-row">
            <textarea
              rows={2}
              placeholder="Add a review note..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <button className="pdb-save-btn" onClick={addNote} disabled={!noteText.trim()}>Add</button>
          </div>
          {reviewNotes.length > 0 ? (
            <ul className="pdb-notes-list">
              {reviewNotes.map((n, i) => (
                <li key={i}>
                  <div className="pdb-note-text">{n.text}</div>
                  <div className="pdb-note-time">{formatDateTime(n.timestamp)}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pdb-card-empty">No review notes yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProjectDashboard;
