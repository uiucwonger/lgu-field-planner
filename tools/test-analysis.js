// Run: node tools/test-analysis.js   (no dependencies)
const assert = require('assert');
const A = require('../analysis.js');

// peakLoad: overlapping and back-to-back intervals
let p = A.peakLoad([{ start: 900, end: 970, weight: 10 }, { start: 900, end: 970, weight: 12 }, { start: 970, end: 1040, weight: 15 }]);
assert.strictEqual(p.players, 22, 'back-to-back blocks must not stack');
p = A.peakLoad([{ start: 960, end: 1030, weight: 18 }, { start: 970, end: 1045, weight: 20 }]);
assert.strictEqual(p.players, 38, 'overlap stacks');

// parseWindows
assert.deepStrictEqual(A.parseWindows('15:00–16:00\n16:15–17:15').length, 2);
assert.deepStrictEqual(A.parseWindows(''), []);

// program inference
assert.strictEqual(A.inferProgram('2011/10B ECNL RL (U16)'), 'ECNL RL');
assert.strictEqual(A.inferProgram('2011/10B ECNL (U16)'), 'ECNL');
assert.strictEqual(A.inferProgram('2016/15B Pre-ECNL (U11)'), 'Pre-ECNL');
assert.strictEqual(A.inferProgram("Boys' Pre 7v7 (2026-2027)"), 'Pre 7v7');
assert.strictEqual(A.inferProgram('2017/16B Academy I (U10)'), 'Comp', 'Academy grouped with Comp');
assert.strictEqual(A.analyze({ settings: { targets: { Academy: 5 } }, fields: [], teams: [{ name: 'X', roster: 9, program: 'Academy' }], bookings: [] }).teams[0].program, 'Comp', 'saved Academy program normalized');

// End-to-end on a tiny state
const state = {
  settings: { asOf: '2026-10-15', weekDays: ['Mon', 'Tue'], targets: { Comp: 2 } },
  fields: [
    { name: 'A', compEligible: true, renewal: '', windows: { Mon: '15:00–17:00', Tue: '15:00–17:00' } },
    { name: 'B', compEligible: true, renewal: '2026-10-01', windows: { Tue: '18:00–19:00' } }
  ],
  teams: [{ name: 'T1 Comp', roster: 10 }, { name: 'T2 Comp', roster: 12 }],
  bookings: [
    { day: 'Mon', field: 'A', start: '15:00', end: '16:00', team: 'T1 Comp' },
    { day: 'Mon', field: 'A', start: '15:00', end: '16:00', team: 'T2 Comp' },
    { day: 'Tue', field: 'B', start: '18:00', end: '19:00', team: 'T2 Comp' },
    { day: 'Tue', field: 'A', start: '15:00', end: '16:00', team: 'T1 Comp', canceled: true },
    { day: 'Mon', field: 'A', start: '16:00', end: '17:00', team: 'Rec Lions (U8)' }
  ]
};
const r = A.analyze(state);
const fa = r.fields.find(f => f.name === 'A'), fb = r.fields.find(f => f.name === 'B');
assert.strictEqual(fa.status, 'Active');
assert.strictEqual(fb.status, 'Lapsed', 'renewal before as-of => lapsed');
assert.strictEqual(fa.capacity, 22, 'observed peak excludes rec and canceled');
const t1 = r.teams.find(t => t.name === 'T1 Comp'), t2 = r.teams.find(t => t.name === 'T2 Comp');
assert.deepStrictEqual([t1.secure, t1.canceled, t1.gap], [1, 1, 1]);
assert.deepStrictEqual([t2.secure, t2.atRisk, t2.gap], [1, 1, 1]);
assert.strictEqual(r.summary.sessionGap, 2);
// T2 (12) can't fit into A on Tue? A Tue capacity 22, load 0 → fits. T1 also fits Tue.
assert.strictEqual(r.suggestions.length, 2);
assert.ok(r.suggestions.every(s => s.field === 'A' && s.day === 'Tue'));
// Planning cap override limits placement
state.fields[0].planningCap = 15;
const r2 = A.analyze(state);
assert.strictEqual(r2.suggestions.length, 1, 'only one team fits under a 15-player cap');
assert.strictEqual(r2.unplaced.length, 1);

