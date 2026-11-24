/* LGU Field Planner – analysis module.
 * Pure functions only: no DOM access, so the same code runs in the browser and in Node tests.
 * Input: state {settings, fields, teams, bookings}. Output: plain objects for rendering/export.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LGUAnalysis = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DEFAULT_SETTINGS = {
    asOf: '',                 // YYYY-MM-DD; blank = today
    expiringDays: 30,         // renewal within N days => "Expiring"
    weekDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    targets: { 'ECNL': 3, 'ECNL RL': 3, 'Pre-ECNL': 3, 'Comp': 3, 'Pre 7v7': 2, 'GK': 2 },
    // Field surfaces each program may train on.
    surfaces: { 'ECNL': ['Turf'], 'ECNL RL': ['Turf'], 'Pre-ECNL': ['Grass', 'Turf'], 'Comp': ['Grass', 'Turf'], 'Pre 7v7': ['Grass', 'Turf'], 'GK': ['Grass', 'Turf'] }
  };
  const SURFACES = ['Grass', 'Turf', 'Hardwood'];

  // Fields that count as usable supply, and how risky each status is.
  const STATUS = {
    'Active':         { usable: true,  risk: 0, label: 'Active' },
    'Expiring':       { usable: true,  risk: 1, label: 'Expiring' },
    'Pending permit': { usable: true,  risk: 1, label: 'Pending permit' },
    'Lapsed':         { usable: false, risk: 2, label: 'Lapsed' },
    'Lost':           { usable: false, risk: 2, label: 'Lost' },
    'Rec only':       { usable: false, risk: 0, label: 'Rec only' },
    'Not in use':     { usable: false, risk: 0, label: 'Not in use' }
  };

  const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
  const toHHMM = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  function settingsOf(state) {
    const s = Object.assign({}, DEFAULT_SETTINGS, state.settings || {});
    s.targets = Object.assign({}, DEFAULT_SETTINGS.targets, (state.settings || {}).targets || {});
    delete s.targets.Academy;
    s.surfaces = Object.assign({}, DEFAULT_SETTINGS.surfaces, (state.settings || {}).surfaces || {});
    delete s.surfaces.Academy;
    return s;
  }

  function asOfDate(settings) {
    if (settings.asOf) return settings.asOf;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

  /** "A; B / C & D" -> ['A','B','C','D'] (case-insensitive, trimmed). */
  const coachList = s => String(s || '').split(/\s*(?:[;,/&\n]|\s+and\s+)\s*/i).map(x => x.trim()).filter(Boolean);
  const coachKey = s => s.toLowerCase().replace(/\s+/g, ' ');

  /** Legacy/alias program names map onto current ones (Academy is treated as Comp). */
  const normalizeProgram = p => (p === 'Academy' ? 'Comp' : p);

  function inferProgram(name) {
    if (/^\s*(all\s+)?gk\b/i.test(name)) return 'GK';
    if (/pre\s*7v7/i.test(name)) return 'Pre 7v7';
    if (/pre-ecnl/i.test(name)) return 'Pre-ECNL';
    if (/ecnl\s*rl/i.test(name)) return 'ECNL RL';
    if (/ecnl/i.test(name)) return 'ECNL';
    // Academy teams are grouped with Comp.
    return 'Comp';
  }

  /** Parse an inventory window cell like "15:00–17:15\n17:30–18:00" into [{start,end}] minutes. */
  function parseWindows(text) {
    return String(text || '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).map(s => {
      const m = s.match(/(\d{1,2}:\d{2})\s*[–\-to]+\s*(\d{1,2}:\d{2})/);
      return m ? { start: toMin(m[1]), end: toMin(m[2]) } : null;
    }).filter(w => w && w.end > w.start);
  }

  /** Peak concurrent load of intervals [{start,end,weight}], optionally clipped to [from,to). */
  function peakLoad(items, from = -Infinity, to = Infinity) {
    const ev = [];
    for (const it of items) {
      const s = Math.max(it.start, from), e = Math.min(it.end, to);
      if (e > s) { ev.push([s, it.weight, 1]); ev.push([e, -it.weight, -1]); }
    }
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]); // ends before starts at same minute
    let cur = 0, teams = 0, peak = 0, peakTeams = 0, at = null;
    for (const [t, w, n] of ev) {
      cur += w; teams += n;
      if (cur > peak) { peak = cur; peakTeams = teams; at = t; }
    }
    return { players: peak, teams: peakTeams, at: at === null ? null : toHHMM(at) };
  }

  function fieldStatus(field, settings, hasCompUse) {
    const asOf = asOfDate(settings);
    if (field.permit === 'Lost') return 'Lost';
    const usedForComp = field.compEligible || hasCompUse;
    if (usedForComp && field.renewal) {
      const d = daysBetween(asOf, field.renewal);
      if (d < 0) return 'Lapsed';
      if (d <= settings.expiringDays) return 'Expiring';
    }
    if (usedForComp && field.permit === 'Pending') return 'Pending permit';
    if (usedForComp) return 'Active';
    const anyWindow = DAYS.some(d => parseWindows((field.windows || {})[d]).length);
    return anyWindow ? 'Rec only' : 'Not in use';
  }

  function analyze(state) {
    const settings = settingsOf(state);
    const asOf = asOfDate(settings);
    const week = settings.weekDays;
    const teamByName = new Map(state.teams.map(t => [t.name, t]));
    const fieldByName = new Map(state.fields.map(f => [f.name, f]));

    // ---- Classify bookings -------------------------------------------------
    const comp = [], unmatched = [], unknownField = [];
    for (const b of state.bookings) {
      if (!fieldByName.has(b.field)) unknownField.push(b);
      const team = teamByName.get(b.team);
      if (team) comp.push(Object.assign({}, b, { roster: Number(team.roster) || 0, s: toMin(b.start), e: toMin(b.end) }));
      else if (/^\d{4}\/\d{2}[BG]|^U\d+\/U\d+[BG]/.test(b.team)) unmatched.push(b); // looks competitive, no roster row
    }
    const active = comp.filter(b => !b.canceled);
    const compFieldNames = new Set(active.map(b => b.field));

    // ---- Field status + per-day load ---------------------------------------
    const fields = state.fields.map(f => {
      const autoStatus = fieldStatus(f, settings, compFieldNames.has(f.name));
      const overridden = !!(f.statusOverride && STATUS[f.statusOverride]);
      const status = overridden ? f.statusOverride : autoStatus;
      const meta = STATUS[status];
      const byDay = {};
      let observedPeak = 0, observedPeakTeams = 0;
      for (const d of DAYS) {
        const items = active.filter(b => b.field === f.name && b.day === d).map(b => ({ start: b.s, end: b.e, weight: b.roster }));
        const p = peakLoad(items);
        const windows = parseWindows((f.windows || {})[d]);
        byDay[d] = { peakPlayers: p.players, peakTeams: p.teams, peakAt: p.at, sessions: items.length, windows };
        if (p.players > observedPeak) { observedPeak = p.players; observedPeakTeams = p.teams; }
      }
      // Capacity is a fixed quantity: planning cap if set, else the saved baseline. Only fields with
      // neither fall back to the live observed peak (and are flagged so the user can fix it).
      const cap = Number(f.planningCap) > 0 ? Number(f.planningCap)
        : Number(f.baselineCap) > 0 ? Number(f.baselineCap) : (observedPeak || null);
      for (const d of DAYS) {
        const x = byDay[d];
        x.capacity = cap && (x.windows.length || x.sessions) ? cap : null;
        x.utilization = x.capacity ? x.peakPlayers / x.capacity : null;
        x.headroom = x.capacity ? Math.max(0, x.capacity - x.peakPlayers) : null;
      }
      const renewalIn = f.renewal ? daysBetween(asOf, f.renewal) : null;
      // Weekly utilization: average of daily peak ÷ capacity over planning days the field is available.
      const openDays = settings.weekDays.filter(d => byDay[d].capacity);
      const weekUtil = openDays.length ? openDays.reduce((s, d) => s + byDay[d].utilization, 0) / openDays.length : null;
      const peakDay = openDays.reduce((best, d) => (!best || byDay[d].utilization > byDay[best].utilization ? d : best), null);
      return Object.assign({}, f, {
        status, autoStatus, statusSource: overridden ? 'Manual' : 'Auto', usable: meta.usable, risk: meta.risk, renewalIn,
        observedPeak: observedPeak || null, observedPeakTeams, capacity: cap,
        weekUtil, openDays: openDays.length, peakDay, peakDayUtil: peakDay ? byDay[peakDay].utilization : null,
        capacitySource: Number(f.planningCap) > 0 ? 'Planning cap' : Number(f.baselineCap) > 0 ? 'Baseline (Oct 19–23)' : (observedPeak ? 'Live peak (not fixed)' : 'None'),
        byDay
      });
    });
    const fieldInfo = new Map(fields.map(f => [f.name, f]));
    /** Field surface allowed for program? Unknown surface = allowed (can't prove otherwise). */
    const surfaceOK = (program, field) => !field || !field.surface || (settings.surfaces[program] || SURFACES).includes(field.surface);

    // ---- Team coverage -----------------------------------------------------
    const teams = state.teams.map(t => {
      const program = normalizeProgram(t.program) || inferProgram(t.name);
      const target = Number.isFinite(Number(t.target)) && t.target !== '' && t.target !== null
        ? Number(t.target) : (settings.targets[program] ?? 0);
      const mine = comp.filter(b => b.team === t.name);
      const surfaceIssues = mine.filter(b => !b.canceled && !surfaceOK(program, fieldInfo.get(b.field)))
        .map(b => ({ day: b.day, field: b.field, surface: fieldInfo.get(b.field).surface }));
      const days = {};
      for (const b of mine) {
        const fi = fieldInfo.get(b.field);
        const kind = b.canceled ? 'canceled' : (fi && !fi.usable ? 'atRisk' : 'secure');
        // keep the best outcome per day (secure > atRisk > canceled)
        const rank = { secure: 3, atRisk: 2, canceled: 1 };
        if (!days[b.day] || rank[kind] > rank[days[b.day].kind]) days[b.day] = { kind, field: b.field, start: b.start, end: b.end };
      }
      const count = k => Object.values(days).filter(x => x.kind === k).length;
      const secure = count('secure'), atRisk = count('atRisk'), canceled = count('canceled');
      const scheduled = secure + atRisk;
      return {
        name: t.name, age: t.age, gender: t.gender, roster: Number(t.roster) || 0, program, target, coaches: coachList(t.coach),
        scheduled, secure, atRisk, canceled, days, surfaceIssues, allowedSurfaces: settings.surfaces[program] || SURFACES,
        gap: Math.max(0, target - secure),
        scheduleGap: Math.max(0, target - scheduled)
      };
    });

    // ---- Daily supply vs demand --------------------------------------------
    const daily = week.map(d => {
      const usable = fields.filter(f => f.usable && f.byDay[d].capacity);
      const capacity = usable.reduce((a, f) => a + f.byDay[d].capacity, 0);
      const peakSecure = usable.reduce((a, f) => a + f.byDay[d].peakPlayers, 0);
      const atRiskPlayers = fields.filter(f => !f.usable).reduce((a, f) => a + f.byDay[d].peakPlayers, 0);
      const teamsPracticing = teams.filter(t => t.days[d] && t.days[d].kind !== 'canceled').length;
      const canceledPlayers = comp.filter(b => b.canceled && b.day === d).reduce((a, b) => a + b.roster, 0);
      return { day: d, capacity, peakSecure, headroom: Math.max(0, capacity - peakSecure), atRiskPlayers,
        canceledPlayers, teamsPracticing, utilization: capacity ? peakSecure / capacity : null };
    });

    // ---- Optimizer: place unmet sessions into headroom ----------------------
    // Rules: usable fields only; allowed surface for the program; capacity not exceeded;
    // at most one session per team per day. Most-constrained teams (fewest allowed surfaces)
    // go first so scarce turf goes to turf-only programs. Ties: bigger gap, bigger roster.
    const slots = [];
    for (const f of fields) {
      if (!f.usable || !f.capacity) continue;
      for (const d of week) {
        const items = active.filter(b => b.field === f.name && b.day === d).map(b => ({ start: b.s, end: b.e, weight: b.roster }));
        const blocks = new Map();
        for (const b of active.filter(b => b.field === f.name && b.day === d)) blocks.set(b.start + '-' + b.end, { start: b.s, end: b.e });
        // No sessions booked that day: cut the availability window into normal-length slots
        // (settings.sessionMin, default 75) instead of offering the whole window as one session.
        if (!blocks.size) {
          const len = Number(settings.sessionMin) || 75;
          for (const w of f.byDay[d].windows)
            for (let s0 = w.start; s0 + Math.min(len, w.end - w.start) <= w.end; s0 += len) {
              const e0 = Math.min(s0 + len, w.end);
              blocks.set(s0 + '-' + e0, { start: s0, end: e0 });
              if (e0 === w.end) break;
            }
        }
        for (const blk of blocks.values()) {
          const load = peakLoad(items, blk.start, blk.end).players;
          slots.push({ field: f.name, surface: f.surface, day: d, start: blk.start, end: blk.end, free: f.capacity - load, risk: f.risk });
        }
      }
    }
    const suggestions = [], unplaced = [];
    const dayIdx = d => DAYS.indexOf(d);
    // Coach calendar: every non-canceled comp booking, by coach -> [{day, field, s, e, team}].
    // Placements are added as they're made so later teams see them.
    const teamCoaches = new Map(teams.map(t => [t.name, t.coaches.map(coachKey)]));
    const coachCal = new Map();
    const addCoach = (team, day, field, s, e) => { for (const c of teamCoaches.get(team) || []) { if (!coachCal.has(c)) coachCal.set(c, []); coachCal.get(c).push({ day, field, s, e, team }); } };
    for (const b of active) addCoach(b.team, b.day, b.field, b.s, b.e);
    const TRAVEL = Number(settings.coachTravelMin ?? 15); // minutes needed between sessions at different fields
    /** Would this team's coach(es) have to be at two different fields at once (or without travel time)?
     *  Coaching two teams on the SAME field at the same time is allowed. */
    const coachClash = (team, slot) => {
      for (const c of teamCoaches.get(team) || []) for (const x of coachCal.get(c) || []) {
        if (x.day !== slot.day || x.team === team || x.field === slot.field) continue;
        if (slot.start < x.e + TRAVEL && x.s < slot.end + TRAVEL) return x;
      }
      return null;
    };
    /** Fields the team's coach is already using that day (for the same-field preference). */
    const coachFieldsOn = (team, day) => new Set((teamCoaches.get(team) || []).flatMap(c => (coachCal.get(c) || []).filter(x => x.day === day).map(x => x.field)));
    /** Fields already used on a day by teams in the same program + age group (keeps a group together). */
    const groupKey = t => `${t.program}|${t.age}`;
    const groupFieldsOn = new Map();
    const addGroup = (t, day, field) => { const k = `${groupKey(t)}|${day}`; if (!groupFieldsOn.has(k)) groupFieldsOn.set(k, new Set()); groupFieldsOn.get(k).add(field); };
    for (const b of active) { const t = teams.find(x => x.name === b.team); if (t) addGroup(t, b.day, b.field); }
    const fieldsUsedOn = new Map(); // day -> Set(field) with any comp session
    for (const b of active) { if (!fieldsUsedOn.has(b.day)) fieldsUsedOn.set(b.day, new Set()); fieldsUsedOn.get(b.day).add(b.field); }
    let coachBlocked = 0;
    const needy = teams.filter(t => t.gap > 0)
      .sort((a, b) => a.allowedSurfaces.length - b.allowedSurfaces.length || b.gap - a.gap || b.roster - a.roster || a.name.localeCompare(b.name));
    for (const t of needy) {
      // Days with a secure session are taken. A day with only an at-risk session (lapsed/lost field)
      // can be re-homed: the suggestion replaces that booking.
      const taken = new Set(Object.entries(t.days).filter(([, v]) => v.kind === 'secure').map(([d]) => d));
      const okSurface = s => !s.surface || t.allowedSurfaces.includes(s.surface);
      for (let i = 0; i < t.gap; i++) {
        // Prefer: low-risk field, a day not next to an existing session, then the most headroom.
        const spread = s => [...taken].some(d => Math.abs(dayIdx(d) - dayIdx(s.day)) === 1) ? 1 : 0;
        // Same-field score: 0 = coach already on this field that day, 1 = team's age group already there,
        // 2 = field already in use by LGU that day, 3 = opens a new field that day.
        const sameField = s => coachFieldsOn(t.name, s.day).has(s.field) ? 0
          : (groupFieldsOn.get(`${groupKey(t)}|${s.day}`) || new Set()).has(s.field) ? 1
          : (fieldsUsedOn.get(s.day) || new Set()).has(s.field) ? 2 : 3;
        const open = slots.filter(s => !taken.has(s.day) && s.free >= t.roster && okSurface(s));
        const cands = open.filter(s => !coachClash(t.name, s))
          .sort((a, b) => a.risk - b.risk || sameField(a) - sameField(b) || spread(a) - spread(b) || b.free - a.free || dayIdx(a.day) - dayIdx(b.day));
        if (open.length && !cands.length) coachBlocked++;
        const pick = cands[0];
        if (!pick) {
          const anySurface = slots.some(okSurface);
          const clash = open.length ? coachClash(t.name, open[0]) : null;
          unplaced.push({ team: t.name, program: t.program, roster: t.roster, sessionsShort: t.gap - i,
            reason: open.length && clash ? `Coach already with ${clash.team} at ${clash.field} in every open slot`
              : anySurface ? `No ${t.allowedSurfaces.join('/')} slot with ${t.roster} open spots on a free day` : `No usable ${t.allowedSurfaces.join('/')} field` });
          break;
        }
        pick.free -= t.roster; taken.add(pick.day);
        // reduce overlapping blocks on same field/day too
        for (const s of slots) if (s !== pick && s.field === pick.field && s.day === pick.day && s.start < pick.end && pick.start < s.end) s.free -= t.roster;
        const replaces = t.days[pick.day] && t.days[pick.day].kind === 'atRisk' ? t.days[pick.day] : null;
        addCoach(t.name, pick.day, pick.field, pick.start, pick.end);
        addGroup(t, pick.day, pick.field);
        if (!fieldsUsedOn.has(pick.day)) fieldsUsedOn.set(pick.day, new Set()); fieldsUsedOn.get(pick.day).add(pick.field);
        suggestions.push({ team: t.name, program: t.program, roster: t.roster, field: pick.field, surface: pick.surface, day: pick.day, replaces,
          start: toHHMM(pick.start), end: toHHMM(pick.end), freeAfter: pick.free, sameField: sameField(pick) <= 1 });
      }
    }

    // Coach double-bookings already in the schedule (different fields, overlapping or too close).
    const coachConflicts = [];
    {
      const TRAVEL = Number(settings.coachTravelMin ?? 15);
      const byCoach = new Map();
      for (const b of active) for (const c of coachList((state.teams.find(t => t.name === b.team) || {}).coach)) {
        const k = coachKey(c); if (!byCoach.has(k)) byCoach.set(k, { name: c, list: [] }); byCoach.get(k).list.push(b);
      }
      for (const { name, list } of byCoach.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const x = list[i], y = list[j];
        if (x.day !== y.day || x.team === y.team || x.field === y.field) continue; // same field = allowed
        if (x.s < y.e + TRAVEL && y.s < x.e + TRAVEL) coachConflicts.push({ coach: name, day: x.day, a: x, b: y });
      }
    }
    // ---- Summary -------------------------------------------------------------
    const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0);
    const shortSessions = sum(unplaced, 'sessionsShort');
    const summary = {
      asOf,
      fieldsTotal: fields.length,
      fieldsUsable: fields.filter(f => f.usable).length,
      fieldsAtRisk: fields.filter(f => f.risk >= 1).length,
      teams: teams.length,
      sessionsNeeded: sum(teams, 'target'),
      sessionsSecure: sum(teams, 'secure'),
      sessionsAtRisk: sum(teams, 'atRisk'),
      sessionsCanceled: sum(teams, 'canceled'),
      teamsShort: teams.filter(t => t.gap > 0).length,
      teamsUnscheduled: teams.filter(t => t.scheduled === 0).length,
      sessionGap: sum(teams, 'gap'),
      placeable: suggestions.length,
      coachConflicts: coachConflicts.length, coachBlocked, teamsWithCoach: teams.filter(t => t.coaches.length).length,
      sameFieldPlacements: suggestions.filter(s => s.sameField).length,
      surfaceIssues: sum(teams.map(t => ({ n: t.surfaceIssues.length })), 'n'),
      shortAfterPlacement: shortSessions,
      playerSessionsShort: unplaced.reduce((a, u) => a + u.roster * u.sessionsShort, 0)
    };

    // Each issue carries structured fields so the UI can group and tabulate it.
    // sev: 'high' (wrong plan), 'med' (data gap that skews numbers), 'low' (housekeeping)
    const issues = [
      ...coachConflicts.map(c => ({ type: 'Coach double-booked', sev: 'high', detail: `${c.coach} — ${c.day}: ${c.a.team} at ${c.a.field} ${c.a.start}–${c.a.end} and ${c.b.team} at ${c.b.field} ${c.b.start}–${c.b.end}`,
        coach: c.coach, day: c.day, a: { team: c.a.team, field: c.a.field, start: c.a.start, end: c.a.end }, b: { team: c.b.team, field: c.b.field, start: c.b.start, end: c.b.end } })),
      ...teams.flatMap(t => t.surfaceIssues.map(x => ({ type: 'Surface not allowed', sev: 'med', detail: `${t.name} (${t.program}) on ${x.surface} — ${x.day} ${x.field}`,
        team: t.name, program: t.program, surface: x.surface, day: x.day, field: x.field }))),
      ...state.teams.filter(t => !(Number(t.roster) > 0)).map(t => ({ type: 'Roster size missing', sev: 'med', detail: `${t.name}: enter a roster size on Teams & targets so its sessions count toward field capacity`, team: t.name })),
      ...fields.filter(f => f.capacitySource === 'Live peak (not fixed)').map(f => ({ type: 'Capacity not fixed', sev: 'med', detail: `${f.name}: capacity is following the live schedule. Enter a Planning cap to fix it.`, field: f.name })),
      ...fields.filter(f => f.usable && !f.capacity).map(f => ({ type: 'No capacity', sev: 'med', detail: `${f.name} is usable but has no planning or observed capacity`, field: f.name })),
      ...unmatched.map(b => ({ type: 'No roster match', sev: 'low', detail: `${b.team} — ${b.day} ${b.field} ${b.start}`, team: b.team, day: b.day, field: b.field, start: b.start })),
      ...unknownField.map(b => ({ type: 'Unknown field', sev: 'low', detail: `${b.field} (${b.team}, ${b.day})`, team: b.team, day: b.day, field: b.field }))
    ];

    return { settings, summary, fields, teams, daily, suggestions, unplaced, issues };
  }

  /** Compare two saved states. Bookings match by id; fields and teams match by name. */
  function diffStates(before, after) {
    const key = x => x.id || `${x.day}|${x.field}|${x.start}|${x.team}`;
    const same = (x, y) => String(x ?? '') === String(y ?? '');
    function compare(listA, listB, keyFn, props) {
      const A = new Map((listA || []).map(x => [keyFn(x), x])), B = new Map((listB || []).map(x => [keyFn(x), x]));
      const added = [], removed = [], changed = [];
      for (const [k, x] of B) {
        if (!A.has(k)) { added.push(x); continue; }
        const y = A.get(k), diff = props.filter(p => !same(y[p], x[p]));
        if (diff.length) changed.push({ before: y, after: x, props: diff });
      }
      for (const [k, x] of A) if (!B.has(k)) removed.push(x);
      return { added, removed, changed, count: added.length + removed.length + changed.length };
    }
    const sA = before.settings || {}, sB = after.settings || {};
    const settings = [...new Set([...Object.keys(sA), ...Object.keys(sB)])].filter(k => JSON.stringify(sA[k]) !== JSON.stringify(sB[k]));
    const out = {
      bookings: compare(before.bookings, after.bookings, key, ['day', 'field', 'start', 'end', 'team', 'canceled']),
      fields: compare(before.fields, after.fields, f => f.name, ['statusOverride', 'permit', 'renewal', 'planningCap', 'compEligible', 'surface', 'lights', 'contact', 'notes']),
      teams: compare(before.teams, after.teams, t => t.name, ['roster', 'program', 'target', 'age', 'gender']),
      settings
    };
    out.total = out.bookings.count + out.fields.count + out.teams.count + settings.length;
    return out;
  }

  return { DAYS, SURFACES, DEFAULT_SETTINGS, STATUS, analyze, coachList, diffStates, inferProgram, normalizeProgram, parseWindows, peakLoad, fieldStatus, toMin, toHHMM };
});
