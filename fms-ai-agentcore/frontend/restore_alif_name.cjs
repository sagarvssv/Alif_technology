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
const backupPath = path.join(__dirname, "src", `App.jsx.bak-before-restore-name-${timestamp}`);
fs.writeFileSync(backupPath, originalSource, "utf8");
console.log(`✅ Backup saved to: ${backupPath}`);

const replacements = [
  { from: "Project History", to: "Alif Technologies — Project History" },
  { from: '<h1 className="portal-title"></h1>', to: '<h1 className="portal-title">Alif Technologies</h1>' },
  { from: '<span className="brand-name"></span>', to: '<span className="brand-name">Alif Technologies</span>' },
  { from: '<h1 className="home-hero-title"></h1>', to: '<h1 className="home-hero-title">Alif Technologies</h1>' },
];

let applied = 0;
let skipped = 0;

{
  const target = "Project History";
  const alreadyRestored = "Alif Technologies — Project History";
  if (source.includes(alreadyRestored)) {
    console.log(`⏭️  Already restored: "${alreadyRestored}"`);
    skipped++;
  } else if (source.includes(target)) {
    source = source.replace(target, alreadyRestored);
    console.log(`✅ Restored: "${alreadyRestored}"`);
    applied++;
  } else {
    console.log(`❌ NOT FOUND (skipped): "${target}"`);
    skipped++;
  }
}

for (const { from, to } of replacements.slice(1)) {
  if (source.includes(from)) {
    source = source.split(from).join(to);
    console.log(`✅ Restored: "${to.slice(0, 50)}..."`);
    applied++;
  } else if (source.includes(to)) {
    console.log(`⏭️  Already restored: "${to.slice(0, 50)}..."`);
    skipped++;
  } else {
    console.log(`❌ NOT FOUND (skipped): "${from.slice(0, 50)}..."`);
    skipped++;
  }
}

if (source !== originalSource) {
  fs.writeFileSync(APP_JSX_PATH, source, "utf8");
  console.log(`\n💾 App.jsx updated. (${applied} spot(s) restored, ${skipped} skipped/not found)`);
} else {
  console.log("\n⚠️  No changes were made — the name may already be restored, or the text has changed.");
}