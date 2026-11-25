/* LGU Field Planner – UI controller. State lives in localStorage; all math is in analysis.js. */
'use strict';
const A = window.LGUAnalysis;
const STORE = 'lgu-field-planner-v1';
const DAYS = A.DAYS;
const STATUSES = Object.keys(A.STATUS);
const PERMITS = ['Unknown', 'Confirmed', 'Pending', 'Lost'];
const PROGRAMS = Object.keys(A.DEFAULT_SETTINGS.targets);

const $ = id => document.getElementById(id);
const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'value') value = v; // set as a property below: <textarea> ignores a value attribute
    else if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
  if (value !== undefined) e.value = value;
  return e;
};
const pct = x => x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`;
const clock = t => { if (!t) return ''; const [H, M] = t.split(':').map(Number); return `${(H % 12) || 12}:${String(M).padStart(2, '0')}${H < 12 ? 'a' : 'p'}`; };
const badge = s => h('span', { class: `badge b-${s.split(' ')[0]}`, text: s });

// replaceChildren() prints null/undefined/false as text ("null"). Skip empty items everywhere.
(() => {
  const native = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function (...kids) { return native.apply(this, kids.flat(Infinity).filter(k => k !== null && k !== undefined && k !== false)); };
})();

// ---------------------------------------------------------------- state
const clone = o => JSON.parse(JSON.stringify(o));
const HAD_SAVED_DATA = (() => { try { return !!localStorage.getItem(STORE); } catch (e) { return false; } })(); // first visit = false
let state = load();
let result;
// Extension points used by board.js and versions.js
const renderHooks = [];   // fn(rebuildEditors) after each render
const changeHooks = [];   // fn() after each edit
const beforeReplaceHooks = []; // fn(label) before import/reset replaces data
function load() {
  try { const s = JSON.parse(localStorage.getItem(STORE)); if (s && s.fields && s.teams && s.bookings) return migrate(s); } catch (e) { /* ignore */ }
  return clone(window.LGU_SEED);
}
/** One-time data fixes applied to saved data (seed data already includes them). */
function migrate(s) {
  s.migrations = s.migrations || [];
  if (!s.migrations.includes('2026-11-teams')) {
    // Confirmed by LGU: these two names don't exist. Academy II (U11) does exist but was missing from the roster.
    const drop = new Set(['2013/12B Comp III (U14)', '2011/10B Comp I/II (U16)']);
    s.bookings = s.bookings.filter(b => !drop.has(b.team));
    s.teams = s.teams.filter(t => !drop.has(t.name));
    if (!s.teams.some(t => t.name === '2016/15B Academy II (U11)')) {
      const i = s.teams.findIndex(t => t.name === '2016/15B Academy III (U11)');
      s.teams.splice(i < 0 ? s.teams.length : i, 0, { name: '2016/15B Academy II (U11)', age: 'U11', gender: 'Boys', roster: null, program: '', target: null });
    }
    s.migrations.push('2026-11-teams');
    try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) { /* storage blocked */ }
  }
  if (!s.migrations.includes('2026-11-fixed-capacity')) {
    // Freeze capacity so moving/removing sessions never changes it. Baseline = Oct 19–23 observed peak.
    const seedCap = new Map(window.LGU_SEED.fields.map(f => [f.name, f.baselineCap]));
    for (const f of s.fields) if (f.baselineCap == null) f.baselineCap = seedCap.get(f.name) ?? null;
    s.migrations.push('2026-11-fixed-capacity');
    try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) { /* storage blocked */ }
  }
  if (!s.migrations.includes('2026-11-coaches')) {
    for (const t of s.teams) if (t.coach === undefined) t.coach = '';
    const t = s.teams.find(x => x.name === '2016/15B Academy II (U11)');
    if (t && !t.coach) t.coach = 'Pale Godinez';
    s.migrations.push('2026-11-coaches');
    try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) { /* storage blocked */ }
  }
  if (!s.migrations.includes('2026-11-gk-coaches')) {
    // Add GK groups, fill head coaches from the LGU coach directory, and refresh the baseline
    // capacity for fields whose baseline was set before GK rosters were known.
    const seed = window.LGU_SEED;
    for (const g of seed.teams.filter(t => t.program === 'GK'))
      if (!s.teams.some(t => t.name === g.name)) s.teams.push(JSON.parse(JSON.stringify(g)));
    const seedCoach = new Map(seed.teams.map(t => [t.name, t.coach]));
    for (const t of s.teams) if (!String(t.coach || '').trim() && seedCoach.get(t.name)) t.coach = seedCoach.get(t.name);
    const OLD_BASE = { 'Union Middle School Grass': 26 }; // only fields whose baseline changed with GK included
    const seedBase = new Map(seed.fields.map(f => [f.name, f.baselineCap]));
    for (const f of s.fields) if (OLD_BASE[f.name] !== undefined && Number(f.baselineCap) === OLD_BASE[f.name]) f.baselineCap = seedBase.get(f.name);
    s.migrations.push('2026-11-gk-coaches');
    try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) { /* storage blocked */ }
  }
  if (!s.migrations.includes('2026-11-academy2-roster')) {
    // Roster confirmed from the team page: 11 rostered players (5 guests not counted).
    const t = s.teams.find(x => x.name === '2016/15B Academy II (U11)');
    if (t && !(Number(t.roster) > 0)) t.roster = 11;
    s.migrations.push('2026-11-academy2-roster');
    try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) { /* storage blocked */ }
  }
  return s;
}
let saveTimer;
/** Header status message. A message set with notify() stays visible ~4 s instead of being
 *  replaced by the routine "Saving…/Saved" text from the autosave that follows it. */
let notice = { text: '', until: 0 };
function notify(text, ms = 4000) { notice = { text, until: Date.now() + ms }; $('save-state').textContent = text; }
function saveStatus(text) { if (Date.now() >= notice.until) $('save-state').textContent = text; }
function save() {
  clearTimeout(saveTimer);
  saveStatus('Saving…');
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE, JSON.stringify(state)); saveStatus(`Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`); }
    catch (e) { $('save-state').textContent = 'Not saved (storage blocked)'; }
  }, 250);
}
let renderTimer;
/** Called after any edit. `rebuildEditors` re-draws edit tables (skip while typing in them). */
function changed(rebuildEditors = false) {
  save();
  changeHooks.forEach(f => f());
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => render(rebuildEditors), 120);
}

// ---------------------------------------------------------------- tabs
let currentTab = 'dashboard';
document.querySelectorAll('[role=tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
function showTab(tab) {
  currentTab = tab;
  document.querySelectorAll('[role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('[role=tabpanel]').forEach(p => p.hidden = p.id !== tab);
  render(true);
}

// ---------------------------------------------------------------- render
function render(rebuildEditors) {
  result = A.analyze(state);
  $('as-of').value = result.summary.asOf;
  renderDashboard();
  renderGaps();
  if (rebuildEditors || currentTab !== 'fields') renderFields();
  if (rebuildEditors || currentTab !== 'teams') renderTeams();
  if (rebuildEditors || currentTab !== 'schedule') renderSchedule();
  renderSettings();
  renderHooks.forEach(f => f(rebuildEditors));
}

function kpi(label, value, sub, tone = '') {
  return h('div', { class: `kpi ${tone}` }, h('div', { class: 'l', text: label }), h('div', { class: 'v', text: value }), sub ? h('div', { class: 's', text: sub }) : null);
}

function renderDashboard() {
  const s = result.summary;
  const covered = s.sessionsNeeded ? s.sessionsSecure / s.sessionsNeeded : 0;
  $('kpis').replaceChildren(
    kpi('Usable fields', `${s.fieldsUsable}`, `of ${s.fieldsTotal} in inventory`),
    kpi('Fields at risk', `${s.fieldsAtRisk}`, 'lapsed, expiring or pending', s.fieldsAtRisk ? 'warn' : 'ok'),
    kpi('Sessions secured', `${s.sessionsSecure} / ${s.sessionsNeeded}`, `${pct(covered)} of weekly target`, covered >= .95 ? 'ok' : covered >= .8 ? 'warn' : 'bad'),
    kpi('Teams below target', `${s.teamsShort}`, `${s.sessionGap} sessions short`, s.teamsShort ? 'bad' : 'ok'),
    kpi('At-risk sessions', `${s.sessionsAtRisk}`, 'booked on lapsed or lost fields', s.sessionsAtRisk ? 'bad' : 'ok'),
    kpi('Unresolved after placement', `${s.shortAfterPlacement}`, s.shortAfterPlacement ? `${s.playerSessionsShort} player-sessions need new fields` : 'headroom covers the gap', s.shortAfterPlacement ? 'bad' : 'ok')
  );

  // daily chart
  const max = Math.max(1, ...result.daily.map(d => Math.max(d.capacity, d.peakSecure + d.atRiskPlayers)));
  $('daily-chart').replaceChildren(h('div', { class: 'bars' }, result.daily.map(d => {
    const w = x => `${(x / max) * 100}%`;
    return h('div', { class: 'bar-row', title: `${d.day}: ${d.peakSecure} booked on usable fields, ${d.atRiskPlayers} at risk, capacity ${d.capacity}` },
      h('strong', { text: d.day }),
      h('div', { class: 'bar-track' },
        h('div', { class: 'bar-fill', style: `width:${w(d.peakSecure)}` }),
        h('div', { class: 'bar-risk', style: `left:${w(d.peakSecure)};width:${w(d.atRiskPlayers)}` }),
        h('div', { class: 'bar-cap', style: `left:${w(d.capacity)}` })),
      h('span', { class: 'bar-val', text: `${d.peakSecure}${d.atRiskPlayers ? ` +${d.atRiskPlayers} risk` : ''} / ${d.capacity} · ${pct(d.utilization)}` }));
  })), h('p', { class: 'hint', style: 'margin-top:8px', text: 'Bar = peak players on usable fields; black line = usable capacity.' }));

  // status tiles
  const byStatus = {};
  for (const f of result.fields) (byStatus[f.status] = byStatus[f.status] || []).push(f);
  const watch = result.fields.filter(f => f.risk > 0).sort((a, b) => b.risk - a.risk || (a.renewalIn ?? 999) - (b.renewalIn ?? 999));
  $('status-summary').replaceChildren(
    h('div', { class: 'status-grid' }, STATUSES.filter(st => byStatus[st]).map(st => h('div', {
      class: 'status-tile', title: 'Open in Field inventory',
      onclick: () => { filterFieldsByStatus(st); showTab('fields'); }
    }, badge(st), h('div', { class: 'n', text: byStatus[st].length })))),
    watch.length ? h('ul', { class: 'status-list' }, watch.map(f => h('li', {},
      h('b', { text: f.name }), ` — ${f.status}`,
      f.renewal ? ` (renewal ${f.renewal}${f.renewalIn !== null ? `, ${f.renewalIn < 0 ? `${-f.renewalIn} days ago` : `in ${f.renewalIn} days`}` : ''})` : '',
      f.capacity ? ` · ${f.capacity} players` : ''))) : null
  );

  // actions
  const acts = [];
  for (const f of result.fields.filter(f => f.status === 'Lapsed' || f.status === 'Lost')) {
    const n = new Set(state.bookings.filter(b => b.field === f.name && !b.canceled).map(b => b.team)).size;
    acts.push(h('li', {}, h('b', { text: `Renew or replace ${f.name}` }), ` — ${f.status.toLowerCase()}${f.renewal ? ` since ${f.renewal}` : ''}; ${f.capacity || '?'} players of capacity, ${n} teams affected.${f.contact ? ` Contact: ${f.contact}.` : ''}`));
  }
  for (const f of result.fields.filter(f => f.status === 'Expiring')) acts.push(h('li', {}, h('b', { text: `Renew ${f.name}` }), ` before ${f.renewal} (${f.renewalIn} days).`));
  for (const f of result.fields.filter(f => f.status === 'Pending permit')) acts.push(h('li', {}, h('b', { text: `Confirm permit for ${f.name}` }), ` — ${f.capacity || '?'} players of capacity depend on it.`));
  const tight = result.daily.filter(d => d.utilization !== null && d.utilization >= .8);
  if (tight.length) acts.push(h('li', {}, h('b', { text: 'Tight days: ' }), tight.map(d => `${d.day} ${pct(d.utilization)}`).join(', '), '. Little room to absorb displaced teams.'));
  if (result.summary.placeable) acts.push(h('li', {}, h('b', { text: `Review ${result.summary.placeable} suggested placements` }), ' in Weekly gaps.'));
  if (result.summary.shortAfterPlacement) acts.push(h('li', {}, h('b', { text: `Source new field time for ${result.unplaced.length} teams` }), ` — ${result.summary.shortAfterPlacement} sessions can't fit current headroom.`));
  const unmatched = new Set(result.issues.filter(i => i.type === 'No roster match').map(i => i.detail.split(' — ')[0]));
  if (unmatched.size) acts.push(h('li', {}, h('b', { text: `Fix ${unmatched.size} unmatched team names` }), ` (${[...unmatched].join(', ')}). They're excluded from capacity.`));
  $('actions').replaceChildren(...(acts.length ? acts : [h('li', { text: 'No actions. All targets are covered by usable fields.' })]));

  // program coverage
  const progs = {};
  for (const t of result.teams) {
    const p = progs[t.program] = progs[t.program] || { teams: 0, need: 0, secure: 0, risk: 0, short: 0 };
    p.teams++; p.need += t.target; p.secure += t.secure; p.risk += t.atRisk; p.short += t.gap > 0 ? 1 : 0;
  }
  $('program-table').replaceChildren(h('table', {},
    h('thead', {}, h('tr', {}, ['Program', 'Teams', 'Target', 'Secure', 'At risk', 'Coverage', 'Teams short'].map((x, i) => h('th', { class: i ? 'num' : '', text: x })))),
    h('tbody', {}, Object.entries(progs).sort((a, b) => b[1].need - a[1].need).map(([k, p]) => h('tr', {},
      h('td', { text: k }), h('td', { class: 'num', text: p.teams }), h('td', { class: 'num', text: p.need }),
      h('td', { class: 'num', text: p.secure }), h('td', { class: 'num', text: p.risk || '' }),
      h('td', { class: 'num', text: pct(p.need ? p.secure / p.need : null) }),
      h('td', { class: 'num' }, p.short ? h('span', { class: 'gapnum', text: p.short }) : '0'))))));

  // issues
  renderIssues();
}

