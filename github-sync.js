/* LGU Field Planner – shared versions on GitHub.
 *
 * The plan everyone sees lives in the repository as  data/plan.json.
 * Every "Publish" is a git commit to that file, so GitHub keeps the full shared history:
 *   - Anyone opening the site can READ the latest plan and every earlier version (public repo, no sign-in).
 *   - Editors get an EDITOR LINK:  https://<owner>.github.io/<repo>/#key=<token>
 *     Opening it once enables "Save version" → GitHub on that device (the key is remembered and removed
 *     from the address bar). The #key part is never sent to the web server. <token> is one fine-grained
 *     token created by the repo owner (this repo only, Contents: Read and write).
 *
 * Reads use the GitHub REST API: 2 requests per page load (history + latest file). Without a token, GitHub
 * allows 60 requests/hour per network, i.e. ~30 page loads/hour from one location. Editors (with a token)
 * get 5,000/hour. Writes use PUT /repos/{owner}/{repo}/contents/{path} with the file's sha, so two editors
 * can't silently overwrite each other: a stale sha is caught before publishing (and GitHub rejects it with 409).
 *
 * Uses app.js globals (state, result, changed, h, $, A, clone, download, showTab, currentTab, renderHooks,
 * HAD_SAVED_DATA) and window.LGUVersions (replaceState, compareStates). */
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
  const NAME_KEY = 'lgu-editor-name-v1';        // editor's display name for the shared history

  // Editor link: take the key from #key=… (or ?key=…), remember it, and clean the address bar.
  let keyJustAdded = false;
  (() => {
    const read = s => new URLSearchParams(s.replace(/^[#?]/, '')).get('key');
    const k = read(location.hash) || read(location.search);
    if (!k) return;
    try { localStorage.setItem(TOKEN_KEY, k.trim()); keyJustAdded = true; } catch (e) { /* storage blocked */ }
    try { window.history.replaceState(null, '', location.pathname + location.search.replace(/[?&]key=[^&]*/, '')); } catch (e) { /* ignore */ }
  })();
  const editorName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } };
  function askName() {
    let n = editorName();
    if (n) return n;
    n = (prompt('Your name (shown with your versions in the shared history):', '') || '').trim();
    if (n) try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* ignore */ }
    return n || 'LGU editor';
  }
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
    const data = JSON.parse(text); delete data._version;   // version label lives in the file, not in the plan
    return { text, data, sha: file.sha, commit: cm.sha, message: cm.commit.message, date: cm.commit.author.date, author: cm.commit.author.name || (cm.author && cm.author.login) || '' };
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
  // ---- Deleted (hidden) versions: data/deleted.json lists commit shas hidden from the history.
  // Git history itself is never rewritten; "Delete" hides a version for everyone.
  const hiddenPath = () => cfg().path.replace(/[^/]+$/, 'deleted.json');
  const contentsUrl = p => `${repoPath(cfg())}/contents/${p.split('/').map(encodeURIComponent).join('/')}`;
  let hiddenList = [];      // [{ commit, message, by, at }]
  let hiddenSha = null;     // blob sha of deleted.json (for updates)
  async function fetchHidden() {
    const c = cfg();
    if (token()) {          // editors: API (exact, needed for updates)
      try { const f = await gh(`${contentsUrl(hiddenPath())}?ref=${encodeURIComponent(c.branch)}`); hiddenSha = f.sha; return JSON.parse(b64decode(f.content)).hidden || []; }
      catch (e) { if (e.status === 404) { hiddenSha = null; return []; } throw e; }
    }
    // viewers: raw file (doesn't count against the API rate limit)
    const res = await fetch(`https://raw.githubusercontent.com/${c.owner}/${c.repo}/${c.branch}/${hiddenPath()}?t=${Date.now()}`, { cache: 'no-store' });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`deleted list ${res.status}`);
    return (await res.json()).hidden || [];
  }
  async function writeHidden(list, message) {
    const body = { message, branch: cfg().branch, author: { name: editorName() || 'LGU editor', email: 'field-planner@losgatosunited.invalid' },
      content: b64encode(JSON.stringify({ note: 'Versions hidden from the Field Planner history. Remove an entry to bring a version back.', hidden: list }, null, 1)) };
    if (hiddenSha) body.sha = hiddenSha;
    const r = await gh(contentsUrl(hiddenPath()), { method: 'PUT', body: JSON.stringify(body) }, true);
    hiddenSha = r.content.sha; hiddenList = list;
  }
  const isHidden = sha => hiddenList.some(x => x.commit === sha);
  const visibleHistory = () => (history || []).filter(cm => !isHidden(cm.sha));

  /** Delete (hide) a shared version. Deleting the latest restores the previous version as the shared plan. */
  async function deleteVersion(cm) {
    if (!token()) throw new Error('Only editors can delete versions.');
    hiddenList = await fetchHidden();
    const vis = visibleHistory(); const title = cm.commit.message.split('\n')[0];
    if (vis.length <= 1) throw new Error("This is the only shared version, so it can't be deleted.");
    const add = [{ commit: cm.sha, message: title, by: editorName() || 'LGU editor', at: new Date().toISOString() }];
    if (vis[0].sha === cm.sha) {
      // Latest: put the previous version's exact file back, then hide both the deleted version and this restore commit.
      const prev = await fetchAt(vis[1]);
      const body = { message: `Delete “${title}” (restores “${prev.message.split('\n')[0]}”)`, branch: cfg().branch,
        author: { name: editorName() || 'LGU editor', email: 'field-planner@losgatosunited.invalid' }, content: b64encode(prev.text) };
      const cur = await currentSha(); if (cur) body.sha = cur;
      const r = await gh(contentsUrl(cfg().path), { method: 'PUT', body: JSON.stringify(body) }, true);
      add.push({ commit: r.commit.sha, message: body.message, by: add[0].by, at: add[0].at, restore: true });
      await writeHidden(hiddenList.concat(add), `Hide version “${title}”`);
      return { restored: prev, blobSha: r.content.sha };
    }
    await writeHidden(hiddenList.concat(add), `Hide version “${title}”`);
    return { restored: null };
  }

  async function publish(message, { author = editorName() || 'LGU editor', force = false } = {}) {
    const c = cfg();
    if (!token()) throw new Error('This device has view-only access. Open the editor link to save shared versions.');
    const s = sync();
    const remoteSha = await currentSha();
    if (remoteSha && s.sha && remoteSha !== s.sha && !force) {
      const e = new Error('Someone saved a newer shared version after you loaded yours.');
      e.status = 409; throw e;
    }
    const body = { message: message || `Plan update ${new Date().toLocaleDateString()}`, branch: c.branch,
      author: { name: author, email: 'field-planner@losgatosunited.invalid' },
      // `_version` makes every save change the file, so GitHub always records it in the file's history
      // (an identical file would create an empty commit that doesn't appear in the version list).
      content: b64encode(JSON.stringify(Object.assign({}, state, { _version: { name: message.split('\n')[0], by: author, savedAt: new Date().toISOString() } }), null, 1)) };
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

  function load(remote) {
    LGUVersions.replaceState(remote.data);
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
    const msg = dirty()
      ? `Load shared “${remote.message}”?\n\nYour changes that haven't been saved as a version will be replaced. ${token() ? 'To keep them, Cancel and click Save version first.' : 'You can Undo right after loading (until you reload the page).'}`
      : `Load shared “${remote.message}”?`;
    if (!confirm(msg)) return;
    load(remote);
    notify(`Loaded shared plan “${remote.message}”`);
  }

  function paint() {
    banner();
    const qv = $('quick-version'); if (qv) qv.hidden = !token();
    const card = $('shared-card'); if (!card) return;
    const c = cfg(), s = sync(), signedIn = !!token();
    const repoUrl = `https://github.com/${c.owner}/${c.repo}`;
    const where = s.commit
      ? [`Your plan is based on shared “`, h('b', { text: s.message || 'version' }), `” (${fmt(s.date)}${s.author ? ` · ${s.author}` : ''}).`, dirty() ? h('span', { class: 'shared-dirty', text: ' You have unpublished changes.' }) : h('span', { class: 'shared-ok', text: ' Up to date with what you loaded.' })]
      : ['Your plan isn\'t linked to a shared version yet.'];
    card.replaceChildren(
      h('div', { class: 'lt-section-head' }, h('h2', { text: 'Shared versions (GitHub)' }),
        h('a', { href: `${repoUrl}/commits/${c.branch}/${c.path}`, target: '_blank', rel: 'noopener', class: 'muted', text: `${c.owner}/${c.repo} · ${c.path}` })),
      h('p', { class: 'hint', text: signedIn
        ? 'You can edit. Click Save version (top right or below) and your version is saved on GitHub for everyone, with your name and the time. Every version is kept.'
        : 'View only. You can explore and try changes here, but only editors can save versions. Open the editor link to edit.' }),
      h('p', {}, h('span', { class: `lt-chip ${signedIn ? 'ok' : 'low'}`, text: signedIn ? `Editor${editorName() ? ` · ${editorName()}` : ''}` : 'View only' }), ' ', ...where),
      status.text ? h('p', { class: `shared-status ${status.kind}`, text: status.text }) : null,
      h('div', { class: 'controls' },
        signedIn ? h('button', { class: 'btn primary', text: 'Save version', onclick: () => saveFromPrompt() }) : null,
        h('button', { class: 'btn', text: 'Check for updates', onclick: refresh }),
        latest ? h('button', { class: 'btn', text: 'Load latest shared', onclick: () => confirmLoad(latest) }) : null),
      historyTable(),
      signedIn ? editorBox() : null);
  }

  function historyTable() {
    if (!history) return null;
    const list = visibleHistory();
    if (!list.length) return h('p', { class: 'hint', text: 'Nothing published yet. An editor can publish the current plan to create the first shared version.' });
    const s = sync();
    return h('div', { class: 'scroller short' }, h('table', { class: 'shared-table' },
      h('thead', {}, h('tr', {}, ['Published', 'By', 'Message', ''].map(x => h('th', { text: x })))),
      h('tbody', {}, list.map((cm, i) => h('tr', { class: cm.sha === s.commit ? 'is-current' : '' },
        h('td', { text: fmt(cm.commit.author.date) }),
        h('td', { text: cm.commit.author.name || (cm.author && cm.author.login) || '' }),
        h('td', {}, h('b', { text: cm.commit.message.split('\n')[0] }), i === 0 ? h('span', { class: 'manual', text: 'latest' }) : null, cm.sha === s.commit ? h('span', { class: 'manual', text: 'you have this' }) : null),
        h('td', { class: 'row-actions' },
          h('button', { class: 'btn mini', text: 'Compare', onclick: () => withRemote(cm, r => LGUVersions.compareStates(state, r.data, `Your plan → shared “${r.message}” (${fmt(r.date)})`)) }),
          h('button', { class: 'btn mini', text: 'Load', onclick: () => withRemote(cm, r => confirmLoad(r)) }),
          h('button', { class: 'btn mini', text: 'Download', onclick: () => withRemote(cm, r => download(`lgu-shared-${r.date.slice(0, 10)}-${cm.sha.slice(0, 7)}.json`, JSON.stringify(r.data, null, 2), 'application/json')) }),
          h('a', { class: 'btn mini', href: cm.html_url, target: '_blank', rel: 'noopener', text: 'On GitHub' }),
          token() && list.length > 1 ? h('button', { class: 'btn mini danger', title: 'Delete this version for everyone', text: 'Delete', onclick: () => doDelete(cm, i === 0) }) : null))))));
  }
  async function doDelete(cm, isLatest) {
    const title = cm.commit.message.split('\n')[0];
    const vis = visibleHistory();
    const msg = isLatest
      ? `Delete “${title}” for everyone?\n\nIt's the latest version, so the previous one (“${vis[1].commit.message.split('\n')[0]}”) becomes the shared plan again.`
      : `Delete “${title}” for everyone?\n\nIt disappears from the history list. (GitHub still keeps a record, so it can be recovered if needed.)`;
    if (!confirm(msg)) return;
    try {
      setStatus('busy', `Deleting “${title}”…`);
      const wasDirty = dirty(), hadIt = sync().commit === cm.sha;
      const r = await deleteVersion(cm);
      if (r.restored && hadIt) {
        if (!wasDirty) load(r.restored);   // follow the shared plan back (undoable)
        setSync({ sha: r.blobSha, commit: r.restored.commit, message: r.restored.message, date: r.restored.date, author: r.restored.author });
      }
      await refresh(true);
      setStatus('ok', r.restored ? `Deleted “${title}”. “${r.restored.message.split('\n')[0]}” is the shared plan again.` : `Deleted “${title}”.`);
    } catch (e) {
      setStatus('error', `Couldn't delete: ${e.message}`);
    }
  }
  async function withRemote(cm, fn) {
    try { setStatus('busy', 'Loading from GitHub…'); const r = await fetchAt(cm); setStatus('idle', ''); fn(r); }
    catch (e) { setStatus('error', `Couldn't load that version: ${e.message}`); }
  }

  /** Editor tools: share the editor link, change display name, stop editing on this device. */
  function editorBox() {
    const link = `${location.origin}${location.pathname}#key=${encodeURIComponent(token())}`;
    return h('details', { class: 'shared-editor' },
      h('summary', { text: 'Editor options' }),
      h('p', { class: 'hint', text: 'Anyone who opens the editor link can save versions for everyone. Share it only with people who should edit, and not in public places.' }),
      h('div', { class: 'controls' },
        h('button', { class: 'btn', text: 'Copy editor link', onclick: async () => {
          try { await navigator.clipboard.writeText(link); setStatus('ok', 'Editor link copied. Send it to the people who should edit.'); }
          catch (e) { prompt('Copy the editor link:', link); }
        } }),
        h('button', { class: 'btn', text: editorName() ? `Change name (${editorName()})` : 'Set your name', onclick: () => {
          const n = (prompt('Your name (shown with your versions in the shared history):', editorName()) || '').trim();
          if (n) { try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* ignore */ } paint(); }
        } }),
        h('button', { class: 'btn', text: 'Stop editing on this device', onclick: () => {
          if (!confirm('Switch this device to view-only? You can open the editor link again later.')) return;
          try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
          setStatus('idle', 'This device is now view-only.');
        } })));
  }

  /** Save a version for everyone (editors) – called by every "Save version" button. */
  async function saveShared(name, note = '') {
    const author = askName();
    const message = note ? `${name}\n\n${note}` : name;
    try {
      setStatus('busy', `Saving “${name}” for everyone…`);
      try { await publish(message, { author }); }
      catch (e) {
        if (e.status !== 409) throw e;
        await refresh(true);
        const other = latest ? `“${latest.message.split('\n')[0]}” by ${latest.author || 'another editor'} (${fmt(latest.date)})` : 'a newer version';
        if (!confirm(`${other} was saved after you loaded the plan.\n\nSave yours as the newest shared version anyway? Theirs stays in the history, and you can compare the two in Versions.`)) {
          setStatus('idle', `Not saved. Your changes are still here; compare with their version above, then save again.`); return false;
        }
        await publish(message, { author, force: true });
      }
      notify(`Saved “${name}” for everyone`);
      setStatus('ok', `Saved “${name}” for everyone. Others get it the next time they open or refresh the planner.`);
      await refresh(true);
      return true;
    } catch (e) {
      const kept = 'Your changes are still here; nothing was lost.';
      setStatus('error',
        e.status === 401 ? `GitHub didn't recognize the editor key (expired or deleted). Ask for a new editor link. ${kept}`
        : e.status === 403 && /not accessible by personal access token/i.test(e.message)
          ? `The editor key can read but not save. On GitHub, edit the key: Repository access must include ${cfg().owner}/${cfg().repo}, and Repository permissions → Contents must be "Read and write". The same editor link keeps working after you update it. ${kept}`
        : e.status === 403 || e.status === 404 ? `GitHub refused the save (${e.message}). Check the editor key has access to ${cfg().owner}/${cfg().repo} with Contents: Read and write. ${kept}`
        : `Couldn't save to GitHub (${e.message}). ${kept} Try again later.`);
      if (currentTab !== 'history') notify(`Not saved to GitHub (${e.status || 'offline'}). See Versions.`, 6000);
      return false;
    }
  }
  function saveFromPrompt() {
    const name = prompt('Name this version', `Version ${new Date().toLocaleDateString()}`);
    if (name !== null) saveShared(name.trim() || `Version ${new Date().toLocaleDateString()}`);
  }
  const canPublish = () => !!token();

  async function refresh(quiet) {
    try {
      if (!quiet) setStatus('busy', 'Checking GitHub…');
      history = await listHistory();
      try { hiddenList = await fetchHidden(); } catch (e) { /* keep the last known list */ }
      const vis = visibleHistory();
      latest = vis.length ? await fetchAt(vis[0]) : null;
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
    if (!remote) { if (keyJustAdded) notify('Editing enabled on this device. Save version now saves for everyone.', 6000); paint(); return; }
    const s = sync();
    if (keyJustAdded) notify('Editing enabled on this device. Save version now saves for everyone.', 6000);
    // First visit on this device (no saved data): start from the shared plan automatically.
    if (!HAD_SAVED_DATA && !s.commit) { load(remote); notify(`Loaded shared plan “${remote.message}”`); return; }
    // Returning visitor who hasn't changed anything since loading a shared version: follow the latest quietly.
    if (s.commit && s.commit !== remote.commit && !dirty()) { load(remote); notify(`Updated to shared plan “${remote.message}”`); return; }
    paint(); // otherwise show the banner and let the user decide
  })();
  renderHooks.push(() => { if (currentTab === 'history') paint(); else banner(); });
  paint();

  window.LGUShared = { refresh, publish, saveShared, deleteVersion, canPublish, fetchLatest, listHistory, cfg, hash, dirty };
})();
