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
const backupPath = path.join(__dirname, "src", `App.jsx.bak-removesidebar-fixed-${timestamp}`);
fs.writeFileSync(backupPath, originalSource, "utf8");
console.log(`✅ Backup saved to: ${backupPath}`);

let removed = 0;
let skipped = 0;

{
  const regex1 = /\r?\n\s*<button\r?\n\s*className=\{`sidebar-agent-btn \$\{view === VIEW_RISK_REVIEW[\s\S]*?Risk Review & Resolution<\/span>\r?\n\s*<\/button>/;
  const match = source.match(regex1);
  if (match) {
    source = source.replace(regex1, "");
    console.log("✅ Removed: 'Your Document' section Risk Review button.");
    removed++;
  } else {
    console.log("⏭️  Not found (already removed): 'Your Document' section button.");
    skipped++;
  }
}

{
  const regex2 = /\r?\n\s*<button\r?\n\s*className=\{`sidebar-agent-btn sidebar-agent-btn-nested \$\{isActiveDoc && view === VIEW_RISK_REVIEW[\s\S]*?Risk Review & Resolution<\/span>\r?\n\s*<\/button>/;
  const match = source.match(regex2);
  if (match) {
    source = source.replace(regex2, "");
    console.log("✅ Removed: Audit Portal per-file dropdown Risk Review button.");
    removed++;
  } else {
    console.log("⏭️  Not found (already removed): Audit Portal dropdown button.");
    skipped++;
  }
}

if (source !== originalSource) {
  fs.writeFileSync(APP_JSX_PATH, source, "utf8");
  console.log(`\n💾 App.jsx updated. (${removed} button(s) removed, ${skipped} not found)`);
} else {
  console.log("\n⚠️  No changes were made.");
}