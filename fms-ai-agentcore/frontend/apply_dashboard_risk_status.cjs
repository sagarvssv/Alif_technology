const fs = require("fs");
const path = require("path");

const FILE_PATH = path.join(__dirname, "src", "components", "ProjectDashboard.jsx");
const ALT_PATH  = path.join(__dirname, "src", "ProjectDashboard.jsx");
const actualPath = fs.existsSync(FILE_PATH) ? FILE_PATH : ALT_PATH;

if (!fs.existsSync(actualPath)) {
  console.error(`❌ Could not find ProjectDashboard.jsx`);
  process.exit(1);
}

let source = fs.readFileSync(actualPath, "utf8");
const originalSource = source;

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = actualPath.replace(/\.jsx$/, `.jsx.bak-riskstatus-${timestamp}`);
fs.writeFileSync(backupPath, originalSource, "utf8");
console.log(`✅ Backup saved to: ${backupPath}`);

let applied = 0;
let skipped = 0;

{
  const anchor = 'import React, { useMemo, useState } from "react";';
  const replacement = 'import React, { useMemo, useState, useEffect } from "react";';
  if (source.includes(anchor)) {
    source = source.replace(anchor, replacement);
    console.log("✅ Patch 1/4 applied: useEffect imported.");
    applied++;
  } else if (source.includes("useEffect } from \"react\"") || source.includes("useEffect} from \"react\"")) {
    console.log("⏭️  Patch 1/4 skipped: useEffect already imported.");
    skipped++;
  } else {
    console.log("❌ Patch 1/4 FAILED: could not find the React import line.");
    skipped++;
  }
}

{
  const anchor = "function ProjectDashboard({ project, reportMarkdown, onUpdateProject }) {";
  const replacement = "function ProjectDashboard({ project, reportMarkdown, onUpdateProject, reportId, auditPlanningMarkdown, fsReviewMarkdown }) {";
  if (source.includes(anchor)) {
    source = source.replace(anchor, replacement);
    console.log("✅ Patch 2/4 applied: new props added to function signature.");
    applied++;
  } else if (source.includes("auditPlanningMarkdown")) {
    console.log("⏭️  Patch 2/4 skipped: new props already present.");
    skipped++;
  } else {
    console.log("❌ Patch 2/4 FAILED: could not find the function signature line.");
    skipped++;
  }
}

