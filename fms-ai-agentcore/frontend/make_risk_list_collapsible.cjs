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
const backupPath = actualPath.replace(/\.jsx$/, `.jsx.bak-collapse-${timestamp}`);
fs.writeFileSync(backupPath, originalSource, "utf8");
console.log(`✅ Backup saved to: ${backupPath}`);

let applied = 0;
let skipped = 0;

{
  const anchor = "const [riskReviewLoading, setRiskReviewLoading] = useState(false);";
  const replacement = `${anchor}
  const [showRiskReviewDetails, setShowRiskReviewDetails] = useState(false);

  function truncateRiskArea(text, max = 90) {
    if (!text || text.length <= max) return text;
    return text.slice(0, max).trim() + "…";
  }`;
  if (source.includes(anchor) && !source.includes("showRiskReviewDetails")) {
    source = source.replace(anchor, replacement);
    console.log("✅ Patch 1/2 applied: collapse state + truncate helper added.");
    applied++;
  } else if (source.includes("showRiskReviewDetails")) {
    console.log("⏭️  Patch 1/2 skipped: already present.");
    skipped++;
  } else {
    console.log("❌ Patch 1/2 FAILED: could not find riskReviewLoading state anchor.");
    skipped++;
  }
}

{
  const oldBlock = `                <ul className="pdb-risk-review-list">
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
                </ul>`;

  const newBlock = `                <button
                  className="pdb-risk-review-toggle"
                  onClick={() => setShowRiskReviewDetails((v) => !v)}
                >
                  {showRiskReviewDetails ? "▲ Hide full list" : \`▼ Show all \${taggedRiskRows.length} risks\`}
                </button>
                {showRiskReviewDetails && (
                  <ul className="pdb-risk-review-list">
                    {taggedRiskRows.map((r, i) => {
                      const key = buildDashboardRiskKey(r.area, r.agentId);
                      const statusValue = riskReviewStatuses[key]?.status || "open";
                      const meta = RISK_REVIEW_STATUS_META[statusValue] || RISK_REVIEW_STATUS_META.open;
                      const customText = riskReviewStatuses[key]?.customStatusText;
                      return (
                        <li key={i} className="pdb-risk-review-item">
                          <span className="pdb-risk-review-area" title={r.area}>{truncateRiskArea(r.area)}</span>
                          <span className="pdb-risk-review-status-badge">
                            {meta.icon} {statusValue === "other" && customText ? customText : meta.label}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}`;

  const normalizedSource = source.replace(/\r\n/g, "\n");
  const normalizedOldBlock = oldBlock.replace(/\r\n/g, "\n");
  const normalizedNewBlock = newBlock.replace(/\r\n/g, "\n");

  if (normalizedSource.includes(normalizedOldBlock) && !source.includes("pdb-risk-review-toggle")) {
    const patchedNormalized = normalizedSource.replace(normalizedOldBlock, normalizedNewBlock);
    source = patchedNormalized.replace(/\n/g, "\r\n");
    console.log("✅ Patch 2/2 applied: list is now collapsible with a toggle, and long text is truncated.");
    applied++;
  } else if (source.includes("pdb-risk-review-toggle")) {
    console.log("⏭️  Patch 2/2 skipped: already present.");
    skipped++;
  } else {
    console.log("❌ Patch 2/2 FAILED: could not find the exact <ul> block. Nothing was changed for this part.");
    skipped++;
  }
}

if (source !== originalSource) {
  fs.writeFileSync(actualPath, source, "utf8");
  console.log(`\n💾 ProjectDashboard.jsx updated. (${applied} patch(es) applied, ${skipped} skipped/failed)`);
} else {
  console.log("\n⚠️  No changes were made.");
}