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
const backupPath = path.join(__dirname, "src", `App.jsx.bak-sidebarmove-${timestamp}`);
fs.writeFileSync(backupPath, originalSource, "utf8");
console.log(`✅ Backup saved to: ${backupPath}`);

let patchesApplied = 0;
let patchesSkipped = 0;

{
  const wrappedRegex = /<>\r?\n(\s*)(<MasterAgentOverview[\s\S]*?\/>)\r?\n\r?\n\s*<MasterRiskReviewPanel[\s\S]*?\/>\r?\n\s*<\/>/;
  const match = source.match(wrappedRegex);

  if (match) {
    const indent = match[1];
    const overviewOnly = `${indent}${match[2]}`;
    source = source.replace(wrappedRegex, overviewOnly);
    console.log("✅ Patch A applied: MasterRiskReviewPanel un-wrapped from Master Agent screen.");
    patchesApplied++;
  } else if (source.includes("view === VIEW_RISK_REVIEW &&")) {
    console.log("⏭️  Patch A skipped: already moved out of the Master Agent screen.");
  } else if (!source.includes("<MasterRiskReviewPanel")) {
    console.log("⏭️  Patch A skipped: MasterRiskReviewPanel not found in Master Agent screen (already moved?).");
  } else {
    console.log("❌ Patch A FAILED: could not find the wrapped <MasterAgentOverview>/<MasterRiskReviewPanel> fragment.");
    patchesSkipped++;
  }
}

{
  const anchor = 'const VIEW_MASTER_AGENT = "master_agent";';
  if (source.includes(anchor) && !source.includes("VIEW_RISK_REVIEW")) {
    source = source.replace(anchor, `${anchor}\nconst VIEW_RISK_REVIEW = "risk_review";`);
    console.log("✅ Patch B applied: VIEW_RISK_REVIEW constant added.");
    patchesApplied++;
  } else if (source.includes("VIEW_RISK_REVIEW")) {
    console.log("⏭️  Patch B skipped: VIEW_RISK_REVIEW already present.");
  } else {
    console.log('❌ Patch B FAILED: could not find `const VIEW_MASTER_AGENT = "master_agent";` anchor.');
    patchesSkipped++;
  }
}

{
  const yourDocIndex = source.indexOf("Your Document</div>");
  if (yourDocIndex !== -1 && !source.includes("VIEW_RISK_REVIEW ? \"sidebar-agent-active\"")) {
    const afterYourDoc = source.slice(yourDocIndex);
    const closeMapRegex = /\)\)\}\r?\n(\s*)<\/div>/;
    const closeMatch = afterYourDoc.match(closeMapRegex);

    if (closeMatch) {
      const indent = closeMatch[1];
      const button = `))}\r\n\r\n${indent}<button\r\n${indent}  className={\`sidebar-agent-btn \${view === VIEW_RISK_REVIEW ? "sidebar-agent-active" : ""}\`}\r\n${indent}  onClick={() => navigateTo(VIEW_RISK_REVIEW)}\r\n${indent}>\r\n${indent}  <span className="sidebar-agent-icon">🗂️</span>\r\n${indent}  <span className="sidebar-agent-label">Risk Review & Resolution</span>\r\n${indent}</button>\r\n${indent}</div>`;
      const newAfter = afterYourDoc.replace(closeMapRegex, button);
      source = source.slice(0, yourDocIndex) + newAfter;
      console.log("✅ Patch C applied: sidebar button for Risk Review & Resolution added.");
      patchesApplied++;
    } else {
      console.log("❌ Patch C FAILED: could not find the SUB_AGENTS.map closing pattern after 'Your Document'.");
      patchesSkipped++;
    }
  } else if (source.includes("VIEW_RISK_REVIEW ? \"sidebar-agent-active\"")) {
    console.log("⏭️  Patch C skipped: sidebar button already present.");
  } else {
    console.log("❌ Patch C FAILED: could not find 'Your Document' anchor text.");
    patchesSkipped++;
  }
}

{
  const anchor = "{/* MANAGER CHAT */}";
  if (source.includes(anchor) && !source.includes("view === VIEW_RISK_REVIEW &&")) {
    const screenBlock = `{view === VIEW_RISK_REVIEW && (
          <div className="chatbot-view">
            <div className="chatbot-nav-bar">
              <button className="back-nav-btn" onClick={() => goBack(VIEW_MASTER_AGENT)}>
                ← Back to Master Agent
              </button>
            </div>
            <MasterRiskReviewPanel
              reportId={selectedReportId}
              onRegenerateWithEvidence={regenerateBothAgentsWithEvidence}
            />
          </div>
        )}

        ${anchor}`;
    source = source.replace(anchor, screenBlock);
    console.log("✅ Patch D applied: new Risk Review & Resolution screen added.");
    patchesApplied++;
  } else if (source.includes("view === VIEW_RISK_REVIEW &&")) {
    console.log("⏭️  Patch D skipped: Risk Review screen already present.");
  } else {
    console.log("❌ Patch D FAILED: could not find '{/* MANAGER CHAT */}' anchor.");
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
  console.log("\n⚠️  Some patches FAILED — please report the FAILED lines above.");
} else {
  console.log("\n🎉 All patches applied successfully!");
}