// ---------------------------------------------------------------- gaps
let heatSel = null;
function renderGaps() {
  const week = result.settings.weekDays;
  const compOnly = $('heat-comp-only').checked;
  const rows = result.fields.filter(f => !compOnly || f.capacity || f.status === 'Active' || f.risk > 0)
    .sort((a, b) => (b.capacity || 0) - (a.capacity || 0));
  $('heatmap').replaceChildren(
    h('thead', {}, h('tr', {}, h('th', { text: 'Field' }), h('th', { text: 'Status' }), h('th', { class: 'num', text: 'Capacity' }), week.map(d => h('th', { text: d })))),
    h('tbody', {}, rows.map(f => h('tr', {},
      h('td', {}, h('b', { text: f.name })), h('td', {}, badge(f.status)),
      h('td', { class: 'num', title: f.capacitySource, text: f.capacity || '—' }),
      week.map(d => {
        const x = f.byDay[d];
        let cls = 'none', main = '—', sub = '';
        if (x.capacity) {
          const u = x.utilization;
          cls = !f.usable ? 'risk' : u >= 1 ? 'u3' : u >= .8 ? 'u2' : u >= .5 ? 'u1' : 'u0';
          main = `${x.peakPlayers}/${x.capacity}`; sub = x.peakPlayers ? `${pct(u)} · ${x.peakTeams} teams` : 'open';
        } else if (x.windows.length) { cls = 'none'; main = 'rec'; sub = x.windows.map(w => `${A.toHHMM(w.start)}`).join(' '); }
        const key = `${f.name}|${d}`;
        return h('td', { class: `cell ${cls}${heatSel === key ? ' sel' : ''}`, onclick: () => { heatSel = heatSel === key ? null : key; renderGaps(); } },
          main, sub ? h('small', { text: sub }) : null);
      }))))
  );
  // detail
  const det = $('heat-detail');
  if (heatSel) {
    const [fname, d] = heatSel.split('|');
    const list = state.bookings.filter(b => b.field === fname && b.day === d).sort((a, b) => a.start.localeCompare(b.start));
    const teamSet = new Map(state.teams.map(t => [t.name, t]));
    det.hidden = false;
    det.replaceChildren(h('b', { text: `${fname} — ${d}` }), list.length ? h('ul', {}, list.map(b => h('li', { style: b.canceled ? 'text-decoration:line-through;color:#888' : '' },
      `${clock(b.start)}–${clock(b.end)} · ${b.team}`, teamSet.has(b.team) ? ` (${teamSet.get(b.team).roster})` : ' (rec/other)'))) : h('p', { text: 'No bookings.' }));
  } else det.hidden = true;

  // team matrix
  const progSel = $('gap-program');
  if (progSel.options.length === 1) PROGRAMS.forEach(p => progSel.append(h('option', { value: p, text: p })));
  const pf = progSel.value, mode = $('gap-filter').value, q = $('gap-query').value.trim().toLowerCase();
  const teams = result.teams.filter(t => (!pf || t.program === pf) && (!q || `${t.name} ${t.age}`.toLowerCase().includes(q))
    && (mode === 'short' ? t.gap > 0 : mode === 'risk' ? t.atRisk > 0 : true))
    .sort((a, b) => b.gap - a.gap || a.name.localeCompare(b.name));
  $('gap-count').textContent = `${teams.length} teams · ${teams.reduce((a, t) => a + t.gap, 0)} sessions short`;
  $('team-matrix').replaceChildren(
    h('thead', {}, h('tr', {}, ['Team', 'Program', 'Roster'].map(x => h('th', { text: x })), week.map(d => h('th', { text: d })),
      ['Target', 'Secure', 'At risk', 'Gap'].map(x => h('th', { class: 'num', text: x })))),
    h('tbody', {}, teams.map(t => h('tr', {},
      h('td', {}, h('b', { text: t.name })), h('td', { text: t.program }), h('td', { class: 'num', text: t.roster }),
      week.map(d => {
        const x = t.days[d];
        return h('td', { class: 'day' }, x ? h('span', { class: `chip ${x.kind}`, title: `${x.field} ${clock(x.start)}–${clock(x.end)}`, text: `${x.kind === 'secure' ? 'S' : x.kind === 'atRisk' ? 'R' : 'C'} ${x.field.replace(/ (Elementary|School|Middle|High).*$/, '').slice(0, 14)}` }) : '');
      }),
      h('td', { class: 'num', text: t.target }), h('td', { class: 'num', text: t.secure }), h('td', { class: 'num', text: t.atRisk || '' }),
      h('td', { class: 'num' }, h('span', { class: `gapnum${t.gap ? '' : ' zero'}`, text: t.gap }))))));

  // suggestions
  $('suggestions').replaceChildren(
    h('thead', {}, h('tr', {}, ['Team', 'Roster', 'Day', 'Field', 'Block', 'Headroom left'].map((x, i) => h('th', { class: [1, 5].includes(i) ? 'num' : '', text: x })))),
    h('tbody', {}, result.suggestions.map(s => h('tr', {},
      h('td', { text: s.team }), h('td', { class: 'num', text: s.roster }), h('td', { text: s.day }), h('td', { text: s.field }),
      h('td', { text: `${clock(s.start)}–${clock(s.end)}` }), h('td', { class: 'num', text: s.freeAfter })))));
  $('unplaced').replaceChildren(...(result.unplaced.length ? [h('h2', { style: 'margin-top:14px', text: 'Could not place' }),
    h('ul', {}, result.unplaced.map(u => h('li', { text: `${u.team} (${u.roster} players): ${u.sessionsShort} session(s) — no usable slot with enough headroom` })))] : []));
}
['heat-comp-only', 'gap-program', 'gap-filter'].forEach(id => $(id).addEventListener('change', renderGaps));
$('gap-query').addEventListener('input', renderGaps);

