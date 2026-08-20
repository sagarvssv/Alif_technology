const fs = require("fs");
const path = require("path");

const APP_JSX_PATH = path.join(__dirname, "src", "App.jsx");

if (!fs.existsSync(APP_JSX_PATH)) {
  console.error(`❌ Could not find ${APP_JSX_PATH}`);
  console.error("   Run this script from inside the 'frontend' folder.");
  process.exit(1);
}

let source = fs.readFileSync(APP_JSX_PATH, "utf8");
const originalSource = source;

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(__dirname, "src", `App.jsx.bak-riskreview-${timestamp}`);
fs.writeFileSync(backupPath, originalSource, "utf8");
console.log(`✅ Backup saved to: ${backupPath}`);

let patchesApplied = 0;
let patchesSkipped = 0;

const PANEL_BLOCK = `
// ═══════════════════════════════════════════════════════════════════
// RISK REVIEW & RESOLUTION — shared across both agents (ADD-ON)
// ═══════════════════════════════════════════════════════════════════

const RISK_API = (riskKey) => \`\${API_BASE_URL}/risks/\${encodeURIComponent(riskKey)}\`;
const EVIDENCE_POLL_INTERVAL_MS = 4000;
const EVIDENCE_MAX_POLL_ATTEMPTS = 45;

function buildDocKey(reportId) {
  return \`\${reportId || "no-report"}::__document__\`;
}

function getReviewerName() {
  try { return localStorage.getItem("alif_reviewer_name") || ""; }
  catch { return ""; }
}

function setReviewerNameStorage(name) {
  try { localStorage.setItem("alif_reviewer_name", name); } catch {}
}

const RISK_STATUS_LABELS = {
  open:      { label: "Open",      icon: "🔴" },
  in_review: { label: "In Review", icon: "🟡" },
  resolved:  { label: "Resolved",  icon: "✅" },
  closed:    { label: "Closed",    icon: "⚪" },
};

function MasterRiskReviewPanel({ reportId, onRegenerateWithEvidence }) {
  const docKey = buildDocKey(reportId);

  const [expanded, setExpanded]           = useState(false);
  const [review, setReview]               = useState(null);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [reviewError, setReviewError]     = useState("");
  const [newComment, setNewComment]       = useState("");
  const [reviewerName, setReviewerNameState] = useState(getReviewerName());
  const [saving, setSaving]               = useState(false);
  const [savedConfirmation, setSavedConfirmation] = useState(false);
  const [uploading, setUploading]         = useState(false);
  const [uploadStage, setUploadStage]     = useState("");

  useEffect(() => {
    if (!expanded || !reportId) return;
    let cancelled = false;
    setReviewLoading(true);
    setReviewError("");
    fetch(RISK_API(docKey))
      .then((res) => res.json())
      .then((data) => { if (!cancelled) setReview(data); })
      .catch(() => { if (!cancelled) setReviewError("Could not load review status."); })
      .finally(() => { if (!cancelled) setReviewLoading(false); });
    return () => { cancelled = true; };
  }, [expanded, docKey, reportId]);

  async function saveUpdate(patch, { showConfirmation = false } = {}) {
    setSaving(true);
    setReviewError("");
    setSavedConfirmation(false);
    try {
      const res = await fetch(RISK_API(docKey), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changedBy: reviewerName || "Unnamed reviewer", ...patch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save.");
      setReview(data);
      if (showConfirmation) {
        setSavedConfirmation(true);
        setTimeout(() => setSavedConfirmation(false), 2500);
      }
      return data;
    } catch (err) {
      setReviewError(err.message || "Failed to save your update. Please try again.");
      return null;
    } finally {
      setSaving(false);
    }
  }

  function handleStatusChange(e) {
    saveUpdate({ status: e.target.value });
  }

  function handleAddComment() {
    const text = newComment.trim();
    if (!text) return;
    saveUpdate({ newComment: { author: reviewerName || "Unnamed reviewer", text } });
    setNewComment("");
  }

  function handleReviewerNameBlur() {
    setReviewerNameStorage(reviewerName);
  }

  async function handleManualSave() {
    setReviewerNameStorage(reviewerName);
    const pendingComment = newComment.trim();
    const patch = { status: review?.status || "open" };
    if (pendingComment) {
      patch.newComment = { author: reviewerName || "Unnamed reviewer", text: pendingComment };
    }
    const result = await saveUpdate(patch, { showConfirmation: true });
    if (result && pendingComment) setNewComment("");
  }

  async function waitForEvidenceDocument(fileName, existingIds) {
    const normalize = (n) => (n || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    for (let attempt = 0; attempt < EVIDENCE_MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(EVIDENCE_POLL_INTERVAL_MS);
      setUploadStage(\`Extracting text from evidence document… (\${attempt + 1})\`);
      try {
        const res  = await fetch(\`\${DOCUMENTS_API}?portal=user\`);
        const data = await res.json();
        const list = data.reports || data.documents || data.items || [];
        const match = list.find((doc) => {
          const id = getReportId(doc);
          if (!id || existingIds.has(id)) return false;
          const isDone = ["COMPLETED", "READY"].includes(doc.status || doc.processingStatus);
          if (!isDone) return false;
          const name = normalize(getReportName(doc));
          return name && name.endsWith(normalize(fileName));
        });
        if (match) return getReportId(match);
      } catch {}
    }
    throw new Error("Evidence document took too long to process. Please try again.");
  }

  async function handleAttachEvidence(e) {
    const file = e.target.files?.[0];
    if (!file || !reportId) return;
    setUploading(true);
    setReviewError("");
    setUploadStage("Uploading evidence document…");
    try {
      let existingIds = new Set();
      try {
        const snapRes  = await fetch(\`\${DOCUMENTS_API}?portal=user\`);
        const snapData = await snapRes.json();
        const snapList = snapData.reports || snapData.documents || snapData.items || [];
        existingIds = new Set(snapList.map(getReportId).filter(Boolean));
      } catch {}

      const urlRes = await fetch(UPLOAD_URL_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_name: file.name,
          content_type: file.type || "application/pdf",
        }),
      });
      const urlData   = await urlRes.json();
      const uploadUrl = urlData.uploadUrl || urlData.upload_url || urlData.url || urlData.presignedUrl;
      if (!uploadUrl) throw new Error("Could not get an upload link for the evidence document.");

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/pdf" },
        body: file,
      });
      if (!putRes.ok) throw new Error("Uploading the evidence document to storage failed.");

      const evidenceReportId = await waitForEvidenceDocument(file.name, existingIds);

      await saveUpdate({ newAttachment: { fileName: file.name, s3Key: evidenceReportId } });

      setUploadStage("Re-analysing risks for both agents with the new evidence…");
      await onRegenerateWithEvidence(reportId, evidenceReportId);

      await saveUpdate({
        newComment: {
          author: "System",
          text: \`Both agents re-analysed using supporting document "\${file.name}". Any risk directly addressed by this evidence may have been updated.\`,
        },
      });
    } catch (err) {
      setReviewError(err.message || "Failed to process the evidence document. Please try again.");
    } finally {
      setUploading(false);
      setUploadStage("");
      e.target.value = "";
    }
  }

  if (!reportId) return null;

  return (
    <div className="risk-review-panel">
      <button className="risk-review-toggle-btn" onClick={() => setExpanded((v) => !v)}>
        🗂️ Risk Review &amp; Resolution (shared across both agents) {expanded ? "▲" : "▼"}
      </button>

      {expanded && (
        <div className="risk-review-panel-body">
          {reviewLoading ? (
            <div className="single-section-body">Loading review status…</div>
          ) : (
            <>
              {reviewError && <div className="risk-review-error">⚠️ {reviewError}</div>}

              <div className="risk-review-field">
                <label className="risk-review-field-label">Your name (remembered on this device)</label>
                <input
                  type="text"
                  className="risk-review-input"
                  placeholder="e.g. Hasini"
                  value={reviewerName}
                  onChange={(e) => setReviewerNameState(e.target.value)}
                  onBlur={handleReviewerNameBlur}
                />
              </div>

              <div className="risk-review-field">
                <label className="risk-review-field-label">Overall review status</label>
                <select
                  className="risk-review-select"
                  value={review?.status || "open"}
                  onChange={handleStatusChange}
                  disabled={saving}
                >
                  {Object.entries(RISK_STATUS_LABELS).map(([value, { label, icon }]) => (
                    <option key={value} value={value}>{icon} {label}</option>
                  ))}
                </select>
              </div>

              <div className="risk-review-field">
                <label className="risk-review-field-label">
                  Supporting documents ({review?.attachments?.length || 0})
                </label>
                <p className="risk-review-hint">
                  Uploading evidence here re-runs BOTH the Audit Planning and Financial
                  Statement Review agents. Risks the evidence directly addresses may
                  update; unrelated risks are left unchanged.
                </p>
                {review?.attachments?.length > 0 && (
                  <ul className="risk-review-attachment-list">
                    {review.attachments.map((a, i) => (
                      <li key={i} className="risk-review-attachment-item">
                        📎 {a.fileName}
                        <span className="risk-review-attachment-meta">
                          — {a.uploadedBy || "unknown"}, {new Date(a.uploadedAt).toLocaleDateString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <label className="risk-review-upload-btn">
                  <input type="file" onChange={handleAttachEvidence} disabled={uploading} />
                  {uploading ? (uploadStage || "Processing…") : "➕ Attach supporting evidence"}
                </label>
              </div>

              <div className="risk-review-field">
                <label className="risk-review-field-label">
                  Comments &amp; justification ({review?.comments?.length || 0})
                </label>
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
                  placeholder="Add your review, response, or justification…"
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
              </div>

              <div className="risk-review-save-row">
                <button className="risk-review-save-btn" onClick={handleManualSave} disabled={saving}>
                  {saving ? "Saving…" : "💾 Save"}
                </button>
                {savedConfirmation && <span className="risk-review-saved-note">✅ Saved</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
`;

