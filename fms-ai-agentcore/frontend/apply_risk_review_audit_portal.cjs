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
const backupPath = path.join(__dirname, "src", `App.jsx.bak-auditportal-${timestamp}`);
fs.writeFileSync(backupPath, originalSource, "utf8");
console.log(`✅ Backup saved to: ${backupPath}`);

let patchesApplied = 0;
let patchesSkipped = 0;

{
  const anchorIndex = source.indexOf("sidebar-doc-agents");
  if (anchorIndex !== -1 && !source.includes("openDocumentAgent(f, \"master\"); navigateTo(VIEW_RISK_REVIEW)")) {
    const afterAnchor = source.slice(anchorIndex);
    const closeMapRegex = /\)\)\}\r?\n(\s*)<\/div>/;
    const closeMatch = afterAnchor.match(closeMapRegex);

    if (closeMatch) {
      const indent = closeMatch[1];
      const button = `))}\r\n${indent}<button\r\n${indent}  className={\`sidebar-agent-btn sidebar-agent-btn-nested \${isActiveDoc && view === VIEW_RISK_REVIEW ? "sidebar-agent-active" : ""}\`}\r\n${indent}  onClick={() => { openDocumentAgent(f, "master"); navigateTo(VIEW_RISK_REVIEW); }}\r\n${indent}>\r\n${indent}  <span className="sidebar-agent-icon">🗂️</span>\r\n${indent}  <span className="sidebar-agent-label">Risk Review & Resolution</span>\r\n${indent}</button>\r\n${indent}</div>`;
      const newAfter = afterAnchor.replace(closeMapRegex, button);
      source = source.slice(0, anchorIndex) + newAfter;
      console.log("✅ Patch applied: Risk Review & Resolution button added to Audit Portal per-file dropdown.");
      patchesApplied++;
    } else {
      console.log("❌ Patch FAILED: could not find the SUB_AGENTS.map closing pattern after 'sidebar-doc-agents'.");
      patchesSkipped++;
    }
  } else if (source.includes("openDocumentAgent(f, \"master\"); navigateTo(VIEW_RISK_REVIEW)")) {
    console.log("⏭️  Patch skipped: button already present.");
  } else {
    console.log("❌ Patch FAILED: could not find 'sidebar-doc-agents' anchor text.");
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
  console.log("\n⚠️  Patch FAILED — please report the message above.");
} else {
  console.log("\n🎉 Patch applied successfully!");
}