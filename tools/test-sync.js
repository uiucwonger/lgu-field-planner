#!/usr/bin/env node
/* Shared-versions (GitHub) tests against an in-memory fake of the GitHub REST API.
 *   npm run test:sync     (needs `npm install` for jsdom)
 * Simulates several browsers (separate localStorage) sharing one fake repository. */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.join(__dirname, '..');

// ---------------- fake GitHub (one repo, one file history)
const repo = { commits: [], files: {} }; // commits: newest first {sha, message, author, date, fileSha, text}
let n = 0;
const sha = () => (++n).toString(16).padStart(40, 'a');
function fakeFetch(url, opts = {}) {
  const u = new URL(url), auth = (opts.headers || {}).Authorization, ok = auth === 'Bearer good-token';
  const json = (status, body) => Promise.resolve({ ok: status < 300, status, statusText: String(status), json: async () => body, text: async () => JSON.stringify(body) });
  const m = u.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
  if (!m) return json(404, { message: 'Not Found' });
  const rest = m[3] || '';
  if (rest === '') return json(200, { full_name: `${m[1]}/${m[2]}`, permissions: { push: ok, admin: false } });
  if (rest === '/commits') return json(200, repo.commits.slice(0, Number(u.searchParams.get('per_page')) || 30).map(c => ({ sha: c.sha, html_url: `https://github.com/x/commit/${c.sha}`, commit: { message: c.message, author: { name: c.author, date: c.date } } })));
  if (rest.startsWith('/contents/')) {
    if ((opts.method || 'GET') === 'GET') {
      const ref = u.searchParams.get('ref'); const c = repo.commits.find(x => x.sha === ref) || (ref === 'main' ? repo.commits[0] : null);
      if (!c) return json(404, { message: 'Not Found' });
      return json(200, { sha: c.fileSha, encoding: 'base64', content: Buffer.from(c.text, 'utf8').toString('base64') });
    }
    if (!ok) return json(401, { message: 'Bad credentials' });
    const body = JSON.parse(opts.body); const head = repo.commits[0];
    if (head && body.sha !== head.fileSha) return json(409, { message: 'is at ' + head.fileSha + ' but expected ' + body.sha });
    const c = { sha: sha(), fileSha: sha(), message: body.message, author: 'uiucwonger', date: new Date(Date.now() + n * 1000).toISOString(), text: Buffer.from(body.content, 'base64').toString('utf8') };
    repo.commits.unshift(c);
    return json(201, { content: { sha: c.fileSha }, commit: { sha: c.sha, author: { name: c.author, date: c.date } } });
  }
  return json(404, { message: 'Not Found' });
}