{
  const anchorRegex = /function emptyAgentReportState\(\) \{[\s\S]*?\r?\n\}\r?\n/;
  const match = source.match(anchorRegex);
  if (match && !source.includes("function MasterRiskReviewPanel(")) {
    const insertPoint = match.index + match[0].length;
    source = source.slice(0, insertPoint) + PANEL_BLOCK + source.slice(insertPoint);
    console.log("✅ Patch 1/3 applied: MasterRiskReviewPanel component inserted.");
    patchesApplied++;
  } else if (source.includes("function MasterRiskReviewPanel(")) {
    console.log("⏭️  Patch 1/3 skipped: MasterRiskReviewPanel already present.");
  } else {
    console.log("❌ Patch 1/3 FAILED: could not find emptyAgentReportState() anchor.");
    patchesSkipped++;
  }
}

{
  const oldFnRegex = /async function generateAgentReportInBackground\(reportId, agentId, generateMessage\) \{[\s\S]*?\r?\n  \}\r?\n/;
  const match = source.match(oldFnRegex);

  const newFn = `async function generateAgentReportInBackground(reportId, agentId, generateMessage, extraReportIds = []) {
    updateDocAgentReport(reportId, agentId, { preGenerating: true, preGenerated: null });
    try {
      const allReportIds = [reportId, ...extraReportIds];
      const res = await fetch(CHAT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message:       generateMessage,
          question:      generateMessage,
          sessionId:     \`bg-\${agentId}-\${Date.now()}\`,
          reportId,
          reportIds:     allReportIds,
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

  async function regenerateBothAgentsWithEvidence(reportId, evidenceReportId) {
    await Promise.all([
      generateAgentReportInBackground(reportId, "audit_planning_agent", AGENT_GENERATE_MESSAGES.audit_planning_agent, [evidenceReportId]),
      generateAgentReportInBackground(reportId, "fs_review_agent", AGENT_GENERATE_MESSAGES.fs_review_agent, [evidenceReportId]),
    ]);
  }
`;

  if (match && !source.includes("function regenerateBothAgentsWithEvidence(")) {
    source = source.replace(oldFnRegex, newFn);
    console.log("✅ Patch 2/3 applied: generateAgentReportInBackground extended + regenerateBothAgentsWithEvidence added.");
    patchesApplied++;
  } else if (source.includes("function regenerateBothAgentsWithEvidence(")) {
    console.log("⏭️  Patch 2/3 skipped: regenerateBothAgentsWithEvidence already present.");
  } else {
    console.log("❌ Patch 2/3 FAILED: could not find generateAgentReportInBackground anchor (exact text may differ from expected).");
    patchesSkipped++;
  }
}