{
  const anchor = 'const riskRows = useMemo(() => (hasReport ? parseRiskRows(reportMarkdown) : []), [reportMarkdown, hasReport]);';
  const newCode = `${anchor}

  // ─── Per-Risk Review Status (ADD-ON) ────────────────────────────────
  const taggedRiskRows = useMemo(() => {
    const tag = (markdown, agentId) =>
      parseRiskRows(markdown || "").map((r) => ({ ...r, agentId }));
    return [
      ...tag(auditPlanningMarkdown, "audit_planning_agent"),
      ...tag(fsReviewMarkdown, "fs_review_agent"),
    ];
  }, [auditPlanningMarkdown, fsReviewMarkdown]);

  function buildDashboardRiskKey(area, agentId) {
    const safeArea = (area || "").trim().toLowerCase().replace(/\\s+/g, "-");
    return \`\${reportId || "no-report"}::\${agentId || "no-agent"}::\${safeArea}\`;
  }

  const [riskReviewStatuses, setRiskReviewStatuses] = useState({});
  const [riskReviewLoading, setRiskReviewLoading] = useState(false);

  useEffect(() => {
    if (!reportId || taggedRiskRows.length === 0) {
      setRiskReviewStatuses({});
      return;
    }
    let cancelled = false;
    setRiskReviewLoading(true);
    const apiBase =
      import.meta.env.VITE_API_BASE_URL ||
      "https://c0feinpvm5.execute-api.eu-central-1.amazonaws.com/prod";
    Promise.all(
      taggedRiskRows.map((r) => {
        const key = buildDashboardRiskKey(r.area, r.agentId);
        return fetch(\`\${apiBase}/risks/\${encodeURIComponent(key)}\`)
          .then((res) => res.json())
          .then((data) => [key, data])
          .catch(() => [key, null]);
      })
    ).then((entries) => {
      if (cancelled) return;
      const map = {};
      entries.forEach(([key, data]) => { if (data) map[key] = data; });
      setRiskReviewStatuses(map);
      setRiskReviewLoading(false);
    });
    return () => { cancelled = true; };
  }, [reportId, taggedRiskRows]);

  const RISK_REVIEW_STATUS_META = {
    open:            { label: "Open",             icon: "🔴" },
    in_process:      { label: "In Process",       icon: "🟡" },
    review:          { label: "Review",           icon: "🔵" },
    closed_resolved: { label: "Closed / Resolved", icon: "✅" },
    other:           { label: "Other",            icon: "⚪" },
  };

  const riskReviewCounts = useMemo(() => {
    const counts = { open: 0, in_process: 0, review: 0, closed_resolved: 0, other: 0 };
    taggedRiskRows.forEach((r) => {
      const key = buildDashboardRiskKey(r.area, r.agentId);
      const status = riskReviewStatuses[key]?.status || "open";
      if (counts[status] !== undefined) counts[status]++;
    });
    return counts;
  }, [taggedRiskRows, riskReviewStatuses]);`;

  if (source.includes(anchor) && !source.includes("taggedRiskRows")) {
    source = source.replace(anchor, newCode);
    console.log("✅ Patch 3/4 applied: risk review status computation added.");
    applied++;
  } else if (source.includes("taggedRiskRows")) {
    console.log("⏭️  Patch 3/4 skipped: computation already present.");
    skipped++;
  } else {
    console.log("❌ Patch 3/4 FAILED: could not find the riskRows useMemo anchor.");
    skipped++;
  }
}

{
  const anchor = "        {/* Risk Rankings */}";
  const newCard = `        {/* Risk Review Status (ADD-ON) */}
        {taggedRiskRows.length > 0 && (
          <div className="pdb-card pdb-card-wide">
            <div className="pdb-card-label">🗂️ Risk Review Status</div>
            {riskReviewLoading ? (
              <p className="pdb-card-empty">Loading review status…</p>
            ) : (
              <>
                <div className="pdb-risk-review-summary">
                  {Object.entries(RISK_REVIEW_STATUS_META).map(([value, { label, icon }]) => (
                    <span key={value} className="pdb-risk-review-count">
                      {icon} {riskReviewCounts[value] || 0} {label}
                    </span>
                  ))}
                </div>
                <ul className="pdb-risk-review-list">
                  {taggedRiskRows.map((r, i) => {
                    const key = buildDashboardRiskKey(r.area, r.agentId);
                    const statusValue = riskReviewStatuses[key]?.status || "open";
                    const meta = RISK_REVIEW_STATUS_META[statusValue] || RISK_REVIEW_STATUS_META.open;
                    const customText = riskReviewStatuses[key]?.customStatusText;
                    return (
                      <li key={i} className="pdb-risk-review-item">
                        <span className="pdb-risk-review-area">{r.area}</span>
                        <span className="pdb-risk-review-status-badge">
                          {meta.icon} {statusValue === "other" && customText ? customText : meta.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}

${anchor}`;

  if (source.includes(anchor) && !source.includes("pdb-risk-review-summary")) {
    source = source.replace(anchor, newCard);
    console.log("✅ Patch 4/4 applied: Risk Review Status card added to dashboard.");
    applied++;
  } else if (source.includes("pdb-risk-review-summary")) {
    console.log("⏭️  Patch 4/4 skipped: card already present.");
    skipped++;
  } else {
    console.log("❌ Patch 4/4 FAILED: could not find the Risk Rankings comment anchor.");
    skipped++;
  }
}

if (source !== originalSource) {
  fs.writeFileSync(actualPath, source, "utf8");
  console.log(`\n💾 ProjectDashboard.jsx updated. (${applied} patch(es) applied, ${skipped} skipped/failed)`);
} else {
  console.log("\n⚠️  No changes were made.");
}