// ---------------- a "browser"
function browser(storage = {}) {
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/requestAnimationFrame/.test(e.message)) errors.push(e.message); });
  let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script defer src="([^"]+)"><\/script>/g)].map(m => m[1]);
  const pre = `<script>${Object.entries(storage).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v).replace(/</g, '\\u003c')});`).join('')}</script>`;
  html = html.replace(/<script defer src="[^"]+"><\/script>/g, '').replace('<body>', '<body>' + pre)
    .replace('</body>', () => scripts.map(f => `<script>${fs.readFileSync(path.join(root, f), 'utf8')}</script>`).join('\n') + '</body>');
  const w = new JSDOM(html, { runScripts: 'dangerously', virtualConsole: vc, url: 'https://uiucwonger.github.io/lgu-field-planner/', pretendToBeVisual: true,
    beforeParse(win) { win.fetch = fakeFetch; win.TextEncoder = TextEncoder; win.TextDecoder = TextDecoder; } }).window;
  w.confirm = () => true; w.alert = m => { w.__alert = m; }; w.HTMLElement.prototype.scrollIntoView = function () {};
  return { w, d: w.document, errors, storage: () => Object.fromEntries(Object.keys(w.localStorage).map(k => [k, w.localStorage.getItem(k)])) };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const T = e => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed++; console.log(`  ✓ ${m}`); };
const bookings = w => w.eval('state.bookings.length');
async function publishVia(b, msg) {
  b.d.querySelector('[data-tab=history]').click(); await wait(100);
  b.d.getElementById('pub-msg').value = msg;
  [...b.d.querySelectorAll('#shared-card button')].find(x => x.textContent === 'Publish to GitHub').click();
  await wait(400);
  return T(b.d.querySelector('#shared-card .shared-status'));
}
async function signIn(b, t) {
  b.d.querySelector('[data-tab=history]').click(); await wait(80);
  b.d.getElementById('gh-token').value = t;
  [...b.d.querySelectorAll('#shared-card button')].find(x => x.textContent === 'Save token').click(); await wait(300);
  return T(b.d.querySelector('#shared-card .shared-status'));
}

(async () => {
  // 1. Nothing published yet: visitor works from the seed, no errors
  let A = browser(); await wait(500);
  ok(A.w.LGUShared.cfg().owner === 'uiucwonger' && A.w.LGUShared.cfg().repo === 'lgu-field-planner', 'repo detected from the github.io address');
  A.d.querySelector('[data-tab=history]').click(); await wait(100);
  ok(/Nothing published yet/.test(T(A.d.getElementById('shared-card'))), 'empty repo: "Nothing published yet"');
  ok(!A.d.getElementById('pub-msg'), 'no Publish button before signing in');

  // 2. Editor A signs in (bad token rejected, good accepted) and publishes
  ok(/not accepted/.test(await signIn(A, 'bad-token')), 'bad token is rejected');
  ok(/Signed in/.test(await signIn(A, 'good-token')), 'good token is accepted');
  A.w.eval("state.bookings = state.bookings.slice(0, 400); changed(true);"); await wait(300);
  ok(/Published/.test(await publishVia(A, 'Week of Dec 1 – first shared plan')), 'editor publishes the first shared version');
  ok(repo.commits.length === 1 && JSON.parse(repo.commits[0].text).bookings.length === 400, 'GitHub holds the plan as a commit');
  ok(A.w.LGUVersions.loadVersions().some(v => /^Published:/.test(v.name)), 'publish also keeps a local version');

  // 3. New visitor B (fresh browser) gets the shared plan automatically
  let B = browser(); await wait(600);
  ok(bookings(B.w) === 400, 'first-time visitor starts from the shared plan (400 bookings, not the seed)');
  ok(/Loaded shared plan/.test(T(B.d.getElementById('save-state'))), 'visitor sees "Loaded shared plan"');
  const bStore = B.storage();

  // 4. A publishes again; returning visitor B (no local edits) follows automatically
  A.w.eval("state.bookings = state.bookings.slice(0, 390); changed(true);"); await wait(300);
  await publishVia(A, 'Week of Dec 8');
  B = browser(bStore); await wait(600);
  ok(bookings(B.w) === 390, 'returning visitor with no edits auto-updates to the latest shared version');

  // 5. Visitor with unpublished edits: banner instead of overwrite
  B.w.eval("state.bookings = state.bookings.slice(0, 380); changed(true);"); await wait(400);
  const bEdited = B.storage();
  A.w.eval("state.bookings = state.bookings.slice(0, 385); changed(true);"); await wait(300);
  await publishVia(A, 'Week of Dec 15');
  B = browser(bEdited); await wait(600);
  ok(bookings(B.w) === 380, 'local unpublished edits are NOT overwritten');
  ok(!B.d.getElementById('shared-banner').hidden && /newer shared plan/.test(T(B.d.getElementById('shared-banner'))), 'banner offers the newer shared plan');
  [...B.d.querySelectorAll('#shared-banner button')].find(x => x.textContent === 'Load it').click(); await wait(400);
  ok(bookings(B.w) === 385, '"Load it" loads the latest shared plan');
  ok(B.w.LGUVersions.loadVersions().some(v => /unpublished changes/.test(v.name) && v.data.bookings.length === 380), 'the unpublished edits were kept as a local version');

  // 6. History: list, compare, load an older version
  B.d.querySelector('[data-tab=history]').click(); await wait(100);
  const rows = B.d.querySelectorAll('#shared-card .shared-table tbody tr');
  ok(rows.length === 3, `shared history lists all ${rows.length} published versions`);
  [...rows[2].querySelectorAll('button')].find(x => x.textContent === 'Compare').click(); await wait(400);
  ok(/Bookings added/.test(T(B.d.getElementById('version-diff'))), 'compare against an older shared version works');
  [...rows[2].querySelectorAll('button')].find(x => x.textContent === 'Load').click(); await wait(400);
  ok(bookings(B.w) === 400, 'load an older shared version (400 bookings)');

  // 7. Conflict: two editors, second one is stale
  const aStore = A.storage();
  let C = browser(Object.assign({}, aStore)); await wait(600);        // editor C, same token, synced to latest
  A.w.eval("state.bookings = state.bookings.slice(0, 370); changed(true);"); await wait(300);
  await publishVia(A, 'A publishes first');
  C.w.eval("state.bookings = state.bookings.slice(0, 360); changed(true);"); await wait(300);
  const msg = await publishVia(C, 'C publishes stale');
  ok(/newer shared version/.test(msg) && repo.commits[0].message === 'A publishes first', 'stale editor is blocked instead of overwriting the other editor');

  // 8. Offline / GitHub down: app still works
  const D = browser(); D.w.fetch = () => Promise.reject(new Error('offline')); await wait(500);
  ok(D.d.querySelectorAll('.kpi').length >= 6, 'app still works if GitHub is unreachable');

  const errs = [A, B, C, D].flatMap(b => b.errors);
  ok(errs.length === 0, `no script errors${errs.length ? ': ' + errs[0] : ''}`);
  console.log(`\nShared-version tests passed (${passed} checks).`);
  process.exit(0);
})().catch(e => { console.error('Sync test failed:', e.message); process.exit(1); });
