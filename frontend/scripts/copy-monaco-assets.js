/**
 * Copies monaco-editor's prebuilt "vs" assets into public/monaco-editor/vs.
 *
 * Why this exists: by default @monaco-editor/react fetches the Monaco editor
 * runtime from a public CDN (cdn.jsdelivr.net) the first time <Editor /> mounts.
 * On machines without outbound internet access (offline dev boxes, locked-down
 * corporate networks, air-gapped VMs, etc.) that request silently hangs or
 * fails, so the file tree and the "open file" plumbing all work perfectly
 * (you can see the 200s in the API logs) but the editor pane never paints
 * anything - it *looks* like clicking a file "does nothing".
 *
 * Running this after `npm install` copies Monaco's static files into
 * public/monaco-editor/vs so they are served from the same origin as the
 * rest of the app. CodeEditor.tsx points @monaco-editor/react's loader at
 * that local path instead of the CDN.
 */
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "node_modules", "monaco-editor", "min", "vs");
const dest = path.join(__dirname, "..", "public", "monaco-editor", "vs");

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const fromPath = path.join(from, entry.name);
    const toPath = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(fromPath, toPath);
    else fs.copyFileSync(fromPath, toPath);
  }
}

if (!fs.existsSync(src)) {
  console.warn("[copy-monaco-assets] monaco-editor/min/vs not found - skipping (did `npm install` run fully?)");
  process.exit(0);
}

copyDir(src, dest);
console.log(`[copy-monaco-assets] copied Monaco assets to ${path.relative(process.cwd(), dest)}`);