// ---------------------------------------------------------------- generic editable table helpers
const inp = (value, onchange, props = {}) => h('input', Object.assign({ value: value ?? '', oninput: e => onchange(e.target.value, e) }, props));
const sel = (value, options, onchange) => h('select', { onchange: e => onchange(e.target.value) }, options.map(o => h('option', { value: o, text: o || '—', selected: o === (value ?? '') })));
const delBtn = onclick => h('button', { class: 'btn mini', title: 'Delete', text: '✕', onclick });
function renameEverywhere(kind, from, to) {
  if (!from || from === to) return;
  for (const b of state.bookings) { if (kind === 'field' && b.field === from) b.field = to; if (kind === 'team' && b.team === from) b.team = to; }
}

// ---------------------------------------------------------------- fields editor
// Column definitions for the inventory table: how to read a value for sorting/filtering,
// and which filter control to show (select = pick from values, num = numeric, text = contains).
const FIELD_COLS = (() => {
  const day = d => ({ key: d, label: d, w: 122, center: true, filter: 'text', get: (f) => f.windows?.[d] || '',
    sort: (f) => { const w = A.parseWindows(f.windows?.[d]); return w.length ? w.reduce((a, x) => a + x.end - x.start, 0) : null; } });
  return [
    { key: 'name', label: 'Field', w: 250, filter: 'text', get: f => f.name },
    { key: 'status', label: 'Status', w: 210, filter: 'select', get: (f, r) => r.status || '', options: () => STATUSES },
    { key: 'comp', label: 'Comp use', w: 82, filter: 'select', get: f => f.compEligible ? 'Yes' : 'No', options: () => ['Yes', 'No'] },
    { key: 'permit', label: 'Permit', w: 120, filter: 'select', get: f => f.permit || 'Unknown', options: () => PERMITS },
    { key: 'renewal', label: 'Renewal', w: 150, filter: 'text', get: f => f.renewal || '' },
    { key: 'peak', label: 'Observed peak', w: 108, filter: 'num', get: (f, r) => r.observedPeak ?? null },
    { key: 'base', label: 'Baseline cap', w: 108, filter: 'num', get: f => (Number(f.baselineCap) > 0 ? Number(f.baselineCap) : null) },
    { key: 'cap', label: 'Capacity used', w: 108, filter: 'num', get: (f, r) => r.capacity ?? null, readonly: true },
    { key: 'pcap', label: 'Planning cap', w: 108, filter: 'num', get: f => (f.planningCap ?? null) },
    { key: 'surface', label: 'Surface', w: 118, filter: 'select', get: f => f.surface || '', options: () => ['Grass', 'Turf', 'Hardwood'] },
    { key: 'lights', label: 'Lights', w: 82, filter: 'select', get: f => f.lights || '', options: () => ['Yes', 'No'] },
    ...DAYS.map(day),
    { key: 'contact', label: 'Contact', w: 160, filter: 'select', get: f => f.contact || '', options: () => [...new Set(state.fields.map(f => f.contact).filter(Boolean))].sort() },
    { key: 'cost', label: 'Cost ($/mo)', w: 110, filter: 'num', get: f => f.cost === '' || f.cost == null ? null : Number(String(f.cost).replace(/[^\d.]/g, '')) || null },
    { key: 'notes', label: 'Notes', w: 340, filter: 'text', get: f => f.notes || '' },
    { key: 'del', label: '', w: 46, nosort: true }
  ];
})();
const fieldView = { sort: null, dir: 1, filters: {} }; // filters[key] = string
const BLANK = '(blank)', NOT_BLANK = '(not blank)';

