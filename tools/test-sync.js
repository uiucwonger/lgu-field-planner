#!/usr/bin/env node
/* Shared-versions (GitHub) tests against an in-memory fake of the GitHub REST API.
 *   npm run test:sync     (needs `npm install` for jsdom)
 * Simulates several browsers (separate localStorage) sharing one fake repository. */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.join(__dirname, '..');

// ---------------- fake GitHub (one repo; commits touch one file each)
const repo = { commits: [] }; // newest first: {sha, path, message, author, date, fileSha, text}
let n = 0;
const sha = () => (++n).toString(16).padStart(40, 'a');
const latestFor = (path, ref) => repo.commits.find(c => c.path === path && (ref === 'main' || !ref || c.sha === ref)) ||
  (ref && ref !== 'main' ? (() => { const i = repo.commits.findIndex(c => c.sha === ref); return i < 0 ? null : repo.commits.slice(i).find(c => c.path === path); })() : null);
function fakeFetch(url, opts = {}) {
  const u = new URL(url), auth = (opts.headers || {}).Authorization, ok = auth === 'Bearer good-token';
  const json = (status, body) => Promise.resolve({ ok: status < 300, status, statusText: String(status), json: async () => body, text: async () => JSON.stringify(body) });
  if (u.hostname === 'raw.githubusercontent.com') {
    const path = u.pathname.split('/').slice(4).join('/'); const c = latestFor(path, 'main');
    return c ? json(200, JSON.parse(c.text)) : json(404, {});
  }
  const m = u.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
  if (!m) return json(404, { message: 'Not Found' });
  const rest = m[3] || '';
  if (rest === '') return json(200, { full_name: `${m[1]}/${m[2]}`, permissions: { push: ok, admin: false } });
  if (rest === '/commits') {
    const path = u.searchParams.get('path');
    return json(200, repo.commits.filter(c => c.path === path).slice(0, Number(u.searchParams.get('per_page')) || 30)
      .map(c => ({ sha: c.sha, html_url: `https://github.com/x/commit/${c.sha}`, commit: { message: c.message, author: { name: c.author, date: c.date } } })));
  }
  if (rest.startsWith('/contents/')) {
    const path = decodeURIComponent(rest.slice('/contents/'.length));
    if ((opts.method || 'GET') === 'GET') {
      const c = latestFor(path, u.searchParams.get('ref'));
      return c ? json(200, { sha: c.fileSha, encoding: 'base64', content: Buffer.from(c.text, 'utf8').toString('base64') }) : json(404, { message: 'Not Found' });
    }
    if (!ok) return json(401, { message: 'Bad credentials' });
    const body = JSON.parse(opts.body); const head = latestFor(path, 'main');
    if (head && body.sha !== head.fileSha) return json(409, { message: 'is at ' + head.fileSha + ' but expected ' + body.sha });
    const c = { sha: sha(), path, fileSha: sha(), message: body.message, author: (body.author && body.author.name) || 'uiucwonger', date: new Date(Date.now() + n * 1000).toISOString(), text: Buffer.from(body.content, 'base64').toString('utf8') };
    repo.commits.unshift(c);
    return json(201, { content: { sha: c.fileSha }, commit: { sha: c.sha, author: { name: c.author, date: c.date } } });
  }
  return json(404, { message: 'Not Found' });
}
const planCommits = () => repo.commits.filter(c => c.path === 'data/plan.json');

