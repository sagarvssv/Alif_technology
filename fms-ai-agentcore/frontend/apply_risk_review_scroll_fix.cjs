const fs = require("fs");
const path = require("path");

const APP_JSX_PATH = path.join(__dirname, "src", "App.jsx");
const APP_CSS_PATH = path.join(__dirname, "src", "App.css");

if (!fs.existsSync(APP_JSX_PATH)) {
  console.error(`❌ Could not find ${APP_JSX_PATH}`);
  console.error("   Run this script from inside the 'frontend' folder.");
  process.exit(1);
}

let source = fs.readFileSync(APP_JSX_PATH, "utf8");
const originalSource = source;

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupJsxPath = path.join(__dirname, "src", `App.jsx.bak-scrollfix-${timestamp}`);
fs.writeFileSync(backupJsxPath, originalSource, "utf8");
console.log(`✅ JSX backup saved to: ${backupJsxPath}`);

let patchesApplied = 0;
let patchesSkipped = 0;

{
  const oldBlockRegex = /\{view === VIEW_RISK_REVIEW && \(\r?\n(\s*)<div className="chatbot-view">\r?\n([\s\S]*?)<MasterRiskReviewPanel\r?\n([\s\S]*?)\/>\r?\n(\s*)<\/div>\r?\n(\s*)\)\}/;
  const match = source.match(oldBlockRegex);

  if (match) {
    const outerIndent = match[1];
    const navBarPart = match[2];
    const propsPart = match[3];
    const closeIndent = match[4];
    const wrapCloseIndent = match[5];

    const newBlock = `{view === VIEW_RISK_REVIEW && (\r\n${outerIndent}<div className="chatbot-view">\r\n${navBarPart}<div className="risk-review-screen-body">\r\n${closeIndent}  <MasterRiskReviewPanel\r\n${propsPart}/>\r\n${closeIndent}</div>\r\n${closeIndent}</div>\r\n${wrapCloseIndent})}`;

    source = source.replace(oldBlockRegex, newBlock);
    console.log("✅ Patch applied: MasterRiskReviewPanel wrapped in a scrollable container.");
    patchesApplied++;
  } else if (source.includes("risk-review-screen-body")) {
    console.log("⏭️  Patch skipped: scroll fix already applied.");
  } else {
    console.log("❌ Patch FAILED: could not find the VIEW_RISK_REVIEW screen block.");
    patchesSkipped++;
  }
}

if (source !== originalSource) {
  fs.writeFileSync(APP_JSX_PATH, source, "utf8");
  console.log(`💾 App.jsx updated. (${patchesApplied} patch(es) applied, ${patchesSkipped} failed)`);
} else {
  console.log("⚠️  No changes were made to App.jsx.");
}

if (fs.existsSync(APP_CSS_PATH)) {
  let css = fs.readFileSync(APP_CSS_PATH, "utf8");
  const cssBackupPath = path.join(__dirname, "src", `App.css.bak-scrollfix-${timestamp}`);
  fs.writeFileSync(cssBackupPath, css, "utf8");
  console.log(`✅ CSS backup saved to: ${cssBackupPath}`);

  if (!css.includes(".risk-review-screen-body")) {
    css += `\r\n\r\n.risk-review-screen-body {\r\n  flex: 1;\r\n  min-height: 0;\r\n  overflow-y: auto;\r\n  padding: 20px 24px 60px;\r\n}\r\n`;
    fs.writeFileSync(APP_CSS_PATH, css, "utf8");
    console.log("✅ CSS rule for .risk-review-screen-body added to App.css.");
  } else {
    console.log("⏭️  CSS rule already present in App.css.");
  }
} else {
  console.log("⚠️  Could not find App.css to add the scroll-fix CSS rule.");
}

if (patchesSkipped > 0) {
  console.log("\n⚠️  Patch FAILED — please report the message above.");
} else {
  console.log("\n🎉 Patch applied successfully!");
}