function matchFilter(col, raw, value) {
  const q = String(value ?? '').trim();
  if (!q) return true;
  const empty = raw === null || raw === undefined || raw === '';
  if (q === BLANK) return empty;
  if (q === NOT_BLANK) return !empty;
  if (col.filter === 'select') return String(raw) === q;
  if (col.filter === 'num') {
    if (empty) return false;
    const n = Number(raw), m = q.replace(/\s/g, '');
    let x;
    if ((x = m.match(/^(>=|<=|>|<|=)(-?\d+(?:\.\d+)?)$/))) {
      const v = Number(x[2]);
      return x[1] === '>' ? n > v : x[1] === '<' ? n < v : x[1] === '>=' ? n >= v : x[1] === '<=' ? n <= v : n === v;
    }
    if ((x = m.match(/^(-?\d+(?:\.\d+)?)[-–](-?\d+(?:\.\d+)?)$/))) return n >= Number(x[1]) && n <= Number(x[2]);
    if (/^-?\d+(\.\d+)?$/.test(m)) return n === Number(m);
    return String(raw).toLowerCase().includes(q.toLowerCase());
  }
  return String(raw).toLowerCase().includes(q.toLowerCase());
}
/** Called from the dashboard tiles: show only one status. */
function filterFieldsByStatus(st) { fieldView.filters = { status: st }; }