// ---------------- a "browser"
function browser(storage = {}, url = 'https://uiucwonger.github.io/lgu-field-planner/') {
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/requestAnimationFrame/.test(e.message)) errors.push(e.message); });
  let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script defer src="([^"]+)"><\/script>/g)].map(m => m[1]);
  const pre = `<script>${Object.entries(storage).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v).replace(/</g, '\\u003c')});`).join('')}</script>`;
  html = html.replace(/<script defer src="[^"]+"><\/script>/g, '').replace('<body>', '<body>' + pre)
    .replace('</body>', () => scripts.map(f => `<script>${fs.readFileSync(path.join(root, f), 'utf8')}</script>`).join('\n') + '</body>');
  const w = new JSDOM(html, { runScripts: 'dangerously', virtualConsole: vc, url, pretendToBeVisual: true,
    beforeParse(win) { win.fetch = fakeFetch; win.TextEncoder = TextEncoder; win.TextDecoder = TextDecoder; } }).window;
  w.confirm = () => true; w.alert = m => { w.__alert = m; }; w.prompt = (q, d) => /^Your name/.test(q) ? 'Jason Wong' : (w.__nextName || d); w.HTMLElement.prototype.scrollIntoView = function () {};
  return { w, d: w.document, errors, storage: () => Object.fromEntries(Object.keys(w.localStorage).map(k => [k, w.localStorage.getItem(k)])) };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const T = e => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed++; console.log(`  ✓ ${m}`); };
const bookings = w => w.eval('state.bookings.length');
async function saveVia(b, name) {
  b.w.__nextName = name;
  b.d.getElementById('quick-version').click();
  await wait(500);
  b.d.querySelector('[data-tab=history]').click(); await wait(100);
  return T(b.d.querySelector('#shared-card .shared-status'));
}
const EDITOR = 'https://uiucwonger.github.io/lgu-field-planner/#key=good-token';

(async () => {
  // 1. View-only visitor (plain link): nothing published yet, Save version stays on the device
  let V = browser(); await wait(500);
  ok(V.w.LGUShared.cfg().owner === 'uiucwonger' && V.w.LGUShared.cfg().repo === 'lgu-field-planner', 'repo detected from the github.io address');
  V.d.querySelector('[data-tab=history]').click(); await wait(100);
  ok(/View only/.test(T(V.d.getElementById('shared-card'))) && /Nothing published yet/.test(T(V.d.getElementById('shared-card'))), 'plain link = view only; "Nothing published yet"');
  ok(!/token/i.test(T(V.d.getElementById('shared-card'))), 'no token box or token wording anywhere');
  ok(V.d.getElementById('quick-version').hidden, 'view-only: no Save version button');

  // 2. Editor link: no setup, Save version saves for everyone
  let A = browser({}, EDITOR); await wait(500);
  ok(A.w.location.hash === '' && !A.w.location.href.includes('good-token'), 'key is removed from the address bar');
  ok(A.w.LGUShared.canPublish(), 'editor link enables saving for everyone');
  A.w.eval("state.bookings = state.bookings.slice(0, 400); changed(true);"); await wait(300);
  ok(/for everyone/.test(await saveVia(A, 'Week of Dec 1 – first shared plan')), 'header "Save version" saves for everyone');
  ok(planCommits().length === 1 && JSON.parse(planCommits()[0].text).bookings.length === 400, 'GitHub holds the plan as a commit');
  ok(planCommits()[0].author === 'Jason Wong', 'shared history shows the editor\'s name');
  ok(!A.d.getElementById('quick-version').hidden, 'editor sees the Save version button');
  ok(!A.d.getElementById('version-table') && A.w.localStorage.getItem('lgu-field-planner-versions-v1') === null, 'no versions stored on the device');
  const editorAgain = browser(A.storage()); await wait(500);
  ok(editorAgain.w.LGUShared.canPublish(), 'editor stays an editor on later visits with the plain link');

  // 3. New visitor B (fresh browser) gets the shared plan automatically
  let B = browser(); await wait(600);
  ok(bookings(B.w) === 400, 'first-time visitor starts from the shared plan (400 bookings, not the seed)');
  ok(/Loaded shared plan/.test(T(B.d.getElementById('save-state'))), 'visitor sees "Loaded shared plan"');
  const bStore = B.storage();

  // 4. A publishes again; returning visitor B (no local edits) follows automatically
  A.w.eval("state.bookings = state.bookings.slice(0, 390); changed(true);"); await wait(300);
  await saveVia(A, 'Week of Dec 8');
  B = browser(bStore); await wait(600);
  ok(bookings(B.w) === 390, 'returning visitor with no edits auto-updates to the latest shared version');

  // 5. Visitor with unpublished edits: banner instead of overwrite
  B.w.eval("state.bookings = state.bookings.slice(0, 380); changed(true);"); await wait(400);
  const bEdited = B.storage();
  A.w.eval("state.bookings = state.bookings.slice(0, 385); changed(true);"); await wait(300);
  await saveVia(A, 'Week of Dec 15');
  B = browser(bEdited); await wait(600);
  ok(bookings(B.w) === 380, 'local unpublished edits are NOT overwritten');
  ok(!B.d.getElementById('shared-banner').hidden && /newer shared plan/.test(T(B.d.getElementById('shared-banner'))), 'banner offers the newer shared plan');
  [...B.d.querySelectorAll('#shared-banner button')].find(x => x.textContent === 'Load it').click(); await wait(400);
  ok(bookings(B.w) === 385, '"Load it" loads the latest shared plan');
  B.d.getElementById('undo').click(); await wait(400);
  ok(bookings(B.w) === 380, 'Undo right after loading brings the unsaved edits back');
  B.d.getElementById('redo').click(); await wait(400);

  // 6. History: list, compare, load an older version
  B.d.querySelector('[data-tab=history]').click(); await wait(100);
  const rows = B.d.querySelectorAll('#shared-card .shared-table tbody tr');
  ok(rows.length === 3, `shared history lists all ${rows.length} published versions`);
  [...rows[2].querySelectorAll('button')].find(x => x.textContent === 'Compare').click(); await wait(400);
  ok(/Bookings added/.test(T(B.d.getElementById('version-diff'))), 'compare against an older shared version works');
  [...rows[2].querySelectorAll('button')].find(x => x.textContent === 'Load').click(); await wait(400);
  ok(bookings(B.w) === 400, 'load an older shared version (400 bookings)');

  // 7. Two editors: the second is warned and can choose; nothing is lost either way
  let C = browser(A.storage()); await wait(600);
  A.w.eval("state.bookings = state.bookings.slice(0, 370); changed(true);"); await wait(300);
  await saveVia(A, 'A saves first');
  C.w.eval("state.bookings = state.bookings.slice(0, 360); changed(true);"); await wait(300);
  C.w.confirm = q => (C.w.__lastConfirm = q, false);
  let msg = await saveVia(C, 'C declines');
  ok(/was saved after you loaded/.test(C.w.__lastConfirm) && planCommits()[0].message === 'A saves first' && /still here/.test(msg) && bookings(C.w) === 360, 'second editor is warned; declining keeps their edits on screen, unsaved');
  C.w.confirm = () => true;
  await saveVia(C, 'C saves anyway');
  ok(planCommits()[0].message === 'C saves anyway' && planCommits()[1].message === 'A saves first', 'saving anyway keeps both versions in the shared history');

  // 8. Delete versions (editors only)
  const rowsOf = b => [...b.d.querySelectorAll('#shared-card .shared-table tbody tr')];
  const titleOf = r => T(r.cells[2].querySelector('b'));
  let V2 = browser(); await wait(600); V2.d.querySelector('[data-tab=history]').click(); await wait(100);
  ok(!rowsOf(V2).some(r => /Delete/.test(T(r))), 'viewers have no Delete button');
  let E = browser(A.storage()); await wait(600); E.d.querySelector('[data-tab=history]').click(); await wait(100);
  const before = rowsOf(E).map(titleOf);
  const older = rowsOf(E).find(r => titleOf(r) === 'Week of Dec 8');
  [...older.querySelectorAll('button')].find(x => x.textContent === 'Delete').click(); await wait(600);
  ok(!rowsOf(E).map(titleOf).includes('Week of Dec 8') && rowsOf(E).length === before.length - 1, 'Delete removes an older version from the list');
  ok(JSON.parse(planCommits()[0].text).bookings.length === 360, 'deleting an older version leaves the shared plan unchanged');
  // delete the latest -> previous visible version becomes the shared plan again
  const latestTitle = titleOf(rowsOf(E)[0]), prevTitle = titleOf(rowsOf(E)[1]);
  E.w.eval("state = JSON.parse(JSON.stringify(state)); changed(true);"); await wait(300);
  [...rowsOf(E)[0].querySelectorAll('button')].find(x => x.textContent === 'Delete').click(); await wait(900);
  ok(titleOf(rowsOf(E)[0]) === prevTitle && !rowsOf(E).map(titleOf).includes(latestTitle), `deleting the latest makes "${prevTitle}" the latest again`);
  ok(JSON.parse(planCommits()[0].text).bookings.length === 370, 'shared plan file is restored to the previous version');
  ok(!rowsOf(E).some(r => /^Delete “/.test(titleOf(r))), 'the restore step itself is hidden from the list');
  V2 = browser(); await wait(700); V2.d.querySelector('[data-tab=history]').click(); await wait(100);
  ok(bookings(V2.w) === 370 && !rowsOf(V2).map(titleOf).includes(latestTitle) && !rowsOf(V2).map(titleOf).includes('Week of Dec 8'), 'other people see the deletions and get the restored plan');
  // can save again afterwards (no false conflict)
  E.w.eval("state.bookings = state.bookings.slice(0, 365); changed(true);"); await wait(300);
  ok(/for everyone/.test(await saveVia(E, 'After delete')), 'saving after a delete works');
  const only = browser(); await wait(10);

  // 9. Offline / GitHub down: app still works
  const D = browser(); D.w.fetch = () => Promise.reject(new Error('offline')); await wait(500);
  ok(D.d.querySelectorAll('.kpi').length >= 6, 'app still works if GitHub is unreachable');

  const errs = [V, A, editorAgain, B, C, D, V2, E].flatMap(b => b.errors);
  ok(errs.length === 0, `no script errors${errs.length ? ': ' + errs[0] : ''}`);
  console.log(`\nShared-version tests passed (${passed} checks).`);
  process.exit(0);
})().catch(e => { console.error('Sync test failed:', e.message); process.exit(1); });