{
  const anchorRegex = /<MasterAgentOverview[\s\S]*?\/>/;
  const match = source.match(anchorRegex);

  if (match && !source.includes("<MasterRiskReviewPanel")) {
    const wrapped = `<>
              ${match[0]}

              <MasterRiskReviewPanel
                reportId={selectedReportId}
                onRegenerateWithEvidence={regenerateBothAgentsWithEvidence}
              />
              </>`;
    source = source.slice(0, match.index) + wrapped + source.slice(match.index + match[0].length);
    console.log("✅ Patch 3/3 applied: <MasterRiskReviewPanel /> inserted into Master Agent view (wrapped in a fragment alongside MasterAgentOverview).");
    patchesApplied++;
  } else if (source.includes("<MasterRiskReviewPanel")) {
    console.log("⏭️  Patch 3/3 skipped: <MasterRiskReviewPanel /> already present.");
  } else {
    console.log("❌ Patch 3/3 FAILED: could not find <MasterAgentOverview /> anchor.");
    patchesSkipped++;
  }
}

if (source !== originalSource) {
  fs.writeFileSync(APP_JSX_PATH, source, "utf8");
  console.log(`\n💾 App.jsx updated. (${patchesApplied} patch(es) applied, ${patchesSkipped} failed)`);
} else {
  console.log("\n⚠️  No changes were made to App.jsx.");
}

if (patchesSkipped > 0) {
  console.log("\n⚠️  Some patches FAILED — App.jsx was still updated with whatever succeeded,");
  console.log("    but please report the FAILED lines above so the remaining piece(s) can be");
  console.log("    added by hand instead.");
} else {
  console.log("\n🎉 All patches applied successfully!");
}