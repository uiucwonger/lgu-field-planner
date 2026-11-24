/* LGU Field Planner – drag-and-drop schedule board.
 * Rows = fields, columns = planning days. Cards = competitive sessions.
 * Uses app.js globals (state, result, changed, h, $, A, clock, currentTab). */
'use strict';
(function () {
  const DAYS = A.DAYS;
  const toMin = A.toMin, toHHMM = A.toHHMM;
  let drag = null;          // { kind: 'booking'|'team', id?, team, roster }
  let editingId = null;

  const teamMap = () => new Map(state.teams.map(t => [t.name, t]));
  const fieldInfo = () => new Map(result.fields.map(f => [f.name, f]));
  const short = n => n.replace(/\s*\((U\d+(\/U\d+)?)\)\s*$/, ' $1');
  const ensureId = b => (b.id = b.id || `b${Date.now()}${Math.random().toString(36).slice(2, 6)}`);

  // ------------------------------------------------------------ capacity checks
  /** Remaining players on field/day during [s,e), ignoring booking `exceptId`. */
  function freeDuring(fieldName, day, s, e, exceptId) {
    const fi = fieldInfo().get(fieldName);
    if (!fi || !fi.capacity) return null;
    const tm = teamMap();
    const items = state.bookings.filter(b => b.field === fieldName && b.day === day && !b.canceled && b.id !== exceptId && tm.has(b.team))
      .map(b => ({ start: toMin(b.start), end: toMin(b.end), weight: Number(tm.get(b.team).roster) || 0 }));
    return fi.capacity - A.peakLoad(items, s, e).players;
  }
  /** Candidate time blocks for a field/day: existing comp blocks, then inventory windows, then a default. */
  function blocksFor(fieldName, day) {
    const tm = teamMap(), seen = new Map();
    for (const b of state.bookings) if (b.field === fieldName && b.day === day && !b.canceled && tm.has(b.team)) seen.set(`${b.start}-${b.end}`, [b.start, b.end]);
    if (!seen.size) {
      const f = state.fields.find(x => x.name === fieldName);
      for (const w of A.parseWindows(f?.windows?.[day])) seen.set(`${w.start}`, [toHHMM(w.start), toHHMM(Math.min(w.end, w.start + 75))]);
    }
    if (!seen.size) seen.set('d', ['15:00', '16:15']);
    return [...seen.values()];
  }
  function bestBlock(fieldName, day) {
    const blocks = blocksFor(fieldName, day).map(([s, e]) => ({ s, e, free: freeDuring(fieldName, day, toMin(s), toMin(e)) }));
    blocks.sort((a, b) => (b.free ?? -1) - (a.free ?? -1) || a.s.localeCompare(b.s));
    return blocks[0];
  }
  /** 'fit' | 'nocap' | 'full' | 'unusable' | 'conflict' for the current drag on a cell. */
  function verdict(fieldName, day) {
    if (!drag) return '';
    const fi = fieldInfo().get(fieldName);
    const sameDay = state.bookings.some(b => b.team === drag.team && b.day === day && !b.canceled && b.id !== drag.id);
    if (sameDay) return 'conflict';
    if (fi && !fi.usable) return 'unusable';
    const tr = result.teams.find(t => t.name === drag.team);
    if (tr && fi && fi.surface && !tr.allowedSurfaces.includes(fi.surface)) return 'surface';
    let s, e;
    if (drag.kind === 'booking') { const b = state.bookings.find(x => x.id === drag.id); s = toMin(b.start); e = toMin(b.end); }
    else { const blk = bestBlock(fieldName, day); s = toMin(blk.s); e = toMin(blk.e); }
    const free = freeDuring(fieldName, day, s, e, drag.id);
    if (free === null) return 'nocap';
    return free >= drag.roster ? 'fit' : 'full';
  }
  const VERDICT_TEXT = { surface: "Surface not allowed for this team's program", fit: 'Has room', nocap: 'No capacity on record', full: 'Over capacity', unusable: 'Field not usable', conflict: 'Team already has a session that day' };

  // ------------------------------------------------------------ render
  function render() {
    if (currentTab !== 'board') return;
    const week = result.settings.weekDays;
    const tm = teamMap(), fi = fieldInfo();
    const q = $('board-query').value.trim().toLowerCase();
    const compFields = new Set(state.bookings.filter(b => tm.has(b.team)).map(b => b.field));
    const isComp = f => f.capacity || compFields.has(f.name) || f.status === 'Active';
    fillFieldPicker(isComp);
    const pick = $('board-field').value;
    const rows = result.fields.filter(f => pick === '' ? isComp(f)
      : pick === '__all__' ? true
      : pick === '__usable__' ? f.usable
      : pick === '__risk__' ? f.risk > 0
      : f.name === pick)
      .sort(sorter($('board-sort').value));

    const grid = $('board-grid');
    grid.style.gridTemplateColumns = `210px repeat(${week.length}, minmax(170px, 1fr))`;
    const cells = [h('div', { class: 'bh corner', text: 'Field' }), ...week.map(d => {
      const dd = result.daily.find(x => x.day === d);
      return h('div', { class: 'bh' }, h('b', { text: d }), dd && dd.capacity ? h('small', { title: 'All usable fields combined', text: `All fields ${pct(dd.utilization)}` }) : null);
    })];
    for (const f of rows) {
      cells.push(h('div', { class: 'brow-head' },
        h('b', { text: f.name }),
        h('div', {}, h('span', { class: `badge b-${f.status.split(' ')[0]}`, text: f.status }), f.capacity ? h('small', { text: ` cap ${f.capacity}` }) : null),
        f.weekUtil !== null ? h('div', { class: 'row-util', title: `Average of daily peak ÷ capacity over ${f.openDays} day(s). Busiest: ${f.peakDay} ${pct(f.peakDayUtil)}` },
          h('div', { class: 'row-bar' }, h('span', { class: tone(f.weekUtil), style: `width:${Math.min(100, Math.round(f.weekUtil * 100))}%` })),
          h('span', { class: `row-pct ${tone(f.weekUtil)}`, text: pct(f.weekUtil) }),
          h('small', { text: `wk avg · peak ${f.peakDay} ${pct(f.peakDayUtil)}` })) : h('small', { class: 'row-none', text: 'No capacity on record' })));
      for (const d of week) {
        const list = state.bookings.filter(b => b.field === f.name && b.day === d && tm.has(b.team) && !b.canceled)
          .sort((a, b) => a.start.localeCompare(b.start) || a.team.localeCompare(b.team));
        const x = f.byDay[d];
        const v = verdict(f.name, d);
        const cell = h('div', {
          class: `bcell ${f.usable ? '' : 'unusable-bg'} ${v ? 'v-' + v : ''}`, 'data-field': f.name, 'data-day': d,
          title: v ? VERDICT_TEXT[v] : '',
          ondragover: e => { if (drag) { e.preventDefault(); e.dataTransfer.dropEffect = drag.kind === 'team' ? 'copy' : 'move'; cell.classList.add('over'); } },
          ondragleave: () => cell.classList.remove('over'),
          ondrop: e => { e.preventDefault(); cell.classList.remove('over'); dropOnCell(f.name, d); }
        },
          x.capacity ? h('div', { class: 'cell-util', title: `Peak ${x.peakPlayers} of ${x.capacity} players${x.peakAt ? ` at ${clock(x.peakAt)}` : ''} · ${x.headroom} open` },
            h('span', { class: `cell-pct ${tone(x.utilization)}`, text: pct(x.utilization) }),
            h('span', { class: 'cell-sub', text: `${x.peakPlayers}/${x.capacity} · ${x.headroom} open` }),
            h('div', { class: 'cell-meter' }, h('span', { class: tone(x.utilization), style: `width:${Math.min(100, Math.round((x.utilization || 0) * 100))}%` }))) : null,
          list.map(b => card(b, tm.get(b.team), q)));
        cells.push(cell);
      }
    }
    grid.replaceChildren(...cells);
    renderTray(q);
  }

  const pct = x => x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`;
  const tone = u => u === null || u === undefined ? '' : u >= 1 ? 'hot' : u >= .8 ? 'warm' : u >= .5 ? 'mid' : 'cool';
  function sorter(mode) {
    const u = f => f.weekUtil ?? -1;
    if (mode === 'util') return (a, b) => u(b) - u(a) || a.name.localeCompare(b.name);
    if (mode === 'headroom') return (a, b) => u(a) - u(b) || a.name.localeCompare(b.name);
    if (mode === 'name') return (a, b) => a.name.localeCompare(b.name);
    return (a, b) => a.risk - b.risk || (b.capacity || 0) - (a.capacity || 0) || a.name.localeCompare(b.name);
  }

  /** Field dropdown: groups first, then every field (status in label). Keeps the selection across re-renders. */
  function fillFieldPicker(isComp) {
    const sel = $('board-field'), cur = sel.value;
    const count = fn => result.fields.filter(fn).length;
    const sig = result.fields.map(f => f.name + f.status).join('|');
    if (sel.dataset.sig !== sig) {
      sel.replaceChildren(
        h('optgroup', { label: 'Groups' },
          h('option', { value: '', text: `Competitive fields (${count(isComp)})` }),
          h('option', { value: '__usable__', text: `Usable fields (${count(f => f.usable)})` }),
          h('option', { value: '__risk__', text: `At-risk fields (${count(f => f.risk > 0)})` }),
          h('option', { value: '__all__', text: `All fields (${result.fields.length})` })),
        h('optgroup', { label: 'Single field' },
          [...result.fields].sort((a, b) => a.name.localeCompare(b.name))
            .map(f => h('option', { value: f.name, text: `${f.name} — ${f.status}${f.capacity ? ` · cap ${f.capacity}` : ''}` }))));
      sel.dataset.sig = sig;
    }
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : '';
  }

  function card(b, team, q) {
    ensureId(b);
    const hit = q && b.team.toLowerCase().includes(q);
    return h('div', {
      class: `bcard${b.canceled ? ' canceled' : ''}${hit ? ' hit' : ''}${q && !hit ? ' dim' : ''}`, draggable: 'true', tabindex: '0',
      title: `${b.team} · ${team.roster} players · ${clock(b.start)}–${clock(b.end)}${b.canceled ? ' (canceled)' : ''}\nDrag to move · click to edit`,
      ondragstart: e => startDrag(e, { kind: 'booking', id: b.id, team: b.team, roster: Number(team.roster) || 0 }),
      ondragend: endDrag,
      onclick: () => openEditor(b.id),
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor(b.id); } }
    }, h('span', { class: 'ct', text: short(b.team) }), h('span', { class: 'cm', text: `${clock(b.start)}–${clock(b.end)} · ${Number(team.roster) > 0 ? team.roster : 'roster ?'}` }));
  }

  function renderTray(q) {
    const teams = result.teams.filter(t => t.gap > 0 && (!q || t.name.toLowerCase().includes(q)))
      .sort((a, b) => b.gap - a.gap || a.name.localeCompare(b.name));
    $('board-tray').replaceChildren(...(teams.length ? teams.map(t => h('div', {
      class: 'tcard', draggable: 'true',
      title: `${t.name}: ${t.secure} of ${t.target} sessions secure. Drag onto a field and day to add a session.`,
      ondragstart: e => startDrag(e, { kind: 'team', team: t.name, roster: t.roster }), ondragend: endDrag
    }, h('span', { class: 'ct', text: short(t.name) }), h('span', { class: 'cm', text: `${t.program} · ${t.roster ? `${t.roster} players` : 'roster ?'}` }),
      h('span', { class: 'gap-pill', text: `−${t.gap}` }))) : [h('p', { class: 'hint', text: 'All teams are at target.' })]));
  }

  // ------------------------------------------------------------ drag handling
  function startDrag(e, info) {
    drag = info;
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', info.team);
    document.body.classList.add('dragging', info.kind === 'booking' ? 'drag-booking' : 'drag-team');
    // Paint the verdicts after the drag image is captured.
    requestAnimationFrame(paintVerdicts);
  }
  function paintVerdicts() {
    document.querySelectorAll('#board-grid .bcell').forEach(c => {
      c.classList.remove('v-fit', 'v-nocap', 'v-full', 'v-unusable', 'v-conflict', 'v-surface');
      const v = verdict(c.dataset.field, c.dataset.day);
      if (v) { c.classList.add(`v-${v}`); c.title = VERDICT_TEXT[v]; }
    });
  }
  function endDrag() {
    drag = null;
    document.body.classList.remove('dragging', 'drag-booking', 'drag-team');
    document.querySelectorAll('#board-grid .bcell').forEach(c => { c.classList.remove('v-fit', 'v-nocap', 'v-full', 'v-unusable', 'v-conflict', 'v-surface', 'over'); c.title = ''; });
  }
  const checkpoint = () => window.LGUVersions && window.LGUVersions.commit(); // each board action = its own undo step

  function dropOnCell(fieldName, day) {
    if (!drag) return;
    checkpoint();
    const v = verdict(fieldName, day);
    if (v === 'conflict' && !confirm(`${drag.team} already has a session on ${day}. Add another anyway?`)) return endDrag();
    if (v === 'unusable' && !confirm(`${fieldName} is not usable (${fieldInfo().get(fieldName)?.status}). Place the session there anyway?`)) return endDrag();
    if (v === 'surface' && !confirm(`${fieldName} is ${fieldInfo().get(fieldName)?.surface}, which isn't allowed for this team's program. Place it anyway?`)) return endDrag();
    if (v === 'full' && !confirm(`This puts ${fieldName} over capacity on ${day}. Continue?`)) return endDrag();
    if (drag.kind === 'booking') {
      const b = state.bookings.find(x => x.id === drag.id);
      if (b && (b.field !== fieldName || b.day !== day)) {
        b.field = fieldName; b.day = day;
        b.note = [b.note, 'Moved on board'].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join('; ');
      }
    } else {
      const blk = bestBlock(fieldName, day);
      state.bookings.push({ id: `b${Date.now()}`, day, field: fieldName, start: blk.s, end: blk.e, team: drag.team, canceled: false, note: 'Added on board' });
    }
    endDrag();
    changed(true);
  }
  function dropZone(id, fn) {
    const z = $(id);
    z.addEventListener('dragover', e => { if (drag && drag.kind === 'booking') { e.preventDefault(); z.classList.add('over'); } });
    z.addEventListener('dragleave', () => z.classList.remove('over'));
    z.addEventListener('drop', e => { e.preventDefault(); z.classList.remove('over'); if (drag && drag.kind === 'booking') { checkpoint(); fn(drag.id); endDrag(); changed(true); } });
  }
  dropZone('dz-delete', id => { const i = state.bookings.findIndex(x => x.id === id); if (i >= 0) state.bookings.splice(i, 1); });

  // ------------------------------------------------------------ editor (also the keyboard / touch alternative to dragging)
  function openEditor(id) {
    const b = state.bookings.find(x => x.id === id); if (!b) return;
    editingId = id;
    const ed = $('board-editor');
    const fieldSel = h('select', {}, state.fields.map(f => h('option', { value: f.name, text: f.name, selected: f.name === b.field })));
    const daySel = h('select', {}, DAYS.map(d => h('option', { value: d, text: d, selected: d === b.day })));
    const s = h('input', { type: 'time', step: 300, value: b.start }), e = h('input', { type: 'time', step: 300, value: b.end });
    ed.replaceChildren(
      h('h2', { text: b.team }),
      h('div', { class: 'ed-grid' }, h('label', {}, 'Field', fieldSel), h('label', {}, 'Day', daySel), h('label', {}, 'Start', s), h('label', {}, 'End', e)),
      h('div', { class: 'ed-actions' },
        h('button', { class: 'btn', text: 'Save', onclick: () => {
          if (toMin(e.value) <= toMin(s.value)) { alert('End time must be after start time.'); return; }
          checkpoint();
          Object.assign(b, { field: fieldSel.value, day: daySel.value, start: s.value, end: e.value });
          closeEditor(); changed(true);
        } }),
        h('button', { class: 'btn', text: 'Cancel', onclick: closeEditor }),
        h('button', { class: 'btn danger', text: 'Remove from board', onclick: () => { checkpoint(); state.bookings.splice(state.bookings.indexOf(b), 1); closeEditor(); changed(true); } })));
    ed.hidden = false;
    fieldSel.focus();
  }
  function closeEditor() { editingId = null; $('board-editor').hidden = true; }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && editingId) closeEditor(); });

  // ------------------------------------------------------------ optimize
  // Preview the analysis module's placements, then apply them as real bookings (one undo step).
  let preview = null;
  function openOptimize() {
    const sug = result.suggestions, un = result.unplaced;
    preview = sug;
    const p = $('opt-panel');
    if (!sug.length && !un.length) { p.hidden = false; p.replaceChildren(h('b', { text: 'Every team is already at its weekly target.' }), h('button', { class: 'btn mini', text: 'Close', onclick: closeOptimize })); return; }
    const byProg = {};
    for (const s of sug) (byProg[s.program] = byProg[s.program] || { add: 0, move: 0 })[s.replaces ? 'move' : 'add']++;
    const shortBy = {};
    for (const u of un) shortBy[u.program] = (shortBy[u.program] || 0) + u.sessionsShort;
    p.hidden = false;
    p.replaceChildren(
      h('div', { class: 'opt-head' },
        h('div', {}, h('h3', { text: `Optimize: ${sug.length} session${sug.length === 1 ? '' : 's'} to place` }),
          h('p', { class: 'hint', text: `${result.summary.teamsWithCoach ? `Coach rules on for ${result.summary.teamsWithCoach} team${result.summary.teamsWithCoach === 1 ? '' : 's'}: no coach at two fields at once; ${result.summary.sameFieldPlacements} of ${sug.length} sessions placed on a field the coach or age group already uses that day. ` : 'Add coaches on Teams & targets to turn on coach rules. '}Uses open capacity on usable fields, follows each program's allowed surfaces, and puts at most one session per team per day. Sessions on lapsed or lost fields are moved where possible. Sessions short now: ${result.summary.sessionGap} → ${result.summary.shortAfterPlacement} after applying.` })),
        h('div', { class: 'opt-actions' },
          h('button', { class: 'btn primary', text: `Apply ${sug.length}`, disabled: !sug.length, onclick: applyOptimize }),
          h('button', { class: 'btn', text: 'Close', onclick: closeOptimize }))),
      h('div', { class: 'opt-cols' },
        h('div', {}, h('b', { text: 'By program' }), h('ul', {}, Object.entries(byProg).map(([k, v]) =>
          h('li', { text: `${k}: ${v.add} added${v.move ? `, ${v.move} moved off lapsed/lost fields` : ''}${shortBy[k] ? `, ${shortBy[k]} still short` : ''}` })),
          Object.keys(shortBy).filter(k => !byProg[k]).map(k => h('li', { text: `${k}: ${shortBy[k]} still short` })))),
        un.length ? h('div', {}, h('b', { class: 'bad', text: `Can't place (${un.reduce((a, u) => a + u.sessionsShort, 0)} sessions)` }),
          h('ul', {}, un.map(u => h('li', { text: `${short(u.team)}: ${u.sessionsShort} short. ${u.reason}` })))) : null),
      h('details', {}, h('summary', { text: 'Preview every placement' }),
        h('div', { class: 'scroller short' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Team', 'Coach', 'Program', 'Day', 'Field', 'Surface', 'Time', 'Action'].map(x => h('th', { text: x })))),
          h('tbody', {}, sug.map(s => h('tr', {}, h('td', { text: s.team }), h('td', { text: (state.teams.find(t => t.name === s.team) || {}).coach || '—' }), h('td', { text: s.program }), h('td', { text: s.day }),
            h('td', { text: s.field }), h('td', { text: s.surface || '' }), h('td', { text: `${clock(s.start)}–${clock(s.end)}` }),
            h('td', { text: s.replaces ? `Move from ${s.replaces.field}` : 'Add' }))))))));
    p.scrollIntoView({ block: 'nearest' });
  }
  function closeOptimize() { preview = null; $('opt-panel').hidden = true; }
  function applyOptimize() {
    if (!preview || !preview.length) return;
    if (window.LGUVersions) window.LGUVersions.saveVersion('Before Optimize', `${preview.length} sessions to place`, true);
    checkpoint();
    let n = 0, moved = 0;
    const stamp = Date.now();
    for (const s of preview) {
      if (s.replaces) {
        const old = state.bookings.find(b => b.team === s.team && b.day === s.day && b.field === s.replaces.field && b.start === s.replaces.start && !b.canceled);
        if (old) { state.bookings.splice(state.bookings.indexOf(old), 1); moved++; }
      }
      state.bookings.push({ id: `opt${stamp}-${n++}`, day: s.day, field: s.field, start: s.start, end: s.end, team: s.team, canceled: false, note: 'Added by Optimize' });
    }
    closeOptimize();
    changed(true);
    const msg = `Optimize added ${n} sessions${moved ? `, moved ${moved}` : ''}. Undo is available.`;
    setTimeout(() => { $('save-state').textContent = msg; }, 400); // after the autosave notice
  }
  $('board-optimize').addEventListener('click', openOptimize);

  ['board-field', 'board-sort'].forEach(id => $(id).addEventListener('change', render));
  $('board-query').addEventListener('input', render);
  renderHooks.push(render);
  render();
  window.LGUBoard = { verdict, bestBlock, freeDuring, dropOnCell, startDragForTest: info => { drag = info; } };
})();