// Manual status override
state.fields[1].statusOverride = 'Active';
const r3 = A.analyze(state);
const fb3 = r3.fields.find(f => f.name === 'B');
assert.deepStrictEqual([fb3.status, fb3.autoStatus, fb3.statusSource, fb3.usable], ['Active', 'Lapsed', 'Manual', true]);
assert.strictEqual(r3.teams.find(t => t.name === 'T2 Comp').secure, 2, 'override makes B sessions secure');
state.fields[0].statusOverride = 'Lost';
assert.strictEqual(A.analyze(state).fields.find(f => f.name === 'A').usable, false);
state.fields[0].statusOverride = 'Bogus';
assert.strictEqual(A.analyze(state).fields.find(f => f.name === 'A').statusSource, 'Auto', 'invalid override ignored');
delete state.fields[0].statusOverride; delete state.fields[1].statusOverride;

// diffStates
const s0 = { settings: {}, fields: [{ name: 'A', permit: 'Unknown' }], teams: [{ name: 'T', roster: 10 }],
  bookings: [{ id: 'x', day: 'Mon', field: 'A', start: '15:00', end: '16:00', team: 'T' }, { id: 'y', day: 'Tue', field: 'A', start: '15:00', end: '16:00', team: 'T' }] };
const s1 = JSON.parse(JSON.stringify(s0));
s1.bookings[0].day = 'Wed'; s1.bookings.splice(1, 1); s1.bookings.push({ id: 'z', day: 'Thu', field: 'A', start: '15:00', end: '16:00', team: 'T' });
s1.fields[0].statusOverride = 'Lapsed'; s1.teams[0].roster = 12; s1.settings.asOf = '2026-11-01';
const df = A.diffStates(s0, s1);
assert.deepStrictEqual([df.bookings.added.length, df.bookings.removed.length, df.bookings.changed.length], [1, 1, 1]);
assert.deepStrictEqual(df.bookings.changed[0].props, ['day']);
assert.deepStrictEqual(df.fields.changed[0].props, ['statusOverride']);
assert.deepStrictEqual(df.teams.changed[0].props, ['roster']);
assert.deepStrictEqual(df.settings, ['asOf']);
assert.strictEqual(df.total, 6);
assert.strictEqual(A.diffStates(s0, s0).total, 0);

// Surface rules + optimizer
const sv = {
  settings: { asOf: '2026-10-15', weekDays: ['Mon', 'Tue', 'Wed'], targets: { ECNL: 2, Comp: 2 } },
  fields: [
    { name: 'G', surface: 'Grass', compEligible: true, planningCap: 40, windows: { Mon: '15:00–16:00', Tue: '15:00–16:00', Wed: '15:00–16:00' } },
    { name: 'T', surface: 'Turf', compEligible: true, planningCap: 20, windows: { Mon: '17:00–18:00', Tue: '17:00–18:00', Wed: '17:00–18:00' } },
    { name: 'H', surface: 'Hardwood', compEligible: true, planningCap: 40, windows: { Mon: '15:00–16:00' } }
  ],
  teams: [{ name: 'E1 ECNL', roster: 18, program: 'ECNL' }, { name: 'C1 Comp', roster: 15, program: 'Comp' }],
  bookings: [{ id: 'h1', day: 'Mon', field: 'H', start: '15:00', end: '16:00', team: 'C1 Comp' }]
};
const ro = A.analyze(sv);
assert.ok(ro.issues.some(i => i.type === 'Surface not allowed' && i.detail.includes('Hardwood')), 'Comp on hardwood flagged');
const eSug = ro.suggestions.filter(s => s.team === 'E1 ECNL');
assert.strictEqual(eSug.length, 2, 'ECNL gets 2 sessions');
assert.ok(eSug.every(s => s.surface === 'Turf'), 'ECNL only on turf');
assert.strictEqual(new Set(eSug.map(s => s.day)).size, 2, 'one session per day');
const cSug = ro.suggestions.filter(s => s.team === 'C1 Comp');
assert.ok(cSug.every(s => s.surface !== 'Hardwood' && s.day !== 'Mon'), 'Comp avoids hardwood and its existing day');
// Allowing ECNL on grass changes nothing about turf capacity, but turning off turf strands ECNL
const sv2 = JSON.parse(JSON.stringify(sv)); sv2.settings.surfaces = { ECNL: [] };
const ro2 = A.analyze(sv2);
assert.strictEqual(ro2.suggestions.filter(s => s.team === 'E1 ECNL').length, 0);
assert.ok(ro2.unplaced.find(u => u.team === 'E1 ECNL').reason.startsWith('No usable'));
// Re-home: a session on a lapsed field can be replaced on the same day
const sv3 = JSON.parse(JSON.stringify(sv));
sv3.fields.push({ name: 'L', surface: 'Turf', compEligible: true, renewal: '2026-10-01', windows: { Mon: '15:00–16:00' } });
sv3.bookings.push({ id: 'l1', day: 'Mon', field: 'L', start: '15:00', end: '16:00', team: 'E1 ECNL' });
const ro3 = A.analyze(sv3);
assert.ok(ro3.suggestions.some(s => s.team === 'E1 ECNL' && s.replaces && s.replaces.field === 'L'), 'at-risk session re-homed');
// Turf-only teams are placed before flexible teams
assert.strictEqual(A.analyze(sv).suggestions[0].team, 'E1 ECNL');

