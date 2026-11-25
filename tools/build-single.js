#!/usr/bin/env node
/* Bundle the planner into ONE self-contained HTML file for sharing.
 *   node tools/build-single.js            -> dist/lgu-field-planner.html
 * Inlines style.css, every <script src>, and logo.png (as a data URI).
 * The result works offline from a file, email attachment, SharePoint/Drive or any static web host. */
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let html = read('index.html');

html = html.replace(/<link rel="stylesheet" href="([^"?]+)(?:\?[^"]*)?">/g, (_, f) => `<style>\n${read(f)}\n</style>`);
html = html.replace(/<script defer src="([^"?]+)(?:\?[^"]*)?"><\/script>/g, (_, f) =>
  `<script>\n${read(f).replace(/<\/script/gi, '<\\/script')}\n</script>`);
// Inline scripts run immediately (no defer), so move them to the end of <body> to keep DOM-ready order.
const scripts = [];
html = html.replace(/<script>\n[\s\S]*?\n<\/script>/g, s => { scripts.push(s); return ''; });
html = html.replace('</body>', `${scripts.join('\n')}\n</body>`);

const logo = path.join(root, 'logo.png');
if (fs.existsSync(logo)) {
  const uri = `data:image/png;base64,${fs.readFileSync(logo).toString('base64')}`;
  html = html.replace(/"logo\.png(?:\?[^"]*)?"/g, `"${uri}"`);
}
const stamp = new Date().toISOString().slice(0, 10);
html = html.replace('<head>', `<head>\n  <!-- Built ${stamp} by tools/build-single.js from the LGU Field Planner source. Edit the source, not this file. -->`);

const out = path.join(root, 'dist', 'lgu-field-planner.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Wrote ${path.relative(root, out)} (${(html.length / 1024).toFixed(0)} KB, ${scripts.length} scripts inlined)`);
