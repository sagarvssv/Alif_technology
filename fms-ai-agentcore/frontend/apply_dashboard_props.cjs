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
const backupPath = path.join(__dirname, "src", `App.jsx.bak-dashboardprops-${timestamp}`);
fs.writeFileSync(backupPath, originalSource, "utf8");
console.log(`✅ Backup saved to: ${backupPath}`);

const anchor = `<ProjectDashboard
              project={selectedProjectItem}
              reportMarkdown={[agentReports.audit_planning_agent?.content, agentReports.fs_review_agent?.content]
                .filter(Boolean)
                .join("\\n\\n---\\n\\n")}
              onUpdateProject={(updates) =>
                setSelectedProjectItem((prev) => ({ ...prev, ...updates }))
              }
            />`;

const replacement = `<ProjectDashboard
              project={selectedProjectItem}
              reportMarkdown={[agentReports.audit_planning_agent?.content, agentReports.fs_review_agent?.content]
                .filter(Boolean)
                .join("\\n\\n---\\n\\n")}
              reportId={selectedReportId}
              auditPlanningMarkdown={agentReports.audit_planning_agent?.content}
              fsReviewMarkdown={agentReports.fs_review_agent?.content}
              onUpdateProject={(updates) =>
                setSelectedProjectItem((prev) => ({ ...prev, ...updates }))
              }
            />`;

let applied = 0;
let skipped = 0;

const normalizedSource = source.replace(/\r\n/g, "\n");
const normalizedAnchor = anchor.replace(/\r\n/g, "\n");

if (normalizedSource.includes(normalizedAnchor) && !source.includes("auditPlanningMarkdown")) {
  const normalizedReplacement = replacement.replace(/\r\n/g, "\n");
  const patchedNormalized = normalizedSource.replace(normalizedAnchor, normalizedReplacement);
  source = patchedNormalized.replace(/\n/g, "\r\n");
  console.log("✅ Patch applied: reportId + per-agent markdown props added to <ProjectDashboard>.");
  applied++;
} else if (source.includes("auditPlanningMarkdown")) {
  console.log("⏭️  Patch skipped: props already present.");
  skipped++;
} else {
  console.log("❌ Patch FAILED: could not find the exact <ProjectDashboard> block. Nothing was changed.");
  skipped++;
}

if (source !== originalSource) {
  fs.writeFileSync(APP_JSX_PATH, source, "utf8");
  console.log(`\n💾 App.jsx updated. (${applied} patch(es) applied, ${skipped} skipped/failed)`);
} else {
  console.log("\n⚠️  No changes were made.");
}