function renderFields() {
  const q = $('field-query').value.trim().toLowerCase();
  const info = new Map(result.fields.map(f => [f.name, f]));
  let rows = state.fields.map((f, i) => ({ f, i, r: info.get(f.name) || {} }));
  rows = rows.filter(({ f, r }) => (!q || FIELD_COLS.some(c => c.get && String(c.get(f, r) ?? '').toLowerCase().includes(q)))
    && FIELD_COLS.every(c => !c.get || matchFilter(c, c.get(f, r), fieldView.filters[c.key])));
  if (fieldView.sort) {
    const c = FIELD_COLS.find(x => x.key === fieldView.sort), val = c.sort || c.get;
    rows.sort((a, b) => {
      const x = val(a.f, a.r), y = val(b.f, b.r);
      const ex = x === null || x === undefined || x === '', ey = y === null || y === undefined || y === '';
      if (ex || ey) return ex === ey ? a.f.name.localeCompare(b.f.name) : ex ? 1 : -1; // blanks always last
      const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return d * fieldView.dir || a.f.name.localeCompare(b.f.name);
    });
  }
  const active = Object.values(fieldView.filters).filter(v => String(v || '').trim()).length;
  $('field-count').textContent = `${rows.length} of ${state.fields.length} fields${active ? ` · ${active} column filter${active > 1 ? 's' : ''}` : ''}${fieldView.sort ? ` · sorted by ${FIELD_COLS.find(c => c.key === fieldView.sort).label} ${fieldView.dir > 0 ? '↑' : '↓'}` : ''}`;
  $('field-clear').hidden = !active && !fieldView.sort && !q;

  const table = $('field-table');
  table.style.width = `${FIELD_COLS.reduce((a, c) => a + c.w, 0)}px`;

  // Header row (sort) + filter row. Rebuild only when the column set changes, so typing in a filter keeps focus.
  if (!table.tHead || table.dataset.cols !== String(FIELD_COLS.length)) {
    const sortRow = h('tr', {}, FIELD_COLS.map(c => h('th', { class: `${c.center ? 'c ' : ''}${c.nosort ? '' : 'sortable'}`, 'data-key': c.key, scope: 'col',
      onclick: c.nosort ? null : () => {
        if (fieldView.sort !== c.key) { fieldView.sort = c.key; fieldView.dir = 1; }
        else if (fieldView.dir === 1) fieldView.dir = -1;
        else fieldView.sort = null;
        renderFields();
      } }, h('span', { class: 'th-label', text: c.label }), c.nosort ? null : h('span', { class: 'sort-ind', 'aria-hidden': 'true' }))));
    const filterRow = h('tr', { class: 'filter-row' }, FIELD_COLS.map(c => h('th', { 'data-key': c.key }, c.get ? filterControl(c) : null)));
    table.replaceChildren(h('colgroup', {}, FIELD_COLS.map(c => h('col', { style: `width:${c.w}px` }))), h('thead', {}, sortRow, filterRow), h('tbody'));
    table.dataset.cols = String(FIELD_COLS.length);
  }
  // Update sort indicators + filter option lists (values can change as data is edited)
  table.tHead.rows[0].querySelectorAll('th').forEach(th => {
    const on = th.dataset.key === fieldView.sort;
    th.setAttribute('aria-sort', on ? (fieldView.dir > 0 ? 'ascending' : 'descending') : 'none');
    th.classList.toggle('sorted', on);
    const ind = th.querySelector('.sort-ind'); if (ind) ind.textContent = on ? (fieldView.dir > 0 ? '▲' : '▼') : '↕';
  });
  table.tHead.rows[1].querySelectorAll('th').forEach(th => {
    const c = FIELD_COLS.find(x => x.key === th.dataset.key), ctl = th.firstChild;
    if (!c || !ctl) return;
    if (c.filter === 'select') {
      const want = ['', BLANK, NOT_BLANK, ...c.options()];
      if ([...ctl.options].map(o => o.value).join('|') !== want.join('|'))
        ctl.replaceChildren(...want.map(v => h('option', { value: v, text: v || 'All' })));
      ctl.value = fieldView.filters[c.key] || '';
    } else if (document.activeElement !== ctl) ctl.value = fieldView.filters[c.key] || '';
    th.classList.toggle('filtering', !!String(fieldView.filters[c.key] || '').trim());
  });

  table.tBodies[0].replaceChildren(...rows.map(({ f, i, r }) => {
    const set = k => v => { f[k] = v; changed(); };
    return h('tr', {},
      h('td', { class: 'name' }, h('textarea', { class: 'wrap one-line', rows: 1, 'aria-label': 'Field name', value: f.name,
        onkeydown: e => { if (e.key === 'Enter') e.preventDefault(); },
        oninput: e => { const v = e.target.value.replace(/\n/g, ' '); renameEverywhere('field', f.name, v); f.name = v; autoGrow(e.target); changed(); } })),
      h('td', { class: 'status-cell' },
        h('select', { class: `status-sel b-${(r.status || '').split(' ')[0]}`, 'aria-label': `Status for ${f.name}`,
          title: f.statusOverride ? `Set manually. Calculated status: ${r.autoStatus}` : 'Calculated from comp use, permit and renewal date',
          onchange: e => { f.statusOverride = e.target.value || null; changed(true); } },
          h('option', { value: '', text: `Auto (${r.autoStatus || '—'})`, selected: !f.statusOverride }),
          STATUSES.map(s => h('option', { value: s, text: s, selected: f.statusOverride === s }))),
        f.statusOverride ? h('span', { class: 'manual', title: `Calculated status would be ${r.autoStatus}`, text: 'manual' }) : null),
      h('td', { style: 'text-align:center' }, h('input', { type: 'checkbox', checked: !!f.compEligible, 'aria-label': `${f.name} comp use`, title: 'Field is used/allowed for competitive teams', onchange: e => { f.compEligible = e.target.checked; changed(); } })),
      h('td', {}, sel(f.permit || 'Unknown', PERMITS, set('permit'))),
      h('td', {}, inp(f.renewal, set('renewal'), { type: 'date' })),
      h('td', { class: 'num', text: r.observedPeak || '' }),
      h('td', { class: 'num', text: Number(f.baselineCap) > 0 ? f.baselineCap : '' }),
      h('td', { class: 'num', title: r.capacitySource ? `Source: ${r.capacitySource}` : '', text: r.capacity || '' }),
      h('td', {}, inp(f.planningCap, v => { f.planningCap = v === '' ? null : Number(v); changed(); }, { type: 'number', min: 0, placeholder: f.baselineCap || r.observedPeak || '' })),
      h('td', {}, sel(f.surface || '', ['', 'Grass', 'Turf', 'Hardwood'], set('surface'))),
      h('td', {}, sel(f.lights || '', ['', 'Yes', 'No'], set('lights'))),
      DAYS.map(d => h('td', {}, h('textarea', { class: 'win', rows: Math.max(1, String(f.windows?.[d] || '').split('\n').length), value: f.windows?.[d] || '',
        'aria-label': `${f.name} ${d} window`, placeholder: '', oninput: e => { f.windows = f.windows || {}; f.windows[d] = e.target.value; autoGrow(e.target); changed(); } }))),
      h('td', {}, inp(f.contact, set('contact'))),
      h('td', {}, inp(f.cost, set('cost'))),
      h('td', {}, h('textarea', { class: 'wrap', rows: 1, value: f.notes || '', 'aria-label': `${f.name} notes`, oninput: e => { f.notes = e.target.value; autoGrow(e.target); changed(); } })),
      h('td', {}, delBtn(() => { if (confirm(`Delete ${f.name}? Bookings at this field are kept.`)) { state.fields.splice(i, 1); changed(true); } })));
  }));
  if (!rows.length) table.tBodies[0].append(h('tr', {}, h('td', { colspan: FIELD_COLS.length, class: 'muted', style: 'padding:14px', text: 'No fields match these filters.' })));
  (window.requestAnimationFrame || setTimeout)(() => {
    table.tBodies[0].querySelectorAll('textarea').forEach(autoGrow);
    // Pin the filter row directly under the (possibly two-line) header row.
    const hh = table.tHead.rows[0].getBoundingClientRect().height;
    if (hh) table.style.setProperty('--fh', `${Math.round(hh)}px`);
  });
}
function filterControl(c) {
  const label = `Filter ${c.label}`;
  const update = v => { fieldView.filters[c.key] = v; renderFields(); };
  if (c.filter === 'select') return h('select', { class: 'col-filter', 'aria-label': label, onchange: e => update(e.target.value) });
  return h('input', { type: 'search', class: 'col-filter', 'aria-label': label, list: 'dl-filter-hints',
    placeholder: c.filter === 'num' ? '>100, 50-150' : 'Filter…', oninput: e => update(e.target.value) });
}
/** Grow a textarea to fit its content (no inner scrollbars). */
function autoGrow(el) { if (!el.scrollHeight) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; }
document.body.append(h('datalist', { id: 'dl-filter-hints' }, h('option', { value: BLANK }), h('option', { value: NOT_BLANK })));
$('field-query').addEventListener('input', () => renderFields());
$('field-clear').addEventListener('click', () => { fieldView.filters = {}; fieldView.sort = null; $('field-query').value = ''; renderFields(); });
$('add-field').addEventListener('click', () => {
  state.fields.unshift({ name: 'New field', compEligible: true, permit: 'Unknown', planningCap: null, baselineCap: null, surface: '', lights: '', renewal: '', windows: {}, contact: '', cost: '', notes: '' });
  $('field-query').value = ''; fieldView.filters = {}; fieldView.sort = null; changed(true);
});