// Coaches: no double-booking at different places; prefer the same field on a day
{
  const mk = () => ({
    settings: { asOf: '2026-10-15', weekDays: ['Mon', 'Tue'], targets: { Comp: 1 } },
    fields: [
      { name: 'North', surface: 'Grass', compEligible: true, planningCap: 60, windows: { Mon: '15:00–16:15', Tue: '15:00–16:15' } },
      { name: 'South', surface: 'Grass', compEligible: true, planningCap: 60, windows: { Mon: '15:00–16:15', Tue: '15:00–16:15' } }
    ],
    teams: [
      { name: 'A Comp', roster: 12, program: 'Comp', age: 'U10', coach: 'Pat Lee' },
      { name: 'B Comp', roster: 12, program: 'Comp', age: 'U11', coach: 'Pat Lee; Sam Ruiz' },
      { name: 'C Comp', roster: 12, program: 'Comp', age: 'U12', coach: 'Jo Kim' }
    ],
    bookings: [
      { id: 'n1', day: 'Mon', field: 'North', start: '15:00', end: '16:15', team: 'A Comp' }, // Pat busy at North Mon
      { id: 'f1', day: 'Mon', field: 'South', start: '15:00', end: '16:15', team: 'Filler Rec' }
    ]
  });
  assert.deepStrictEqual(A.coachList('Pat Lee; Sam Ruiz / Al & Bo'), ['Pat Lee', 'Sam Ruiz', 'Al', 'Bo']);
  const r = A.analyze(mk());
  const b = r.suggestions.find(s => s.team === 'B Comp');
  assert.ok(b, 'B placed');
  assert.ok(!(b.day === 'Mon' && b.field === 'South'), 'coach not sent to South while at North Mon');
  assert.ok(b.day === 'Tue' || b.field === 'North', 'B goes to Tue, or alongside A at North');
  assert.ok(b.field === 'North' && b.day === 'Mon', 'same coach + same day prefers the same field');
  // Force a clash: North full on Mon -> B must go to Tue, not South Mon
  const s2 = mk(); s2.fields[0].planningCap = 12;
  const b2 = A.analyze(s2).suggestions.find(s => s.team === 'B Comp');
  assert.strictEqual(b2.day, 'Tue', 'no cross-field clash: moved to another day');
  // Existing double-booking is reported
  const s3 = mk(); s3.bookings.push({ id: 'x', day: 'Mon', field: 'South', start: '15:30', end: '16:30', team: 'B Comp' });
  s3.bookings.push({ id: 'y', day: 'Mon', field: 'North', start: '15:00', end: '16:15', team: 'B Comp' }); // same field as A: allowed, not reported
  const iss = A.analyze(s3).issues.filter(i => i.type === 'Coach double-booked');
  assert.strictEqual(iss.length, 1); assert.ok(iss[0].detail.startsWith('Pat Lee'));
  // Same-field preference by age group with no coach data
  const s4 = mk(); s4.teams.forEach(t => { delete t.coach; t.age = 'U10'; });
  const r4 = A.analyze(s4);
  assert.ok(r4.suggestions.filter(s => s.day === 'Mon').every(s => s.field === 'North'), 'age group kept on one field per day');
}

