#!/usr/bin/env node
/* UI smoke tests in a simulated browser (jsdom). Not a substitute for a real-browser check.
 *   npm install            (once; installs jsdom from package.json)
 *   npm run test:ui
 * Loads index.html with every script, clicks through each tab, runs Optimize, drags a card,
 * and fails on any script error or stray "null" / "undefined" / "[object" text on the page. */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.join(__dirname, '..');

function boot(savedState) {
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/requestAnimationFrame/.test(e.message)) errors.push(e.message); });
  let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script defer src="([^"]+)"><\/script>/g)].map(m => m[1]);
  html = html.replace(/<script defer src="[^"]+"><\/script>/g, '')
    .replace('</body>', () => scripts.map(f => `<script>${fs.readFileSync(path.join(root, f.split('?')[0]), 'utf8')}</script>`).join('\n') + '</body>');
  if (savedState) html = html.replace('<body>', `<body><script>localStorage.setItem("lgu-field-planner-v1",${JSON.stringify(JSON.stringify(savedState)).replace(/</g, '\\u003c')});</script>`);
  const w = new JSDOM(html, { runScripts: 'dangerously', virtualConsole: vc, url: 'http://localhost/', pretendToBeVisual: true }).window;
  w.confirm = () => true; w.alert = () => {}; w.HTMLElement.prototype.scrollIntoView = function () {};
  return { w, d: w.document, errors };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const text = e => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
function strayText(d) {
  const hits = [], tw = d.createTreeWalker(d.body, 4); let n;
  while ((n = tw.nextNode())) if (/\b(null|undefined|NaN)\b|\[object /.test(n.nodeValue) && !n.parentElement.closest('script')) hits.push(n.nodeValue.slice(0, 80));
  return hits;
}
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log(`  ✓ ${msg}`); };

(async () => {
  const { w, d, errors } = boot(null);
  await wait(400);
  ok(d.querySelectorAll('.kpi').length >= 6, 'dashboard KPIs render');
  for (const tab of [...d.querySelectorAll('[role=tab]')].map(b => b.dataset.tab)) {
    d.querySelector(`[data-tab=${tab}]`).click(); await wait(tab === 'longterm' ? 300 : 80);
    ok(!d.getElementById(tab).hidden, `tab "${tab}" opens`);
    const stray = strayText(d); ok(stray.length === 0, `tab "${tab}" has no stray null/undefined/[object text${stray.length ? ': ' + stray[0] : ''}`);
  }
  // Optimize
  d.querySelector('[data-tab=board]').click(); await wait(80);
  const before = text(d.querySelector('.kpi .v'));
  const startCount = w.LGUAnalysis.analyze(JSON.parse(JSON.stringify(w.LGU_SEED))).fields.length && JSON.parse(JSON.stringify(w.LGU_SEED)).bookings.length;
  d.getElementById('board-optimize').click(); await wait(80);
  const apply = [...d.querySelectorAll('#opt-panel button')].find(b => b.textContent.startsWith('Apply'));
  ok(!!apply, 'Optimize preview opens');
  apply.click(); await wait(700);
  const st = JSON.parse(w.localStorage.getItem('lgu-field-planner-v1'));
  const r = w.LGUAnalysis.analyze(st);
  ok(r.fields.every(f => !f.usable || w.LGUAnalysis.DAYS.every(x => !f.byDay[x].capacity || f.byDay[x].peakPlayers <= f.byDay[x].capacity)), 'no usable field over capacity after Optimize');
  ok(st.bookings.filter(b => /Optimize/.test(b.note || '')).every(b => w.LGUAnalysis.toMin(b.end) - w.LGUAnalysis.toMin(b.start) <= 90), 'Optimize sessions are normal length');
  // Undo
  d.getElementById('undo').click(); await wait(400);
  const afterUndo = JSON.parse(w.localStorage.getItem('lgu-field-planner-v1')).bookings;
  ok(afterUndo.length === startCount && !afterUndo.some(b => /Optimize/.test(b.note || '')), `undo reverts Optimize (${st.bookings.length} → ${afterUndo.length} bookings)`);
  // Fixed capacity after removing a card
  d.querySelector('[data-tab=board]').click(); await wait(80);
  const head = () => [...d.querySelectorAll('#board-grid .brow-head')].find(x => x.querySelector('b').textContent === 'Daves Avenue Elementary').querySelector('small').textContent;
  const cap0 = head();
  const dt = { data: {}, setData(k, v) { this.data[k] = v; }, getData(k) { return this.data[k]; } };
  const ev = t => { const e = new w.Event(t, { bubbles: true, cancelable: true }); e.dataTransfer = dt; return e; };
  const cardEl = d.querySelector('#board-grid .bcell[data-field="Daves Avenue Elementary"][data-day="Mon"] .bcard');
  cardEl.dispatchEvent(ev('dragstart')); d.getElementById('dz-delete').dispatchEvent(ev('dragover')); d.getElementById('dz-delete').dispatchEvent(ev('drop')); cardEl.dispatchEvent(ev('dragend'));
  await wait(400);
  ok(head() === cap0, `field capacity stays fixed after removing a session (${cap0})`);
  // Long Term Planning
  d.querySelector('[data-tab=longterm]').click(); await wait(300);
  ok(d.querySelectorAll('.lt-focus').length === 3, 'Long Term Planning focus strip has 3 items');
  ok(d.querySelectorAll('#lt-opps .lt-cap').length > 0, 'opportunity cards show player capacity');
  ok(errors.length === 0, `no script errors${errors.length ? ': ' + errors[0] : ''}`);
  console.log(`\nUI tests passed (${passed} checks).`);
  process.exit(0);
})().catch(e => { console.error('UI test failed:', e.message); process.exit(1); });