// ---------------------------------------------------------------- teams editor
function renderTeams() {
  const q = $('team-query').value.trim().toLowerCase();
  const info = new Map(result.teams.map(t => [t.name, t]));
  const rows = state.teams.map((t, i) => ({ t, i, r: info.get(t.name) || {} })).filter(({ t }) => !q || `${t.name} ${t.age} ${t.coach || ''}`.toLowerCase().includes(q));
  const withCoach = state.teams.filter(t => String(t.coach || '').trim()).length;
  $('team-count').textContent = `${rows.length} of ${state.teams.length} teams · ${state.teams.reduce((a, t) => a + (Number(t.roster) || 0), 0)} players · coach entered for ${withCoach}`;
  $('team-table').replaceChildren(
    h('thead', {}, h('tr', {}, ['Team', 'Coach(es)', 'Age', 'Gender', 'Roster', 'Program', 'Target / wk', 'Secure', 'Gap', ''].map(x => h('th', { text: x })))),
    h('tbody', {}, rows.map(({ t, i, r }) => h('tr', {},
      h('td', { class: 'name' }, inp(t.name, v => { renameEverywhere('team', t.name, v); t.name = v; changed(); })),
      h('td', {}, inp(t.coach, v => { t.coach = v; changed(); }, { list: 'dl-coaches', placeholder: 'Add coach', style: 'min-width:190px', title: 'Separate multiple coaches with ; (e.g. Pale Godinez; Sam Ruiz)', 'aria-label': `${t.name} coach` })),
      h('td', {}, inp(t.age, v => { t.age = v; changed(); }, { style: 'width:60px' })),
      h('td', {}, sel(t.gender, ['Girls', 'Boys', 'Coed'], v => { t.gender = v; changed(); })),
      h('td', {}, inp(t.roster, v => { t.roster = v === '' ? null : Number(v); changed(); }, { type: 'number', min: 0, style: 'width:70px', placeholder: 'needed', class: Number(t.roster) > 0 ? '' : 'missing' })),
      h('td', {}, sel(A.normalizeProgram(t.program) || '', ['', ...PROGRAMS], v => { t.program = v; changed(); })),
      h('td', {}, inp(t.target, v => { t.target = v === '' ? null : Number(v); changed(); }, { type: 'number', min: 0, max: 7, style: 'width:70px', placeholder: r.target })),
      h('td', { class: 'num', text: r.secure ?? '' }),
      h('td', { class: 'num' }, h('span', { class: `gapnum${r.gap ? '' : ' zero'}`, text: r.gap ?? '' })),
      h('td', {}, delBtn(() => { if (confirm(`Delete ${t.name}?`)) { state.teams.splice(i, 1); changed(true); } }))))));
  const names = [...new Set(state.teams.flatMap(t => A.coachList(t.coach)))].sort();
  let dl = $('dl-coaches'); if (!dl) { dl = h('datalist', { id: 'dl-coaches' }); document.body.append(dl); }
  dl.replaceChildren(...names.map(n => h('option', { value: n })));
}
$('team-query').addEventListener('input', () => renderTeams());
$('add-team').addEventListener('click', () => { state.teams.unshift({ name: 'New team', coach: '', age: '', gender: 'Girls', roster: 0, program: '', target: null }); $('team-query').value = ''; changed(true); });

// ---------------------------------------------------------------- schedule editor
function renderSchedule() {
  const fill = (id, vals) => { const s = $(id); const cur = s.value; s.replaceChildren(h('option', { value: '', text: 'All' }), ...vals.map(v => h('option', { value: v, text: v }))); s.value = vals.includes(cur) ? cur : ''; };
  fill('sch-day', DAYS);
  fill('sch-field', [...new Set([...state.fields.map(f => f.name), ...state.bookings.map(b => b.field)])].sort());
  $('dl-fields').replaceChildren(...state.fields.map(f => h('option', { value: f.name })));
  $('dl-teams').replaceChildren(...state.teams.map(t => h('option', { value: t.name })));
  const teamSet = new Set(state.teams.map(t => t.name));
  const d = $('sch-day').value, f = $('sch-field').value, ty = $('sch-type').value, q = $('sch-query').value.trim().toLowerCase();
  const rows = state.bookings.map((b, i) => ({ b, i }))
    .filter(({ b }) => (!d || b.day === d) && (!f || b.field === f) && (!q || b.team.toLowerCase().includes(q))
      && (!ty || (ty === 'comp') === teamSet.has(b.team)))
    .sort((x, y) => DAYS.indexOf(x.b.day) - DAYS.indexOf(y.b.day) || x.b.field.localeCompare(y.b.field) || x.b.start.localeCompare(y.b.start));
  const shown = rows.slice(0, 400);
  $('sch-count').textContent = `${rows.length} bookings${rows.length > shown.length ? ` (showing first ${shown.length}; filter to narrow)` : ''} · ${rows.filter(r => r.b.canceled).length} canceled`;
  $('sch-table').replaceChildren(
    h('thead', {}, h('tr', {}, ['Day', 'Field', 'Start', 'End', 'Team', 'Type', 'Canceled', 'Note', ''].map(x => h('th', { text: x })))),
    h('tbody', {}, shown.map(({ b, i }) => {
      const set = k => v => { b[k] = v; changed(); };
      return h('tr', { class: b.canceled ? 'canceled' : '' },
        h('td', {}, sel(b.day, DAYS, set('day'))),
        h('td', {}, inp(b.field, set('field'), { list: 'dl-fields', style: 'min-width:220px' })),
        h('td', {}, inp(b.start, set('start'), { type: 'time', step: 300 })),
        h('td', {}, inp(b.end, set('end'), { type: 'time', step: 300 })),
        h('td', {}, inp(b.team, set('team'), { list: 'dl-teams', style: 'min-width:220px' })),
        h('td', { text: teamSet.has(b.team) ? 'Comp' : 'Rec / other' }),
        h('td', { style: 'text-align:center' }, h('input', { type: 'checkbox', checked: !!b.canceled, onchange: e => { b.canceled = e.target.checked; e.target.closest('tr').className = b.canceled ? 'canceled' : ''; changed(); } })),
        h('td', {}, inp(b.note, set('note'))),
        h('td', {}, delBtn(() => { state.bookings.splice(i, 1); changed(true); })));
    })));
}
['sch-day', 'sch-field', 'sch-type'].forEach(id => $(id).addEventListener('change', () => renderSchedule()));
$('sch-query').addEventListener('input', () => renderSchedule());
$('add-booking').addEventListener('click', () => {
  state.bookings.unshift({ id: `b${Date.now()}`, day: $('sch-day').value || 'Mon', field: $('sch-field').value || '', start: '15:00', end: '16:15', team: '', canceled: false, note: 'Added manually' });
  $('sch-query').value = ''; $('sch-type').value = ''; changed(true);
});

