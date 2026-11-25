#!/usr/bin/env node
/* Cache-busting: appends ?v=<hash of the file's contents> to every local script/stylesheet/logo in index.html.
 * Browsers (and GitHub Pages' 10-minute cache) then fetch a changed file immediately, and keep unchanged ones.
 *   npm run stamp      (also runs automatically before `npm run build` and on commit via tools/publish.sh) */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..'), file = path.join(root, 'index.html');
let html = fs.readFileSync(file, 'utf8'), n = 0;
html = html.replace(/(<(?:script|link|img)\b[^>]*?\b(?:src|href)=")([\w.\-\/]+\.(?:js|css|png))(?:\?v=[0-9a-f]+)?(")/g, (m, a, f, z) => {
  const p = path.join(root, f); if (!fs.existsSync(p)) return m;
  n++; return `${a}${f}?v=${crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex').slice(0, 8)}${z}`;
});
fs.writeFileSync(file, html);
console.log(`Stamped ${n} assets in index.html`);
