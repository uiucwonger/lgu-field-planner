/* LGU Field Planner – Long Term Planning.
 * Three ranked lists for a program manager:
 *   1. Risks to protect   – fields the plan depends on; impact = sessions that can't be re-homed if lost
 *   2. Quality-field opportunities – new/expanded turf (ideally lit); impact = backup for the top risk + busiest-day relief
 *   3. Fields to sunset   – grass and/or unlit fields; impact = sessions ending after dark
 * Impact numbers are what-if runs of the same analysis engine (A.analyze) on a copy of the plan.
 * Owners, blockers and next steps come from the Oct 12, 2026 fields meeting notes; tracking
 * (status / owner / due) and opportunity assumptions are editable and saved in state.longTerm.
 * Uses app.js globals (state, result, changed, h, $, A, clock, currentTab, renderHooks). */
'use strict';
(function () {
  const DAYS5 = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const STATUSES = ['Not started', 'In progress', 'Waiting on others', 'Done', 'Dropped'];
  const CERTAINTY = { Confirmed: 1, Likely: .7, Conditional: .5, Uncertain: .35, Blocked: .15 };
  // Approximate Los Gatos sunset (local clock time, mid-month). Used for "after dark" counts only.
  const SUNSET = { 1: '17:20', 2: '17:50', 3: '19:10', 4: '19:40', 5: '20:05', 6: '20:30', 7: '20:30', 8: '20:05', 9: '19:20', 10: '18:30', 11: '16:55', 12: '16:55' };
  const MONTH = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---- Meeting-note context (Oct 12, 2026 fields meeting) -----------------------------
  const RISK_NOTES = {
    'Union Middle School Turf': {
      owner: 'Shawn; Phil (district / permit)',
      next: 'Get written approval for the Union turf permit and the usable weekday times.',
      blocker: 'Oct 25 request paid, approval not located. School soccer blocks most weekdays before 5 pm; Wednesday 4 pm unconfirmed.',
      cost: '$678.36 paid (Oct 25). Weekday costs TBD.' },
    'Westmont High School Stadium': {
      owner: 'Phil (booking); Shawn (schedule); Shaun (liaison)',
      next: 'Extend the Tue/Thu stadium windows past Oct 29 and get permit terms in writing.',
      blocker: 'Only Oct 20–29 (four slots, 10 hours) reported confirmed; early-start request pending.',
      cost: 'Rate, fees and insurance TBD.' },
    'Los Gatos High School (Baseball Field)': {
      owner: 'Shawn (schedule); Phil (terms); Joel',
      next: 'Secure post-tryout windows after Nov 5 (the "November bridge") with a dated fallback.',
      blocker: 'Reservation ran through Nov 5. HS tryout dates and released windows TBD.',
      cost: '$285/hour reported. Added hours TBD.' },
    'Los Gatos High School (Softball Field)': {
      owner: 'Shawn (schedule); Phil (terms); Joel',
      next: 'Secure post-tryout windows after Nov 5 together with the baseball field.',
      blocker: 'Reservation ran through Nov 5; baseball/softball assignment moves for school events.',
      cost: '$285/hour reported.' },
    'Futsal Gym': {
      owner: 'Phil (permit / insurance); Shawn / Shaun (use)',
      next: 'Confirm the gym permit beyond Oct 29, plus hours and insurance.',
      blocker: 'Approval covered Oct 8–29; Oct 13–14 request pending. (Assumed to be the "Union gym" in the notes.)',
      cost: '$657.48 paid; $235.01 estimate pending.' }
  };
  const OPPORTUNITIES = [
    { id: 'creekside', name: 'Creekside Turf Sports Park (Town proposal)', horizon: 'Aug 2027', certainty: 'Uncertain',
      status: 'Closed indefinitely. Town cost materials received Oct 5; end-of-October proposal target.',
      blocker: 'Maintenance scope, access rights, funding and approvals unresolved.',
      next: 'Agree proposal scope and cost-review owner; align LGU "provides / needs" with the Town list.',
      owner: 'Phil (Town / proposal); Esge; Shaun; Shawn', cost: '$2.4–2.5M preliminary project; $27,690/yr turf maintenance benchmark.',
      quality: 'Lit turf (the club\'s only controlled lighted field)',
      assume: { surface: 'Turf', lights: 'Yes', teams: 4, days: DAYS5, window: '16:00–20:00' } },
    { id: 'dartmouth', name: 'Dartmouth Middle School turf', horizon: 'Winter/Spring 2027', certainty: 'Likely',
      status: 'New turf reportedly installed. Rentals unavailable until winter/spring.',
      blocker: 'Earliest rental date and Fall 2027 terms TBD.',
      next: 'Get the earliest rental date and Fall 2027 access terms.',
      owner: 'Phil (rentals); Shawn (capacity); Shaun (fit)', cost: 'Rental cost TBD.',
      quality: 'New turf, no lights',
      assume: { surface: 'Turf', lights: 'No', teams: 3, days: DAYS5, window: '15:30–17:00' } },
    { id: 'saratoga', name: 'Saratoga High stadium', horizon: 'Any time', certainty: 'Blocked',
      status: 'Not secured. Three prior requests declined.',
      blocker: 'Actual weekday lighted slots and final decision-maker unknown.',
      next: 'Escalate through Chris Linden for specific slots or a written no.',
      owner: 'Phil; Esge (escalation)', cost: 'Rates and fees TBD.',
      quality: 'Lit stadium turf',
      assume: { surface: 'Turf', lights: 'Yes', teams: 3, days: ['Mon', 'Wed'], window: '18:00–21:00' } },
    { id: 'canyon', name: 'Canyon Heights Academy turf', horizon: 'Aug 2027', certainty: 'Uncertain',
      status: 'Summer 2027 turf installation reported. Current grass is low quality.',
      blocker: 'Funding, completion, LGU access priority, hours and lighting unverified.',
      next: 'Get project evidence and dependable LGU access terms.',
      owner: 'Phil (access); Esge; Shaun / Shawn (fit)', cost: 'TBD.',
      quality: 'Planned turf, lights unverified',
      assume: { surface: 'Turf', lights: 'No', teams: 3, days: ['Mon', 'Wed', 'Thu'], window: '16:30–17:45' } },
    { id: 'fisher', name: 'Fisher Middle School turf', horizon: 'Aug 2027', certainty: 'Uncertain',
      status: 'Summer 2027 turf possible, not certain.',
      blocker: 'Scope, funding, construction timing and rental route unverified.',
      next: 'Get project milestones and the rental route.',
      owner: 'Esge (project); Phil (access); Shaun / Shawn', cost: 'TBD.',
      quality: 'Possible turf, no lights',
      assume: { surface: 'Turf', lights: 'No', teams: 3, days: DAYS5, window: '16:30–17:45' } },
    { id: 'hockey', name: 'LGHS field hockey turf (portable lights)', horizon: 'Now, if approved', certainty: 'Conditional',
      status: 'Conditional after 6 pm. District reviewing the CEQA agreement for portable lights.',
      blocker: 'Lighting permission and power/siting pending. Hard surface; no cleats.',
      next: 'Get the district lighting decision and a safe setup confirmation.',
      owner: 'Phil; Shaun (training fit)', cost: 'Lights, power, setup and staffing TBD.',
      quality: 'Hard turf, no cleats, temporary lights',
      assume: { surface: 'Turf', lights: 'Yes', teams: 2, days: ['Mon', 'Tue', 'Wed', 'Thu'], window: '18:00–19:15' } },
    { id: 'westmontgrass', name: 'Westmont High School grass', horizon: 'Now, if approved', certainty: 'Conditional',
      status: 'Exploratory. Grass is decent/good per Phil; no lights.',
      blocker: 'Permission, daylight hours, usable area and costs TBD.',
      next: 'Confirm availability and the daylight window.',
      owner: 'Phil (access); Shaun (fit); Shawn (schedule)', cost: 'TBD.',
      quality: 'Grass, no lights',
      assume: { surface: 'Grass', lights: 'No', teams: 4, days: DAYS5, window: '15:30–16:45' } }
  ];

  // ---- helpers ---------------------------------------------------------------------------
  const lt = () => (state.longTerm = state.longTerm || { track: {}, assume: {} });
  const track = id => Object.assign({ status: 'Not started', owner: '', due: '' }, lt().track[id] || {});
  const assumeOf = o => Object.assign({}, o.assume, lt().assume[o.id] || {});
  const copy = () => JSON.parse(JSON.stringify(state));
  const shortOf = st => A.analyze(st).summary.shortAfterPlacement;
  const peakUtil = r => Math.max(0, ...r.daily.filter(d => d.utilization !== null).map(d => d.utilization));
  const isComp = (st, b) => !b.canceled && st.teams.some(t => t.name === b.team);
  const fShort = f => f.replace('Los Gatos High School', 'LGHS').replace('Union Middle School', 'Union MS').replace('Westmont High School', 'Westmont').replace(' Elementary', '');
  function addOpportunity(st, o) {
    const a = assumeOf(o);
    st.fields.push({ name: `[LTP] ${o.name}`, surface: a.surface, lights: a.lights, compEligible: true, permit: 'Confirmed',
      planningCap: capacityOf(a).atOnce, windows: Object.fromEntries((a.days || []).map(d => [d, a.window])) });
  }
  /** Average roster across competitive/GK teams (players per team on the field). */
  const avgRoster = () => { const r = state.teams.map(t => Number(t.roster)).filter(x => x > 0); return r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length) : 14; };
  /** Player capacity an opportunity adds: at once, per day (75-min slots in the window), per week. */
  function capacityOf(a) {
    const per = Number(a.players) > 0 ? Number(a.players) : avgRoster();
    const atOnce = Math.max(1, Number(a.teams) || 1) * per;
    const mins = A.parseWindows(a.window).reduce((x, w) => x + w.end - w.start, 0);
    const slots = Math.max(mins ? 1 : 0, Math.floor(mins / 75));
    const days = (a.days || []).length;
    return { per, atOnce, slots, days, perDay: atOnce * slots, perWeek: atOnce * slots * days, teamSessions: Math.max(1, Number(a.teams) || 1) * slots * days };
  }
  const lose = (st, name) => { const f = st.fields.find(x => x.name === name); if (f) f.statusOverride = 'Lost'; };

  // ---- compute ---------------------------------------------------------------------------
  let cache = { key: null, data: null };
  function compute() {
    const key = JSON.stringify([state.fields, state.teams, state.bookings, state.settings, lt().assume]);
    if (cache.key === key) return cache.data;
    const base = A.analyze(state), baseShort = base.summary.shortAfterPlacement;

    // 1) Risks: every usable field that hosts competitive sessions
    const used = new Map();
    for (const b of state.bookings) if (isComp(state, b)) used.set(b.field, (used.get(b.field) || 0) + 1);
    const risks = base.fields.filter(f => f.usable && used.get(f.name)).map(f => {
      const st = copy(); lose(st, f.name);
      const lost = shortOf(st) - baseShort;
      const auto = f.autoStatus, manual = !!f.statusOverride;
      const shaky = ['Lapsed', 'Lost', 'Pending permit', 'Expiring'];
      let exposure, exposureTone;
      if (manual && shaky.includes(auto)) { exposure = `Set to Active by hand; booking shows ${auto}`; exposureTone = 'high'; }
      else if (shaky.includes(f.status)) { exposure = f.status; exposureTone = 'high'; }
      else if (!f.renewal) { exposure = 'No renewal date on file'; exposureTone = 'med'; }
      else { exposure = `Renews ${f.renewal}`; exposureTone = 'low'; }
      const turfOnly = new Set(state.bookings.filter(b => b.field === f.name && isComp(state, b))
        .map(b => base.teams.find(t => t.name === b.team)).filter(t => t && ['ECNL', 'ECNL RL'].includes(t.program)).map(t => t.name)).size;
      const score = lost * (exposureTone === 'high' ? 1 : exposureTone === 'med' ? .6 : .3);
      const tier = lost >= 20 && exposureTone !== 'low' ? 'Protect now' : lost >= 5 || exposureTone === 'high' ? 'Protect' : 'Monitor';
      return { id: `risk:${f.name}`, name: f.name, sessions: used.get(f.name), lost, exposure, exposureTone, turfOnly, score, tier,
        surface: f.surface, lights: (state.fields.find(x => x.name === f.name) || {}).lights, notes: RISK_NOTES[f.name] || null };
    }).sort((a, b) => b.score - a.score || b.lost - a.lost);
    // Bookings that aren't confirmed in writing tend to fall through together (same school calendar,
    // same contacts). Show their combined loss as one item at the top.
    const shakyList = risks.filter(r => r.exposureTone === 'high');
    if (shakyList.length >= 2) {
      const st = copy(); shakyList.forEach(r => lose(st, r.name));
      const lost = shortOf(st) - baseShort;
      const sessions = shakyList.reduce((a, r) => a + r.sessions, 0);
      const members = shakyList.slice().sort((a, b) => b.lost - a.lost || b.sessions - a.sessions);
      for (const m of members) risks.splice(risks.indexOf(m), 1);
      risks.unshift({ id: 'risk:__unconfirmed', group: true, name: `Unconfirmed bookings (${members.length} fields)`, members,
        sessions, lost, exposure: 'Not confirmed in writing', exposureTone: 'high', turfOnly: 0, score: lost * 2, tier: 'Protect now',
        notes: { next: `Get written confirmation (dates, hours, cost) for: ${shakyList.map(r => fShort(r.name)).join(', ')}.`,
          owner: 'Phil (terms); Shawn (schedule)' } });
    }
    // Single field that matters most if lost (used by Opportunities as "backup for"), members included.
    const singles = risks.flatMap(r => r.group ? r.members : [r]);
    const topRisk = singles.filter(r => r.lost > 0).sort((a, b) => b.lost - a.lost)[0] || null;

    // 2) Opportunities: backup for the top risk + busiest-day relief (+ anything unplaceable today)
    const basePeak = peakUtil(base);
    // Today's weekly player capacity on usable fields, using the same 75-minute slot rule as opportunities.
    const baseWeekCap = base.fields.filter(f => f.usable && f.capacity).reduce((sum, f) => sum + A.DAYS.reduce((s2, dd) => {
      const x = f.byDay[dd]; if (!x.capacity) return s2;
      const mins = x.windows.reduce((m, w) => m + w.end - w.start, 0) || (x.sessions ? 75 : 0);
      return s2 + x.capacity * Math.max(mins ? 1 : 0, Math.floor(mins / 75));
    }, 0), 0);
    let lostShort = null;
    if (topRisk) { const st = copy(); lose(st, topRisk.name); lostShort = shortOf(st); }
    const opps = OPPORTUNITIES.map(o => {
      const a = assumeOf(o);
      const st = copy(); addOpportunity(st, o);
      const r = A.analyze(st);
      const placeNow = baseShort - r.summary.shortAfterPlacement;
      const peakAfter = peakUtil(r);
      let cover = 0;
      if (topRisk) { const s2 = copy(); addOpportunity(s2, o); lose(s2, topRisk.name); cover = lostShort - shortOf(s2); }
      const cap = capacityOf(a), slotsWk = cap.teamSessions;
      // Weekly player capacity in the plan today (usable fields: capacity × number of 75-min blocks booked or open each day)
      const pctAdded = baseWeekCap ? cap.perWeek / baseWeekCap : null;
      const qual = (a.surface === 'Turf' ? 2 : 0) + (a.lights === 'Yes' ? 1 : 0); // 3 = lit turf
      const w = CERTAINTY[o.certainty] ?? .35;
      const qf = qual === 3 ? 1.3 : qual === 2 ? 1 : .35; // lit turf > turf > grass (grass isn't a quality fix)
      const score = (cover + placeNow * 2 + Math.max(0, (basePeak - peakAfter) * 100) * .5) * w * qf;
      return Object.assign({}, o, { a, cap, pctAdded, placeNow, cover, peakAfter, slotsWk, qual, weight: w, score });
    }).sort((x, y) => y.score - x.score);

    // 3) Sunset: competitive fields that are grass and/or unlit
    const month = Number(String(base.summary.asOf).slice(5, 7)) || 11;
    const sunNow = A.toMin(SUNSET[month]), sunDark = A.toMin(SUNSET[12]);
    const sunset = base.fields.filter(f => used.get(f.name)).map(f => {
      const raw = state.fields.find(x => x.name === f.name) || {};
      const grass = f.surface === 'Grass', unlit = raw.lights !== 'Yes';
      if (!grass && !unlit) return null;
      const list = state.bookings.filter(b => b.field === f.name && isComp(state, b));
      const darkNow = unlit ? list.filter(b => A.toMin(b.end) > sunNow).length : 0;
      const darkDec = unlit ? list.filter(b => A.toMin(b.end) > sunDark).length : 0;
      const score = darkNow * 2 + darkDec + (grass ? 6 : 0) + list.length * .2;
      const isRisk = singles.some(r => r.name === f.name && r.tier === 'Protect now');
      const tier = isRisk ? 'Fix hours, keep field' : darkNow >= 10 || (grass && darkNow >= 5) ? 'Sunset first' : darkNow > 0 || grass ? 'Daylight / phase down' : 'Keep for now';
      let rec;
      if (isRisk) rec = `Can't be replaced yet, so keep it. Move its ${darkNow} after-dark sessions to lit fields (or earlier start times) and plan to replace it with lit turf.`;
      else if (darkNow && grass) rec = `Move the ${darkNow} after-dark sessions to lit turf; phase the field down when new turf opens.`;
      else if (darkNow) rec = `Turf but no lights: keep daylight slots only; move ${darkNow} after-dark sessions to a lit field.`;
      else rec = 'Grass: fine in daylight now; phase down as quality turf comes online.';
      return { id: `sunset:${f.name}`, name: f.name, surface: f.surface, lights: raw.lights || 'No', sessions: list.length, darkNow, darkDec, grass, unlit, score, tier, rec, isRisk };
    }).filter(Boolean).sort((a, b) => (a.isRisk - b.isRisk) || b.score - a.score);

    const data = { base, baseShort, basePeak, baseWeekCap, risks, singles, topRisk, opps, sunset, month, sunNow };
    cache = { key, data };
    return data;
  }

  // ---- render ----------------------------------------------------------------------------
  const chip = (text, tone) => h('span', { class: `lt-chip ${tone || ''}`, text });
  const tierTone = t => ({ 'Protect now': 'high', Protect: 'med', Monitor: 'low', 'Sunset first': 'high', 'Daylight / phase down': 'med', 'Fix hours, keep field': 'med', 'Keep for now': 'low' }[t] || 'low');
  const certTone = c => ({ Confirmed: 'ok', Likely: 'ok', Conditional: 'med', Uncertain: 'med', Blocked: 'high' }[c] || 'low');

  function tracker(id, defaults = {}) {
    const t = Object.assign({}, track(id));
    if (!t.owner && defaults.owner) t.owner = defaults.owner;
    const save = patch => { lt().track[id] = Object.assign(track(id), patch); changed(); };
    return h('div', { class: 'lt-track' },
      h('label', {}, 'Status ', h('select', { 'aria-label': 'Status', onchange: e => { save({ status: e.target.value }); renderNow(); } },
        STATUSES.map(s => h('option', { value: s, text: s, selected: s === t.status })))),
      h('label', {}, 'Owner ', h('input', { value: t.owner, placeholder: 'Owner', onchange: e => save({ owner: e.target.value }) })),
      h('label', {}, 'Answer by ', h('input', { type: 'date', value: t.due, onchange: e => save({ due: e.target.value }) })));
  }
  const closedOne = id => ['Done', 'Dropped'].includes(track(id).status);
  const closed = id => id === 'risk:__unconfirmed' ? (cache.data?.risks.find(r => r.id === id)?.members || []).every(m => closedOne(m.id)) : closedOne(id);
  const facts = rows => h('dl', { class: 'lt-facts' }, rows.filter(r => r[1]).flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]));

  /** One row per unconfirmed field: what the booking shows, sessions alone, next step, and its own tracker. */
  function memberTable(g) {
    return h('div', { class: 'lt-members' },
      h('table', { class: 'lt-member-table' },
        h('thead', {}, h('tr', {}, ['Field', 'Booking shows', 'Alone', 'Next step', 'Tracking'].map(x => h('th', { text: x })))),
        h('tbody', {}, g.members.map(m => {
          const n = m.notes || {};
          return h('tr', { class: closed(m.id) ? 'is-closed' : '' },
            h('td', {}, h('b', { text: fShort(m.name) }), h('div', { class: 'muted', text: `${m.sessions} sessions/wk${m.turfOnly ? ` · ${m.turfOnly} ECNL/RL teams` : ''}` })),
            h('td', { text: m.exposure.replace('Set to Active by hand; booking shows ', '') }),
            h('td', { class: 'num', title: 'Sessions that could not be re-homed if only this field were lost', text: m.lost }),
            h('td', {}, n.next || 'Confirm the booking term and renewal date in writing.', n.blocker ? h('div', { class: 'muted', text: n.blocker }) : null, n.cost ? h('div', { class: 'muted', text: `Cost: ${n.cost}` }) : null),
            h('td', {}, tracker(m.id, { owner: n.owner || 'Phil (terms)' })));
        }))),
      h('p', { class: 'hint', text: '"Alone" = sessions at stake if only that field were lost. The group total is larger because the fields back each other up: lose one and the others absorb its teams; lose several and they can\'t.' }));
  }

  function riskCard(r, i) {
    const n = r.notes || {};
    return h('article', { class: `lt-item tone-${tierTone(r.tier)}${closed(r.id) ? ' is-closed' : ''}` },
      h('div', { class: 'lt-rank', text: i + 1 }),
      h('div', { class: 'lt-main' },
        h('div', { class: 'lt-head' }, h('h4', { text: r.name }), chip(r.tier, tierTone(r.tier)), chip(r.exposure, r.exposureTone)),
        r.group
          ? h('p', { class: 'lt-why' }, `These ${r.members.length} fields host ${r.sessions} competitive sessions a week but none is confirmed in writing. If they fall through together, `, h('b', { text: `${r.lost} sessions` }), ` couldn't be re-homed. Confirm them as one package; track each field below.`)
          : h('p', { class: 'lt-why' }, `If this field is lost, `, h('b', { text: `${r.lost} session${r.lost === 1 ? '' : 's'}` }),
          ` couldn't be re-homed (it hosts ${r.sessions} competitive sessions a week${r.turfOnly ? `, ${r.turfOnly} turf-only ECNL/RL teams` : ''}).`),
        r.group ? null : facts([['Next step', n.next || 'Confirm the booking term and renewal date in writing.'], ['Blocker', n.blocker], ['Cost', n.cost]]),
        r.group ? memberTable(r) : null,
        r.group ? null : tracker(r.id, { owner: n.owner || 'Phil (terms)' })),
      h('div', { class: 'lt-metric' }, h('div', { class: 'v', text: r.lost }), h('div', { class: 'l', text: 'sessions at stake' })));
  }

  function oppCard(o, i, d) {
    const a = o.a, save = patch => { lt().assume[o.id] = Object.assign(assumeOf(o), patch); changed(); };
    const dayBtns = DAYS5.map(dd => h('button', { type: 'button', class: `lt-day${a.days.includes(dd) ? ' on' : ''}`, text: dd[0] + (dd === 'Thu' ? 'h' : ''), title: dd,
      'aria-pressed': String(a.days.includes(dd)), onclick: () => save({ days: DAYS5.filter(x => x === dd ? !a.days.includes(dd) : a.days.includes(x)) }) }));
    const peakDrop = Math.round((d.basePeak - o.peakAfter) * 100);
    return h('article', { class: `lt-item tone-${o.qual === 3 ? 'ok' : o.qual === 2 ? 'med' : 'low'}${closed(o.id) ? ' is-closed' : ''}` },
      h('div', { class: 'lt-rank', text: i + 1 }),
      h('div', { class: 'lt-main' },
        h('div', { class: 'lt-head' }, h('h4', { text: o.name }), chip(o.quality, o.qual === 3 ? 'ok' : o.qual === 2 ? 'med' : 'low'), chip(`Certainty: ${o.certainty}`, certTone(o.certainty)), chip(o.horizon, 'low')),
        h('p', { class: 'lt-why' },
          d.topRisk ? [`Backs up `, h('b', { text: `${o.cover} of ${d.topRisk.lost}` }), ` sessions if ${fShort(d.topRisk.name)} is lost. `] : null,
          `Busiest day ${Math.round(d.basePeak * 100)}% → `, h('b', { text: `${Math.round(o.peakAfter * 100)}%` }), peakDrop > 0 ? ` (−${peakDrop} pts)` : '',
          o.placeNow > 0 ? [`. Places `, h('b', { text: `${o.placeNow}` }), ` sessions that don't fit today.`] : '.'),
        h('div', { class: 'lt-cap', title: `${o.cap.atOnce} players at once × ${o.cap.slots} slot${o.cap.slots === 1 ? '' : 's'} of 75 min × ${o.cap.days} day${o.cap.days === 1 ? '' : 's'}` },
          h('div', {}, h('b', { text: `+${o.cap.atOnce}` }), h('span', { text: 'players at once' })),
          h('div', {}, h('b', { text: `+${o.cap.perDay}` }), h('span', { text: 'player spots / day' })),
          h('div', {}, h('b', { text: `+${o.cap.perWeek}` }), h('span', { text: 'player spots / week' })),
          h('div', {}, h('b', { text: o.pctAdded === null ? '—' : `+${Math.round(o.pctAdded * 100)}%` }), h('span', { text: "of today's weekly capacity" }))),
        facts([['Status', o.status], ['Next step', o.next], ['Blocker', o.blocker], ['Cost', o.cost]]),
        h('details', { class: 'lt-assume' }, h('summary', { text: `Assumptions: ${a.teams} teams × ${o.cap.per} players at once · ${a.days.join('/')} · ${a.window} · ${a.surface}${a.lights === 'Yes' ? ', lit' : ', no lights'} (≈${o.slotsWk} team-sessions/wk)` }),
          h('div', { class: 'lt-assume-row' },
            h('label', {}, 'Teams at once ', h('input', { type: 'number', min: 1, max: 8, value: a.teams, onchange: e => save({ teams: Number(e.target.value) || 1 }) })),
            h('label', { title: `Blank = club average roster (${avgRoster()})` }, 'Players / team ', h('input', { type: 'number', min: 1, max: 30, value: a.players ?? '', placeholder: avgRoster(), onchange: e => save({ players: e.target.value === '' ? null : Number(e.target.value) }) })),
            h('span', { class: 'lt-days' }, 'Days ', dayBtns),
            h('label', {}, 'Window ', h('input', { value: a.window, size: 11, title: 'HH:MM–HH:MM', onchange: e => save({ window: e.target.value }) })),
            h('label', {}, 'Surface ', h('select', { onchange: e => save({ surface: e.target.value }) }, ['Turf', 'Grass'].map(s => h('option', { value: s, text: s, selected: s === a.surface })))),
            h('label', {}, 'Lights ', h('select', { onchange: e => save({ lights: e.target.value }) }, ['Yes', 'No'].map(s => h('option', { value: s, text: s, selected: s === a.lights })))),
            h('button', { type: 'button', class: 'btn mini', text: 'Reset', onclick: () => { delete lt().assume[o.id]; changed(); } }))),
        tracker(o.id, { owner: o.owner })),
      h('div', { class: 'lt-metric' }, h('div', { class: 'v', text: d.topRisk ? o.cover : (peakDrop > 0 ? `−${peakDrop}` : '0') }), h('div', { class: 'l', text: d.topRisk ? 'sessions backed up' : 'pts busiest day' })));
  }

  function sunsetCard(s, i, d) {
    const repl = d.opps.find(o => o.qual === 3 && !closed(o.id));
    return h('article', { class: `lt-item tone-${tierTone(s.tier)}${closed(s.id) ? ' is-closed' : ''}` },
      h('div', { class: 'lt-rank', text: i + 1 }),
      h('div', { class: 'lt-main' },
        h('div', { class: 'lt-head' }, h('h4', { text: s.name }), chip(s.tier, tierTone(s.tier)),
          s.grass ? chip('Grass', 'med') : chip('Turf', 'low'), s.unlit ? chip('No lights', 'med') : chip('Lit', 'ok'), s.isRisk ? chip('Also a top risk', 'high') : null),
        h('p', { class: 'lt-why' }, h('b', { text: `${s.darkNow}` }), ` of ${s.sessions} weekly sessions end after sunset now (${MONTH[d.month]}, ~${clock(SUNSET[d.month])})`,
          s.darkDec !== s.darkNow ? [`; `, h('b', { text: `${s.darkDec}` }), ` in December (~${clock(SUNSET[12])})`] : '',
          s.unlit ? '. Dark-early season runs Nov–Feb.' : '.'),
        facts([['Recommendation', s.rec], ['Replace with', repl ? `${repl.name} (${repl.horizon})` : 'No lit-turf option open yet']]),
        tracker(s.id, { owner: 'Shawn (schedule); Shaun (fit)' })),
      h('div', { class: 'lt-metric' }, h('div', { class: 'v', text: s.darkNow }), h('div', { class: 'l', text: 'after dark now' })));
  }

  function section(key, title, intro, items, card, d, keepTop) {
    const open = items.filter(x => !closed(x.id)), done = items.filter(x => closed(x.id));
    const main = open.slice(0, keepTop), rest = open.slice(keepTop);
    return h('section', { class: 'card lt-section', id: `lt-${key}` },
      h('div', { class: 'lt-section-head' }, h('h2', { text: title }), h('span', { class: 'muted', text: `${open.length} open${done.length ? ` · ${done.length} closed` : ''}` })),
      h('p', { class: 'hint', text: intro }),
      h('div', { class: 'lt-list' }, main.map((x, i) => card(x, i, d))),
      rest.length ? h('details', { class: 'lt-more' }, h('summary', { text: `${rest.length} lower-priority item${rest.length > 1 ? 's' : ''} (parked — revisit monthly)` }),
        h('div', { class: 'lt-list' }, rest.map((x, i) => card(x, i + keepTop, d)))) : null,
      done.length ? h('details', { class: 'lt-more' }, h('summary', { text: `${done.length} done or dropped` }), h('div', { class: 'lt-list' }, done.map((x, i) => card(x, i, d)))) : null);
  }

  function renderNow() {
    const root = $('longterm-body'); if (!root) return;
    const d = compute();
    const r1 = d.risks.find(x => !closed(x.id)), o1 = d.opps.find(x => !closed(x.id)), s1 = d.sunset.find(x => !closed(x.id) && !x.isRisk) || d.sunset.find(x => !closed(x.id));
    const focus = (label, tone, title, big, unit, target) => h('button', { type: 'button', class: `lt-focus tone-${tone}`, onclick: () => $(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
      h('div', { class: 'l', text: label }), h('div', { class: 't', text: title }), h('div', { class: 'v' }, h('b', { text: big }), ` ${unit}`));
    const parked = d.risks.filter(x => x.tier === 'Monitor').length + Math.max(0, d.opps.length - 3) + d.sunset.filter(x => x.tier === 'Keep for now').length;
    root.replaceChildren(
      h('div', { class: 'card lt-focus-card' },
        h('div', { class: 'lt-section-head' }, h('h2', { text: 'Focus this month' }),
          h('span', { class: 'muted', text: `Current plan: ${d.base.summary.sessionsSecure}/${d.base.summary.sessionsNeeded} sessions secured · ${d.baseShort} can't be placed · busiest day ${Math.round(d.basePeak * 100)}%` })),
        h('div', { class: 'lt-focus-row' },
          r1 ? focus('1 · Protect', tierTone(r1.tier), r1.name, r1.lost, 'sessions at stake', 'lt-risks') : null,
          o1 ? focus('2 · Pursue', o1.qual === 3 ? 'ok' : 'med', o1.name, `+${o1.cap.perWeek}`, `player spots/wk${d.topRisk ? ` · backs up ${o1.cover} sessions` : ''}`, 'lt-opps') : null,
          s1 ? focus('3 · Sunset', tierTone(s1.tier), s1.name, s1.darkNow, 'sessions after dark', 'lt-sunset') : null),
        h('p', { class: 'hint', text: `Everything else (${parked} items) is parked below each list — not critical this month. Numbers are what-if runs of the current plan; they update when you edit fields, teams or the schedule.` }),
        h('div', { class: 'lt-actions' }, h('button', { class: 'btn', text: 'Download plan (CSV)', onclick: () => exportCSV(d) }))),
      section('risks', '1. Risks to protect',
        'Fields the plan depends on, ranked by sessions that could not be re-homed if the field were lost, weighted by how shaky the booking is. Protect these before adding anything new.',
        d.risks, riskCard, d, 3),
      section('opps', '2. Quality-field opportunities',
        `New or expanded fields, ranked by how much they relieve capacity (backup for ${d.topRisk ? fShort(d.topRisk.name) : 'the top risk'} and busiest-day load) × how certain they are. Lit turf scores highest. Player capacity added = teams × players per team, per 75-minute slot. Today's usable fields offer about ${d.baseWeekCap.toLocaleString()} player spots a week. Open "Assumptions" to change hours.`,
        d.opps, oppCard, d, 3),
      section('sunset', '3. Fields to sunset (grass or no lights)',
        'Fields that limit quality or hours: grass, or no lights. Move after-dark sessions first, then phase the field down as quality turf comes online. Fields that are also a top risk are listed last: fix their hours but keep them until they can be replaced.',
        d.sunset, sunsetCard, d, 3));
  }

  function exportCSV(d) {
    const rows = [['Section', 'Rank', 'Item', 'Priority', 'Impact', 'Detail', 'Next step', 'Owner', 'Status', 'Answer by']];
    d.risks.forEach((r, i) => {
      if (r.group) {
        rows.push(['Risk to protect', i + 1, r.name, r.tier, `${r.lost} sessions at stake together`, 'Not confirmed in writing', 'Confirm as one package', '', '', '']);
        r.members.forEach((m, k) => { const t = track(m.id); rows.push(['Risk to protect', `${i + 1}.${k + 1}`, m.name, '', `${m.lost} alone`, m.exposure, (m.notes || {}).next || 'Confirm booking term', t.owner || (m.notes || {}).owner || '', t.status, t.due]); });
      } else { const t = track(r.id); rows.push(['Risk to protect', i + 1, r.name, r.tier, `${r.lost} sessions at stake`, r.exposure, (r.notes || {}).next || 'Confirm booking term', t.owner || (r.notes || {}).owner || '', t.status, t.due]); }
    });
    d.opps.forEach((o, i) => { const t = track(o.id); rows.push(['Opportunity', i + 1, o.name, `Certainty: ${o.certainty}`, `${d.topRisk ? `${o.cover} sessions backed up; ` : ''}+${o.cap.atOnce} players at once, +${o.cap.perWeek} player spots/wk (+${Math.round((o.pctAdded || 0) * 100)}%)`, `${o.quality}; busiest day ${Math.round(o.peakAfter * 100)}%`, o.next, t.owner || o.owner, t.status, t.due]); });
    d.sunset.forEach((s, i) => { const t = track(s.id); rows.push(['Sunset', i + 1, s.name, s.tier, `${s.darkNow} after dark now`, `${s.surface}; lights ${s.lights}`, s.rec, t.owner, t.status, t.due]); });
    download(`lgu-long-term-plan-${result.summary.asOf}.csv`, rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  }

  renderHooks.push(rebuild => { if (currentTab === 'longterm') { const k = cache.key; compute(); if (rebuild || cache.key !== k || !$('longterm-body').childElementCount) renderNow(); } });
  window.LGULongTerm = { compute, renderNow, OPPORTUNITIES };
})();
