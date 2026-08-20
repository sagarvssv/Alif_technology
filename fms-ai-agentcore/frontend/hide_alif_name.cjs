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
const backupPath = path.join(__dirname, "src", `App.jsx.bak-before-hide-name-${timestamp}`);
fs.writeFileSync(backupPath, originalSource, "utf8");
console.log(`✅ Backup saved to: ${backupPath}`);

const replacements = [
  { from: "Alif Technologies — Project History", to: "Project History" },
  { from: '<h1 className="portal-title">Alif Technologies</h1>', to: '<h1 className="portal-title"></h1>' },
  { from: '<span className="brand-name">Alif Technologies</span>', to: '<span className="brand-name"></span>' },
  { from: '<h1 className="home-hero-title">Alif Technologies</h1>', to: '<h1 className="home-hero-title"></h1>' },
];

let applied = 0;
let skipped = 0;

for (const { from, to } of replacements) {
  if (source.includes(from)) {
    source = source.split(from).join(to);
    console.log(`✅ Hidden: "${from.slice(0, 50)}..."`);
    applied++;
  } else if (source.includes(to)) {
    console.log(`⏭️  Already hidden: "${to.slice(0, 50)}..."`);
    skipped++;
  } else {
    console.log(`❌ NOT FOUND (skipped, nothing changed for this one): "${from.slice(0, 50)}..."`);
    skipped++;
  }
}

if (source !== originalSource) {
  fs.writeFileSync(APP_JSX_PATH, source, "utf8");
  console.log(`\n💾 App.jsx updated. (${applied} spot(s) hidden, ${skipped} skipped/not found)`);
} else {
  console.log("\n⚠️  No changes were made — the name may already be hidden, or the text has changed.");
}

console.log("\nWhen your demo is done, run: node restore_alif_name.cjs");