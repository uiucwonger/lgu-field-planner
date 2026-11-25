/* LGU Field Planner – shared versions on GitHub.
 *
 * The plan everyone sees lives in the repository as  data/plan.json.
 * Every "Publish" is a git commit to that file, so GitHub keeps the full shared history:
 *   - Anyone opening the site can READ the latest plan and every earlier version (public repo, no sign-in).
 *   - Editors PUBLISH with a fine-grained personal access token (Contents: read & write on this repo only).
 *     The token is stored only in the editor's own browser.
 *
 * Reads use the GitHub REST API: 2 requests per page load (history + latest file). Without a token, GitHub
 * allows 60 requests/hour per network, i.e. ~30 page loads/hour from one location. Editors (with a token)
 * get 5,000/hour. Writes use PUT /repos/{owner}/{repo}/contents/{path} with the file's sha, so two editors
 * can't silently overwrite each other: a stale sha is caught before publishing (and GitHub rejects it with 409).
 *
 * Uses app.js globals (state, result, changed, h, $, A, clone, download, showTab, currentTab, renderHooks,
 * HAD_SAVED_DATA) and window.LGUVersions (replaceState, compareStates, saveVersion). */
'use strict';
(function () {
  // ---------------------------------------------------------------- configuration
  const DEFAULT_REPO = (() => {
    // On https://<owner>.github.io/<repo>/ the repo is known from the address; otherwise use the club repo.
    const m = location.hostname.match(/^([\w-]+)\.github\.io$/i);
    const repo = location.pathname.split('/').filter(Boolean)[0];
    return m && repo ? { owner: m[1], repo, branch: 'main', path: 'data/plan.json' }
                     : { owner: 'uiucwonger', repo: 'lgu-field-planner', branch: 'main', path: 'data/plan.json' };
  })();
  const CFG_KEY = 'lgu-github-config-v1';       // { owner, repo, branch, path }
  const TOKEN_KEY = 'lgu-github-token-v1';      // editor's token (this browser only)
  const SYNC_KEY = 'lgu-github-sync-v1';        // { sha, commit, message, date, author, baseHash }
  const API = 'https://api.github.com';

  const cfg = () => Object.assign({}, DEFAULT_REPO, readJSON(CFG_KEY) || {});
  const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } };
  const sync = () => readJSON(SYNC_KEY) || {};
  const setSync = s => writeJSON(SYNC_KEY, Object.assign(sync(), s));
  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }

  // A stable fingerprint of plan content (ignores tracking-only noise like key order).
  const planOnly = s => ({ settings: s.settings || {}, fields: s.fields, teams: s.teams, bookings: s.bookings, longTerm: s.longTerm || null });
  function hash(s) {
    const str = JSON.stringify(planOnly(s)); let x = 2166136261;
    for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
    return (x >>> 0).toString(36);
  }

  // UTF-8 safe base64 for the GitHub contents API
  const b64encode = str => { const bytes = new TextEncoder().encode(str); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };
  const b64decode = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

  // ---------------------------------------------------------------- GitHub calls
  async function gh(path, opts = {}, auth = !!token()) {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (auth && token()) headers.Authorization = `Bearer ${token()}`;
    if (opts.body) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${API}${path}`, Object.assign({}, opts, { headers, cache: 'no-store' }));
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try { const j = await res.json(); if (j.message) msg = `${res.status}: ${j.message}`; } catch (e) { /* ignore */ }
      const err = new Error(msg); err.status = res.status; throw err;
    }
    return res.status === 204 ? null : res.json();
  }
  const repoPath = c => `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`;

  /** Latest shared plan: { data, sha, commit, message, date, author } or null if not published yet. */
  async function fetchLatest() {
    const c = cfg();
    // 1) newest commit touching the file (gives message/author/date)
    const commits = await gh(`${repoPath(c)}/commits?path=${encodeURIComponent(c.path)}&sha=${encodeURIComponent(c.branch)}&per_page=1`);
    if (!commits.length) return null;
    return fetchAt(commits[0]);
  }
  /** Plan file as of a commit (object from the commits API). */
  async function fetchAt(cm) {
    const c = cfg();
    const file = await gh(`${repoPath(c)}/contents/${c.path.split('/').map(encodeURIComponent).join('/')}?ref=${cm.sha}`);
    let text;
    if (file.content && file.encoding === 'base64') text = b64decode(file.content);
    else text = await (await fetch(file.download_url, { cache: 'no-store' })).text(); // > 1 MB files
    return { data: JSON.parse(text), sha: file.sha, commit: cm.sha, message: cm.commit.message, date: cm.commit.author.date, author: cm.commit.author.name || (cm.author && cm.author.login) || '' };
  }
  async function listHistory(n = 30) {
    const c = cfg();
    return gh(`${repoPath(c)}/commits?path=${encodeURIComponent(c.path)}&sha=${encodeURIComponent(c.branch)}&per_page=${n}`);
  }
  async function currentSha() {
    const c = cfg();
    try { return (await gh(`${repoPath(c)}/contents/${c.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(c.branch)}`)).sha; }
    catch (e) { if (e.status === 404) return null; throw e; }
  }
  async function publish(message) {
    const c = cfg();
    if (!token()) throw new Error('Add an editor token first (Versions → Shared versions → Editor sign-in).');
    const s = sync();
    const remoteSha = await currentSha();
    if (remoteSha && s.sha && remoteSha !== s.sha) {
      const e = new Error('Someone published a newer shared version after you loaded yours. Load the latest shared version (your work is kept as a local version), re-apply your changes, then publish.');
      e.status = 409; throw e;
    }
    const body = { message: message || `Plan update ${new Date().toLocaleDateString()}`, branch: c.branch,
      content: b64encode(JSON.stringify(state, null, 1)) };
    if (remoteSha) body.sha = remoteSha;
    const r = await gh(`${repoPath(c)}/contents/${c.path.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', body: JSON.stringify(body) }, true);
    setSync({ sha: r.content.sha, commit: r.commit.sha, message: body.message, date: r.commit.author.date, author: r.commit.author.name, baseHash: hash(state) });
    return r;
  }

  // ---------------------------------------------------------------- state helpers
  const fmt = iso => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const dirty = () => { const s = sync(); return !!s.baseHash && s.baseHash !== hash(state); };
  let latest = null;          // last fetched remote { data, sha, commit, ... }
  let history = null;         // commits list
  let status = { kind: 'idle', text: '' };
  const setStatus = (kind, text) => { status = { kind, text }; paint(); };

  function load(remote, label) {
    LGUVersions.replaceState(remote.data, label);
    setSync({ sha: remote.sha, commit: remote.commit, message: remote.message, date: remote.date, author: remote.author, baseHash: hash(remote.data) });
    paint();
  }

  // ---------------------------------------------------------------- UI
  function banner() {
    const el = $('shared-banner'); if (!el) return;
    const s = sync();
    if (latest && s.commit && latest.commit !== s.commit) {
      el.hidden = false;
      el.replaceChildren(h('span', {}, h('b', { text: 'A newer shared plan is available' }), ` — “${latest.message}” by ${latest.author || 'an editor'}, ${fmt(latest.date)}.`),
        h('button', { class: 'btn mini', text: 'See what changed', onclick: () => LGUVersions.compareStates(state, latest.data, `Your plan → shared “${latest.message}”`) }),
        h('button', { class: 'btn mini primary', text: 'Load it', onclick: () => confirmLoad(latest) }));
    } else el.hidden = true;
  }
  function confirmLoad(remote) {
    const msg = dirty() ? `Load shared “${remote.message}”?\n\nYou have unpublished changes. They'll be kept as a version on this device (Versions tab) so nothing is lost.` : `Load shared “${remote.message}”?`;
    if (!confirm(msg)) return;
    load(remote, dirty() ? 'My unpublished changes (before loading shared plan)' : 'Before loading shared plan');
    notify(`Loaded shared plan “${remote.message}”`);
  }

  function paint() {
    banner();
    const card = $('shared-card'); if (!card) return;
    const c = cfg(), s = sync(), signedIn = !!token();
    const repoUrl = `https://github.com/${c.owner}/${c.repo}`;
    const where = s.commit
      ? [`Your plan is based on shared “`, h('b', { text: s.message || 'version' }), `” (${fmt(s.date)}${s.author ? ` · ${s.author}` : ''}).`, dirty() ? h('span', { class: 'shared-dirty', text: ' You have unpublished changes.' }) : h('span', { class: 'shared-ok', text: ' Up to date with what you loaded.' })]
      : ['Your plan isn\'t linked to a shared version yet.'];
    card.replaceChildren(
      h('div', { class: 'lt-section-head' }, h('h2', { text: 'Shared versions (GitHub)' }),
        h('a', { href: `${repoUrl}/commits/${c.branch}/${c.path}`, target: '_blank', rel: 'noopener', class: 'muted', text: `${c.owner}/${c.repo} · ${c.path}` })),
      h('p', { class: 'hint', text: 'Everyone who opens this site sees the shared plan. Each Publish is saved on GitHub as a new version with who, when and a message, and the full history is kept. Editing still happens on your device until you publish.' }),
      h('p', {}, ...where),
      status.text ? h('p', { class: `shared-status ${status.kind}`, text: status.text }) : null,
      h('div', { class: 'controls' },
        h('button', { class: 'btn', text: 'Check for updates', onclick: refresh }),
        latest ? h('button', { class: 'btn', text: 'Load latest shared', onclick: () => confirmLoad(latest) }) : null,
        signedIn
          ? [h('input', { id: 'pub-msg', placeholder: 'What changed? e.g. "Week of Dec 1 – Westmont renewed"', size: 46 }),
             h('button', { class: 'btn primary', text: 'Publish to GitHub', onclick: doPublish })]
          : null),
      historyTable(),
      editorBox());
  }

  function historyTable() {
    if (!history) return null;
    if (!history.length) return h('p', { class: 'hint', text: 'Nothing published yet. An editor can publish the current plan to create the first shared version.' });
    const s = sync();
    return h('div', { class: 'scroller short' }, h('table', { class: 'shared-table' },
      h('thead', {}, h('tr', {}, ['Published', 'By', 'Message', ''].map(x => h('th', { text: x })))),
      h('tbody', {}, history.map((cm, i) => h('tr', { class: cm.sha === s.commit ? 'is-current' : '' },
        h('td', { text: fmt(cm.commit.author.date) }),
        h('td', { text: cm.commit.author.name || (cm.author && cm.author.login) || '' }),
        h('td', {}, h('b', { text: cm.commit.message.split('\n')[0] }), i === 0 ? h('span', { class: 'manual', text: 'latest' }) : null, cm.sha === s.commit ? h('span', { class: 'manual', text: 'you have this' }) : null),
        h('td', { class: 'row-actions' },
          h('button', { class: 'btn mini', text: 'Compare', onclick: () => withRemote(cm, r => LGUVersions.compareStates(state, r.data, `Your plan → shared “${r.message}” (${fmt(r.date)})`)) }),
          h('button', { class: 'btn mini', text: 'Load', onclick: () => withRemote(cm, r => confirmLoad(r)) }),
          h('button', { class: 'btn mini', text: 'Download', onclick: () => withRemote(cm, r => download(`lgu-shared-${r.date.slice(0, 10)}-${cm.sha.slice(0, 7)}.json`, JSON.stringify(r.data, null, 2), 'application/json')) }),
          h('a', { class: 'btn mini', href: cm.html_url, target: '_blank', rel: 'noopener', text: 'On GitHub' })))))));
  }
  async function withRemote(cm, fn) {
    try { setStatus('busy', 'Loading from GitHub…'); const r = await fetchAt(cm); setStatus('idle', ''); fn(r); }
    catch (e) { setStatus('error', `Couldn't load that version: ${e.message}`); }
  }

  function editorBox() {
    const c = cfg();
    const signedIn = !!token();
    return h('details', { class: 'shared-editor', open: false },
      h('summary', { text: signedIn ? 'Editor sign-in: token saved on this device' : 'Editor sign-in (to publish)' }),
      h('ol', { class: 'hint' },
        h('li', {}, 'On GitHub, open ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener', text: 'Settings → Developer settings → Fine-grained tokens → Generate new token' }), '.'),
        h('li', { text: `Repository access: Only select repositories → ${c.owner}/${c.repo}. Permissions → Contents: Read and write. Set an expiry (e.g. 90 days).` }),
        h('li', { text: 'Paste the token below. It stays in this browser only and is sent only to api.github.com. Don\'t use a shared or public computer.' })),
      h('div', { class: 'controls' },
        h('input', { id: 'gh-token', type: 'password', placeholder: signedIn ? '•••••••• (saved)' : 'github_pat_…', size: 40, autocomplete: 'off' }),
        h('button', { class: 'btn', text: 'Save token', onclick: async () => {
          const t = $('gh-token').value.trim(); if (!t) return;
          try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* ignore */ }
          try { const r = await gh(repoPath(cfg()), {}, true); if (!(r.permissions && (r.permissions.push || r.permissions.admin))) throw new Error('This token can read but not publish. Give it Contents: Read and write on this repository.'); setStatus('ok', `Signed in. You can publish to ${cfg().owner}/${cfg().repo}.`); }
          catch (e) { try { localStorage.removeItem(TOKEN_KEY); } catch (x) { /* ignore */ } setStatus('error', `Token not accepted: ${e.message}`); }
        } }),
        signedIn ? h('button', { class: 'btn', text: 'Sign out', onclick: () => { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } setStatus('idle', 'Signed out on this device.'); } }) : null),
      h('details', { class: 'hint' }, h('summary', { text: 'Repository settings' }),
        h('div', { class: 'controls' },
          ...['owner', 'repo', 'branch', 'path'].map(k => h('label', {}, `${k} `, h('input', { value: c[k], size: k === 'path' ? 16 : 14, onchange: e => { const x = readJSON(CFG_KEY) || {}; x[k] = e.target.value.trim(); writeJSON(CFG_KEY, x); refresh(); } }))))));
  }

  async function doPublish() {
    const msg = ($('pub-msg') || {}).value?.trim();
    if (!msg) { alert('Add a short message describing what changed. It appears in the shared history.'); $('pub-msg').focus(); return; }
    try {
      setStatus('busy', 'Publishing to GitHub…');
      LGUVersions.saveVersion(`Published: ${msg}`, '', false);
      await publish(msg);
      setStatus('ok', `Published “${msg}”. Everyone gets it the next time they open or refresh the site. The site itself doesn't need to rebuild.`);
      await refresh(true);
    } catch (e) {
      setStatus('error', e.status === 409 ? e.message : e.status === 401 || e.status === 403 ? `GitHub refused the publish (${e.message}). Check the token hasn't expired and has Contents: Read and write.` : `Publish failed: ${e.message}`);
    }
  }

  async function refresh(quiet) {
    try {
      if (!quiet) setStatus('busy', 'Checking GitHub…');
      history = await listHistory();
      latest = history.length ? await fetchAt(history[0]) : null;
      if (!quiet) setStatus('idle', latest ? '' : 'No shared plan published yet.');
      else paint();
      return latest;
    } catch (e) {
      latest = null; history = null;
      setStatus('error', e.status === 404 ? `Couldn't find ${cfg().owner}/${cfg().repo} on GitHub (or it's private).`
        : e.status === 403 && /rate limit/i.test(e.message) ? 'GitHub is limiting requests from this network for the moment (about 30 page loads an hour without sign-in). Try again later; you can keep working.'
        : `Couldn't reach GitHub: ${e.message}. You can keep working; nothing is lost.`);
      return null;
    }
  }

  // ---------------------------------------------------------------- startup
  (async () => {
    const remote = await refresh(true);
    if (!remote) { paint(); return; }
    const s = sync();
    // First visit on this device (no saved data): start from the shared plan automatically.
    if (!HAD_SAVED_DATA && !s.commit) { load(remote, null); notify(`Loaded shared plan “${remote.message}”`); return; }
    // Returning visitor who hasn't changed anything since loading a shared version: follow the latest quietly.
    if (s.commit && s.commit !== remote.commit && !dirty()) { load(remote, 'Before updating to latest shared plan'); notify(`Updated to shared plan “${remote.message}”`); return; }
    paint(); // otherwise show the banner and let the user decide
  })();
  renderHooks.push(() => { if (currentTab === 'history') paint(); else banner(); });
  paint();

  window.LGUShared = { refresh, publish, fetchLatest, listHistory, cfg, hash, dirty };
})();
