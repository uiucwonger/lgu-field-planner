/* LGU Field Planner – version control: undo/redo + named snapshots with compare and restore.
 * Loaded after app.js; uses its globals (state, changed, render, h, $, A, clone, download). */
'use strict';
(function () {
  const VKEY = 'lgu-field-planner-versions-v1';
  const UNDO_LIMIT = 50;
  const MAX_VERSIONS = 60;

  // ------------------------------------------------------------ undo / redo
  // Edits are coalesced: a snapshot is taken at the first edit after a pause, so typing a word is one undo step.
  const undoStack = [], redoStack = [];
  let lastCommitted = JSON.stringify(state);
  let pending = null, idleTimer = null, restoring = false;

  function commit() {
    clearTimeout(idleTimer); idleTimer = null;
    const now = JSON.stringify(state);
    if (pending !== null && now !== pending) {
      undoStack.push(pending);
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
      redoStack.length = 0;
    }
    pending = null; lastCommitted = now; updateButtons();
  }
  changeHooks.push(() => {
    if (restoring) return;
    if (pending === null) pending = lastCommitted;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(commit, 700);
  });

  function applyState(json) {
    restoring = true;
    state = JSON.parse(json);
    lastCommitted = json;
    changed(true);
    restoring = false;
    updateButtons();
  }
  function undo() {
    commit();
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(state));
    applyState(undoStack.pop());
    flash('Undone');
  }
  function redo() {
    commit();
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(state));
    applyState(redoStack.pop());
    flash('Redone');
  }
  function updateButtons() {
    $('undo').disabled = !undoStack.length && pending === null;
    $('redo').disabled = !redoStack.length;
    const info = $('undo-info');
    if (info) info.textContent = `${undoStack.length + (pending !== null ? 1 : 0)} undo step(s) and ${redoStack.length} redo step(s) are available in this session. The undo history clears when the page reloads; saved versions don't.`;
  }
  function flash(msg) { notify(msg); }

  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);
  document.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
    const t = e.target;
    // Leave native text undo alone while typing in a field.
    if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes(t.type)))) return;
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  });

  // ------------------------------------------------------------ named versions
  function loadVersions() { try { return JSON.parse(localStorage.getItem(VKEY)) || []; } catch (e) { return []; } }
  function storeVersions(list) {
    try { localStorage.setItem(VKEY, JSON.stringify(list)); return true; }
    catch (e) { alert('Browser storage is full. Delete or export some versions and try again.'); return false; }
  }
  function summarize(s) {
    const r = A.analyze(s).summary;
    return { fields: s.fields.length, teams: s.teams.length, bookings: s.bookings.length,
      secure: r.sessionsSecure, needed: r.sessionsNeeded, teamsShort: r.teamsShort, usable: r.fieldsUsable };
  }
  function saveVersion(name, note = '', auto = false) {
    commit();
    const list = loadVersions();
    const data = clone(state);
    const v = { id: `v${Date.now()}`, name: name || `Version ${list.filter(x => !x.auto).length + 1}`, note, auto,
      created: new Date().toISOString(), summary: summarize(data), data };
    list.unshift(v);
    // Trim oldest automatic versions first.
    while (list.length > MAX_VERSIONS) {
      const i = list.map(x => x.auto).lastIndexOf(true);
      list.splice(i >= 0 ? i : list.length - 1, 1);
    }
    if (storeVersions(list)) { flash(`Saved version “${v.name}”`); renderVersions(); }
    return v;
  }
  beforeReplaceHooks.push(label => saveVersion(label, '', true));

  const CURRENT = '__current__';
  const fmtDate = iso => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  function stateOf(id) { return id === CURRENT ? state : (loadVersions().find(v => v.id === id) || {}).data; }

  function renderVersions() {
    const list = loadVersions();
    const bytes = (localStorage.getItem(VKEY) || '').length;
    $('ver-storage').textContent = `${list.length} version(s) · about ${(bytes / 1024 / 1024).toFixed(1)} MB of browser storage (most browsers allow about 5 MB). Automatic versions are trimmed first after ${MAX_VERSIONS}.`;
    const opts = sel => {
      const cur = sel.value;
      sel.replaceChildren(h('option', { value: CURRENT, text: 'Current (unsaved)' }), ...list.map(v => h('option', { value: v.id, text: `${v.name} — ${fmtDate(v.created)}` })));
      if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
    };
    opts($('cmp-a')); opts($('cmp-b'));
    if (!$('cmp-a').dataset.init && list.length) { $('cmp-a').value = list[0].id; $('cmp-b').value = CURRENT; $('cmp-a').dataset.init = '1'; }

    $('version-table').replaceChildren(
      h('thead', {}, h('tr', {}, ['Saved', 'Name', 'Note', 'Sessions secure', 'Teams short', 'Bookings', ''].map((x, i) => h('th', { class: [3, 4, 5].includes(i) ? 'num' : '', text: x })))),
      h('tbody', {}, list.length ? list.map(v => h('tr', {},
        h('td', { text: fmtDate(v.created) }),
        h('td', {}, h('b', { text: v.name }), v.auto ? h('span', { class: 'manual', text: 'auto' }) : null),
        h('td', { class: 'muted', text: v.note || '' }),
        h('td', { class: 'num', text: `${v.summary.secure} / ${v.summary.needed}` }),
        h('td', { class: 'num', text: v.summary.teamsShort }),
        h('td', { class: 'num', text: v.summary.bookings }),
        h('td', { class: 'row-actions' },
          h('button', { class: 'btn mini', text: 'Compare', onclick: () => { $('cmp-a').value = v.id; $('cmp-b').value = CURRENT; showDiff(); } }),
          h('button', { class: 'btn mini', text: 'Restore', onclick: () => restore(v) }),
          h('button', { class: 'btn mini', text: 'Rename', onclick: () => {
            const name = prompt('Version name', v.name); if (name === null) return;
            const note = prompt('Note', v.note || ''); const l = loadVersions(); const x = l.find(y => y.id === v.id);
            if (x) { x.name = name || x.name; if (note !== null) x.note = note; x.auto = false; storeVersions(l); renderVersions(); }
          } }),
          h('button', { class: 'btn mini', text: 'Download', onclick: () => download(`lgu-version-${v.name.replace(/[^\w-]+/g, '_')}.json`, JSON.stringify(v.data, null, 2), 'application/json') }),
          h('button', { class: 'btn mini', title: 'Delete version', text: '✕', onclick: () => { if (confirm(`Delete version “${v.name}”?`)) { storeVersions(loadVersions().filter(x => x.id !== v.id)); renderVersions(); } } }))
      )) : [h('tr', {}, h('td', { colspan: 7, class: 'muted', text: 'No copies on this device yet.' }))])
    );
    updateButtons();
  }

  function restore(v) {
    if (!confirm(`Restore “${v.name}”? The current data is saved as a version first.`)) return;
    saveVersion(`Before restoring “${v.name}”`, '', true);
    undoStack.push(JSON.stringify(state)); redoStack.length = 0;
    applyState(JSON.stringify(v.data));
    flash(`Restored “${v.name}”`);
  }

  // ------------------------------------------------------------ compare
  const describeBooking = b => `${b.day} ${b.field} ${b.start}–${b.end} · ${b.team}${b.canceled ? ' (canceled)' : ''}`;
  function showDiff() {
    const a = stateOf($('cmp-a').value), b = stateOf($('cmp-b').value);
    if (!a || !b) { $('version-diff').replaceChildren(h('p', { class: 'hint', text: 'Choose two versions.' })); return; }
    renderDiff(a, b);
  }
  /** Show what changes going from state a to state b. caption = optional heading (used for shared versions). */
  function renderDiff(a, b, caption) {
    const out = $('version-diff');
    const d = A.diffStates(a, b);
    const ra = A.analyze(a).summary, rb = A.analyze(b).summary;
    const delta = (x, y) => { const n = y - x; return n ? ` (${n > 0 ? '+' : ''}${n})` : ''; };
    const section = (title, items) => items.length ? h('details', { open: items.length <= 12 }, h('summary', { text: `${title} (${items.length})` }), h('ul', {}, items.slice(0, 200).map(x => h('li', {}, x)))) : null;
    const chg = (c, label) => [h('b', { text: label }), ': ', c.props.map(p => `${p} ${fmtVal(c.before[p])} → ${fmtVal(c.after[p])}`).join('; ')];
    out.replaceChildren(
      caption ? h('p', { class: 'diff-caption' }, h('b', { text: caption })) : null,
      h('div', { class: 'diff-kpis' },
        h('span', { text: `Sessions secure: ${ra.sessionsSecure} → ${rb.sessionsSecure}${delta(ra.sessionsSecure, rb.sessionsSecure)}` }),
        h('span', { text: `Teams short: ${ra.teamsShort} → ${rb.teamsShort}${delta(ra.teamsShort, rb.teamsShort)}` }),
        h('span', { text: `Usable fields: ${ra.fieldsUsable} → ${rb.fieldsUsable}${delta(ra.fieldsUsable, rb.fieldsUsable)}` })),
      d.total ? null : h('p', { class: 'hint', text: 'No differences.' }),
      section('Bookings added', d.bookings.added.map(describeBooking)),
      section('Bookings removed', d.bookings.removed.map(describeBooking)),
      section('Bookings changed', d.bookings.changed.map(c => chg(c, `${c.before.team} (${c.before.day})`))),
      section('Fields changed', d.fields.changed.map(c => chg(c, c.after.name))),
      section('Fields added', d.fields.added.map(f => f.name)),
      section('Fields removed', d.fields.removed.map(f => f.name)),
      section('Teams changed', d.teams.changed.map(c => chg(c, c.after.name))),
      section('Teams added', d.teams.added.map(t => t.name)),
      section('Teams removed', d.teams.removed.map(t => t.name)),
      section('Settings changed', d.settings)
    );
  }
  const fmtVal = v => (v === null || v === undefined || v === '') ? '∅' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
  $('cmp-go').addEventListener('click', showDiff);

  // ------------------------------------------------------------ wiring
  // Editors (opened the editor link) save for everyone via GitHub; others save on this device.
  const shared = () => window.LGUShared && window.LGUShared.canPublish();
  const save = (name, note) => shared() ? window.LGUShared.saveShared(name || `Version ${new Date().toLocaleDateString()}`, note) : saveVersion(name, note);
  $('quick-version').addEventListener('click', () => {
    const name = prompt('Name this version', `Version ${new Date().toLocaleDateString()}`);
    if (name !== null) save(name.trim());
  });
  renderHooks.push(() => { if (currentTab === 'history') renderVersions(); else updateButtons(); });
  renderVersions();

  /** Replace all data (e.g. with a shared plan). label = auto-save the current data as a local version first. */
  function replaceState(obj, label, { undoable = true } = {}) {
    commit();
    if (label) saveVersion(label, '', true);
    if (undoable) { undoStack.push(JSON.stringify(state)); redoStack.length = 0; }
    applyState(JSON.stringify(obj));
  }
  function compareStates(a, b, caption) {
    showTab('history');
    renderDiff(a, b, caption);
    $('version-diff').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  window.LGUVersions = { saveVersion, undo, redo, loadVersions, commit, replaceState, compareStates };
})();