// ---------------------------------------------------------------- settings
function renderSettings() {
  const s = result.settings;
  if (document.activeElement !== $('set-expiring')) $('set-expiring').value = s.expiringDays;
  if (document.activeElement !== $('set-travel')) $('set-travel').value = s.coachTravelMin ?? 15;
  $('set-days').replaceChildren(...DAYS.map(d => h('label', {}, h('input', { type: 'checkbox', checked: s.weekDays.includes(d), onchange: e => {
    const cur = new Set(result.settings.weekDays); e.target.checked ? cur.add(d) : cur.delete(d);
    state.settings = Object.assign({}, state.settings, { weekDays: DAYS.filter(x => cur.has(x)) }); changed();
  } }), ` ${d}`)));
  if (!$('set-targets').contains(document.activeElement))
    $('set-targets').replaceChildren(...PROGRAMS.map(p => h('label', {}, `${p} `, h('input', { type: 'number', min: 0, max: 7, style: 'width:60px', value: s.targets[p], oninput: e => {
      state.settings = Object.assign({}, state.settings); state.settings.targets = Object.assign({}, result.settings.targets, { [p]: Number(e.target.value) || 0 }); changed();
    } }))));
  // surfaces matrix
  const SURF = A.SURFACES;
  $('set-surfaces').replaceChildren(
    h('thead', {}, h('tr', {}, h('th', { text: 'Program' }), SURF.map(x => h('th', { class: 'c', text: x })))),
    h('tbody', {}, PROGRAMS.map(p => h('tr', {}, h('td', { text: p }), SURF.map(x => h('td', { class: 'c' },
      h('input', { type: 'checkbox', 'aria-label': `${p} on ${x}`, checked: (s.surfaces[p] || []).includes(x), onchange: e => {
        const cur = new Set(result.settings.surfaces[p] || []); e.target.checked ? cur.add(x) : cur.delete(x);
        state.settings = Object.assign({}, state.settings);
        state.settings.surfaces = Object.assign({}, result.settings.surfaces, { [p]: SURF.filter(y => cur.has(y)) });
        changed();
      } })))))));
}
$('surface-defaults').addEventListener('click', () => {
  state.settings = Object.assign({}, state.settings); delete state.settings.surfaces; changed(true);
});
$('set-travel').addEventListener('input', e => { state.settings = Object.assign({}, state.settings, { coachTravelMin: e.target.value === '' ? 15 : Number(e.target.value) }); changed(); });
$('set-expiring').addEventListener('input', e => { state.settings = Object.assign({}, state.settings, { expiringDays: Number(e.target.value) || 0 }); changed(); });
$('as-of').addEventListener('change', e => { state.settings = Object.assign({}, state.settings, { asOf: e.target.value }); changed(true); });

// ---------------------------------------------------------------- data issues
const ISSUE_INFO = {
  'Coach double-booked': { fix: 'A head coach is at two different fields at once (or with less travel time than set in Data & settings). Move one session, or remove a coach from the team if another head coach covers it.', tab: 'board', go: 'Open Board' },
  'Surface not allowed': { fix: "These sessions are on a surface the program isn't allowed to use. Move them on the Board, or allow that surface for the program in Data & settings.", tab: 'data', go: 'Surface settings' },
  'Roster size missing': { fix: "Without a roster size, the team's players don't count toward field capacity.", tab: 'teams', go: 'Teams & targets' },
  'Capacity not fixed': { fix: "This field has no baseline or planning cap, so its capacity follows the live schedule. Enter a Planning cap.", tab: 'fields', go: 'Field inventory' },
  'No capacity': { fix: 'This field is usable but has no capacity, so it can’t be planned. Enter a Planning cap.', tab: 'fields', go: 'Field inventory' },
  'No roster match': { fix: "These bookings use a team name that isn't on Teams & targets. Add the team or correct the name.", tab: 'schedule', go: 'Schedule' },
  'Unknown field': { fix: "These bookings use a field that isn't in the inventory. Add the field or correct the name.", tab: 'fields', go: 'Field inventory' }
};
const SEV = { high: { label: 'Fix first', cls: 'sev-high' }, med: { label: 'Skews the numbers', cls: 'sev-med' }, low: { label: 'Housekeeping', cls: 'sev-low' } };
const dayOrder = d => DAYS.indexOf(d);
const tm = (a, b) => `${clock(a)}–${clock(b)}`;
const shortField = f => f.replace('Los Gatos High School', 'LGHS').replace('Union Middle School', 'Union MS').replace('Westmont High School', 'Westmont').replace(' Elementary', '');

function issueTable(type, list) {
  const tbl = (head, rows) => h('table', { class: 'issue-table' }, h('thead', {}, h('tr', {}, head.map(x => h('th', { text: x })))), h('tbody', {}, rows));
  if (type === 'Coach double-booked') {
    // One row per coach + day + clashing pair; group by coach
    const byCoach = new Map();
    for (const i of list) { if (!byCoach.has(i.coach)) byCoach.set(i.coach, []); byCoach.get(i.coach).push(i); }
    return h('div', {}, [...byCoach.entries()].sort().map(([coach, l]) => h('div', { class: 'issue-sub' },
      h('div', { class: 'issue-subhead' }, h('b', { text: coach }), h('span', { class: 'muted', text: ` · ${l.length} clash${l.length > 1 ? 'es' : ''}` })),
      tbl(['Day', 'Session 1', 'Session 2'], l.sort((x, y) => dayOrder(x.day) - dayOrder(y.day) || x.a.start.localeCompare(y.a.start)).map(i => {
        const [p, q] = [i.a, i.b].sort((x, y) => x.start.localeCompare(y.start));
        const cell = s => h('td', {}, h('div', { text: s.team }), h('div', { class: 'muted', text: `${shortField(s.field)} · ${tm(s.start, s.end)}` }));
        return h('tr', {}, h('td', { class: 'nowrap', text: i.day }), cell(p), cell(q));
      })))));
  }
  if (type === 'Surface not allowed') {
    // Group by field + surface, then list team/day
    const byField = new Map();
    for (const i of list) { const k = `${i.field}|${i.surface}`; if (!byField.has(k)) byField.set(k, []); byField.get(k).push(i); }
    return h('div', {}, [...byField.entries()].map(([k, l]) => {
      const [field, surface] = k.split('|');
      const progs = [...new Set(l.map(i => i.program))].join(', ');
      const byTeam = new Map();
      for (const i of l) { if (!byTeam.has(i.team)) byTeam.set(i.team, { program: i.program, days: [] }); byTeam.get(i.team).days.push(i.day); }
      return h('div', { class: 'issue-sub' },
        h('div', { class: 'issue-subhead' }, h('b', { text: field }), h('span', { class: 'muted', text: ` · ${surface} · ${l.length} session${l.length > 1 ? 's' : ''} · ${progs}` })),
        tbl(['Team', 'Program', 'Days'], [...byTeam.entries()].sort((x, y) => x[1].program.localeCompare(y[1].program) || x[0].localeCompare(y[0]))
          .map(([team, v]) => h('tr', {}, h('td', { text: team }), h('td', { text: v.program }), h('td', { text: v.days.sort((x, y) => dayOrder(x) - dayOrder(y)).join(', ') })))));
    }));
  }
  if (type === 'No roster match') return tbl(['Team name in schedule', 'Day', 'Field', 'Start'], list.map(i => h('tr', {}, h('td', { text: i.team }), h('td', { text: i.day }), h('td', { text: i.field }), h('td', { text: clock(i.start) }))));
  if (type === 'Unknown field') return tbl(['Field name in schedule', 'Team', 'Day'], list.map(i => h('tr', {}, h('td', { text: i.field }), h('td', { text: i.team }), h('td', { text: i.day }))));
  if (type === 'Roster size missing') return h('ul', { class: 'issue-list' }, list.map(i => h('li', { text: i.team })));
  return h('ul', { class: 'issue-list' }, list.map(i => h('li', { text: i.field || i.detail })));
}

