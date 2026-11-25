/* LGU Field Planner – undo/redo and the Compare view.
 * Saved versions live on GitHub only (github-sync.js). This file keeps in-session undo/redo
 * (also the safety net for Optimize, imports, reset and loading a shared plan) and renders diffs.
 * Loaded after app.js; uses its globals (state, changed, render, h, $, A, clone, showTab). */
'use strict';
(function () {
  const UNDO_LIMIT = 50;
  // Versions used to be stored on each device; they now live on GitHub only. Free that browser storage.
  try { localStorage.removeItem('lgu-field-planner-versions-v1'); } catch (e) { /* storage blocked */ }

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

  // Imports and reset replace everything: close the current undo step so they can be undone as one step.
  beforeReplaceHooks.push(() => commit());

  // ------------------------------------------------------------ compare
  const describeBooking = b => `${b.day} ${b.field} ${b.start}–${b.end} · ${b.team}${b.canceled ? ' (canceled)' : ''}`;
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

  // ------------------------------------------------------------ wiring
  // Save version = save for everyone on GitHub (editors only; the button is hidden for view-only devices).
  $('quick-version').addEventListener('click', () => {
    if (!(window.LGUShared && window.LGUShared.canPublish())) return;
    const name = prompt('Name this version', `Version ${new Date().toLocaleDateString()}`);
    if (name !== null) window.LGUShared.saveShared(name.trim() || `Version ${new Date().toLocaleDateString()}`);
  });
  renderHooks.push(() => updateButtons());
  updateButtons();

  /** Replace all data (e.g. with a shared plan). Undoable in this session. */
  function replaceState(obj, { undoable = true } = {}) {
    commit();
    if (undoable) { undoStack.push(JSON.stringify(state)); redoStack.length = 0; }
    applyState(JSON.stringify(obj));
  }
  function compareStates(a, b, caption) {
    showTab('history');
    renderDiff(a, b, caption);
    $('version-diff').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  window.LGUVersions = { undo, redo, commit, replaceState, compareStates };
})();