// Optimizer never offers a whole multi-hour availability window as one session
{
  const st = { settings: { asOf: '2026-10-15', weekDays: ['Wed'], targets: { Comp: 1 } },
    fields: [{ name: 'Open', surface: 'Grass', compEligible: true, planningCap: 40, windows: { Wed: '15:00–17:45' } }],
    teams: [{ name: 'T Comp', roster: 12, program: 'Comp' }], bookings: [] };
  const s = A.analyze(st).suggestions[0];
  assert.ok(A.toMin(s.end) - A.toMin(s.start) <= 75, `slot is ${s.start}-${s.end}`);
}

// Capacity is fixed: removing sessions never changes it
{
  const ctx = {}; new Function('window', require('fs').readFileSync(require('path').join(__dirname, '../seed-data.js'), 'utf8'))(ctx);
  const base = JSON.parse(JSON.stringify(ctx.LGU_SEED));
  const capBefore = A.analyze(base).fields.find(f => f.name === 'Daves Avenue Elementary').capacity;
  base.bookings = base.bookings.filter(b => !(b.field === 'Daves Avenue Elementary' && b.day === 'Mon'));
  const after = A.analyze(base).fields.find(f => f.name === 'Daves Avenue Elementary');
  assert.strictEqual(after.capacity, capBefore, 'capacity unchanged after removing Monday sessions');
  assert.strictEqual(after.capacitySource, 'Baseline (Oct 19–23)');
  base.fields.find(f => f.name === 'Daves Avenue Elementary').planningCap = 90;
  assert.strictEqual(A.analyze(base).fields.find(f => f.name === 'Daves Avenue Elementary').capacity, 90, 'planning cap overrides baseline');
}

// Seed data sanity
global.window = {};
require('../seed-data.js');
const seed = A.analyze(Object.assign({}, window.LGU_SEED, { settings: { asOf: '2026-10-19' } }));
assert.strictEqual(seed.fields.length, 43);
assert.strictEqual(seed.teams.length, 99, '89 roster teams + Academy II (U11) + 9 GK groups');
assert.strictEqual(seed.teams.filter(t => t.program === 'GK').length, 9, '9 GK groups');
assert.strictEqual(seed.teams.filter(t => t.coaches.length).length, 99, 'every team has a head coach');
assert.deepStrictEqual(seed.teams.find(t => t.name === 'GK Boys Group B').coaches, ['Asad Aliyev', 'Carter Tseu', 'Kian Van Der Meer']);
assert.strictEqual(seed.fields.find(f => f.name === 'Union Middle School Grass').capacity, 46, 'Union Grass baseline includes GK rosters');
assert.ok(!window.LGU_SEED.bookings.some(b => /Comp III \(U14\)|Comp I\/II \(U16\)/.test(b.team)), 'non-existent teams removed');
assert.strictEqual(seed.issues.filter(i => i.type === 'No roster match').length, 0, 'no unmatched team names left');
assert.strictEqual(seed.teams.find(t => t.name === '2016/15B Academy II (U11)').roster, 11, 'Academy II roster');
assert.deepStrictEqual(seed.issues.filter(i => i.type === 'Roster size missing').map(i => i.detail.split(':')[0]), ['GK Group X'], 'only GK Group X roster missing');
assert.strictEqual(seed.teams.find(t => t.name === '2016/15B Academy II (U11)').secure, 3, 'Academy II sessions now counted');
assert.strictEqual(seed.fields.filter(f => f.capacity).length, 10, 'matches 10 calculated capacities');
const caps = Object.fromEntries(seed.fields.filter(f => f.capacity).map(f => [f.name, f.capacity]));
console.log('Observed capacities:', caps);
console.log('All analysis tests passed.');
