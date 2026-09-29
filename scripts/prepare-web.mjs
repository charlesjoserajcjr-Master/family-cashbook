// Bundles the app fonts into www/vendor so the app never contacts Google Fonts (privacy + works offline).
// If a font package is missing, the app still builds and falls back to the phone's system font.
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const nm = p => path.join(root, "node_modules", p);
const out = p => path.join(root, "www", "vendor", p);
const fonts = { "bricolage-grotesque": ["500", "700"], "instrument-sans": ["400", "500", "600"] };
let links = "";
for (const [name, weights] of Object.entries(fonts)) {
  const dir = nm("@fontsource/" + name);
  if (!fs.existsSync(dir)) { console.warn("font package missing, using system font:", name); continue; }
  fs.cpSync(path.join(dir, "files"), out("fonts/" + name + "/files"), { recursive: true });
  for (const w of weights) {
    const css = path.join(dir, w + ".css");
    if (!fs.existsSync(css)) { console.warn("missing weight", name, w); continue; }
    fs.mkdirSync(out("fonts/" + name), { recursive: true });
    fs.copyFileSync(css, out(`fonts/${name}/${w}.css`));
    links += `<link rel="stylesheet" href="vendor/fonts/${name}/${w}.css">\n`;
  }
}
const indexPath = path.join(root, "www", "index.html");
let html = fs.readFileSync(indexPath, "utf8");
html = html.replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>\s*/g, "");
html = html.replace("<title>", links + "<title>");
fs.writeFileSync(indexPath, html);
console.log("prepare-web done; bundled font stylesheets:", (links.match(/<link/g) || []).length);