function renderIssues() {
  const issues = result.issues;
  $('issues-card').hidden = !issues.length;
  if (!issues.length) return;
  const groups = new Map();
  for (const i of issues) { if (!groups.has(i.type)) groups.set(i.type, []); groups.get(i.type).push(i); }
  const order = ['high', 'med', 'low'];
  const sorted = [...groups.entries()].sort((x, y) => order.indexOf(x[1][0].sev) - order.indexOf(y[1][0].sev));
  const counts = order.map(s => sorted.filter(([, l]) => l[0].sev === s).reduce((a, [, l]) => a + l.length, 0));
  $('issues-summary').replaceChildren(...order.map((s, k) => counts[k] ? h('span', { class: `sev-pill ${SEV[s].cls}`, text: `${counts[k]} ${SEV[s].label.toLowerCase()}` }) : null));
  $('issues').replaceChildren(...sorted.map(([type, list], idx) => {
    const info = ISSUE_INFO[type] || {}, sev = SEV[list[0].sev] || SEV.low;
    const open = idx === 0 || list.length <= 3;
    return h('details', { class: `issue-group ${sev.cls}`, open },
      h('summary', {},
        h('span', { class: 'issue-title', text: type }),
        h('span', { class: 'issue-count', text: list.length }),
        h('span', { class: `sev-tag ${sev.cls}`, text: sev.label })),
      h('div', { class: 'issue-body' },
        h('p', { class: 'issue-fix' }, info.fix || '', info.tab ? h('button', { class: 'btn mini', text: `${info.go} →`, onclick: () => showTab(info.tab) }) : null),
        issueTable(type, list)));
  }));
}

// ---------------------------------------------------------------- import / export
function download(name, text, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}
const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCSV = (head, rows) => [head, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
const stamp = () => result.summary.asOf;
$('exp-json').addEventListener('click', () => download(`lgu-field-planner-${stamp()}.json`, JSON.stringify(state, null, 2), 'application/json'));
$('imp-json').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const s = JSON.parse(await file.text());
    if (!Array.isArray(s.fields) || !Array.isArray(s.teams) || !Array.isArray(s.bookings)) throw new Error('Missing fields, teams or bookings');
    beforeReplaceHooks.forEach(f => f('Before JSON import'));
    state = s; changed(true); alert(`Imported ${s.fields.length} fields, ${s.teams.length} teams, ${s.bookings.length} bookings.`);
  } catch (err) { alert(`Import failed: ${err.message}`); }
  e.target.value = '';
});
$('imp-csv').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  const rows = parseCSV(await file.text());
  const head = rows.shift().map(x => x.trim().toLowerCase());
  const col = k => head.indexOf(k);
  const need = ['day', 'field', 'start', 'end', 'team'];
  const missing = need.filter(k => col(k) < 0);
  if (missing.length) { alert(`CSV is missing columns: ${missing.join(', ')}`); e.target.value = ''; return; }
  const norm = d => DAYS.find(x => String(d).toLowerCase().startsWith(x.toLowerCase())) || d;
  const pad = t => { const m = String(t).trim().match(/^(\d{1,2}):(\d{2})/); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : String(t).trim(); };
  const added = rows.map((r, i) => ({ id: `csv${Date.now()}-${i}`, day: norm(r[col('day')]), field: r[col('field')].trim(), start: pad(r[col('start')]), end: pad(r[col('end')]),
    team: r[col('team')].trim(), canceled: col('canceled') >= 0 && /^(true|yes|y|1|x)$/i.test(r[col('canceled')].trim()), note: col('note') >= 0 ? r[col('note')] : '' }));
  const bad = added.filter(b => !DAYS.includes(b.day) || !/^\d{2}:\d{2}$/.test(b.start) || !/^\d{2}:\d{2}$/.test(b.end));
  if (bad.length) { alert(`${bad.length} rows have an invalid day or time (e.g. "${bad[0].day} ${bad[0].start}"). Nothing imported.`); e.target.value = ''; return; }
  beforeReplaceHooks.forEach(f => f('Before CSV import'));
  state.bookings = $('imp-replace').checked ? added : state.bookings.concat(added);
  changed(true); alert(`Imported ${added.length} bookings.`); e.target.value = '';
});
$('exp-bookings').addEventListener('click', () => download(`lgu-bookings-${stamp()}.csv`,
  toCSV(['day', 'field', 'start', 'end', 'team', 'canceled', 'note'], state.bookings.map(b => [b.day, b.field, b.start, b.end, b.team, b.canceled ? 'yes' : '', b.note])), 'text/csv'));
$('exp-gaps').addEventListener('click', () => download(`lgu-team-gaps-${stamp()}.csv`,
  toCSV(['team', 'program', 'age', 'gender', 'roster', 'target', 'secure', 'at_risk', 'canceled', 'gap', ...result.settings.weekDays],
    result.teams.map(t => [t.name, t.program, t.age, t.gender, t.roster, t.target, t.secure, t.atRisk, t.canceled, t.gap,
      ...result.settings.weekDays.map(d => t.days[d] ? `${t.days[d].kind}: ${t.days[d].field} ${t.days[d].start}` : '')])), 'text/csv'));
$('exp-fields').addEventListener('click', () => download(`lgu-field-status-${stamp()}.csv`,
  toCSV(['field', 'status', 'status_source', 'auto_status', 'permit', 'renewal', 'renewal_in_days', 'capacity', 'capacity_source', ...result.settings.weekDays.map(d => `${d}_util`), 'contact', 'notes'],
    result.fields.map(f => [f.name, f.status, f.statusSource, f.autoStatus, f.permit, f.renewal, f.renewalIn ?? '', f.capacity ?? '', f.capacitySource,
      ...result.settings.weekDays.map(d => f.byDay[d].utilization === null ? '' : Math.round(f.byDay[d].utilization * 100) + '%'), f.contact, f.notes])), 'text/csv'));
$('export-suggestions').addEventListener('click', () => download(`lgu-suggested-placements-${stamp()}.csv`,
  toCSV(['team', 'roster', 'day', 'field', 'start', 'end', 'headroom_after'], result.suggestions.map(s => [s.team, s.roster, s.day, s.field, s.start, s.end, s.freeAfter])), 'text/csv'));
$('exp-coaches').addEventListener('click', () => download('lgu-team-coaches.csv', toCSV(['team', 'coach'], state.teams.map(t => [t.name, t.coach || ''])), 'text/csv'));
$('imp-coaches').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  const rows = parseCSV(await file.text()); const head = (rows.shift() || []).map(x => x.trim().toLowerCase());
  const ti = head.findIndex(x => x === 'team' || x === 'team name'), ci = head.findIndex(x => /coach/.test(x));
  if (ti < 0 || ci < 0) { alert('CSV needs a "team" column and a "coach" column.'); e.target.value = ''; return; }
  const byName = new Map(state.teams.map(t => [t.name.trim().toLowerCase(), t]));
  let set = 0; const missing = [];
  for (const r of rows) { const t = byName.get(String(r[ti] || '').trim().toLowerCase()); if (!t) { if (r[ti]) missing.push(r[ti]); continue; } t.coach = String(r[ci] || '').trim(); set++; }
  changed(true); e.target.value = '';
  alert(`Coaches set for ${set} team(s).${missing.length ? `\nNot found (${missing.length}): ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}` : ''}`);
});
$('reset').addEventListener('click', () => { if (confirm('Discard all edits and reload the seed data? You can Undo this until you reload the page.')) { beforeReplaceHooks.forEach(f => f('Before reset')); state = clone(window.LGU_SEED); changed(true); } });

render(true);
$('save-state').textContent = localStorage.getItem(STORE) ? 'Loaded saved edits' : 'Seed data';
