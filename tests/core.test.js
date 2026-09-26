/* Temporary test harness — extracts the core-logic script from index.html and exercises TM. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/<script id="core-logic">([\s\S]*?)<\/script>/);
if (!m) { console.error('core-logic script not found'); process.exit(1); }
const core = m[1];

// minimal browser shim
const store = {};
const sandbox = {
  console,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  Date, Math, JSON, Number, Object, Array, String,
  setTimeout, clearTimeout
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(core, sandbox, { filename: 'core-logic.js' });

const TM = sandbox.TM;
// The first knockout round is an explicit organiser step in the app (Generate /
// Start knockout), after which the rules lock. Tests that only need a built
// bracket use this convenience wrapper; later rounds still advance automatically.
function ensureBracket() {
  if (!TM.knockoutInfo().exists) TM.generateKnockout();
  TM.ensureKnockout();
}
let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (extra ? ' :: ' + extra : '')); }
}
function eq(name, a, b) { check(name, a === b, 'got ' + a + ' expected ' + b); }

/* ── 1. default tournament structure ───────────────────── */
TM.buildDefaultTournament();
let st = TM.getState();
eq('20 players -> 10 pairs', st.teams.length, 10);
eq('Group A size', st.groups.A.length, 5);
eq('Group B size', st.groups.B.length, 5);
eq('Group A matches = 10', TM.groupMatches('A').length, 10);
eq('Group B matches = 10', TM.groupMatches('B').length, 10);
eq('total group matches = 20', TM.groupMatches().length, 20);

// no duplicate pairing, each team plays 4
(function () {
  ['A', 'B'].forEach(g => {
    const seen = new Set();
    const count = {};
    TM.groupMatches(g).forEach(mm => {
      const key = [mm.teamA, mm.teamB].sort().join('|');
      check('no duplicate pairing ' + g + ' ' + key, !seen.has(key));
      seen.add(key);
      count[mm.teamA] = (count[mm.teamA] || 0) + 1;
      count[mm.teamB] = (count[mm.teamB] || 0) + 1;
    });
    eq('every ' + g + ' team plays 4', Object.values(count).every(c => c === 4), true);
  });
})();

// distinct Vinays preserved
eq('RK & Vinay exists', st.teams.some(t => t.id === 'A3' && t.players.includes('RK') && t.players.includes('Vinay')), true);
eq('Praveen & Vinay exists', st.teams.some(t => t.id === 'B3' && t.players.includes('Praveen') && t.players.includes('Vinay')), true);
eq('Anil partner editable (TBD)', st.teams.find(t => t.id === 'B5').players[1], 'TBD');

/* ── 2. scoring validation ─────────────────────────────── */
check('21-17 valid', TM.validateGroupScore(21, 17) === null);
check('21-21 tie rejected', TM.validateGroupScore(21, 21) !== null);
check('19-17 rejected (not to 21)', TM.validateGroupScore(19, 17) !== null);
check('21-20 rejected (not 2 clear)', TM.validateGroupScore(21, 20) !== null);
check('30-29 valid (cap)', TM.validateGroupScore(30, 29) === null);
check('non-integer rejected', TM.validateGroupScore(21.5, 17) !== null);

/* ── 3. win = 2 points ─────────────────────────────────── */
const NOON = new Date(2026, 0, 1, 6, 30, 0); // deterministic clock, inside 06:00–08:00
(function () {
  const a = TM.groupMatches('A')[0];
  const r = TM.saveGroupScore(a.id, 21, 15);
  check('save group score ok', r.ok, r.msg);
  const rows = TM.computeStandings('A');
  const winner = rows.find(x => x.team.id === a.winner);
  eq('winner gets 2 points', winner.pts, 2);
  eq('winner PF', winner.pf, 21);
  eq('winner PA', winner.pa, 15);
  eq('winner diff', winner.diff, 6);
  const loser = rows.find(x => x.team.id === a.loser);
  eq('loser gets 0 points', loser.pts, 0);
  eq('loser diff', loser.diff, -6);
  eq('winner is top', rows[0].team.id, a.winner);
})();

/* ── 4. completed match cannot be started again ────────── */
(function () {
  const a = TM.groupMatches('A')[0];
  const r = TM.startMatch(a.id, 1, NOON);
  check('completed match cannot start', !r.ok, r.msg);
})();

/* ── 5. scheduling rules ───────────────────────────────── */
(function () {
  const busy = TM.busyTeamIds();
  TM.startMatch('A-02', 1, NOON);
  TM.startMatch('A-03', 2, NOON);
  TM.startMatch('A-04', 3, NOON);
  // A-02/03/04 may share teams? No: A-02 pairs (A1,A3); A-03 (A1,A4); A-04 (A2,A5) -> A1 conflict
  const inprog = TM.inProgressMatches();
  check('max 3 simultaneous', inprog.length <= 3, 'got ' + inprog.length);
  // no team twice on court
  const seen = {};
  let dup = false;
  inprog.forEach(mm => { [mm.teamA, mm.teamB].forEach(t => { if (seen[t]) dup = true; seen[t] = 1; }); });
  check('no team plays simultaneously', !dup);

  // complete a match -> court frees
  const cur = inprog[0];
  const freeCourt = cur.court;
  TM.saveGroupScore(cur.id, 21, 10);
  eq('court freed after complete', TM.matchOnCourt(freeCourt), null);
  check('next eligible exists', TM.rankCandidates(1).length > 0);
})();

/* ── 6. back-to-back avoidance preference ──────────────── */
(function () {
  // after completing, the just-finished teams should rank low (backToBack flagged)
  const ranked = TM.rankCandidates(0);
  const count = TM.getState().matches.filter(m => m.status === 'completed').length;
  const justFinished = TM.getState().matches.filter(m => m.status === 'completed')
    .sort((a, b) => b.completedSeq - a.completedSeq)[0];
  const firstWithJustFinished = ranked.findIndex(r => r.match.teamA === justFinished.teamA || r.match.teamB === justFinished.teamA ||
    r.match.teamA === justFinished.teamB || r.match.teamB === justFinished.teamB);
  const firstWithout = ranked.findIndex(r => r.backToBack === 0);
  if (firstWithout !== -1 && firstWithJustFinished !== -1) {
    check('non-back-to-back preferred', firstWithout < firstWithJustFinished, 'with=' + firstWithJustFinished + ' without=' + firstWithout);
  }
  check('ranked reason present', ranked.length === 0 || !!ranked[0].reason);
})();

/* ── 7. deterministic ordering ─────────────────────────── */
(function () {
  const r1 = TM.rankCandidates(5).map(r => r.match.id).join(',');
  const r2 = TM.rankCandidates(5).map(r => r.match.id).join(',');
  eq('scheduling deterministic', r1, r2);
})();

/* ── 8. group completion + qualification + knockout ────── */
(function () {
  // fill remaining group matches deterministically
  TM.groupMatches().forEach((mm, i) => {
    if (mm.status === 'completed') return;
    const a = mm.teamA < mm.teamB ? 21 : 12;
    const b = mm.teamA < mm.teamB ? 12 : 21;
    const r = TM.saveGroupScore(mm.id, a, b);
    if (!r.ok) failures.push('fill ' + mm.id + ': ' + r.msg);
  });
  check('group stage complete', TM.groupStageComplete());

  // Starting the knockout is an explicit step (not auto-generated on the last result).
  check('bracket not built until started', !TM.knockoutInfo().exists);
  const gen = TM.generateKnockout();
  check('generate knockout ok', gen.ok, gen.msg);
  const info = TM.knockoutInfo();
  check('QF generated', info.qfExists);
  eq('4 QFs', TM.getState().matches.filter(x => x.stage === 'qf').length, 4);

  const sa = TM.computeStandings('A'), sb = TM.computeStandings('B');
  const qf1 = TM.getMatch('QF-1'), qf2 = TM.getMatch('QF-2'), qf3 = TM.getMatch('QF-3'), qf4 = TM.getMatch('QF-4');
  eq('QF1 = A1 vs B4', qf1.teamA + '/' + qf1.teamB, sa[0].team.id + '/' + sb[3].team.id);
  eq('QF2 = B1 vs A4', qf2.teamA + '/' + qf2.teamB, sb[0].team.id + '/A' + sa[3].team.id.replace('A', ''));
  eq('QF3 = A2 vs B3', qf3.teamA + '/' + qf3.teamB, sa[1].team.id + '/' + sb[2].team.id);
  eq('QF4 = B2 vs A3', qf4.teamA + '/' + qf4.teamB, sb[1].team.id + '/' + sa[2].team.id);
  eq('8 qualifiers', info.qualifiers.A.length + info.qualifiers.B.length, 8);

  // knockout validation
  check('QF bad set tie rejected', TM.validateKnockoutSets('QF-1', [{a:11,b:11},{a:null,b:null},{a:null,b:null}]) !== null);
  check('QF valid 9-11 set accepted', TM.validateKnockoutSets('QF-1', [{a:9,b:11},{a:11,b:5},{a:null,b:null}]) === null);
  check('QF set below target rejected', TM.validateKnockoutSets('QF-1', [{a:10,b:9},{a:11,b:5},{a:null,b:null}]) !== null);
  check('QF set not 2 clear rejected', TM.validateKnockoutSets('QF-1', [{a:11,b:10},{a:11,b:5},{a:null,b:null}]) !== null);
  check('QF needs 2 sets', TM.validateKnockoutSets('QF-1', [{a:11,b:7},{a:null,b:null},{a:null,b:null}]) !== null);
  check('QF 3rd set when 2-0 rejected', TM.validateKnockoutSets('QF-1', [{a:11,b:7},{a:11,b:7},{a:11,b:7}]) !== null);

  // play out QFs (best of 3)
  const qfRes = {
    'QF-1': [{a:11,b:7},{a:11,b:9}],
    'QF-2': [{a:8,b:11},{a:11,b:9},{a:11,b:6}],
    'QF-3': [{a:11,b:5},{a:11,b:4}],
    'QF-4': [{a:9,b:11},{a:11,b:8},{a:11,b:13 - 1}] // invalid third? 11-12 -> need check
  };
  // use clean valid results
  const qfClean = {
    'QF-1': [{a:11,b:7},{a:11,b:9}],
    'QF-2': [{a:8,b:11},{a:11,b:9},{a:11,b:6}],
    'QF-3': [{a:11,b:5},{a:11,b:4}],
    'QF-4': [{a:9,b:11},{a:11,b:8},{a:12,b:10}]
  };
  Object.keys(qfClean).forEach(id => {
    const r = TM.saveKnockoutScore(id, qfClean[id]);
    if (!r.ok) failures.push('QF ' + id + ': ' + r.msg);
  });

  // winners feed SF correctly
  const info2 = TM.knockoutInfo();
  check('SF auto-generated', info2.sfExists);
  const sf1 = TM.getMatch('SF-1'), sf2 = TM.getMatch('SF-2');
  eq('SF1 = W QF1 vs W QF2', sf1.teamA + '/' + sf1.teamB, TM.getMatch('QF-1').winner + '/' + TM.getMatch('QF-2').winner);
  eq('SF2 = W QF3 vs W QF4', sf2.teamA + '/' + sf2.teamB, TM.getMatch('QF-3').winner + '/' + TM.getMatch('QF-4').winner);

  // SF sets to 15
  check('SF target is 15', TM.getMatch('SF-1').target, 15);
  check('SF set to 11 rejected', TM.validateKnockoutSets('SF-1', [{a:11,b:5},{a:11,b:5},{a:null,b:null}]) !== null);

  TM.saveKnockoutScore('SF-1', [{a:15,b:10},{a:15,b:12}]);
  TM.saveKnockoutScore('SF-2', [{a:12,b:15},{a:15,b:13},{a:15,b:9}]);

  const info3 = TM.knockoutInfo();
  check('Final auto-generated', info3.finalExists);
  const f = TM.getMatch('F-1');
  eq('F = W SF1 vs W SF2', f.teamA + '/' + f.teamB, TM.getMatch('SF-1').winner + '/' + TM.getMatch('SF-2').winner);
  eq('Final target is 21', f.target, 21);

  TM.saveKnockoutScore('F-1', [{a:21,b:18},{a:19,b:21},{a:21,b:15}]);
  const info4 = TM.knockoutInfo();
  eq('champion determined', info4.champion, TM.getMatch('F-1').winner);
  eq('overall progress complete', TM.progress().overallDone, TM.progress().overallTotal);
})();

/* ── 9. reset cascade ──────────────────────────────────── */
(function () {
  const impact = TM.resetImpact('QF-2');
  check('QF reset warns about SF/Final', impact.length > 0);
  const r = TM.resetMatch('QF-2');
  check('reset QF ok', r.ok);
  check('SF removed after QF reset', TM.getMatch('SF-1') === null);
  check('Final removed after QF reset', TM.getMatch('F-1') === null);
  check('QF-2 back to queued', TM.getMatch('QF-2').status === 'queued');
  // regenerate by replaying QF-2
  TM.saveKnockoutScore('QF-2', [{a:8,b:11},{a:11,b:9},{a:11,b:6}]);
  check('SF re-generated', !!TM.getMatch('SF-1'));
})();

/* ── 10. persistence + backup + reset ──────────────────── */
(function () {
  TM.save();
  // simulate reload
  const snapshot = store[TM.STORAGE_KEY];
  check('state persisted', !!snapshot);
  const completedBefore = TM.getState().matches.filter(m => m.status === 'completed').length;
  TM.setState(JSON.parse(snapshot));
  eq('reload keeps completed match count', TM.getState().matches.filter(m => m.status === 'completed').length, completedBefore);
  eq('reload keeps group stage complete', TM.groupStageComplete(), true);
  eq('reload keeps SF present', !!TM.getMatch('SF-1'), true);

  const json = TM.exportJSON();
  const imp = TM.importJSON(json);
  check('import roundtrip ok', imp.ok, imp.msg);
  check('bad import rejected', !TM.importJSON('{nope').ok);
  check('non-backup import rejected', !TM.importJSON('{"a":1}').ok);

  TM.resetTournament();
  eq('after reset: 20 group matches', TM.groupMatches().length, 20);
  eq('after reset: no knockout', TM.getState().matches.filter(m => m.stage !== 'group').length, 0);
  eq('after reset: progress 0', TM.progress().overallDone, 0);
})();

/* ── 11. team editing guards ───────────────────────────── */
(function () {
  const teams = TM.getState().teams.map(t => ({ id: t.id, group: t.group, name: t.name, players: t.players, level: t.level }));
  // rename only (structure same)
  teams[0].name = 'Naveen & Chandan (A)';
  let r = TM.applyTeams(teams);
  check('rename allowed', r.ok, r.msg);
  eq('rename did not regenerate', r.regenerated, false);
  eq('rename kept 20 matches', TM.groupMatches().length, 20);

  // play a match then try structural change
  TM.saveGroupScore('A-01', 21, 10);
  const t2 = TM.getState().teams.map(t => ({ id: t.id, group: t.group, name: t.name, players: t.players, level: t.level }));
  t2[0].group = 'B';
  r = TM.applyTeams(t2);
  check('structural change blocked after results', !r.ok, r.msg);

  // duplicate name rejected
  const t3 = TM.getState().teams.map(t => ({ id: t.id, group: t.group, name: t.name, players: t.players, level: t.level }));
  t3[1].name = t3[0].name;
  check('duplicate names rejected', !TM.applyTeams(t3).ok);

  // structural change after clear allowed
  TM.resetTournament();
  const t4 = TM.getState().teams.map(t => ({ id: t.id, group: t.group, name: t.name, players: t.players, level: t.level }));
  t4[0].group = 'B'; // move -> groups sizes 4/6
  r = TM.applyTeams(t4);
  check('structural change allowed when idle', r.ok, r.msg);
  eq('regenerated matches after move', r.regenerated, true);
  eq('6 group B matches count', TM.groupMatches('B').length, 15);
  eq('4 group A matches count', TM.groupMatches('A').length, 6);
})();

/* ── 12. scheduling: never >3 courts, Court 1 window ───── */
(function () {
  TM.resetTournament();
  const st = TM.getState();
  eq('3 courts', st.courts.length, 3);
  eq('court1 end 09:00', st.courts.find(c => c.id === 1).endTime, '09:00');
  eq('court2 end 08:00', st.courts.find(c => c.id === 2).endTime, '08:00');
  eq('court3 end 08:00', st.courts.find(c => c.id === 3).endTime, '08:00');
  // roll through all group matches with automatic court allocation, at an
  // injected clock inside every court's window so the full stage can finish
  let guard = 0;
  while (TM.groupMatches().some(m => m.status !== 'completed') && guard++ < 100) {
    const sug = TM.suggestCourts(NOON);
    const ids = Object.keys(sug);
    if (!ids.length) { failures.push('scheduler stalled at ' + guard); break; }
    ids.forEach(cid => {
      const r = TM.startMatch(sug[cid].match.id, Number(cid), NOON);
      if (!r.ok) failures.push('start ' + sug[cid].match.id + ': ' + r.msg);
    });
    // complete everything on court
    TM.inProgressMatches().forEach(m => {
      const a = m.teamA < m.teamB ? 21 : 15;
      TM.saveGroupScore(m.id, a, 21 - a + 15);
    });
    // check invariants
    const inprog = TM.inProgressMatches();
    const seen = {};
    let dup = false;
    inprog.forEach(mm => { [mm.teamA, mm.teamB].forEach(t => { if (seen[t]) dup = true; seen[t] = 1; }); });
    if (dup) failures.push('duplicate team on court');
    if (inprog.length > 3) failures.push('more than 3 matches in progress');
  }
  check('auto-scheduled entire group stage', TM.groupStageComplete(), 'guard=' + guard);
})();

/* ── 13. court availability windows (deterministic clocks) ─ */
(function () {
  const at = function (h, m) { return new Date(2026, 0, 1, h, m || 0, 0); };
  const T_0559 = at(5, 59), T_0600 = at(6, 0), T_0730 = at(7, 30);
  const T_0759 = at(7, 59), T_0801 = at(8, 1), T_0859 = at(8, 59);
  const T_0901 = at(9, 1), T_1200 = at(12, 0);

  TM.resetTournament();
  const st = TM.getState();
  const c1 = st.courts.find(c => c.id === 1);
  const c2 = st.courts.find(c => c.id === 2);
  const c3 = st.courts.find(c => c.id === 3);

  // --- acceptance windows, derived from the clock, not fixed slots ---
  eq('C1 accepts before 06:00? no', TM.courtAcceptsNewMatch(c1, T_0559), false);
  eq('C1 accepts at 06:00', TM.courtAcceptsNewMatch(c1, T_0600), true);
  eq('C1 accepts at 08:59', TM.courtAcceptsNewMatch(c1, T_0859), true);
  eq('C1 rejects at 09:01', TM.courtAcceptsNewMatch(c1, T_0901), false);
  eq('C2 accepts at 07:59', TM.courtAcceptsNewMatch(c2, T_0759), true);
  eq('C2 rejects at 08:01', TM.courtAcceptsNewMatch(c2, T_0801), false);
  eq('C3 rejects at 08:01', TM.courtAcceptsNewMatch(c3, T_0801), false);
  eq('C3 accepts at 07:30', TM.courtAcceptsNewMatch(c3, T_0730), true);

  // --- startMatch honours the window ---
  const m1 = TM.groupMatches()[0];
  eq('start after 09:00 on C1 rejected', TM.startMatch(m1.id, 1, T_0901).ok, false);
  eq('start after 08:00 on C2 rejected', TM.startMatch(m1.id, 2, T_0801).ok, false);
  eq('start still-queued after rejection', TM.getMatch(m1.id).status, 'queued');

  const ok1 = TM.startMatch(m1.id, 1, T_0859);
  check('C1 accepts a new match before 09:00', ok1.ok, ok1.msg);
  eq('that match is in progress', TM.getMatch(m1.id).status, 'in_progress');
  eq('match assigned to Court 1', TM.getMatch(m1.id).court, 1);
  eq('court status in_progress even past close', TM.courtStatus(c1, T_0901), 'in_progress');

  // --- a match already running at/after closing time can be completed ---
  const done = TM.saveGroupScore(m1.id, 21, 18);
  check('running match completes after close', done.ok, done.msg);
  eq('match completed after close', TM.getMatch(m1.id).status, 'completed');

  // --- and the court then takes no further new matches ---
  const m2 = TM.groupMatches().find(m => m.status === 'queued');
  const afterClose = TM.startMatch(m2.id, 1, T_0901);
  eq('C1 takes no new match after it finished late', afterClose.ok, false);
  check('rejection explains the availability window', /availability|ended/i.test(afterClose.msg), afterClose.msg);
  eq('m2 untouched after rejection', TM.getMatch(m2.id).status, 'queued');
  eq('no duplicate court assignment', TM.getMatch(m2.id).court, null);

  // --- closing one court does not close the others ---
  TM.resetTournament();
  const st2 = TM.getState();
  TM.setState(Object.assign({}, st2, {
    courts: st2.courts.map(c => c.id === 1 ? Object.assign({}, c, { closed: true }) : c)
  }));
  const s = TM.getState();
  const k1 = s.courts.find(c => c.id === 1), k2 = s.courts.find(c => c.id === 2), k3 = s.courts.find(c => c.id === 3);
  eq('manually closed C1 rejects', TM.courtAcceptsNewMatch(k1, T_0730), false);
  eq('C2 unaffected by C1 closure', TM.courtAcceptsNewMatch(k2, T_0730), true);
  eq('C3 unaffected by C1 closure', TM.courtAcceptsNewMatch(k3, T_0730), true);
  const sug = TM.suggestCourts(T_0730);
  eq('suggestions skip the closed court', sug[1], undefined);
  check('suggestions still fill open courts', !!sug[2] && !!sug[3]);

  // --- suggestCourts only proposes courts inside their window ---
  TM.resetTournament(); // clear the manual court closure from the block above
  const sugLate = TM.suggestCourts(T_0901);
  eq('no suggestions for C2 after 08:00', sugLate[2], undefined);
  eq('no suggestions for C3 after 08:00', sugLate[3], undefined);
  eq('C1 still usable at 08:59', TM.suggestCourts(T_0859)[1] !== undefined, true);

  // --- admin override is explicit and lets a court accept outside the window ---
  TM.resetTournament();
  eq('override defaults off', TM.getState().settings.allowOutsideAvailability, false);
  eq('C2 rejects outside window by default', TM.courtAcceptsNewMatch(TM.getState().courts[1], T_1200), false);
  TM.getState().settings.allowOutsideAvailability = true;
  eq('override lets C2 accept outside window', TM.courtAcceptsNewMatch(TM.getState().courts[1], T_1200), true);
  TM.resetTournament();

  // --- running match survives rollover between window and post-window ---
  const rr = TM.groupMatches()[0];
  TM.startMatch(rr.id, 2, T_0759);
  eq('C2 match started pre-close', TM.getMatch(rr.id).status, 'in_progress');
  const late = TM.saveGroupScore(rr.id, 21, 19);
  check('C2 match finishing after 08:00 allowed', late.ok, late.msg);
})();

/* ── 14. state integrity: knockout derived from standings ── */
(function () {
  TM.resetTournament();
  // play the whole group stage, then start the knockout
  TM.groupMatches().forEach(m => {
    TM.saveGroupScore(m.id, m.teamA < m.teamB ? 21 : 11, m.teamA < m.teamB ? 11 : 21);
  });
  TM.generateKnockout();
  check('QF generated for integrity test', !!TM.getMatch('QF-1'));

  // editing a completed group result must not silently desync the bracket
  const g = TM.groupMatches()[0];
  const before = JSON.stringify(TM.getMatch('QF-1').teamA + '/' + TM.getMatch('QF-1').teamB);
  const edit = TM.saveGroupScore(g.id, 12, 21); // flip the result
  eq('group edit blocked once bracket exists', edit.ok, false);
  check('block explains the bracket conflict', /knockout bracket/i.test(edit.msg), edit.msg);
  eq('group score unchanged after blocked edit', TM.getMatch(g.id).winner, g.winner);
  eq('QF pairing unchanged after blocked edit', JSON.stringify(TM.getMatch('QF-1').teamA + '/' + TM.getMatch('QF-1').teamB), before);

  // resetting one QF cascades its dependants but leaves the rest of the bracket,
  // so group edits stay blocked until the bracket is fully cleared
  const rst = TM.resetMatch('QF-1');
  check('QF reset ok', rst.ok);
  eq('SF cleared on QF reset', TM.getMatch('SF-1'), null);
  eq('group edit still blocked with other QFs present', TM.saveGroupScore(g.id, 12, 21).ok, false);

  TM.clearKnockout();
  eq('knockout cleared', TM.getMatch('QF-1'), null);
  eq('group matches kept', TM.groupMatches().length, 20);
  const edit2 = TM.saveGroupScore(g.id, 12, 21);
  check('group edit allowed after knockout clear', edit2.ok, edit2.msg);
  eq('group winner flipped', TM.getMatch(g.id).winner, g.teamB);

  // standings reflect the edit
  const rows = TM.computeStandings(g.group);
  check('standings recomputed from edited result', rows.length === 5);

  // completedSeq monotonicity across a long run
  TM.resetTournament();
  let seqOk = true, prev = 0;
  TM.groupMatches().forEach(m => {
    TM.saveGroupScore(m.id, 21, 10);
    const s = TM.getMatch(m.id).completedSeq;
    if (s <= prev) seqOk = false;
    prev = s;
  });
  check('completedSeq strictly increasing', seqOk);
  eq('meta.seq equals match count', TM.getState().meta.seq, 20);

  // standings derived, not stored independently
  const raw = JSON.parse(TM.exportJSON());
  check('no persisted standings blob', raw.standings === undefined);
  check('no persisted derived court state', raw.courts.every(c => c.occupied === undefined));
})();

/* ── 15. persistence hardening ─────────────────────────── */
(function () {
  TM.resetTournament();
  const mode = v => { Object.defineProperty(sandbox, 'localStorage', { value: v, configurable: true, writable: true }); };

  // corrupt snapshot must not wedge the app: it is dropped and defaults rebuilt
  mode({ getItem: () => '{ this is not json', setItem: () => {}, removeItem: () => {} });
  eq('corrupt snapshot fails to load', TM.load(), false);
  eq('default tournament present after corruption', TM.groupMatches().length, 20);

  // storage that throws on read/write must never surface as an exception
  mode({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } });
  let threw = null;
  try { TM.save(); TM.load(); } catch (e) { threw = e.message; }
  check('no throw when storage is denied', threw === null, threw);

  // storage entirely absent (private mode / file://)
  mode(undefined);
  threw = null;
  try { TM.save(); eq('load without storage returns false', TM.load(), false); } catch (e) { threw = e.message; }
  check('no throw when storage is absent', threw === null, threw);

  // restore normal storage for the round-trip checks
  mode({ getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } });

  // import rejects junk without mutating state
  const before = TM.exportJSON();
  const bad = ['not json at all', '[]', '"a string"', '42', '{"a":1}', '{"teams":[],"matches":[]}', '{"teams":[{"name":"x"}],"matches":[]}'];
  bad.forEach(function (b, i) {
    const r = TM.importJSON(b);
    eq('import rejects case ' + i, r.ok, false);
    check('import case ' + i + ' has a message', typeof r.msg === 'string' && r.msg.length > 0);
  });
  eq('state untouched by rejected imports', TM.exportJSON(), before);

  // a real export still round-trips
  TM.groupMatches().forEach(m => TM.saveGroupScore(m.id, 21, 9));
  const good = TM.exportJSON();
  eq('valid import accepted', TM.importJSON(good).ok, true);
  eq('round-trip preserved results', TM.getState().matches.filter(m => m.status === 'completed').length, 20);

  // legacy states carrying the old "Enforce court time windows" flag upgrade cleanly
  const legacy = JSON.parse(good);
  legacy.settings = { enforceTimeWindows: false };
  const r1 = TM.importJSON(JSON.stringify(legacy));
  check('legacy state imports', r1.ok, r1.msg);
  eq('legacy flag dropped', TM.getState().settings.enforceTimeWindows, undefined);
  eq('legacy flag inverted into new setting', TM.getState().settings.allowOutsideAvailability, true);

  const legacy2 = JSON.parse(good);
  legacy2.settings = { enforceTimeWindows: true };
  TM.importJSON(JSON.stringify(legacy2));
  eq('legacy enforced flag maps to off', TM.getState().settings.allowOutsideAvailability, false);
})();

/* ── 20. editable court configuration ──────────────────── */
(function () {
  const at = function (h, m) { return new Date(2026, 0, 1, h, m || 0, 0); };

  // 1–4. defaults
  TM.resetTournament();
  let s = TM.getState();
  eq('default court count = 3', s.courts.length, 3);
  eq('default C1 window 06:00', s.courts.find(c => c.id === 1).startTime, '06:00');
  eq('default C1 window 09:00', s.courts.find(c => c.id === 1).endTime, '09:00');
  eq('default C2 window 06:00', s.courts.find(c => c.id === 2).startTime, '06:00');
  eq('default C2 window 08:00', s.courts.find(c => c.id === 2).endTime, '08:00');
  eq('default C3 window 06:00', s.courts.find(c => c.id === 3).startTime, '06:00');
  eq('default C3 window 08:00', s.courts.find(c => c.id === 3).endTime, '08:00');
  check('default courts all enabled', s.courts.every(c => c.enabled === true));
  eq('C1 default accepts at 06:00', TM.courtAcceptsNewMatch(s.courts[0], at(6, 0)), true);
  eq('C2 default rejects at 08:30', TM.courtAcceptsNewMatch(s.courts[1], at(8, 30)), false);

  // 5–6. change Court 2 to 07:00–10:00 and verify the scheduler honours it
  const r1 = TM.updateCourt(2, { startTime: '07:00', endTime: '10:00' });
  check('Court 2 time change accepted', r1.ok, r1.msg);
  s = TM.getState();
  const c2 = s.courts.find(c => c.id === 2);
  eq('C2 end now 10:00', c2.endTime, '10:00');
  eq('C2 accepts at 07:30', TM.courtAcceptsNewMatch(c2, at(7, 30)), true);
  eq('C2 accepts at 09:30 (extended)', TM.courtAcceptsNewMatch(c2, at(9, 30)), true);
  eq('C2 rejects at 06:30 (now opens 07:00)', TM.courtAcceptsNewMatch(c2, at(6, 30)), false);
  eq('C2 rejects at 10:01', TM.courtAcceptsNewMatch(c2, at(10, 1)), false);
  // and the scheduler actually offers C2 inside the new window, not before it
  check('scheduler offers C2 at 09:30', TM.suggestCourts(at(9, 30))[2] !== undefined);
  eq('scheduler withholds C2 at 06:30', TM.suggestCourts(at(6, 30))[2], undefined);

  // start a real match on C2 inside its window to prove startMatch reads config
  TM.resetTournament();
  TM.updateCourt(2, { startTime: '07:00', endTime: '10:00' });
  const mm2 = TM.groupMatches()[0];
  let started = TM.startMatch(mm2.id, 2, at(9, 30));
  check('match can start on C2 at 09:30 after extension', started.ok, started.msg);
  eq('assigned to court 2', TM.getMatch(mm2.id).court, 2);

  // 7–8. disable Court 3
  TM.resetTournament();
  const r2 = TM.setCourtEnabled(3, false);
  check('Court 3 disabled', r2.ok, r2.msg);
  s = TM.getState();
  eq('C3 enabled flag false', s.courts.find(c => c.id === 3).enabled, false);
  eq('C3 not accepted any time', TM.courtAcceptsNewMatch(s.courts.find(c => c.id === 3), at(7, 0)), false);
  const sug = TM.suggestCourts(at(7, 0));
  eq('scheduler never suggests disabled C3', sug[3], undefined);
  check('scheduler still fills C1/C2', !!sug[1] && !!sug[2]);
  const anyC3 = TM.groupMatches().find(x => x.status === 'queued');
  const c3start = TM.startMatch(anyC3.id, 3, at(7, 0));
  eq('start on disabled C3 rejected', c3start.ok, false);
  check('rejection mentions disabled', /disabled/i.test(c3start.msg), c3start.msg);
  // re-enabling restores it
  TM.setCourtEnabled(3, true);
  check('C3 usable again after re-enable', TM.suggestCourts(at(7, 0))[3] !== undefined);

  // the outside-hours override must not resurrect a disabled court
  TM.getState().settings.allowOutsideAvailability = true;
  TM.setCourtEnabled(3, false);
  eq('override does not bypass disabled', TM.courtAcceptsNewMatch(TM.courtById(3), at(7, 0)), false);
  eq('disabled court still absent from suggestions under override', TM.suggestCourts(at(7, 0))[3], undefined);
  check('override still opens enabled courts', TM.courtAcceptsNewMatch(TM.courtById(2), at(12, 0)) === true);
  TM.getState().settings.allowOutsideAvailability = false;
  TM.setCourtEnabled(3, true);

  // 9. rename Court 1
  TM.resetTournament();
  const r3 = TM.updateCourt(1, { name: 'Main Court' });
  check('rename accepted', r3.ok, r3.msg);
  s = TM.getState();
  eq('C1 name changed in state', s.courts.find(c => c.id === 1).name, 'Main Court');
  eq('C1 id unchanged', s.courts.find(c => c.id === 1).id, 1);
  eq('courtName helper reflects rename', TM.courtName(1), 'Main Court');
  eq('other courts untouched', s.courts.find(c => c.id === 2).name, 'Court 2');

  // 10. increase 3 -> 4
  TM.resetTournament();
  TM.updateCourt(1, { name: 'Main Court' });
  const r4 = TM.setCourtCount(4);
  check('increase to 4 courts', r4.ok, r4.msg);
  s = TM.getState();
  eq('now 4 courts', s.courts.length, 4);
  eq('4 enabled', s.courts.filter(c => c.enabled !== false).length, 4);
  eq('new C4 has unique id', new Set(s.courts.map(c => c.id)).size, 4);
  check('C4 has a default window', /^\d{2}:\d{2}$/.test(s.courts.find(c => c.id === 4).startTime));
  eq('C1 rename survived count increase', TM.courtName(1), 'Main Court');

  // 11. decrease 4 -> 2 (keeps config, disables the rest, history intact)
  // seed a completed match on court 4 first so we can prove history is preserved
  const m4 = TM.groupMatches()[0];
  TM.startMatch(m4.id, 4, at(7, 0));
  TM.saveGroupScore(m4.id, 21, 12);
  const histCourt = TM.getMatch(m4.id).court;
  const r5 = TM.setCourtCount(2);
  check('decrease to 2 courts', r5.ok, r5.msg);
  s = TM.getState();
  eq('2 enabled courts', s.courts.filter(c => c.enabled !== false).length, 2);
  eq('C3 + C4 disabled', s.courts.filter(c => c.id > 2).every(c => c.enabled === false), true);
  eq('C1 config preserved', TM.courtName(1), 'Main Court');
  eq('C2 config preserved', TM.courtName(2), 'Court 2');
  eq('history keeps original court id', histCourt, 4);
  eq('completed match still on court 4', TM.getMatch(m4.id).court, 4);
  eq('completed match not disturbed', TM.getMatch(m4.id).status, 'completed');
  eq('disabled C4 not scheduled', TM.suggestCourts(at(7, 0))[4], undefined);
  eq('enabled count helper', TM.enabledCourts().length, 2);

  // 13. active matches are never interrupted by configuration changes
  TM.resetTournament();
  const live = TM.groupMatches()[0];
  TM.startMatch(live.id, 3, at(7, 0));
  eq('match in progress on C3', TM.getMatch(live.id).status, 'in_progress');
  eq('still assigned to its court', TM.getMatch(live.id).court, 3);
  // widening the window: the running match must be untouched
  const r6 = TM.updateCourt(3, { startTime: '05:00', endTime: '11:00' });
  check('window change accepted while busy', r6.ok, r6.msg);
  eq('running match still in progress', TM.getMatch(live.id).status, 'in_progress');
  eq('running match still on its court', TM.getMatch(live.id).court, 3);
  // disabling the court a match is running on must be refused, not silently applied
  const r7 = TM.setCourtEnabled(3, false);
  eq('cannot disable a busy court', r7.ok, false);
  check('busy-court rejection is explained', /in progress/i.test(r7.msg), r7.msg);
  eq('court still enabled after refusal', TM.courtById(3).enabled, true);
  // shrinking the count so the busy court would be dropped is refused too
  const r8 = TM.setCourtCount(2);
  eq('cannot drop a busy court via count', r8.ok, false);
  check('count-drop rejection mentions the match', /in progress/i.test(r8.msg), r8.msg);
  eq('count unchanged after refusal', TM.enabledCourts().length, 3);
  // a count that keeps the busy court is still allowed
  eq('count that keeps the busy court is allowed', TM.setCourtCount(3).ok, true);
  // the match can still finish normally after all those attempts
  const fin = TM.saveGroupScore(live.id, 21, 19);
  check('busy match completes normally', fin.ok, fin.msg);
  eq('completed match keeps its court history', TM.getMatch(live.id).court, 3);
  eq('court freed for scheduling after completion', TM.matchOnCourt(3), null);

  // 12 / 14. invalid time ranges rejected atomically
  TM.resetTournament();
  const before = TM.exportJSON();
  const bad1 = TM.updateCourt(2, { endTime: '05:00' }); // end before start
  eq('end-before-start rejected', bad1.ok, false);
  check('range error explained', /later than/i.test(bad1.msg), bad1.msg);
  const bad2 = TM.updateCourt(2, { startTime: 'oops' });
  eq('malformed start rejected', bad2.ok, false);
  const bad3 = TM.updateCourt(2, { endTime: '25:00' });
  eq('out-of-range hour rejected', bad3.ok, false);
  const bad4 = TM.updateCourt(2, { name:  '   ' });
  eq('empty name rejected', bad4.ok, false);
  check('empty-name error explained', /cannot be empty/i.test(bad4.msg), bad4.msg);
  const bad5 = TM.updateCourt(2, { name: 'Court 1' }); // duplicate of C1's default name
  eq('duplicate name rejected', bad5.ok, false);
  check('duplicate-name error explained', /unique|both named/i.test(bad5.msg), bad5.msg);
  check('failed time-range edits left state untouched', TM.exportJSON() === before, 'state changed after rejected edits');
  eq('invalid time helper', TM.validateTime('6:5', 'X') !== null, true);
  eq('valid time helper', TM.validateTime('06:05', 'X'), null);

  // 15. invalid court counts rejected
  eq('count 0 rejected', TM.setCourtCount(0).ok, false);
  eq('count 9 rejected', TM.setCourtCount(9).ok, false);
  eq('count 8 accepted', TM.setCourtCount(8).ok, true);
  eq('8 enabled', TM.enabledCourts().length, 8);
  eq('count 1 accepted', TM.setCourtCount(1).ok, true);
  eq('1 enabled', TM.enabledCourts().length, 1);
  eq('count 2 accepted', TM.setCourtCount(2).ok, true);
  eq('count 3 accepted', TM.setCourtCount(3).ok, true);
  eq('3 enabled', TM.enabledCourts().length, 3);
  eq('total never exceeds the maximum', TM.getState().courts.length <= 8, true);

  // 16. configuration survives a localStorage reload
  TM.resetTournament();
  TM.updateCourt(1, { name: 'Centre Court' });
  TM.updateCourt(2, { startTime: '07:00', endTime: '10:00' });
  TM.setCourtEnabled(3, false);
  const persisted = TM.getState().courts.map(c => ({ id: c.id, name: c.name, s: c.startTime, e: c.endTime, on: c.enabled }));
  TM.load();
  const afterLoad = TM.getState().courts.map(c => ({ id: c.id, name: c.name, s: c.startTime, e: c.endTime, on: c.enabled }));
  eq('court config survives reload', JSON.stringify(afterLoad), JSON.stringify(persisted));

  // 17. configuration survives export/import
  const dump = TM.exportJSON();
  const imp = TM.importJSON(dump);
  check('import ok', imp.ok, imp.msg);
  const afterImp = TM.getState().courts.map(c => ({ id: c.id, name: c.name, s: c.startTime, e: c.endTime, on: c.enabled }));
  eq('court config survives export/import', JSON.stringify(afterImp), JSON.stringify(persisted));

  // 18. legacy state (old { start, end, closed } shape) migrates to the defaults
  const legacy = {
    version: 4,
    courts: [
      { id: 1, name: 'Court 1', start: '06:00', end: '09:00', closed: false },
      { id: 2, name: 'Court 2', start: '06:00', end: '08:00', closed: false },
      { id: 3, name: 'Court 3', start: '06:00', end: '08:00', closed: false }
    ],
    teams: [{ id: 'A1', group: 'A', name: 'X & Y', players: ['X', 'Y'], level: 'Tunga' }],
    matches: []
  };
  const mig = TM.migrate(legacy);
  eq('legacy: 3 courts preserved', mig.courts.length, 3);
  eq('legacy: start -> startTime', mig.courts[0].startTime, '06:00');
  eq('legacy: end -> endTime', mig.courts[0].endTime, '09:00');
  eq('legacy: C2 endTime 08:00', mig.courts[1].endTime, '08:00');
  check('legacy: enabled defaults true', mig.courts.every(c => c.enabled === true));
  eq('legacy: new schema version', mig.version, 6);

  // legacy state missing courts entirely falls back to the standard three
  const mig2 = TM.migrate({ teams: [{ id: 'A1', group: 'A', name: 'X & Y', players: ['X', 'Y'], level: 'Tunga' }], matches: [] });
  eq('legacy: missing courts -> 3 defaults', mig2.courts.length, 3);
  eq('legacy: default C1 end 09:00', mig2.courts[0].endTime, '09:00');

  // 13b. the documented close-time scenario: a match starting at 07:59 on a court
  // that closes at 08:00 still finishes, and that court then takes no new match.
  TM.resetTournament();
  const late = TM.groupMatches()[0];
  let lateStart = TM.startMatch(late.id, 2, at(7, 59));
  check('match starts at 07:59 on C2', lateStart.ok, lateStart.msg);
  // simulating the clock ticking past 08:00: the running match is untouched
  eq('still in progress just after 08:00', TM.matchOnCourt(2) && TM.matchOnCourt(2).id, late.id);
  eq('C2 accepts no new match at 08:00', TM.courtAcceptsNewMatch(TM.courtById(2), at(8, 0)), false);
  const lateDone = TM.saveGroupScore(late.id, 21, 18);
  check('match finishes normally after the close time', lateDone.ok, lateDone.msg);
  eq('C2 free but unavailable for new matches', TM.suggestCourts(at(8, 0))[2], undefined);
  // extending the window or using the override makes C2 eligible again
  eq('extending C2 to 09:00 re-enables it', TM.updateCourt(2, { endTime: '09:00' }).ok, true);
  check('C2 eligible again at 08:30', TM.suggestCourts(at(8, 30))[2] !== undefined);

  // 18b. court changes must not disturb match generation, results, standings or
  // knockout progression.
  TM.resetTournament();
  TM.groupMatches().forEach(function (m) { TM.saveGroupScore(m.id, m.teamA < m.teamB ? 21 : 10, m.teamA < m.teamB ? 10 : 21); });
  ensureBracket(); // generates QFs from the completed group stage
  const groupIds = TM.groupMatches().map(function (m) { return m.id; }).join(',');
  const standingsA = JSON.stringify(TM.computeStandings('A'));
  const qfIds = ['QF-1', 'QF-2', 'QF-3', 'QF-4'];
  const qfBefore = qfIds.map(function (id) { const m = TM.getMatch(id); return m ? (m.teamA + '|' + m.teamB) : id + ':none'; }).join(',');
  const doneBefore = TM.getState().matches.filter(function (m) { return m.status === 'completed'; }).length;
  const historyBefore = TM.getState().matches.filter(function (m) { return m.status === 'completed'; })
    .map(function (m) { return m.id + ':' + m.court; }).sort().join(',');

  TM.updateCourt(1, { name: 'Main Court' });
  TM.updateCourt(2, { startTime: '07:00', endTime: '10:00' });
  TM.setCourtEnabled(3, false);
  TM.setCourtCount(5);

  eq('group match list unchanged', TM.groupMatches().map(function (m) { return m.id; }).join(','), groupIds);
  eq('no match regenerated', TM.groupMatches().length, 20);
  eq('standings unchanged', JSON.stringify(TM.computeStandings('A')), standingsA);
  eq('completed count unchanged', TM.getState().matches.filter(function (m) { return m.status === 'completed'; }).length, doneBefore);
  eq('QF bracket unchanged', qfIds.map(function (id) { const m = TM.getMatch(id); return m ? (m.teamA + '|' + m.teamB) : id + ':none'; }).join(','), qfBefore);
  eq('completed-match court history unchanged', TM.getState().matches.filter(function (m) { return m.status === 'completed'; })
    .map(function (m) { return m.id + ':' + m.court; }).sort().join(','), historyBefore);
  eq('renames still applied after all changes', TM.courtName(1), 'Main Court');

  TM.resetTournament();
})();


/* ── 21. configurable team levels ──────────────────────── */
(function () {
  // 1. default levels are Tunga, Bhadra and Kaveri
  TM.resetTournament();
  let s = TM.getState();
  const names = TM.levels().map(l => l.name);
  eq('default levels are Tunga/Bhadra/Kaveri', names.join(','), 'Tunga,Bhadra,Kaveri');
  eq('default level ids are slugs', TM.levels().map(l => l.id).join(','), 'tunga,bhadra,kaveri');
  check('default levels enabled', TM.levels().every(l => l.enabled !== false));
  eq('levels persisted on state.settings', Array.isArray(s.settings.levels), true);

  // 2. default distribution: Tunga 3, Bhadra 3, Kaveri 3, Unassigned 1
  let counts = TM.levelCounts();
  eq('default Tunga count = 3', counts.tunga, 3);
  eq('default Bhadra count = 3', counts.bhadra, 3);
  eq('default Kaveri count = 3', counts.kaveri, 3);
  eq('default Unassigned count = 1', counts[TM.UNASSIGNED_ID], 1);
  const sum = TM.levelSummary();
  eq('total pairs 10', sum.total, 10);
  eq('assigned 9', sum.assigned, 9);
  eq('unassigned 1', sum.unassigned, 1);
  check('unassigned warning flag set', TM.hasUnassignedTeams());

  // Anil & TBD is the unassigned pair and remains in Group B (level != group)
  const anil = s.teams.find(t => t.id === 'B5');
  eq('Anil & TBD default level is Unassigned', anil.level, TM.UNASSIGNED_ID);
  eq('Anil & TBD stays in Group B', anil.group, 'B');
  eq('Anil & TBD level label', TM.levelName(anil.level), 'Unassigned');

  // 3. the Teams dropdown draws from the configured levels (one source of truth)
  eq('selectable levels = configured + Unassigned',
    TM.selectableLevels().map(l => l.name).join(','), 'Tunga,Bhadra,Kaveri,Unassigned');
  check('selectable levels expose ids', TM.selectableLevels().every(l => typeof l.id === 'string' && l.id.length > 0));

  // 4. changing a pair's level updates the displayed count
  let teams = TM.getState().teams.map(t => ({ id: t.id, group: t.group, name: t.name, players: t.players, level: t.level }));
  const a1 = teams.find(t => t.id === 'A1'); // Tunga
  a1.level = 'bhadra';
  let r = TM.applyTeams(teams);
  check('level change accepted', r.ok, r.msg);
  counts = TM.levelCounts();
  eq('Tunga count drops to 2', counts.tunga, 2);
  eq('Bhadra count rises to 4', counts.bhadra, 4);
  eq('total still 10', TM.levelSummary().total, 10);

  // 5. moving a team from Kaveri to Tunga updates both counts
  TM.resetTournament();
  teams = TM.getState().teams.map(t => ({ id: t.id, group: t.group, name: t.name, players: t.players, level: t.level }));
  const a3 = teams.find(t => t.id === 'A3'); // Kaveri
  a3.level = 'tunga';
  r = TM.applyTeams(teams);
  check('Kaveri -> Tunga accepted', r.ok, r.msg);
  counts = TM.levelCounts();
  eq('Kaveri count drops to 2', counts.kaveri, 2);
  eq('Tunga count rises to 4', counts.tunga, 4);

  // 6. moving a team to Unassigned works
  TM.resetTournament();
  teams = TM.getState().teams.map(t => ({ id: t.id, group: t.group, name: t.name, players: t.players, level: t.level }));
  teams.find(t => t.id === 'A1').level = TM.UNASSIGNED_ID;
  r = TM.applyTeams(teams);
  check('move to Unassigned accepted', r.ok, r.msg);
  const after = TM.getState().teams.find(t => t.id === 'A1');
  eq('A1 now unassigned', after.level, TM.UNASSIGNED_ID);
  eq('Unassigned count is 2', TM.levelCounts()[TM.UNASSIGNED_ID], 2);
  check('assigned count is 8', TM.levelSummary().assigned === 8);

  // 7. level changes do not regenerate group fixtures
  TM.resetTournament();
  const groupIds = TM.groupMatches().map(m => m.id).join(',');
  const pairings = TM.groupMatches().map(m => m.teamA + '|' + m.teamB).join(',');
  teams = TM.getState().teams.map(t => ({ id: t.id, group: t.group, name: t.name, players: t.players, level: t.level }));
  teams.forEach(t => { t.level = 'bhadra'; });
  r = TM.applyTeams(teams);
  check('bulk level change accepted', r.ok, r.msg);
  eq('fixtures not regenerated', r.regenerated, false);
  eq('group match ids unchanged', TM.groupMatches().map(m => m.id).join(','), groupIds);
  eq('group pairings unchanged', TM.groupMatches().map(m => m.teamA + '|' + m.teamB).join(','), pairings);
  eq('still 20 group matches', TM.groupMatches().length, 20);

  // 8. level changes do not change Group A/B
  eq('Group A size unchanged', TM.getState().groups.A.length, 5);
  eq('Group B size unchanged', TM.getState().groups.B.length, 5);
  eq('A1 still group A', TM.getTeam('A1').group, 'A');
  eq('B5 still group B', TM.getTeam('B5').group, 'B');
  const groupOf = {}; TM.getState().teams.forEach(t => { groupOf[t.id] = t.group; });
  eq('no team moved groups', Object.values(groupOf).filter(g => g !== 'A' && g !== 'B').length, 0);

  // level change allowed even after results exist (level is fixture-independent)
  TM.resetTournament();
  TM.saveGroupScore('A-01', 21, 10);
  teams = TM.getState().teams.map(t => ({ id: t.id, group: t.group, name: t.name, players: t.players, level: t.level }));
  teams.find(t => t.id === 'A1').level = 'kaveri';
  r = TM.applyTeams(teams);
  check('level change allowed after results', r.ok, r.msg);
  eq('A1 level applied after results', TM.getTeam('A1').level, 'kaveri');
  eq('result preserved after level change', TM.getMatch('A-01').status, 'completed');

  // 9. group changes keep the existing structural safeguards
  teams = TM.getState().teams.map(t => ({ id: t.id, group: t.group, name: t.name, players: t.players, level: t.level }));
  teams.find(t => t.id === 'A1').group = 'B';
  r = TM.applyTeams(teams);
  check('group move still blocked after results', !r.ok, r.msg);
  check('block message explains regeneration', /regenerate fixtures/i.test(r.msg), r.msg);

  // 10. level assignments survive a localStorage reload
  TM.resetTournament();
  teams = TM.getState().teams.map(t => ({ id: t.id, group: t.group, name: t.name, players: t.players, level: t.level }));
  teams.find(t => t.id === 'A2').level = 'kaveri';
  TM.applyTeams(teams);
  TM.save();
  const beforeLevels = TM.getState().teams.map(t => t.id + ':' + t.level).join(',');
  TM.load();
  eq('level assignments survive reload', TM.getState().teams.map(t => t.id + ':' + t.level).join(','), beforeLevels);
  eq('level config survives reload', TM.levels().map(l => l.id).join(','), 'tunga,bhadra,kaveri');

  // 11. level assignments survive export/import
  const dump = TM.exportJSON();
  const imp = TM.importJSON(dump);
  check('import with levels ok', imp.ok, imp.msg);
  eq('level assignments survive export/import', TM.getState().teams.map(t => t.id + ':' + t.level).join(','), beforeLevels);
  eq('level config survives export/import', TM.levels().map(l => l.id).join(','), 'tunga,bhadra,kaveri');

  // 12. duplicate/invalid level ids are rejected
  eq('duplicate level id rejected', TM.applyLevels([
    { id: 'tunga', name: 'Tunga' }, { id: 'tunga', name: 'Other' }
  ]).ok, false);
  eq('duplicate level name rejected', TM.applyLevels([
    { id: 'one', name: 'Same' }, { id: 'two', name: 'same' }
  ]).ok, false);
  eq('empty level id rejected', TM.applyLevels([{ id: '', name: 'X' }]).ok, false);
  eq('empty level name rejected', TM.applyLevels([{ id: 'x', name: '' }]).ok, false);
  eq('reserved Unassigned id rejected', TM.applyLevels([{ id: 'unassigned', name: 'Nope' }]).ok, false);
  eq('reserved Unassigned name rejected', TM.applyLevels([{ id: 'x', name: 'Unassigned' }]).ok, false);
  check('validateLevels reports a reason', /unique/i.test(TM.validateLevels([{ id: 'a', name: 'N' }, { id: 'a', name: 'M' }])));
  eq('empty level list rejected', TM.applyLevels([]).ok, false);
  eq('non-list level config rejected', TM.applyLevels('Tunga').ok, false);
  // an unknown level on a pair is rejected rather than silently kept
  TM.resetTournament();
  teams = TM.getState().teams.map(t => ({ id: t.id, group: t.group, name: t.name, players: t.players, level: t.level }));
  teams[0].level = 'not-a-level';
  check('unknown pair level rejected', !TM.applyTeams(teams).ok);

  // 13. two Vinay teams remain distinct
  eq('RK & Vinay distinct from Praveen & Vinay',
    (TM.getTeam('A3').name === 'RK & Vinay' && TM.getTeam('B3').name === 'Praveen & Vinay'), true);
  teams = TM.getState().teams.map(t => ({ id: t.id, group: t.group, name: t.name, players: t.players, level: t.level }));
  teams.find(t => t.id === 'A3').level = 'tunga';
  teams.find(t => t.id === 'B3').level = 'kaveri';
  TM.applyTeams(teams);
  eq('A3 keeps its own level', TM.getTeam('A3').level, 'tunga');
  eq('B3 keeps its own level', TM.getTeam('B3').level, 'kaveri');
  eq('both Vinay pairs still exist',
    TM.getState().teams.filter(t => t.players.includes('Vinay')).length, 2);

  // extra: organizer can redistribute beyond the defaults (Tunga 4, Bhadra 3, Kaveri 3)
  TM.resetTournament();
  teams = TM.getState().teams.map(t => ({ id: t.id, group: t.group, name: t.name, players: t.players, level: t.level }));
  teams.find(t => t.id === 'A3').level = 'tunga';
  teams.find(t => t.id === 'B5').level = 'kaveri'; // assign the unassigned pair
  r = TM.applyTeams(teams);
  check('redistribution accepted', r.ok, r.msg);
  counts = TM.levelCounts();
  eq('Tunga 4 after redistribution', counts.tunga, 4);
  eq('Kaveri 3 after redistribution', counts.kaveri, 3);
  eq('Bhadra 3 after redistribution', counts.bhadra, 3);
  eq('nothing unassigned after redistribution', TM.levelSummary().unassigned, 0);

  // extra: adding a brand-new level makes it selectable and assignable
  TM.resetTournament();
  r = TM.applyLevels(TM.levels().map(l => ({ id: l.id, name: l.name, enabled: l.enabled })).concat([{ id: 'ganga', name: 'Ganga', enabled: true }]));
  check('new level added', r.ok, r.msg);
  check('new level is selectable', TM.selectableLevels().some(l => l.id === 'ganga'));
  teams = TM.getState().teams.map(t => ({ id: t.id, group: t.group, name: t.name, players: t.players, level: t.level }));
  teams.find(t => t.id === 'A1').level = 'ganga';
  check('pair assigned to new level', TM.applyTeams(teams).ok);
  eq('new level count = 1', TM.levelCounts().ganga, 1);

  // extra: disabling/removing a level moves its pairs to Unassigned (never blocks)
  TM.resetTournament();
  const tungaTeams = TM.getState().teams.filter(t => t.level === 'tunga').map(t => t.id);
  r = TM.applyLevels(TM.levels().map(l => l.id === 'tunga' ? { id: l.id, name: l.name, enabled: false } : { id: l.id, name: l.name, enabled: l.enabled }));
  check('disable a level', r.ok, r.msg);
  check('its pairs moved to Unassigned', tungaTeams.every(id => TM.getTeam(id).level === TM.UNASSIGNED_ID));
  check('disabled level hidden from dropdown', !TM.selectableLevels().some(l => l.id === 'tunga'));
  eq('fixtures still intact after level removal', TM.groupMatches().length, 20);

  TM.resetTournament();
})();

/* ── 22. old backups with hard-coded levels still import ─ */
(function () {
  // A pre-configuration backup: no settings.levels, teams referencing level names.
  const legacy = {
    version: 5,
    tournament: { name: 'Legacy', createdAt: '2026-01-01T00:00:00.000Z' },
    teams: [
      { id: 'A1', group: 'A', name: 'X & Y', players: ['X', 'Y'], level: 'Tunga' },
      { id: 'A2', group: 'A', name: 'P & Q', players: ['P', 'Q'], level: 'Bhadra' },
      { id: 'B1', group: 'B', name: 'R & S', players: ['R', 'S'], level: 'Kaveri' },
      { id: 'B2', group: 'B', name: 'M & N', players: ['M', 'N'], level: 'Kaveri' }
    ],
    groups: { A: ['A1', 'A2'], B: ['B1', 'B2'] },
    matches: []
  };
  const mig = TM.migrate(legacy);
  eq('legacy backup seeds the default levels', mig.settings.levels.map(l => l.name).join(','), 'Tunga,Bhadra,Kaveri');
  eq('legacy Tunga name maps to tunga id', mig.teams.find(t => t.id === 'A1').level, 'tunga');
  eq('legacy Bhadra name maps to bhadra id', mig.teams.find(t => t.id === 'A2').level, 'bhadra');
  eq('legacy Kaveri name maps to kaveri id', mig.teams.find(t => t.id === 'B1').level, 'kaveri');

  // importing the legacy document through the real import path works too
  const r = TM.importJSON(JSON.stringify(legacy));
  check('legacy backup imports', r.ok, r.msg);
  eq('imported Kaveri pair kept its level', TM.getTeam('B2').level, 'kaveri');

  // a legacy list of bare level strings is normalized
  const mig2 = TM.migrate({ teams: [{ id: 'A1', group: 'A', name: 'X & Y', players: ['X', 'Y'], level: 'Tunga' }], matches: [], settings: { levels: ['Tunga', 'Bhadra', 'Kaveri'] } });
  eq('string level list normalized to ids', mig2.settings.levels.map(l => l.id).join(','), 'tunga,bhadra,kaveri');

  // a team whose level no longer exists falls back to Unassigned (never breaks)
  const mig3 = TM.migrate({ teams: [{ id: 'A1', group: 'A', name: 'X & Y', players: ['X', 'Y'], level: 'GhostLevel' }], matches: [] });
  eq('unknown legacy level -> Unassigned', mig3.teams[0].level, 'unassigned');
})();

/* ── 23. one source of truth for level options ─────────── */
(function () {
  // The UI must not define its own level list. The only level names in the app are
  // the DEFAULT_LEVELS seed and the two defaults documentations; all rendering reads
  // TM.selectableLevels()/TM.levels(). Guard against a regression that re-introduces
  // a hard-coded array in the UI layer.
  const src = html;
  check('UI reads configured levels from TM.selectableLevels', /TM\.selectableLevels\(\)/.test(src));
  check('no legacy TM.LEVELS reference remains', !/TM\.LEVELS\b/.test(src));
  check('no constant LEVELS array remains', !/const LEVELS = /.test(src));

  // dropdown options equal the configured set in every case
  TM.resetTournament();
  const opts = TM.selectableLevels().map(l => l.name);
  eq('dropdown options come from settings', opts.join(','), TM.levels().map(l => l.name).join(',') + ',Unassigned');
  // and the settings screen count is the same derived count
  eq('settings count = assignment count', TM.levelCounts().kaveri,
    TM.getState().teams.filter(t => t.level === 'kaveri').length);
})();

/* ══════════════════════════════════════════════════════════
   30. dynamic tournament engine — arbitrary pair counts
   ══════════════════════════════════════════════════════════ */

// Build a fully-specified team list { A: n, B: m, ... }.
function makeTeams(counts) {
  const teams = [];
  Object.keys(counts).forEach(g => {
    for (let i = 1; i <= counts[g]; i++) {
      teams.push({ id: g + i, group: g, name: 'Pair ' + g + i, players: ['P' + g + i + 'a', 'P' + g + i + 'b'], level: 'unassigned' });
    }
  });
  return teams;
}

// Verify that a group's fixtures form a correct round-robin.
function assertRoundRobin(label, groupId, n) {
  const gm = TM.groupMatches(groupId);
  eq(label + ' group ' + groupId + ' match count N(N-1)/2', gm.length, n * (n - 1) / 2);
  const seen = new Set();
  const played = {};
  gm.forEach(mm => {
    const key = [mm.teamA, mm.teamB].sort().join('|');
    check(label + ' no duplicate pairing ' + key, !seen.has(key));
    seen.add(key);
    check(label + ' no self-match ' + mm.id, mm.teamA !== mm.teamB);
    check(label + ' both teams present ' + mm.id, !!mm.teamA && !!mm.teamB);
    check(label + ' ids are real teams ' + mm.id, !!TM.getTeam(mm.teamA) && !!TM.getTeam(mm.teamB));
    played[mm.teamA] = (played[mm.teamA] || 0) + 1;
    played[mm.teamB] = (played[mm.teamB] || 0) + 1;
  });
  TM.teamsInGroup(groupId).forEach(t => {
    eq(label + ' team ' + t.id + ' plays every other pair (' + (n - 1) + ')', played[t.id], n - 1);
  });
  eq(label + ' distinct pairings for group ' + groupId, seen.size, n * (n - 1) / 2);
}

(function () {
  // 1 pair counts and their round-robin match totals
  [
    { counts: { A: 2 }, gm: 1 },
    { counts: { A: 3 }, gm: 3 },
    { counts: { A: 4 }, gm: 6 },
    { counts: { A: 5 }, gm: 10 },
    { counts: { A: 6 }, gm: 15 }
  ].forEach(sc => {
    TM.resetTournament();
    const r = TM.applyTeams(makeTeams(sc.counts), { regenerate: true });
    check('single-group applyTeams ok ' + JSON.stringify(sc.counts), r.ok, r.msg);
    const g = Object.keys(sc.counts)[0];
    assertRoundRobin('n=' + sc.counts[g], g, sc.counts[g]);
    eq('n=' + sc.counts[g] + ' total group matches', TM.totalGroupMatchCount(), sc.gm);
    eq('n=' + sc.counts[g] + ' progress group total', TM.progress().groupTotal, sc.gm);
  });

  // 2 pairs in one group. The default configuration has a configured Group B too,
  // so a genuine single-group tournament removes the (empty) Group B first.
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 2 }), { regenerate: true, groups: ['A'] });
  eq('2 pairs: 1 group', TM.groupIds().length, 1);
  eq('2 pairs: 1 match', TM.groupMatches().length, 1);

  // 3 pairs: 3 matches, all pairs play 2
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 3 }), { regenerate: true });
  eq('3 pairs: 3 matches', TM.groupMatches().length, 3);

  // 4 pairs: 6 matches
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 4 }), { regenerate: true });
  eq('4 pairs: 6 matches', TM.groupMatches().length, 6);

  // 5 pairs: 10 matches
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 5 }), { regenerate: true });
  eq('5 pairs: 10 matches', TM.groupMatches().length, 10);

  // 6 pairs: 15 matches
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 6 }), { regenerate: true });
  eq('6 pairs: 15 matches', TM.groupMatches().length, 15);

  // 8 pairs 4+4 => 6 + 6 = 12
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 4, B: 4 }), { regenerate: true });
  eq('8 pairs: distribution', JSON.stringify(TM.groupDistribution()), JSON.stringify({ A: 4, B: 4 }));
  assertRoundRobin('8p', 'A', 4);
  assertRoundRobin('8p', 'B', 4);
  eq('8 pairs: 12 group matches', TM.totalGroupMatchCount(), 12);

  // 9 pairs 5+4 => 10 + 6 = 16
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 5, B: 4 }), { regenerate: true });
  eq('9 pairs: distribution', JSON.stringify(TM.groupDistribution()), JSON.stringify({ A: 5, B: 4 }));
  assertRoundRobin('9p', 'A', 5);
  assertRoundRobin('9p', 'B', 4);
  eq('9 pairs: 16 group matches', TM.totalGroupMatchCount(), 16);

  // 10 pairs 5+5 => 10 + 10 = 20 (the default example)
  TM.resetTournament();
  TM.buildDefaultTournament();
  assertRoundRobin('10p default', 'A', 5);
  assertRoundRobin('10p default', 'B', 5);
  eq('10 pairs: 20 group matches', TM.totalGroupMatchCount(), 20);

  // dynamic match ids: a 4-pair group only ever reaches A-06
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 4, B: 4 }), { regenerate: true });
  const aIds = TM.groupMatches('A').map(mm => mm.id);
  eq('4-pair group ids A-01..A-06', aIds.join(','), 'A-01,A-02,A-03,A-04,A-05,A-06');
  check('no A-07..A-10 for a 4-pair group', !aIds.some(id => ['A-07', 'A-08', 'A-09', 'A-10'].includes(id)));
  const bIds = TM.groupMatches('B').map(mm => mm.id);
  eq('4-pair group B ids B-01..B-06', bIds.join(','), 'B-01,B-02,B-03,B-04,B-05,B-06');

  // 6 pairs -> ids through A-15
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 6 }), { regenerate: true });
  const sixIds = TM.groupMatches('A').map(mm => mm.id);
  eq('6-pair group starts A-01', sixIds[0], 'A-01');
  eq('6-pair group ends A-15', sixIds[sixIds.length - 1], 'A-15');

  // byes never appear in group fixtures
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 5 }), { regenerate: true });
  check('no group fixture is a bye', TM.groupMatches().every(mm => !mm.bye));
})();

/* ── 31. state model is generic (no fixed 10 / 5 / 20) ──── */
(function () {
  const src = html;
  check('no teams.length === 10 assumption', !/teams\.length\s*===\s*10/.test(src));
  check('no groups.A.length === 5 assumption', !/groups\.A\.length\s*===\s*5/.test(src));
  check('no groups.B.length === 5 assumption', !/groups\.B\.length\s*===\s*5/.test(src));
  check('no hard-coded 20 group matches label', !/20 group matches/i.test(src));
  check('no hard-coded "27 matches"', !/\b27\s*match/i.test(src));
  check('score target 21 preserved as a rule', TM.GROUP_TARGET === 21);
})();

/* ── 32. pair management ───────────────────────────────── */
(function () {
  TM.resetTournament();
  const before = TM.getState().teams.length;
  const add = TM.addTeam({ id: 'A11', group: 'A', name: 'New & Pair', players: ['New', 'Pair'], level: 'unassigned' });
  check('add pair ok', add.ok, add.msg);
  eq('add pair increases count', TM.getState().teams.length, before + 1);
  eq('add pair regenerates fixtures', TM.groupMatches().length, TM.totalGroupMatchCount());

  const rm = TM.removeTeam('A11');
  check('remove pair ok', rm.ok, rm.msg);
  eq('remove pair restores count', TM.getState().teams.length, before);

  // removing two from the default 10 yields an 8-pair tournament, no placeholders
  TM.resetTournament();
  TM.removeTeam('A5');
  TM.removeTeam('B5');
  eq('remove two -> 8 pairs', TM.getState().teams.length, 8);
  eq('remove two -> group A size 4', TM.getState().groups.A.length, 4);
  eq('remove two -> group B size 4', TM.getState().groups.B.length, 4);
  eq('remove two -> 12 group matches', TM.totalGroupMatchCount(), 12);
  check('no orphan fixtures', TM.groupMatches().every(mm => TM.getTeam(mm.teamA) && TM.getTeam(mm.teamB)));

  // rename pair + edit players (non-structural, never regenerates)
  TM.resetTournament();
  const upd = TM.updateTeam('A1', { name: 'Renamed & Pair', players: ['Renamed', 'Pair'] });
  check('rename pair ok', upd.ok, upd.msg);
  eq('rename pair name', TM.getTeam('A1').name, 'Renamed & Pair');
  eq('edit player 1', TM.getTeam('A1').players[0], 'Renamed');
  eq('rename does not regenerate', upd.regenerated, false);

  // move pair between groups (structural)
  TM.resetTournament();
  const moved = TM.assignTeamToGroup('A5', 'B', { regenerate: true });
  check('move pair between groups ok', moved.ok, moved.msg);
  eq('moved pair group', TM.getTeam('A5').group, 'B');
  eq('move reflects in distribution A', TM.groupDistribution().A, 4);
  eq('move reflects in distribution B', TM.groupDistribution().B, 6);
  eq('move regenerates matches', TM.totalGroupMatchCount(), 6 + 15);
})();

/* ── 33. regeneration guards and safety ────────────────── */
(function () {
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 4, B: 4 }), { regenerate: true });
  // complete one match so results exist
  const first = TM.groupMatches()[0];
  TM.saveGroupScore(first.id, 21, 12);
  eq('one result recorded', TM.progress().groupDone, 1);

  // structural change without regenerate -> needsConfirmation, nothing changes
  const blocked = TM.removeTeam('B4');
  check('structural change after results needs confirmation', blocked.needsConfirmation === true, JSON.stringify(blocked));
  eq('count unchanged after blocked change', TM.getState().teams.length, 8);
  eq('results preserved after blocked change', TM.progress().groupDone, 1);

  // explicit regenerate clears results safely and rebuilds for the new shape
  const plan = TM.regeneratePlan();
  eq('plan pairs', plan.pairs, 8);
  eq('plan existing results', plan.existingResults, 1);
  const regen = TM.regenerateFixtures();
  check('regenerate ok', regen.ok, regen.msg);
  eq('regenerate clears results', TM.progress().groupDone, 0);
  eq('regenerate keeps fixtures for 8 pairs', TM.groupMatches().length, 12);

  // with regenerate:true the structural change + rebuild happens in one call
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 5, B: 5 }), { regenerate: true });
  TM.saveGroupScore(TM.groupMatches()[0].id, 21, 12);
  const forced = TM.removeTeam('B5', { regenerate: true });
  check('forced removal after results ok', forced.ok, forced.msg);
  eq('forced removal -> 9 pairs', TM.getState().teams.length, 9);
  eq('forced removal -> 16 group matches', TM.totalGroupMatchCount(), 16);
  eq('forced removal cleared results', TM.progress().groupDone, 0);
})();

/* ── 34. qualification configuration ───────────────────── */
(function () {
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 4, B: 4 }), { regenerate: true });
  const q = TM.setQualification(2);
  check('set qualification 2 ok', q.ok, q.msg);
  eq('qualification read back', TM.getQualification().perGroup, 2);
  eq('qualified per group A', TM.qualifiedPerGroup().A, 2);
  eq('qualified per group B', TM.qualifiedPerGroup().B, 2);
  eq('predicted knockout 4 qualifiers -> 3 matches', TM.predictedKnockoutTotal(), 3);

  // cannot exceed largest group
  const bad = TM.setQualification(9);
  check('qualification above group size rejected', !bad.ok, bad.msg);

  // 8 pairs top 2 => SF + Final, no QF
  const gm = TM.groupMatches();
  gm.forEach(mm => TM.saveGroupScore(mm.id, mm.teamA < mm.teamB ? 21 : 12, mm.teamA < mm.teamB ? 12 : 21));
  ensureBracket();
  const info = TM.knockoutInfo();
  check('8p top2: no quarter-finals', !info.rounds.qf.exists);
  check('8p top2: semi-finals exist', info.rounds.sf.exists);
  check('8p top2: bracket structure ends in a Final', TM.bracketRounds(4).some(r => r.key === 'final'));
  eq('8p top2: 4 qualifiers', Object.keys(info.qualifiers).reduce((t, g) => t + info.qualifiers[g].length, 0), 4);
  eq('8p top2: knockout total 3', TM.progress().knockoutTotal, 3);
  eq('8p top2: overall total 15', TM.progress().overallTotal, 15);
  check('8p top2: no fake teams in bracket', TM.getState().matches.filter(mm => mm.stage !== 'group').every(mm => !mm.teamA || !!TM.getTeam(mm.teamA)));

  // changing qualification after the bracket exists is refused
  const late = TM.setQualification(3);
  check('qualification change after bracket refused', !late.ok, late.msg);
})();

/* ── 35. knockout bracket generation for each qualifier size ─ */
(function () {
  function playThrough(counts, perGroup) {
    TM.resetTournament();
    TM.applyTeams(makeTeams(counts), { regenerate: true });
    if (perGroup != null) TM.setQualification(perGroup);
    TM.groupMatches().forEach(mm => TM.saveGroupScore(mm.id, mm.teamA < mm.teamB ? 21 : 12, mm.teamA < mm.teamB ? 12 : 21));
    let info = TM.knockoutInfo();
    let guard = 0;
    while (!info.champion && guard++ < 40) {
      const ko = TM.getState().matches.filter(mm => mm.stage !== 'group' && mm.status === 'queued' && mm.teamA && mm.teamB && !mm.bye);
      if (!ko.length) { ensureBracket(); info = TM.knockoutInfo(); continue; }
      ko.forEach(mm => {
        const t = mm.target || 11;
        TM.saveKnockoutScore(mm.id, [{ a: t, b: t - 4 }, { a: t, b: t - 6 }]);
      });
      info = TM.knockoutInfo();
    }
    return info;
  }

  // 2 qualifiers -> Final only
  let info = playThrough({ A: 2 }, 2);
  check('2 qualifiers: final exists', info.rounds.final.exists);
  check('2 qualifiers: no semi-finals', !info.rounds.sf.exists);
  check('2 qualifiers: champion decided', !!info.champion, 'no champion');

  // 4 qualifiers -> SF + Final
  info = playThrough({ A: 4 }, 4);
  check('4 qualifiers: sf exists', info.rounds.sf.exists);
  check('4 qualifiers: no qf', !info.rounds.qf.exists);
  check('4 qualifiers: champion decided', !!info.champion);

  // 8 qualifiers -> QF + SF + Final (default 10-pair scenario, top 4 each)
  info = playThrough({ A: 5, B: 5 }, 4);
  check('8 qualifiers: qf exists', info.rounds.qf.exists);
  check('8 qualifiers: sf exists', info.rounds.sf.exists);
  check('8 qualifiers: champion decided', !!info.champion);
  eq('8 qualifiers: 7 knockout matches', TM.progress().knockoutTotal, 7);
  eq('10-pair default: overall 27', TM.progress().overallTotal, 27);

  // 16 qualifiers -> Round of 16 onward
  info = playThrough({ A: 8, B: 8 }, 8);
  check('16 qualifiers: r16 exists', info.rounds.r16.exists);
  check('16 qualifiers: champion decided', !!info.champion);
  eq('16 qualifiers: 15 knockout matches', TM.progress().knockoutTotal, 15);

  // non-power-of-two qualifier count gets byes, never a fake match
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 5, B: 5 }), { regenerate: true });
  TM.setQualification(3); // 6 qualifiers
  TM.groupMatches().forEach(mm => TM.saveGroupScore(mm.id, mm.teamA < mm.teamB ? 21 : 12, mm.teamA < mm.teamB ? 12 : 21));
  ensureBracket();
  const byeMatches = TM.getState().matches.filter(mm => mm.stage !== 'group' && mm.bye);
  check('6 qualifiers: byes created', byeMatches.length === 2, 'got ' + byeMatches.length);
  check('byes have no opponent', byeMatches.every(mm => !mm.teamA || !mm.teamB));
  check('byes auto-advance a real team', byeMatches.every(mm => !!TM.getTeam(mm.teamA || mm.teamB)));
  check('bye is recorded as completed', byeMatches.every(mm => mm.status === 'completed'));
  eq('6 qualifiers: predicted knockout matches', TM.predictedKnockoutTotal(), 5);
  check('bye cannot be started', !TM.startMatch(byeMatches[0].id, 1, NOON).ok);
  check('bye cannot be scored', !TM.saveKnockoutScore(byeMatches[0].id, [{ a: 11, b: 5 }, { a: 11, b: 5 }]).ok);
  check('bye cannot be reset', !TM.resetMatch(byeMatches[0].id).ok);
  check('bye advances without a fake opponent', byeMatches.every(mm => !mm.teamA || !mm.teamB));
})();

/* ── 36. standings for any group size ──────────────────── */
(function () {
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 6, B: 3 }), { regenerate: true });
  eq('standings rows = group A size 6', TM.computeStandings('A').length, 6);
  eq('standings rows = group B size 3', TM.computeStandings('B').length, 3);
  ['A', 'B'].forEach(g => {
    const rows = TM.computeStandings(g);
    rows.forEach(r => {
      check('row has position fields ' + g, typeof r.pts === 'number' && typeof r.played === 'number' && typeof r.diff === 'number');
      check('row has played/won/lost ' + g, ['played', 'won', 'lost', 'pts', 'pf', 'pa', 'diff'].every(k => r[k] !== undefined));
    });
    rows.forEach(r => eq('unbeaten rows start 0 played ' + g + r.team.id, r.played, 0));
  });

  // after results, standings reflect real play
  TM.groupMatches('B').forEach(mm => TM.saveGroupScore(mm.id, 21, 15));
  const rowsB = TM.computeStandings('B');
  eq('standings preserve 3 rows after play', rowsB.length, 3);
  eq('total played counts both sides', rowsB.reduce((t, r) => t + r.played, 0), 6);
})();

/* ── 37. scheduler works with any match count ──────────── */
(function () {
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 4, B: 4 }), { regenerate: true });
  eq('scheduler sees 12 queued matches', TM.queuedMatches().length, 12);
  // start several and verify the invariants hold regardless of total
  const started = [];
  let guard = 0;
  while (started.length < 4 && guard++ < 20) {
    const sug = TM.suggestCourts(NOON);
    const ids = Object.keys(sug);
    if (!ids.length) break;
    let progressed = false;
    ids.forEach(cid => {
      const r = TM.startMatch(sug[cid].match.id, Number(cid), NOON);
      if (r.ok) { started.push(sug[cid].match.id); progressed = true; }
    });
    if (!progressed) break;
  }
  check('scheduler started matches', started.length > 0, 'started ' + started.length);
  // no team on two courts
  const busy = {};
  let conflict = false;
  TM.getState().matches.filter(mm => mm.status === 'in_progress').forEach(mm => {
    [mm.teamA, mm.teamB].forEach(t => { if (busy[t]) conflict = true; busy[t] = true; });
  });
  check('scheduler: no team on two courts', !conflict);
  // no court double booking
  const courts = {};
  let doubleBook = false;
  TM.getState().matches.filter(mm => mm.status === 'in_progress').forEach(mm => {
    if (courts[mm.court]) doubleBook = true; courts[mm.court] = true;
  });
  check('scheduler: no court double booking', !doubleBook);
  // deterministic: same suggestion twice on a fresh 12-match queue
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 4, B: 4 }), { regenerate: true });
  const s1 = JSON.stringify(TM.suggestCourts(NOON));
  const s2 = JSON.stringify(TM.suggestCourts(NOON));
  eq('scheduler selection is deterministic', s1, s2);
  check('scheduler offers distinct matches per court', new Set(Object.keys(TM.suggestCourts(NOON)).map(k => TM.suggestCourts(NOON)[k].match.id)).size === Object.keys(TM.suggestCourts(NOON)).length);
  // disabled courts ignored
  const st = TM.getState();
  const d = st.courts[0];
  TM.setCourtEnabled(d.id, false);
  check('disabled court not offered', !TM.enabledCourts().some(c => c.id === d.id));
  check('disabled court absent from suggestions', TM.suggestCourts(NOON)[d.id] === undefined);
  eq('disabled reduces enabled courts', TM.enabledCourts().length, st.courts.length - 1);
  TM.setCourtEnabled(d.id, true);
})();

/* ── 38. dashboard progress is dynamic ─────────────────── */
(function () {
  function expected(counts, per) {
    TM.resetTournament();
    TM.applyTeams(makeTeams(counts), { regenerate: true });
    if (per != null) TM.setQualification(per);
    const p = TM.progress();
    return p;
  }
  let p = expected({ A: 4, B: 4 }, 2);
  eq('8p 4/4 progress groupTotal', p.groupTotal, 12);
  eq('8p 4/4 progress overallTotal', p.overallTotal, 15);

  p = expected({ A: 5, B: 4 }, 4);
  eq('9p 5/4 progress groupTotal', p.groupTotal, 16);
  eq('9p 5/4 progress overallTotal', p.overallTotal, 23);

  p = expected({ A: 5, B: 5 }, 4);
  eq('10p 5/5 progress groupTotal', p.groupTotal, 20);
  eq('10p 5/5 progress overallTotal', p.overallTotal, 27);
  eq('10p 5/5 default matches 27 (config, not constant)', TM.getTotalMatchCount().total, 27);

  // dashboard label reflects partial progress correctly
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 5, B: 4 }), { regenerate: true });
  TM.setQualification(4);
  TM.groupMatches().slice(0, 7).forEach(mm => TM.saveGroupScore(mm.id, 21, 15));
  p = TM.progress();
  eq('partial progress groupDone', p.groupDone, 7);
  eq('partial progress label "7 / 16"', p.groupDone + ' / ' + p.groupTotal, '7 / 16');
})();

/* ── 39. levels independent of groups; courts independent ── */
(function () {
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 4, B: 4 }), { regenerate: true });
  // levels derived from assignments, not from group membership
  TM.updateTeam('A1', { level: 'tunga' });
  TM.updateTeam('A2', { level: 'tunga' });
  TM.updateTeam('B1', { level: 'bhadra' });
  const counts = TM.levelCounts();
  eq('level count tunga = 2', counts.tunga, 2);
  eq('level count bhadra = 1', counts.bhadra, 1);
  eq('unassigned derived', TM.hasUnassignedTeams(), true);
  // moving a team between groups never changes its level
  TM.assignTeamToGroup('A1', 'B', { regenerate: true });
  eq('level survives group move', TM.getTeam('A1').level, 'tunga');

  // courts remain independent of pair count
  TM.applyTeams(makeTeams({ A: 3 }), { regenerate: true });
  eq('courts still 3 with 3 pairs', TM.getState().courts.length, 3);
  const ok = TM.setCourtCount(5);
  check('court count independent of pairs', ok.ok, ok.msg);
  eq('courts now 5', TM.getState().courts.length, 5);
})();

/* ── 40. end-to-end scenarios A/B/C ────────────────────── */
(function () {
  function runScenario(label, counts, perGroup, expectGroup, expectOverall) {
    TM.resetTournament();
    const applied = TM.applyTeams(makeTeams(counts), { regenerate: true });
    check(label + ': apply ok', applied.ok, applied.msg);
    if (perGroup != null) { const q = TM.setQualification(perGroup); check(label + ': qualification ok', q.ok, q.msg); }
    eq(label + ': group matches', TM.totalGroupMatchCount(), expectGroup);

    // group stage
    TM.groupMatches().forEach(mm => {
      const winA = mm.teamA < mm.teamB;
      TM.saveGroupScore(mm.id, winA ? 21 : 15, winA ? 15 : 21);
    });
    eq(label + ': group stage complete', TM.groupStageComplete(), true);
    check(label + ': no group fixture left queued', TM.groupMatches().every(mm => mm.status === 'completed'));

    // knockout to champion
    let info = TM.knockoutInfo();
    let guard = 0;
    while (!info.champion && guard++ < 40) {
      const ko = TM.getState().matches.filter(mm => mm.stage !== 'group' && mm.status === 'queued' && mm.teamA && mm.teamB && !mm.bye);
      if (!ko.length) { ensureBracket(); info = TM.knockoutInfo(); continue; }
      ko.forEach(mm => {
        const t = mm.target || 11;
        TM.saveKnockoutScore(mm.id, [{ a: t, b: t - 3 }, { a: t, b: t - 5 }]);
      });
      info = TM.knockoutInfo();
    }
    check(label + ': champion crowned', !!info.champion, 'no champion');
    check(label + ': champion is a real team', !!TM.getTeam(info.champion));
    eq(label + ': overall total', TM.progress().overallTotal, expectOverall);
    eq(label + ': overall complete', TM.progress().overallDone, expectOverall);
    eq(label + ': 100%', TM.progress().pct, 100);
    check(label + ': no orphan matches', TM.getState().matches.every(mm => (!mm.teamA || !!TM.getTeam(mm.teamA)) && (!mm.teamB || !!TM.getTeam(mm.teamB))));
  }

  runScenario('Scenario A (8 pairs 4+4)', { A: 4, B: 4 }, 2, 12, 15);
  runScenario('Scenario B (9 pairs 5+4)', { A: 5, B: 4 }, 4, 16, 23);
  runScenario('Scenario C (10 pairs 5+5)', { A: 5, B: 5 }, 4, 20, 27);

  // Scenario A must NOT produce QF, 20 group matches or 27 total
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 4, B: 4 }), { regenerate: true });
  TM.setQualification(2);
  TM.groupMatches().forEach(mm => TM.saveGroupScore(mm.id, 21, 15));
  ensureBracket();
  const infoA = TM.knockoutInfo();
  check('Scenario A: no QF matches', !infoA.rounds.qf.exists);
  eq('Scenario A: 12 not 20 group matches', TM.totalGroupMatchCount(), 12);
  eq('Scenario A: 15 not 27 total matches', TM.progress().overallTotal, 15);
})();

/* ── 41. persistence, export and import ────────────────── */
(function () {
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 4, B: 4 }), { regenerate: true });
  TM.setQualification(2);
  TM.groupMatches()[0] && TM.saveGroupScore(TM.groupMatches()[0].id, 21, 13);
  const snapshot = TM.exportJSON();

  // reload from storage
  TM.load();
  eq('persist: 8 pairs survive reload', TM.getState().teams.length, 8);
  eq('persist: qualification survives reload', TM.getQualification().perGroup, 2);
  eq('persist: fixtures survive reload', TM.groupMatches().length, 12);
  eq('persist: result survives reload', TM.progress().groupDone, 1);

  // import the exported backup into a fresh state
  TM.resetTournament();
  const imp = TM.importJSON(snapshot);
  check('import ok', imp.ok, imp.msg);
  eq('import: 8 pairs', TM.getState().teams.length, 8);
  eq('import: 12 fixtures', TM.groupMatches().length, 12);
})();

/* ── 42. createTournament(config) entry point ───────────── */
(function () {
  // Build a 9-pair tournament entirely from config — name, pairs, groups,
  // qualification and court count.
  const pairs = [];
  for (let i = 1; i <= 5; i++) pairs.push({ name: 'Pair A' + i, players: ['a' + i, 'b' + i], level: 'tunga', group: 'A' });
  for (let i = 1; i <= 4; i++) pairs.push({ name: 'Pair B' + i, players: ['c' + i, 'd' + i], level: 'bhadra', group: 'B' });
  const r = TM.createTournament({
    name: 'Yelahanka Badminton Tournament',
    pairs: pairs,
    qualification: { perGroup: 4 },
    courts: 4
  });
  check('createTournament ok', r.ok, r.msg);
  eq('createTournament name', TM.getState().tournament.name, 'Yelahanka Badminton Tournament');
  eq('createTournament 9 pairs', TM.getState().teams.length, 9);
  eq('createTournament distribution', JSON.stringify(TM.groupDistribution()), JSON.stringify({ A: 5, B: 4 }));
  eq('createTournament group matches', TM.totalGroupMatchCount(), 16);
  eq('createTournament qualification', TM.getQualification().perGroup, 4);
  eq('createTournament courts', TM.getState().courts.length, 4);
  check('createTournament ids derived from group', !!TM.getTeam('A1') && !!TM.getTeam('B4'));
  eq('createTournament players preserved', TM.getTeam('A1').players.join('&'), 'a1&b1');
  eq('createTournament level preserved', TM.getTeam('A1').level, 'tunga');
  eq('createTournament no fake teams', TM.getState().teams.filter(t => !t.name).length, 0);

  // A qualifier count that does not fit the largest group is rejected.
  const bad = TM.createTournament({ name: 'x', pairs: [{ name: 'a', group: 'A' }, { name: 'b', group: 'A' }], qualification: 5 });
  check('createTournament rejects oversized qualification', !bad.ok, bad.msg);

  // A 3-group tournament is supported (groups are not fixed at A/B).
  const three = TM.createTournament({
    pairs: [
      { name: 'a1', group: 'A' }, { name: 'a2', group: 'A' },
      { name: 'b1', group: 'B' }, { name: 'b2', group: 'B' },
      { name: 'c1', group: 'C' }, { name: 'c2', group: 'C' }
    ]
  });
  check('createTournament 3 groups ok', three.ok, three.msg);
  eq('createTournament 3 groups', TM.groupIds().length, 3);
  eq('createTournament 3 one-match groups', TM.totalGroupMatchCount(), 3);
})();

/* ── 43. dynamic group management ──────────────────────── */
(function () {
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 4, B: 4 }), { regenerate: true });
  eq('baseline: 2 groups', TM.groupIds().join(','), 'A,B');
  eq('baseline: 12 group matches', TM.totalGroupMatchCount(), 12);

  // add an empty group: no pair is moved, no fixture changes
  const add = TM.addGroup();
  check('addGroup ok', add.ok, add.msg);
  eq('addGroup -> 3 groups', TM.groupIds().join(','), 'A,B,C');
  eq('addGroup does not move a pair', JSON.stringify(TM.groupDistribution()), JSON.stringify({ A: 4, B: 4, C: 0 }));
  eq('addGroup does not add fixtures', TM.groupMatches().length, 12);
  eq('empty group has 0 matches', TM.getGroupMatchCount('C'), 0);

  // A single pair cannot form a one-pair group, so moving just one pair into the
  // new group is rejected; the group stays empty and fixtures are untouched.
  const mv = TM.assignTeamToGroup('A4', 'C', { regenerate: true });
  check('move 1 pair into C is rejected (needs 2)', !mv.ok, JSON.stringify(mv));
  eq('C stays empty after rejected move', TM.groupDistribution().C, 0);
  // Moving two pairs in is valid and regenerates the fixtures for the new shape.
  const teamsMoved = TM.getState().teams.map(t => ({ id: t.id, group: t.group, name: t.name, players: t.players, level: t.level }));
  teamsMoved.find(t => t.id === 'A4').group = 'C';
  teamsMoved.find(t => t.id === 'A3').group = 'C';
  const applied = TM.applyTeams(teamsMoved, { regenerate: true, groups: ['A', 'B', 'C'] });
  check('move two pairs into C ok', applied.ok, applied.msg);
  eq('A now 2', TM.groupDistribution().A, 2);
  eq('C now 2', TM.groupDistribution().C, 2);
  eq('group matches = 1 + 6 + 1', TM.totalGroupMatchCount(), 8);

  // removing a non-empty group is blocked
  const bad = TM.removeGroup('C');
  check('remove non-empty group blocked', !bad.ok, JSON.stringify(bad));
  eq('blocked removal keeps C', TM.groupIds().indexOf('C') !== -1, true);

  // removing an empty group is allowed and harmless
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 4, B: 4 }), { regenerate: true });
  TM.addGroup();
  const rm = TM.removeGroup('C');
  check('remove empty group ok', rm.ok, rm.msg);
  eq('remove empty group -> 2 groups', TM.groupIds().join(','), 'A,B');
  eq('remove empty group keeps fixtures', TM.groupMatches().length, 12);

  // the last group cannot be removed
  const oneLeft = TM.removeGroup('B');
  check('cannot remove a non-empty group', !oneLeft.ok);
  const lone = TM.removeGroup('A');
  check('cannot remove a non-empty group A', !lone.ok);

  // group ids are stable and increments are deterministic
  TM.resetTournament();
  TM.addGroup(); TM.addGroup();
  eq('stable sequential ids', TM.groupIds().join(','), 'A,B,C,D');

  // labels are cosmetic and never touch fixtures
  const rl = TM.renameGroup('A', 'Premier');
  check('rename group ok', rl.ok, rl.msg);
  eq('group label stored', TM.groupLabel('A'), 'Premier');
  eq('rename never changes fixtures', TM.groupMatches().length, 20);
  TM.renameGroup('A', '');
  eq('clearing label restores default', TM.groupLabel('A'), 'Group A');

  // max groups is enforced
  TM.resetTournament();
  let guard = 0;
  while (TM.groupIds().length < TM.MAX_GROUPS && guard++ < 20) TM.addGroup();
  const overflow = TM.addGroup();
  check('max groups enforced', !overflow.ok, JSON.stringify(overflow));
})();

/* ── 44. knockout bracket for every qualifier size ────── */
(function () {
  // Build a single group of `q` pairs so exactly q teams qualify, then play out the
  // bracket and confirm it is real (no fake matches) and internally consistent.
  function buildFor(q) {
    TM.resetTournament();
    TM.applyTeams(makeTeams({ A: q }), { regenerate: true, groups: ['A'] });
    TM.setQualification(q);
    TM.groupMatches().forEach(mm => TM.saveGroupScore(mm.id, mm.teamA < mm.teamB ? 21 : 15, mm.teamA < mm.teamB ? 15 : 21));
    ensureBracket();
  }

  [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16].forEach(function (q) {
    buildFor(q);
    const ko = TM.getState().matches.filter(mm => mm.stage !== 'group');
    const real = ko.filter(mm => !mm.bye);
    const byes = ko.filter(mm => mm.bye);
    eq('q=' + q + ': predicted knockout matches = q-1', TM.predictedKnockoutTotal(), q - 1);
    const pow2 = Math.pow(2, Math.ceil(Math.log2(Math.max(2, q))));
    eq('q=' + q + ': real matches + byes = first-round slots', real.length + byes.length, pow2 / 2);
    check('q=' + q + ': bracket has real matches', real.length > 0);
    check('q=' + q + ': no self matches', ko.every(mm => !mm.teamA || mm.teamA !== mm.teamB));
    check('q=' + q + ': no orphan matches', ko.every(mm => (!mm.teamA || !!TM.getTeam(mm.teamA)) && (!mm.teamB || !!TM.getTeam(mm.teamB))));
    check('q=' + q + ': byes never have two teams', byes.every(mm => !mm.teamA || !mm.teamB));
    check('q=' + q + ': byes auto-advance a real team', byes.every(mm => !!TM.getTeam(mm.teamA || mm.teamB)));
    check('q=' + q + ': bye is completed, not queued', byes.every(mm => mm.status === 'completed'));
    check('q=' + q + ': bye cannot be started', byes.every(mm => !TM.startMatch(mm.id, 1, NOON).ok));
    check('q=' + q + ': bye cannot be scored', byes.every(mm => !TM.saveKnockoutScore(mm.id, [{ a: 11, b: 5 }, { a: 11, b: 5 }]).ok));
    // byes must never inflate the progress totals
    eq('q=' + q + ': knockout total excludes byes', TM.progress().knockoutTotal, q - 1);

    // play through to a champion
    let info = TM.knockoutInfo();
    let guard = 0;
    while (!info.champion && guard++ < 60) {
      const pending = TM.getState().matches.filter(mm => mm.stage !== 'group' && mm.status === 'queued' && mm.teamA && mm.teamB && !mm.bye);
      if (!pending.length) { ensureBracket(); info = TM.knockoutInfo(); continue; }
      pending.forEach(mm => {
        const t = mm.target || 11;
        TM.saveKnockoutScore(mm.id, [{ a: t, b: t - 3 }, { a: t, b: t - 5 }]);
      });
      info = TM.knockoutInfo();
    }
    check('q=' + q + ': champion crowned', !!info.champion);
    check('q=' + q + ': champion is real', !!TM.getTeam(info.champion));
    eq('q=' + q + ': overall played equals overall total', TM.progress().overallDone, TM.progress().overallTotal);
  });

  // the correct rounds exist for the classic sizes
  buildFor(4);
  let info = TM.knockoutInfo();
  check('4 qualifiers: SF exists, no QF', info.sfExists && !info.qfExists);
  buildFor(8);
  info = TM.knockoutInfo();
  check('8 qualifiers: QF exists', info.qfExists);
  eq('8 qualifiers: 7 knockout matches', TM.progress().knockoutTotal, 7);
  buildFor(16);
  info = TM.knockoutInfo();
  check('16 qualifiers: R16 exists', info.rounds.r16.exists);
  eq('16 qualifiers: 15 knockout matches', TM.progress().knockoutTotal, 15);
  // 17-32 qualifiers previously produced no bracket at all; verify that is fixed
  buildFor(17);
  info = TM.knockoutInfo();
  check('17 qualifiers: a bracket exists', info.exists);
  eq('17 qualifiers: 16 knockout matches', TM.progress().knockoutTotal, 16);
  buildFor(24);
  eq('24 qualifiers: 23 knockout matches', TM.predictedKnockoutTotal(), 23);
})();

/* ── 45. scenario D: three groups of three ─────────────── */
(function () {
  TM.resetTournament();
  const teams = [];
  ['A', 'B', 'C'].forEach(function (g) {
    for (let i = 1; i <= 3; i++) teams.push({ id: g + i, group: g, name: 'Pair ' + g + i, players: ['a', 'b'], level: 'unassigned' });
  });
  const r = TM.applyTeams(teams, { regenerate: true, groups: ['A', 'B', 'C'] });
  check('Scenario D: apply ok', r.ok, r.msg);
  eq('Scenario D: 3 groups', TM.groupIds().length, 3);
  eq('Scenario D: 3 + 3 + 3 = 9 group matches', TM.totalGroupMatchCount(), 9);
  ['A', 'B', 'C'].forEach(g => assertRoundRobin('Scenario D', g, 3));
  eq('Scenario D: group A 3 matches', TM.groupMatches('A').length, 3);
  eq('Scenario D: group B 3 matches', TM.groupMatches('B').length, 3);
  eq('Scenario D: group C 3 matches', TM.groupMatches('C').length, 3);
  eq('Scenario D: no orphan matches', TM.getState().matches.every(mm => TM.getTeam(mm.teamA) && TM.getTeam(mm.teamB)), true);
})();

/* ── 46. scenario E: six qualifiers and their byes ─────── */
(function () {
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 5, B: 5 }), { regenerate: true });
  TM.setQualification(3); // top 3 from each = 6 qualifiers
  TM.groupMatches().forEach(mm => TM.saveGroupScore(mm.id, mm.teamA < mm.teamB ? 21 : 15, mm.teamA < mm.teamB ? 15 : 21));
  TM.generateKnockout();
  const info0 = TM.knockoutInfo();
  const qual = TM.getState().knockout.qualifiers;
  eq('Scenario E: 6 real qualifiers', qual.A.length + qual.B.length, 6);
  eq('Scenario E: 5 knockout matches', TM.progress().knockoutTotal, 5);
  eq('Scenario E: predicted 5', TM.predictedKnockoutTotal(), 5);
  const ko = TM.getState().matches.filter(mm => mm.stage !== 'group');
  const real = ko.filter(mm => !mm.bye);
  const byes = ko.filter(mm => mm.bye);
  eq('Scenario E: 2 byes to a 8-slot bracket', byes.length, 2);
  eq('Scenario E: 2 real QF matches', real.length, 2);
  check('Scenario E: no fake matches', ko.every(mm => !mm.teamA || !mm.teamB || mm.teamA !== mm.teamB));
  check('Scenario E: byes never queued', byes.every(mm => mm.status === 'completed'));
  check('Scenario E: real matches are queued', real.every(mm => mm.status === 'queued' || mm.status === 'completed'));

  // play to a champion, verifying the bye teams enter at the right round
  let info = info0;
  let guard = 0;
  while (!info.champion && guard++ < 40) {
    const pending = TM.getState().matches.filter(mm => mm.stage !== 'group' && mm.status === 'queued' && mm.teamA && mm.teamB && !mm.bye);
    if (!pending.length) { ensureBracket(); info = TM.knockoutInfo(); continue; }
    pending.forEach(mm => {
      const t = mm.target || 11;
      TM.saveKnockoutScore(mm.id, [{ a: t, b: t - 3 }, { a: t, b: t - 5 }]);
    });
    info = TM.knockoutInfo();
  }
  check('Scenario E: champion crowned', !!info.champion);
  eq('Scenario E: overall played = total', TM.progress().overallDone, TM.progress().overallTotal);
})();

/* ── 47. pair management validation ────────────────────── */
(function () {
  TM.resetTournament();
  // duplicate pair names are rejected tournament-wide
  const t = makeTeams({ A: 4, B: 4 });
  t[4].name = t[0].name;
  check('duplicate pair names rejected', !TM.applyTeams(t).ok);
  // empty pair names are rejected
  const t2 = makeTeams({ A: 4, B: 4 });
  t2[0].name = '   ';
  check('empty pair name rejected', !TM.applyTeams(t2).ok);
  // duplicate team ids are rejected
  const t3 = makeTeams({ A: 4, B: 4 });
  t3[1].id = t3[0].id;
  check('duplicate team id rejected', !TM.applyTeams(t3).ok);
  // an empty group assignment is rejected
  const t4 = makeTeams({ A: 4, B: 4 });
  t4[0].group = '';
  check('empty group assignment rejected', !TM.applyTeams(t4).ok);
  // below the minimum pair count
  check('below minimum pairs rejected', !TM.applyTeams(makeTeams({ A: 1 })).ok);
  // a group of exactly one pair is rejected (cannot round-robin)
  const t5 = makeTeams({ A: 4, B: 4 });
  t5.forEach(x => { if (x.group === 'B' && x.id !== 'B1') x.group = 'A'; });
  check('one-pair group rejected', !TM.applyTeams(t5).ok);
  // a pair assigned to an undeclared group is rejected when groups are declared
  check('undeclared group rejected with explicit list', !TM.applyTeams(makeTeams({ A: 4, B: 4 }), { groups: ['A'] }).ok);
  // validateGroups catches a mismatch directly
  const vg = TM.validateGroups(['A'], makeTeams({ A: 4, B: 4 }));
  check('validateGroups catches undeclared group', !vg.ok, JSON.stringify(vg));
  const vg2 = TM.validateGroups(['A', 'B'], makeTeams({ A: 4, B: 4 }));
  check('validateGroups accepts a valid config', vg2.ok, vg2.msg);
})();

/* ── 48. regeneration after results with detailed plan ── */
(function () {
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 5, B: 5 }), { regenerate: true });
  TM.setQualification(4);
  TM.groupMatches().slice(0, 7).forEach(mm => TM.saveGroupScore(mm.id, 21, 12));

  // plan reports current vs new detail without touching state
  const plan = TM.regeneratePlan();
  eq('plan: 10 pairs', plan.pairs, 10);
  eq('plan: existing fixtures 20', plan.existingFixtures, 20);
  eq('plan: existing results 7', plan.existingResults, 7);
  eq('plan: new fixtures for 10 pairs', plan.newFixtures, 20);
  eq('plan does not mutate results', TM.progress().groupDone, 7);

  // a structural change is refused without explicit regeneration
  const blocked = TM.removeTeam('A5');
  check('structural change needs confirmation', blocked.needsConfirmation === true, JSON.stringify(blocked));
  eq('results intact after refusal', TM.progress().groupDone, 7);
  eq('teams intact after refusal', TM.getState().teams.length, 10);

  // regenerate clears results and rebuilds for the current shape
  const regen = TM.regenerateFixtures();
  check('regenerate ok', regen.ok, regen.msg);
  eq('regenerate clears results', TM.progress().groupDone, 0);
  eq('regenerate keeps 20 fixtures', TM.groupMatches().length, 20);

  // non-structural edits never regenerate, even with results present
  TM.groupMatches().slice(0, 3).forEach(mm => TM.saveGroupScore(mm.id, 21, 12));
  const doneBefore = TM.progress().groupDone;
  const rename = TM.updateTeam('A1', { name: 'Renamed Pair', players: ['New1', 'New2'] });
  check('rename ok with results present', rename.ok, rename.msg);
  eq('rename did not regenerate', rename.regenerated, false);
  eq('rename preserved results', TM.progress().groupDone, doneBefore);
  const lv = TM.updateTeam('A1', { level: 'tunga' });
  check('level change ok with results', lv.ok, lv.msg);
  eq('level change did not regenerate', lv.regenerated, false);
  eq('level change preserved results', TM.progress().groupDone, doneBefore);

  // adding a pair after results requires confirmation, and cancelling keeps results
  const addRes = TM.addTeam({ id: 'A6', group: 'A', name: 'Extra Pair', players: ['x', 'y'], level: 'unassigned' });
  check('add pair after results needs confirmation', addRes.needsConfirmation === true, JSON.stringify(addRes));
  eq('cancelled add keeps results', TM.progress().groupDone, doneBefore);
  eq('cancelled add keeps pair count', TM.getState().teams.length, 10);
  // confirming regenerates and clears results, with no orphaned matches
  const forced = TM.addTeam({ id: 'A6', group: 'A', name: 'Extra Pair', players: ['x', 'y'], level: 'unassigned' }, { regenerate: true });
  check('forced add ok', forced.ok, forced.msg);
  eq('forced add -> 11 pairs', TM.getState().teams.length, 11);
  eq('forced add cleared results', TM.progress().groupDone, 0);
  check('forced add no orphan matches', TM.getState().matches.every(mm => TM.getTeam(mm.teamA) && TM.getTeam(mm.teamB)));
  eq('forced add regenerated fixtures for 11 pairs', TM.groupMatches().length, TM.totalGroupMatchCount());
})();

/* ── 49. group management persistence ──────────────────── */
(function () {
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 4, B: 4 }), { regenerate: true });
  TM.addGroup('C');
  TM.renameGroup('C', 'Consolation');
  TM.save();
  const snapshot = TM.exportJSON();

  TM.resetTournament();
  const imp = TM.importJSON(snapshot);
  check('group config import ok', imp.ok, imp.msg);
  eq('imported groups', TM.groupIds().join(','), 'A,B,C');
  eq('imported empty group survives', TM.groupDistribution().C, 0);
  eq('imported group label survives', TM.groupLabel('C'), 'Consolation');
  eq('imported fixtures unaffected by empty group', TM.groupMatches().length, 12);

  // an empty configured group must survive a plain reload too
  TM.save();
  TM.load();
  eq('reload keeps the empty group', TM.groupIds().join(','), 'A,B,C');
})();

/* ── 50. empty-group safety with existing results ──────── */
(function () {
  // Completing a group stage then adding/removing/renaming empty groups must
  // leave every completed result and every group fixture untouched.
  function seedResults(counts) {
    TM.resetTournament();
    TM.applyTeams(makeTeams(counts), { regenerate: true });
    TM.groupMatches().forEach(m => TM.saveGroupScore(m.id, m.teamA < m.teamB ? 21 : 12, m.teamA < m.teamB ? 12 : 21));
    return TM.getState().matches.filter(m => m.status === 'completed').length;
  }
  function snapshotCompleted() {
    return JSON.stringify(
      TM.getState().matches.filter(m => m.status === 'completed')
        .map(m => [m.id, m.teamA, m.teamB, m.scoreA, m.scoreB]).sort()
    );
  }

  // add empty group
  let done = seedResults({ A: 4, B: 4 });
  let sigBefore = snapshotCompleted();
  eq('results present before add group', done, 12);
  const beforeMatches = TM.groupMatches().length;
  const add = TM.addGroup('C');
  check('add empty group ok', add.ok, add.msg);
  eq('add empty group did not regenerate', add.regenerated, false);
  eq('add empty group kept completed results', snapshotCompleted(), sigBefore);
  eq('add empty group kept group fixtures', TM.groupMatches().length, beforeMatches);
  eq('add empty group added the container', TM.getState().groups.C.length, 0);
  check('add empty group needs no confirmation', add.needsConfirmation !== true);

  // rename group (label is cosmetic)
  const rename = TM.renameGroup('A', 'Alpha');
  check('rename group ok', rename.ok, rename.msg);
  eq('rename group kept completed results', snapshotCompleted(), sigBefore);
  eq('rename group kept group fixtures', TM.groupMatches().length, beforeMatches);
  eq('rename group label applied', TM.groupLabel('A'), 'Alpha');
  eq('rename group kept the group id', TM.getState().groups.A.length, 4);

  // remove the empty group
  const rm = TM.removeGroup('C');
  check('remove empty group ok', rm.ok, rm.msg);
  eq('remove empty group did not regenerate', rm.regenerated, false);
  eq('remove empty group kept completed results', snapshotCompleted(), sigBefore);
  eq('remove empty group kept group fixtures', TM.groupMatches().length, beforeMatches);
  check('remove empty group removed the container', !TM.getState().groups.C);

  // a group that still holds pairs cannot be removed
  const rmFull = TM.removeGroup('B');
  check('cannot remove a non-empty group', !rmFull.ok, rmFull.msg);
  eq('blocked removal kept results', snapshotCompleted(), sigBefore);

  // same guarantees once a knockout bracket exists
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 5, B: 5 }), { regenerate: true });
  TM.groupMatches().forEach(m => TM.saveGroupScore(m.id, m.teamA < m.teamB ? 21 : 12, m.teamA < m.teamB ? 12 : 21));
  ensureBracket();
  const koBefore = JSON.stringify(TM.getState().matches.filter(m => m.stage !== 'group').map(m => [m.id, m.teamA, m.teamB]));
  const completedKoBefore = TM.getState().matches.filter(m => m.status === 'completed').length;
  TM.addGroup('C');
  TM.renameGroup('C', 'Plate');
  eq('empty-group add keeps bracket intact', JSON.stringify(TM.getState().matches.filter(m => m.stage !== 'group').map(m => [m.id, m.teamA, m.teamB])), koBefore);
  eq('empty-group add keeps completed count', TM.getState().matches.filter(m => m.status === 'completed').length, completedKoBefore);
  TM.removeGroup('C');
  eq('empty-group remove keeps bracket intact', JSON.stringify(TM.getState().matches.filter(m => m.stage !== 'group').map(m => [m.id, m.teamA, m.teamB])), koBefore);

  // structural pair edits still require confirmation when results exist
  TM.resetTournament();
  done = seedResults({ A: 4, B: 4 });
  sigBefore = snapshotCompleted();
  const move = TM.assignTeamToGroup('A1', 'B');
  check('moving a pair after results needs confirmation', move.needsConfirmation === true, JSON.stringify(move));
  eq('blocked move kept results', snapshotCompleted(), sigBefore);
  eq('blocked move kept group membership', TM.getState().teams.find(t => t.id === 'A1').group, 'A');
  const removePair = TM.removeTeam('A1');
  check('removing a pair after results needs confirmation', removePair.needsConfirmation === true, JSON.stringify(removePair));
  eq('blocked removal kept results', snapshotCompleted(), sigBefore);
  const addPair = TM.addTeam({ id: 'A9', group: 'A', name: 'Extra', players: ['x', 'y'], level: 'unassigned' });
  check('adding a pair after results needs confirmation', addPair.needsConfirmation === true, JSON.stringify(addPair));
  eq('blocked add kept results', snapshotCompleted(), sigBefore);
  // confirming the move regenerates and clears results with no orphaned matches
  const moved = TM.assignTeamToGroup('A1', 'B', { regenerate: true });
  check('confirmed move ok', moved.ok, moved.msg);
  check('confirmed move regenerated', moved.regenerated === true);
  eq('confirmed move cleared results', TM.getState().matches.filter(m => m.status === 'completed').length, 0);
  check('confirmed move produced no orphan matches', TM.getState().matches.every(m => !m.teamA || TM.getTeam(m.teamA)));
  eq('confirmed move updated membership', TM.getState().teams.find(t => t.id === 'A1').group, 'B');
  eq('confirmed move regenerated 3+5 fixtures', TM.groupMatches().length, 13);
})();

/* ── 51. multi-group knockout: all groups contribute ───── */
(function () {
  // Play an entire tournament (group stage + knockout) to a champion and return
  // the structural facts about the bracket.
  function playToChampion(counts, perGroup) {
    TM.resetTournament();
    TM.applyTeams(makeTeams(counts), { regenerate: true });
    if (perGroup != null) TM.setQualification(perGroup);
    TM.groupMatches().forEach(m => TM.saveGroupScore(m.id, m.teamA < m.teamB ? 21 : 12, m.teamA < m.teamB ? 12 : 21));
    let info = TM.knockoutInfo();
    let guard = 0;
    while (!info.champion && guard++ < 60) {
      const ko = TM.getState().matches.filter(m => m.stage !== 'group' && m.status === 'queued' && m.teamA && m.teamB && !m.bye);
      if (!ko.length) { ensureBracket(); info = TM.knockoutInfo(); continue; }
      ko.forEach(m => { const t = m.target || 11; TM.saveKnockoutScore(m.id, [{ a: t, b: t - 4 }, { a: t, b: t - 6 }]); });
      info = TM.knockoutInfo();
    }
    const koMatches = TM.getState().matches.filter(m => m.stage !== 'group');
    const q = TM.getState().knockout.qualifiers || {};
    const allQ = [].concat(...Object.keys(q).map(g => q[g]));
    const inBracket = new Set(koMatches.map(m => m.teamA).concat(koMatches.map(m => m.teamB)).filter(Boolean));
    return {
      info, koMatches,
      real: koMatches.filter(m => !m.bye && m.teamA && m.teamB).length,
      byes: koMatches.filter(m => m.bye).length,
      allQ, uniqueQ: new Set(allQ).size,
      allInBracket: allQ.every(t => inBracket.has(t)),
      groupMatches: TM.groupMatches().length,
      progress: TM.progress()
    };
  }

  // 8 pairs, 4 + 4, top 2 -> 12 group + 3 knockout = 15
  let r = playToChampion({ A: 4, B: 4 }, 2);
  eq('8p/4+4: group matches 12', r.groupMatches, 12);
  eq('8p/4+4: 4 qualifiers', r.allQ.length, 4);
  eq('8p/4+4: 3 real knockout matches', r.real, 3);
  eq('8p/4+4: no byes', r.byes, 0);
  eq('8p/4+4: overall 15', r.progress.overallTotal, 15);
  eq('8p/4+4: knockout total 3', r.progress.knockoutTotal, 3);
  check('8p/4+4: champion decided', !!r.info.champion);
  check('8p/4+4: no quarter-finals', !r.info.rounds.qf.exists);
  check('8p/4+4: semi-finals exist', r.info.rounds.sf.exists);

  // 9 pairs, 5 + 4, top 4 -> 16 + 7 = 23
  r = playToChampion({ A: 5, B: 4 }, 4);
  eq('9p/5+4: group matches 16', r.groupMatches, 16);
  eq('9p/5+4: 8 qualifiers', r.allQ.length, 8);
  eq('9p/5+4: 7 real knockout matches', r.real, 7);
  eq('9p/5+4: no byes', r.byes, 0);
  eq('9p/5+4: overall 23', r.progress.overallTotal, 23);
  check('9p/5+4: champion decided', !!r.info.champion);
  check('9p/5+4: qf exists', r.info.rounds.qf.exists);

  // 10 pairs, 5 + 5, top 4 -> 20 + 7 = 27 (the default example)
  r = playToChampion({ A: 5, B: 5 }, 4);
  eq('10p/5+5: group matches 20', r.groupMatches, 20);
  eq('10p/5+5: 8 qualifiers', r.allQ.length, 8);
  eq('10p/5+5: 7 real knockout matches', r.real, 7);
  eq('10p/5+5: overall 27', r.progress.overallTotal, 27);
  check('10p/5+5: champion decided', !!r.info.champion);

  // 3 groups x 3 pairs, top 2 -> 9 group, 6 qualifiers, 2 byes, 5 real matches
  r = playToChampion({ A: 3, B: 3, C: 3 }, 2);
  eq('3x3/2: group matches 9', r.groupMatches, 9);
  eq('3x3/2: 6 qualifiers', r.allQ.length, 6);
  eq('3x3/2: all qualifiers unique', r.uniqueQ, 6);
  check('3x3/2: every group contributes qualifiers', r.allInBracket);
  eq('3x3/2: 2 byes', r.byes, 2);
  eq('3x3/2: 5 real knockout matches', r.real, 5);
  eq('3x3/2: real knockout = qualifiers - 1', r.real, r.allQ.length - 1);
  eq('3x3/2: overall 14', r.progress.overallTotal, 14);
  check('3x3/2: champion decided', !!r.info.champion);
  // brackets size = next power of two >= qualifiers
  eq('3x3/2: bracket size 8', TM.bracketRounds(6)[0].size, 8);
  // byes have no fake opponent and auto-advance a real team
  check('3x3/2: byes have no opponent', r.koMatches.filter(m => m.bye).every(m => !m.teamA || !m.teamB));
  check('3x3/2: byes advance real teams', r.koMatches.filter(m => m.bye).every(m => !!TM.getTeam(m.teamA || m.teamB)));

  // unequal 3-group configuration: 5 + 4 + 3, top 2 -> 6 qualifiers + 2 byes
  r = playToChampion({ A: 5, B: 4, C: 3 }, 2);
  eq('unequal 3-group: group matches 19', r.groupMatches, 19);
  eq('unequal 3-group: 6 qualifiers', r.allQ.length, 6);
  check('unequal 3-group: all groups represented', r.allInBracket);
  eq('unequal 3-group: 2 byes', r.byes, 2);
  eq('unequal 3-group: 5 real knockout matches', r.real, 5);
  eq('unequal 3-group: overall 24', r.progress.overallTotal, 24);
  check('unequal 3-group: champion decided', !!r.info.champion);

  // 4-group configuration: 3 + 3 + 3 + 3, top 1 -> 4 qualifiers, no byes
  r = playToChampion({ A: 3, B: 3, C: 3, D: 3 }, 1);
  eq('4-group: group matches 12', r.groupMatches, 12);
  eq('4-group: 4 qualifiers', r.allQ.length, 4);
  check('4-group: all four groups represented', r.allInBracket);
  eq('4-group: no byes', r.byes, 0);
  eq('4-group: 3 real knockout matches', r.real, 3);
  eq('4-group: overall 15', r.progress.overallTotal, 15);
  check('4-group: champion decided', !!r.info.champion);

  // 4-group with different sizes: 4 + 3 + 2 + 2, top 2 -> 8 qualifiers (2 from each)
  r = playToChampion({ A: 4, B: 3, C: 2, D: 2 }, 2);
  eq('4-group uneven: group matches 11', r.groupMatches, 11);
  eq('4-group uneven: 8 qualifiers', r.allQ.length, 8);
  check('4-group uneven: all groups represented', r.allInBracket);
  eq('4-group uneven: no byes', r.byes, 0);
  eq('4-group uneven: 7 real knockout matches', r.real, 7);
  eq('4-group uneven: real = qualifiers - 1', r.real, r.allQ.length - 1);
  check('4-group uneven: champion decided', !!r.info.champion);

  // no qualifier is dropped or duplicated in any of the above
  [ { A: 3, B: 3, C: 3 }, { A: 5, B: 4, C: 3 }, { A: 3, B: 3, C: 3, D: 3 }, { A: 4, B: 3, C: 2, D: 2 } ].forEach(function (counts, idx) {
    const rr = playToChampion(counts, 2);
    eq('multi-group #' + idx + ': no duplicate qualifiers', rr.uniqueQ, rr.allQ.length);
    check('multi-group #' + idx + ': all qualifiers in bracket', rr.allInBracket);
    eq('multi-group #' + idx + ': real matches = qualifiers - 1', rr.real, rr.allQ.length - 1);
  });
})();

/* ── 52. seedBracket preserves the classic two-group draw ─ */
(function () {
  TM.resetTournament();
  const q = { A: ['A1', 'A2', 'A3', 'A4'], B: ['B1', 'B2', 'B3', 'B4'] };
  const seeded = TM.seedBracket(q);
  // Classic order: A1 v B4, B1 v A4, A2 v B3, B2 v A3
  eq('2-group seed: A1 vs B4', seeded[0] + '/' + seeded[1], 'A1/B4');
  eq('2-group seed: B1 vs A4', seeded[2] + '/' + seeded[3], 'B1/A4');
  eq('2-group seed: A2 vs B3', seeded[4] + '/' + seeded[5], 'A2/B3');
  eq('2-group seed: B2 vs A3', seeded[6] + '/' + seeded[7], 'B2/A3');
  eq('2-group seed: all eight seeds present', new Set(seeded).size, 8);
  const q2 = { A: ['A1', 'A2'], B: ['B1', 'B2'] };
  const seeded2 = TM.seedBracket(q2);
  eq('2-group top2 seed: A1 vs B2', seeded2[0] + '/' + seeded2[1], 'A1/B2');
  eq('2-group top2 seed: B1 vs A2', seeded2[2] + '/' + seeded2[3], 'B1/A2');

  // single group -> standing order
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 4 }), { regenerate: true });
  eq('1-group seed: standing order', TM.seedBracket({ A: ['A1', 'A2', 'A3', 'A4'] }).join(','), 'A1,A2,A3,A4');

  // three groups: every group contributes, no drops/dupes
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 3, B: 3, C: 3 }), { regenerate: true });
  const s3 = TM.seedBracket({ A: ['A1', 'A2'], B: ['B1', 'B2'], C: ['C1', 'C2'] });
  eq('3-group seed: six seeds', s3.length, 6);
  eq('3-group seed: unique', new Set(s3).size, 6);
  ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].forEach(t => check('3-group seed includes ' + t, s3.includes(t)));
  check('3-group seed: strongest meets weakest', s3[0] === 'A1' && s3[1] === 'C2', s3.join(','));
})();

/* ── 53. multi-group knockout persistence + import/export ─ */
(function () {
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 3, B: 3, C: 3 }), { regenerate: true });
  TM.setQualification(2);
  TM.groupMatches().forEach(m => TM.saveGroupScore(m.id, m.teamA < m.teamB ? 21 : 12, m.teamA < m.teamB ? 12 : 21));
  ensureBracket();
  TM.addGroup('D');
  TM.renameGroup('C', 'Gamma');
  TM.save();

  const snapshot = TM.exportJSON();
  const beforeKo = TM.getState().matches.filter(m => m.stage !== 'group').map(m => [m.id, m.teamA, m.teamB]).sort();

  TM.resetTournament();
  const imp = TM.importJSON(snapshot);
  check('multi-group import ok', imp.ok, imp.msg);
  eq('multi-group import keeps groups', TM.groupIds().join(','), 'A,B,C,D');
  eq('multi-group import keeps label', TM.groupLabel('C'), 'Gamma');
  eq('multi-group import keeps group matches', TM.groupMatches().length, 9);
  eq('multi-group import keeps bracket', JSON.stringify(TM.getState().matches.filter(m => m.stage !== 'group').map(m => [m.id, m.teamA, m.teamB]).sort()), JSON.stringify(beforeKo));

  // plain reload preserves everything too
  TM.save();
  TM.load();
  eq('reload keeps bracket', JSON.stringify(TM.getState().matches.filter(m => m.stage !== 'group').map(m => [m.id, m.teamA, m.teamB]).sort()), JSON.stringify(beforeKo));
  eq('reload keeps empty group D', TM.getState().groups.D.length, 0);
})();

/* ══════════════════════════════════════════════════════════
   54. canonical team-level resolver + repair + assignment UI
   ══════════════════════════════════════════════════════════ */

/* 54a. default distribution and exact default teams */
(function () {
  TM.resetTournament();
  const counts = TM.levelCounts();
  eq('default Tunga = 3', counts.tunga, 3);
  eq('default Bhadra = 3', counts.bhadra, 3);
  eq('default Kaveri = 3', counts.kaveri, 3);
  eq('default Unassigned = 1', counts[TM.UNASSIGNED_ID], 1);
  eq('default total = 10', TM.levelSummary().total, 10);
  eq('default assigned = 9', TM.levelSummary().assigned, 9);
  eq('default unassigned = 1', TM.levelSummary().unassigned, 1);

  const byName = {};
  TM.getState().teams.forEach(t => { byName[t.name] = TM.resolveLevel(t.level).id; });
  eq('RK & Vinay → kaveri', byName['RK & Vinay'], 'kaveri');
  eq('Nihar & Rajeev → kaveri', byName['Nihar & Rajeev'], 'kaveri');
  eq('Prabhakar & Phani → kaveri', byName['Prabhakar & Phani'], 'kaveri');
  eq('Anil & TBD → unassigned', byName['Anil & TBD'], 'unassigned');
})();

/* 54b. resolveLevel handles every canonical and legacy representation */
(function () {
  TM.resetTournament();
  eq('exact id kaveri → kaveri', TM.resolveLevel('kaveri').id, 'kaveri');
  eq('display name Kaveri → kaveri', TM.resolveLevel('Kaveri').id, 'kaveri');
  eq('upper KAVERI → kaveri', TM.resolveLevel('KAVERI').id, 'kaveri');
  eq('mixed kAvErI → kaveri', TM.resolveLevel('kAvErI').id, 'kaveri');
  eq('padded " Kaveri " → kaveri', TM.resolveLevel('  Kaveri ').id, 'kaveri');
  eq('slug Kaveri- → kaveri', TM.resolveLevel('Kaveri-').id, 'kaveri');
  eq('legacy id Kaveri → kaveri', TM.resolveLevel('Kaveri').id, 'kaveri');
  eq('legacy name Kaveri → kaveri', TM.resolveLevel('Kaveri').id, 'kaveri');
  eq('id Tunga → tunga', TM.resolveLevel('Tunga').id, 'tunga');
  eq('id bhadra → bhadra', TM.resolveLevel('bhadra').id, 'bhadra');
  eq('name Bhadra → bhadra', TM.resolveLevel('Bhadra').id, 'bhadra');
  eq('Unassigned → unassigned', TM.resolveLevel('Unassigned').id, 'unassigned');
  eq('UNASSIGNED → unassigned', TM.resolveLevel('UNASSIGNED').id, 'unassigned');
  eq('unknown → unassigned', TM.resolveLevel('GhostLevel').id, 'unassigned');
  eq('empty → unassigned', TM.resolveLevel('').id, 'unassigned');
  eq('null → unassigned', TM.resolveLevel(null).id, 'unassigned');
  eq('number-ish unknown → unassigned', TM.resolveLevel(42).id, 'unassigned');
  check('unknown never throws', true);

  // levelById / levelForTeam / levelName agree with the resolver
  eq('levelById Kaveri finds kaveri', TM.levelById('Kaveri').id, 'kaveri');
  eq('levelById kaveri finds kaveri', TM.levelById('kaveri').id, 'kaveri');
  eq('levelById unknown → null', TM.levelById('Ghost'), null);
  eq('levelForTeam Kaveri → kaveri', TM.levelForTeam({ level: 'Kaveri' }).id, 'kaveri');
  eq('levelForTeam unknown → unassigned', TM.levelForTeam({ level: 'Ghost' }).id, 'unassigned');
  eq('levelName Kaveri → Kaveri', TM.levelName('Kaveri'), 'Kaveri');
  eq('levelName unknown → Unassigned', TM.levelName('Ghost'), 'Unassigned');

  // a case/name variant still counts as assigned
  const teams = TM.getState().teams.map(t => ({ id: t.id, group: t.group, name: t.name, players: t.players, level: t.level }));
  teams.find(t => t.id === 'A3').level = 'KAVERI';
  teams.find(t => t.id === 'A5').level = 'Kaveri';
  teams.find(t => t.id === 'B4').level = 'kaveri';
  const r = TM.applyTeams(teams);
  check('legacy-case level change accepted', r.ok, r.msg);
  const c = TM.levelCounts();
  eq('all three Kaveri pairs counted', c.kaveri, 3);
  eq('Unassigned still 1', c[TM.UNASSIGNED_ID], 1);
  eq('canonical id stored after applyTeams', TM.getTeam('A3').level, 'kaveri');
  eq('canonical id stored for name form', TM.getTeam('A5').level, 'kaveri');
})();

/* 54c. migration preserves valid assignments and is idempotent */
(function () {
  // A stored document whose Kaveri pairs use a legacy display name, with a mixed
  // legacy level list (bare-ish ids in caps plus a name). Tunga/Bhadra valid; Anil
  // genuinely unassigned; one truly unknown pair must stay unassigned.
  const legacy = {
    version: 6,
    teams: [
      { id: 'A1', group: 'A', name: 'Naveen & Chandan', players: ['Naveen', 'Chandan'], level: 'Tunga' },
      { id: 'A2', group: 'A', name: 'Harshit & Yakshit', players: ['Harshit', 'Yakshit'], level: 'bhadra' },
      { id: 'A3', group: 'A', name: 'RK & Vinay', players: ['RK', 'Vinay'], level: 'Kaveri' },
      { id: 'A4', group: 'A', name: 'Manjanna & Madhu', players: ['Manjanna', 'Madhu'], level: 'Tunga' },
      { id: 'A5', group: 'A', name: 'Nihar & Rajeev', players: ['Nihar', 'Rajeev'], level: 'KAVERI' },
      { id: 'B1', group: 'B', name: 'Praveen KG & Gagan', players: ['Praveen KG', 'Gagan'], level: 'tunga' },
      { id: 'B2', group: 'B', name: 'Gangadhar & Manju', players: ['Gangadhar', 'Manju'], level: 'Bhadra' },
      { id: 'B3', group: 'B', name: 'Praveen & Vinay', players: ['Praveen', 'Vinay'], level: 'bhadra' },
      { id: 'B4', group: 'B', name: 'Prabhakar & Phani', players: ['Prabhakar', 'Phani'], level: 'kaveri' },
      { id: 'B5', group: 'B', name: 'Anil & TBD', players: ['Anil', 'TBD'], level: 'Unassigned' },
      { id: 'C1', group: 'C', name: 'Ghost & Pair', players: ['Ghost', 'Pair'], level: 'MysteryLevel' }
    ],
    groups: { A: ['A1', 'A2', 'A3', 'A4', 'A5'], B: ['B1', 'B2', 'B3', 'B4', 'B5'], C: ['C1'] },
    matches: [],
    settings: { levels: ['Tunga', 'Bhadra', 'Kaveri'] }
  };

  const m1 = TM.migrate(JSON.parse(JSON.stringify(legacy)));
  const lv = {}; m1.teams.forEach(t => { lv[t.id] = t.level; });
  eq('migration keeps RK & Vinay → kaveri', lv.A3, 'kaveri');
  eq('migration keeps Nihar & Rajeev → kaveri', lv.A5, 'kaveri');
  eq('migration keeps Prabhakar & Phani → kaveri', lv.B4, 'kaveri');
  eq('migration keeps Tunga', lv.A1, 'tunga');
  eq('migration keeps Bhadra', lv.A2, 'bhadra');
  eq('migration keeps genuinely unassigned', lv.B5, 'unassigned');
  eq('migration sends unknown to unassigned', lv.C1, 'unassigned');
  const mc = {}; m1.teams.forEach(t => { mc[t.level] = (mc[t.level] || 0) + 1; });
  eq('migrated Kaveri count = 3', mc.kaveri, 3);
  eq('migrated Tunga count = 3', mc.tunga, 3);
  eq('migrated Bhadra count = 3', mc.bhadra, 3);
  eq('migrated unassigned count = 2', mc.unassigned, 2);

  // idempotence: migrating the migrated document changes nothing
  const m2 = TM.migrate(JSON.parse(JSON.stringify(m1)));
  eq('migration is idempotent (teams)', JSON.stringify(m2.teams.map(t => t.level)), JSON.stringify(m1.teams.map(t => t.level)));
  const m3 = TM.migrate(JSON.parse(JSON.stringify(m2)));
  eq('migration is idempotent (levels)', JSON.stringify(m3.settings.levels), JSON.stringify(m2.settings.levels));

  // import path preserves the same canonical assignments
  const imp = TM.importJSON(JSON.stringify(legacy));
  check('legacy import ok', imp.ok, imp.msg);
  eq('import keeps Kaveri pair', TM.getTeam('A3').level, 'kaveri');
  eq('import keeps the other Kaveri pair', TM.getTeam('B4').level, 'kaveri');
})();

/* 54d. level change safety: results, fixtures, groups, knockout untouched */
(function () {
  TM.resetTournament();
  // finish the whole group stage and build the bracket
  TM.groupMatches().forEach(m => TM.saveGroupScore(m.id, m.teamA < m.teamB ? 21 : 12, m.teamA < m.teamB ? 12 : 21));
  ensureBracket();

  const st0 = TM.getState();
  const resultsBefore = JSON.stringify(st0.matches.filter(m => m.status === 'completed').map(m => [m.id, m.teamA, m.teamB, m.scoreA, m.scoreB, m.winner]));
  const fixturesBefore = JSON.stringify(st0.matches.filter(m => m.stage === 'group').map(m => [m.id, m.teamA, m.teamB]));
  const groupsBefore = JSON.stringify(st0.groups);
  const koBefore = JSON.stringify(st0.matches.filter(m => m.stage !== 'group').map(m => [m.id, m.stage, m.round, m.teamA, m.teamB, m.status]));
  const standingsBefore = JSON.stringify(TM.computeStandings('A').map(r => [r.team.id, r.played, r.won, r.lost, r.pts, r.pf, r.pa, r.diff]));
  const standingsOf = () => JSON.stringify(TM.computeStandings('A').map(r => [r.team.id, r.played, r.won, r.lost, r.pts, r.pf, r.pa, r.diff]));

  const r = TM.setTeamLevel('A1', 'kaveri');
  check('setTeamLevel accepted after results', r.ok, r.msg);
  eq('A1 now kaveri', TM.getTeam('A1').level, 'kaveri');

  const st1 = TM.getState();
  eq('results unchanged after level change', JSON.stringify(st1.matches.filter(m => m.status === 'completed').map(m => [m.id, m.teamA, m.teamB, m.scoreA, m.scoreB, m.winner])), resultsBefore);
  eq('fixtures unchanged after level change', JSON.stringify(st1.matches.filter(m => m.stage === 'group').map(m => [m.id, m.teamA, m.teamB])), fixturesBefore);
  eq('groups unchanged after level change', JSON.stringify(st1.groups), groupsBefore);
  eq('knockout unchanged after level change', JSON.stringify(st1.matches.filter(m => m.stage !== 'group').map(m => [m.id, m.stage, m.round, m.teamA, m.teamB, m.status])), koBefore);
  eq('standings unchanged after level change', standingsOf(), standingsBefore);

  // setting a legacy name/case through the same API also stays canonical + safe
  const r2 = TM.setTeamLevel('A2', 'BHADRA');
  check('setTeamLevel accepts legacy case', r2.ok, r2.msg);
  eq('A2 canonical bhadra', TM.getTeam('A2').level, 'bhadra');
  eq('knockout still unchanged', JSON.stringify(TM.getState().matches.filter(m => m.stage !== 'group').map(m => [m.id, m.stage, m.round, m.teamA, m.teamB, m.status])), koBefore);

  // an unknown level through setTeamLevel falls back to Unassigned, never throws
  const r3 = TM.setTeamLevel('A2', 'NotARealLevel');
  check('setTeamLevel unknown accepted as unassigned', r3.ok, r3.msg);
  eq('A2 → unassigned for unknown', TM.getTeam('A2').level, 'unassigned');
  eq('fixtures still unchanged', JSON.stringify(TM.getState().matches.filter(m => m.stage === 'group').map(m => [m.id, m.teamA, m.teamB])), fixturesBefore);
})();

/* 54e. counts always equal actual state.teams assignments */
(function () {
  TM.resetTournament();
  const counts = TM.levelCounts();
  TM.levels().forEach(l => {
    eq('settings count matches teams for ' + l.id, counts[l.id], TM.getState().teams.filter(t => TM.resolveLevel(t.level).id === l.id).length);
  });
  eq('unassigned count matches teams', counts[TM.UNASSIGNED_ID], TM.getState().teams.filter(t => TM.resolveLevel(t.level).id === 'unassigned').length);

  // move one pair and re-check
  TM.setTeamLevel('A1', 'kaveri');
  const c2 = TM.levelCounts();
  eq('counts update after move (tunga)', c2.tunga, TM.getState().teams.filter(t => TM.resolveLevel(t.level).id === 'tunga').length);
  eq('counts update after move (kaveri)', c2.kaveri, TM.getState().teams.filter(t => TM.resolveLevel(t.level).id === 'kaveri').length);
  eq('total conserved', c2.tunga + c2.bhadra + c2.kaveri + c2[TM.UNASSIGNED_ID], 10);
})();

/* 54f. persistence: reload, export/import and migration keep canonical levels */
(function () {
  TM.resetTournament();
  TM.setTeamLevel('A1', 'Kaveri');   // legacy name form through the canonical API
  TM.setTeamLevel('B5', 'tunga');
  TM.save();
  const before = JSON.stringify(TM.getState().teams.map(t => t.id + ':' + t.level));

  TM.load();
  eq('reload keeps canonical levels', JSON.stringify(TM.getState().teams.map(t => t.id + ':' + t.level)), before);

  const dump = TM.exportJSON();
  const imp = TM.importJSON(dump);
  check('export/import ok', imp.ok, imp.msg);
  eq('export/import keeps canonical levels', JSON.stringify(TM.getState().teams.map(t => t.id + ':' + t.level)), before);

  // re-migrating the exported document is stable
  const re = TM.migrate(JSON.parse(dump));
  eq('migration of exported doc stable', JSON.stringify(re.teams.map(t => t.id + ':' + t.level)), before);
})();

/* 54g. repair: fixes legacy, leaves unknown unassigned, touches nothing else */
(function () {
  TM.resetTournament();
  // Simulate an already-broken live state: three Kaveri pairs stored by display name,
  // one pair stored in caps, plus results and a bracket already recorded.
  TM.groupMatches().forEach(m => TM.saveGroupScore(m.id, m.teamA < m.teamB ? 21 : 12, m.teamA < m.teamB ? 12 : 21));
  ensureBracket();

  // Force legacy representations directly on the stored teams (bypassing applyTeams).
  const st = TM.getState();
  st.teams.find(t => t.id === 'A3').level = 'Kaveri';
  st.teams.find(t => t.id === 'A5').level = 'KAVERI';
  st.teams.find(t => t.id === 'B4').level = 'kaveri';
  st.teams.find(t => t.id === 'A1').level = 'MysteryLevel';
  st.teams.find(t => t.id === 'B5').level = 'Unassigned';

  const resultsBefore = JSON.stringify(st.matches.map(m => [m.id, m.status, m.teamA, m.teamB, m.scoreA, m.scoreB, m.winner]));
  const groupsBefore = JSON.stringify(st.groups);
  const fixturesBefore = JSON.stringify(st.matches.filter(m => m.stage === 'group').map(m => [m.id, m.teamA, m.teamB]));

  // Before repair the counts already route the legacy names correctly via the resolver.
  eq('pre-repair Kaveri count = 3 (resolver)', TM.levelCounts().kaveri, 3);

  const r = TM.repairTeamLevels();
  check('repair ok', r.ok);
  eq('repair reports 4 normalizations', r.repaired, 4); // A3, A5, B4 canonicalized + A1 unknown→unassigned
  eq('A3 canonicalized', TM.getTeam('A3').level, 'kaveri');
  eq('A5 canonicalized', TM.getTeam('A5').level, 'kaveri');
  eq('B4 canonicalized', TM.getTeam('B4').level, 'kaveri');
  eq('A1 unknown left unassigned', TM.getTeam('A1').level, 'unassigned');

  const st2 = TM.getState();
  eq('repair did not change fixtures', JSON.stringify(st2.matches.filter(m => m.stage === 'group').map(m => [m.id, m.teamA, m.teamB])), fixturesBefore);
  eq('repair did not change results', JSON.stringify(st2.matches.map(m => [m.id, m.status, m.teamA, m.teamB, m.scoreA, m.scoreB, m.winner])), resultsBefore);
  eq('repair did not change groups', JSON.stringify(st2.groups), groupsBefore);

  // idempotent: a second repair reports nothing to do
  const r2 = TM.repairTeamLevels();
  eq('second repair reports 0', r2.repaired, 0);
  eq('repair is idempotent', TM.getTeam('A3').level, 'kaveri');
})();

/* 54g. existing localStorage is self-healed on load (no manual clear needed) */
(function () {
  // Seed the exact shared storage key with a legacy document whose levels are display
  // names / mixed case, plus one genuinely unassigned pair.
  const legacyDoc = {
    version: 6,
    teams: [
      { id: 'A1', group: 'A', name: 'Naveen & Chandan', players: ['Naveen', 'Chandan'], level: 'Tunga' },
      { id: 'A2', group: 'A', name: 'Harshit & Yakshit', players: ['Harshit', 'Yakshit'], level: 'Bhadra' },
      { id: 'A3', group: 'A', name: 'RK & Vinay', players: ['RK', 'Vinay'], level: 'Kaveri' },
      { id: 'A4', group: 'A', name: 'Manjanna & Madhu', players: ['Manjanna', 'Madhu'], level: 'Tunga' },
      { id: 'A5', group: 'A', name: 'Nihar & Rajeev', players: ['Nihar', 'Rajeev'], level: 'KAVERI' },
      { id: 'B1', group: 'B', name: 'Praveen KG & Gagan', players: ['Praveen KG', 'Gagan'], level: 'tunga' },
      { id: 'B2', group: 'B', name: 'Gangadhar & Manju', players: ['Gangadhar', 'Manju'], level: 'Bhadra' },
      { id: 'B3', group: 'B', name: 'Praveen & Vinay', players: ['Praveen', 'Vinay'], level: 'bhadra' },
      { id: 'B4', group: 'B', name: 'Prabhakar & Phani', players: ['Prabhakar', 'Phani'], level: 'Kaveri' },
      { id: 'B5', group: 'B', name: 'Anil & TBD', players: ['Anil', 'TBD'], level: 'Unassigned' }
    ],
    groups: { A: ['A1', 'A2', 'A3', 'A4', 'A5'], B: ['B1', 'B2', 'B3', 'B4', 'B5'] },
    matches: [],
    settings: { levels: [{ id: 'tunga', name: 'Tunga' }, { id: 'bhadra', name: 'Bhadra' }, { id: 'kaveri', name: 'Kaveri' }] }
  };
  store['shuttledraw_v4'] = JSON.stringify(legacyDoc);
  TM.load();
  const c = TM.levelCounts();
  eq('live-load Tunga = 3', c.tunga, 3);
  eq('live-load Bhadra = 3', c.bhadra, 3);
  eq('live-load Kaveri = 3', c.kaveri, 3);
  eq('live-load Unassigned = 1', c[TM.UNASSIGNED_ID], 1);
  // the healed document was written back to storage
  const healed = JSON.parse(store['shuttledraw_v4']);
  eq('storage healed: A3 level', healed.teams.find(t => t.id === 'A3').level, 'kaveri');
  eq('storage healed: A5 level', healed.teams.find(t => t.id === 'A5').level, 'kaveri');
  eq('storage healed: B4 level', healed.teams.find(t => t.id === 'B4').level, 'kaveri');
  eq('storage healed: A1 level', healed.teams.find(t => t.id === 'A1').level, 'tunga');
  eq('storage healed: B5 level', healed.teams.find(t => t.id === 'B5').level, 'unassigned');
  // a second load is stable and reports nothing further to repair
  TM.load();
  const c2 = TM.levelCounts();
  eq('live-load reload stable (kaveri)', c2.kaveri, 3);
  eq('live-load reload stable (unassigned)', c2[TM.UNASSIGNED_ID], 1);
  eq('live-load repair reports nothing', TM.repairTeamLevels().repaired, 0);
  store['shuttledraw_v4'] = undefined;
  delete store['shuttledraw_v4'];
})();

/* ══════════════════════════════════════════════════════════
   55. Settings + Teams render UI
   ══════════════════════════════════════════════════════════ */
(function () {
  // The Settings Team Level Configuration must show every level, the actual pair
  // names, a per-pair assignment control and the assigned/unassigned summary.
  const src = html;
  check('Settings renders Tunga/Bhadra/Kaveri/Unassigned blocks', /levelAssignmentBlocks/.test(src));
  check('Settings has assigned/unassigned summary line', /assigned · .*unassigned/.test(src) || /levelSummaryLine/.test(src));
  check('Settings has a level assignment control', /levelSelect/.test(src));
  check('Settings calls the repair action', /App\.repairLevels\(\)/.test(src));
  check('Settings warning names unassigned pairs', /unassigned: /.test(src));
  check('Teams page shows pair · level in the row', /team-edit-title/.test(src));
  check('Teams/Settings share the canonical resolver', /TM\.resolveLevel\(/.test(src));
  check('no separate stored level counts', !/state\.levelCounts\b/.test(src) && !/settings\.levelCounts/.test(src));
})();

/* ══════════════════════════════════════════════════════════
   56. Dashboard V2 analytics (derived from live state)
   ══════════════════════════════════════════════════════════ */

/* KPI cards: pairs · total · completed · live · courts · progress %.
   Every value must come from state, never a constant. */
(function () {
  TM.resetTournament();
  let k = TM.dashboardKPIs();
  eq('kpi default pairs = 10', k.pairs, 10);
  eq('kpi default total = 27', k.totalMatches, 27);
  eq('kpi default completed = 0', k.completed, 0);
  eq('kpi default live = 0', k.live, 0);
  eq('kpi default courts = 3', k.courts, 3);
  eq('kpi default progress = 0%', k.progressPct, 0);

  // A different shape must move every number accordingly (no hard-coded 10/27/3).
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 4, B: 4 }), { regenerate: true });
  TM.setQualification(2);
  TM.setCourtCount(2, {});
  k = TM.dashboardKPIs();
  eq('kpi 8p pairs = 8', k.pairs, 8);
  eq('kpi 8p total = 15', k.totalMatches, 15);
  eq('kpi 8p courts = 2', k.courts, 2);

  // Completing a match moves completed + progress, live moves on start.
  TM.resetTournament();
  const first = TM.groupMatches()[0];
  TM.startMatch(first.id, 1, NOON);
  k = TM.dashboardKPIs();
  eq('kpi live after start = 1', k.live, 1);
  TM.saveGroupScore(first.id, 21, 15);
  k = TM.dashboardKPIs();
  eq('kpi completed after result = 1', k.completed, 1);
  eq('kpi live after result = 0', k.live, 0);
  eq('kpi progress = round(1/27)', k.progressPct, Math.round((1 / 27) * 100));

  // Disabling a court lowers the active-court count (independent of matches).
  TM.resetTournament();
  TM.setCourtEnabled(3, false);
  eq('kpi courts drops when one disabled', TM.dashboardKPIs().courts, 2);
})();

/* Level distribution must read actual team assignments, not configured counts. */
(function () {
  TM.resetTournament();
  const ld = TM.levelDistribution();
  const byId = {};
  ld.rows.forEach(r => { byId[r.id] = r; });
  eq('leveldist Tunga = 3', byId.tunga.count, 3);
  eq('leveldist Bhadra = 3', byId.bhadra.count, 3);
  eq('leveldist Kaveri = 3', byId.kaveri.count, 3);
  eq('leveldist Unassigned = 1', byId.unassigned.count, 1);
  eq('leveldist unassigned flagged', byId.unassigned.unassigned, true);
  eq('leveldist total = 10', ld.total, 10);
  eq('leveldist max = 3', ld.max, 3);
  // Bar width is proportional to the max.
  eq('leveldist Tunga is full width', Math.round((byId.tunga.count / ld.max) * 100), 100);
  eq('leveldist Unassigned is 1/3 width', Math.round((byId.unassigned.count / ld.max) * 100), 33);

  // Reassigning changes the distribution and drops the warning.
  TM.updateTeam('B5', { level: 'kaveri' });
  const ld2 = TM.levelDistribution();
  const by2 = {};
  ld2.rows.forEach(r => { by2[r.id] = r; });
  eq('leveldist Kaveri = 4 after reassign', by2.kaveri.count, 4);
  eq('leveldist Unassigned = 0 after reassign', by2.unassigned.count, 0);
  eq('leveldist unassigned total = 0', ld2.unassigned, 0);
})();

/* Group performance must work for 1, 2, 3 and 4 groups, deriving everything from
   fixtures — never from a hard-coded A/B pair. */
(function () {
  function shape(counts) {
    TM.resetTournament();
    TM.applyTeams(makeTeams(counts), { regenerate: true, groups: Object.keys(counts) });
    return TM.groupPerformance();
  }

  let gp = shape({ A: 4 });
  eq('1 group: row count', gp.length, 1);
  eq('1 group: pairs', gp[0].pairs, 4);
  eq('1 group: total', gp[0].total, 6);
  eq('1 group: remaining', gp[0].remaining, 6);
  eq('1 group: pct', gp[0].pct, 0);

  gp = shape({ A: 5, B: 5 });
  eq('2 groups: row count', gp.length, 2);
  eq('2 groups: A total', gp[0].total, 10);
  eq('2 groups: B total', gp[1].total, 10);

  gp = shape({ A: 3, B: 3, C: 3 });
  eq('3 groups: row count', gp.length, 3);
  eq('3 groups: C total', gp[2].total, 3);
  eq('3 groups: C label', gp[2].label, 'Group C');

  gp = shape({ A: 3, B: 3, C: 3, D: 3 });
  eq('4 groups: row count', gp.length, 4);
  eq('4 groups: D pairs', gp[3].pairs, 3);

  // Completed / remaining / percentage update as results land.
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 5, B: 5 }), { regenerate: true });
  const gm = TM.groupMatches('A');
  gm.slice(0, 6).forEach(m => TM.saveGroupScore(m.id, 21, 15));
  gp = TM.groupPerformance();
  eq('group A completed = 6', gp[0].completed, 6);
  eq('group A remaining = 4', gp[0].remaining, 4);
  eq('group A pct = 60', gp[0].pct, 60);
  eq('group B untouched pct = 0', gp[1].pct, 0);
  // Completed must never exceed total, remaining must never go negative.
  gp.forEach(r => {
    check('group ' + r.group + ' completed <= total', r.completed <= r.total);
    check('group ' + r.group + ' remaining >= 0', r.remaining >= 0);
  });
})();

/* Stage labels must follow the actual bracket size implied by qualification. */
(function () {
  function stageNames(counts, per) {
    TM.resetTournament();
    TM.applyTeams(makeTeams(counts), { regenerate: true, groups: Object.keys(counts) });
    TM.setQualification(per);
    return TM.dashboardStages().map(s => s.name);
  }

  // 2 qualifiers (1 group of 2, top 2) has no semi-final — just the final.
  eq('2 qualifiers: stages', JSON.stringify(stageNames({ A: 2 }, 2)), JSON.stringify(['Final']));
  eq('4 qualifiers: stages', JSON.stringify(stageNames({ A: 4 }, 4)), JSON.stringify(['Semi-Final', 'Final']));
  eq('8 qualifiers: stages', JSON.stringify(stageNames({ A: 8 }, 8)), JSON.stringify(['Quarter-Final', 'Semi-Final', 'Final']));
  eq('16 qualifiers: stages', JSON.stringify(stageNames({ A: 8, B: 8 }, 8)), JSON.stringify(['Round of 16', 'Quarter-Final', 'Semi-Final', 'Final']));
  // 6 qualifiers (2 groups x 3, top 3) is a QF-sized bracket with byes.
  eq('6 qualifiers: stages', JSON.stringify(stageNames({ A: 3, B: 3 }, 3)), JSON.stringify(['Quarter-Final', 'Semi-Final', 'Final']));

  // After the bracket is generated the stage list is read from actual matches and
  // its done counts track real completion.
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 3, B: 3 }), { regenerate: true, groups: ['A', 'B'] });
  TM.setQualification(2);
  TM.groupMatches().forEach(m => TM.saveGroupScore(m.id, m.teamA < m.teamB ? 21 : 15, m.teamA < m.teamB ? 15 : 21));
  ensureBracket();
  const st = TM.dashboardStages();
  eq('generated 4-qualifier bracket rounds', JSON.stringify(st.map(s => s.name)), JSON.stringify(['Semi-Final', 'Final']));
  eq('generated semi-final has 2 matches', st[0].total, 2);
  eq('generated final is pending until SF results', st[1].total, 0);
  st.forEach(s => check('stage ' + s.name + ' done <= total', s.done <= s.total));
})();

/* Leaders reuse computeStandings — same order and tie-breaks as Standings. */
(function () {
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 5, B: 5 }), { regenerate: true });
  eq('no leaders before any result', TM.dashboardLeaders(5).length, 0);

  TM.groupMatches('A').slice(0, 7).forEach(m => TM.saveGroupScore(m.id, 21, 15));
  const leaders = TM.dashboardLeaders(5);
  const standingsA = TM.computeStandings('A').filter(r => r.played > 0);
  eq('leaders capped at 5', TM.dashboardLeaders(5).length <= 5, true);
  eq('leaders only from played rows', leaders.every(l => l.played > 0), true);
  // The leader is the top played row of the standings engine, with same stats.
  eq('leaders[0] matches standings top', leaders[0].team.id, standingsA[0].team.id);
  eq('leaders[0] pts match Standings', leaders[0].pts, standingsA[0].pts);
  eq('leaders[0] diff match Standings', leaders[0].diff, standingsA[0].diff);
  eq('leaders carry group id', leaders[0].group, 'A');
  // Ordering must be points, then diff, then pf — identical tie-break chain.
  for (let i = 1; i < leaders.length; i++) {
    const a = leaders[i - 1], b = leaders[i];
    check('leaders sorted at ' + i,
      (a.pts > b.pts) || (a.pts === b.pts && a.diff >= b.diff));
  }
})();

/* Status source for the champion / knockout strip. */
(function () {
  TM.resetTournament();
  eq('status group by default', TM.dashboardStatus(), 'group');
  TM.applyTeams(makeTeams({ A: 2 }), { regenerate: true, groups: ['A'] });
  TM.groupMatches().forEach(m => TM.saveGroupScore(m.id, 21, 15));
  // The engine auto-generates the bracket on the final group result, so clear it to
  // exercise the "group stage complete, awaiting generation" state.
  TM.clearKnockout();
  eq('status ready when group stage complete', TM.dashboardStatus(), 'ready');
  ensureBracket();
  eq('status knockout once bracket exists', TM.dashboardStatus(), 'knockout');
  const fin = TM.getMatch('F-1');
  if (fin && !fin.bye) { TM.saveKnockoutScore('F-1', [{ a: 21, b: 15 }, { a: 21, b: 15 }, { a: null, b: null }]); }
  if (TM.knockoutInfo().champion) eq('status complete with champion', TM.dashboardStatus(), 'complete');
})();

/* The dashboard must never store analytics: no cached totals in state/localStorage. */
(function () {
  TM.resetTournament();
  const src = html;
  check('no stored dashboard analytics object', !/state\.dashboard\b/.test(src) && !/dashboardCache/.test(src));
  check('dashboard helpers exported on TM', /dashboardKPIs:/.test(src) && /groupPerformance:/.test(src) && /levelDistribution:/.test(src));
  check('no external chart library referenced', !/chart\.js|recharts|\bd3\b|highcharts/i.test(src));
  // A completed match changing membership must be reflected on the next derive.
  TM.applyTeams(makeTeams({ A: 3, B: 3 }), { regenerate: true });
  const before = TM.dashboardKPIs().totalMatches;
  TM.addTeam({ id: 'B4', group: 'B', name: 'B Four' });
  const after = TM.dashboardKPIs().totalMatches;
  check('adding a pair changes derived totals', after !== before, 'before ' + before + ' after ' + after);
})();

/* ══════════════════════════════════════════════════════════
   57. Dashboard V3 — live control centre helpers
   ══════════════════════════════════════════════════════════ */

/* Status wording: the group stage must report the GROUP total, never the overall
   tournament total, and every value stays dynamic. */
(function () {
  TM.resetTournament();
  const p = TM.progress();
  const kpi = TM.dashboardKPIs();
  const text = TM.statusText('group', p, kpi);
  check('group status names the group count 0 / 20', /0 \/ 20 group matches complete/.test(text), text);
  check('group status never shows the overall 27 count', text.indexOf('27') === -1, text);
  check('group status has a text label, not colour alone', /Group Stage in progress/.test(text), text);

  // A different shape moves the group count (no hard-coded 20/27).
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 4, B: 4 }), { regenerate: true });
  TM.setQualification(2);
  const p8 = TM.progress();
  eq('8p group total is 12', p8.groupTotal, 12);
  eq('8p overall total is 15', p8.overallTotal, 15);
  const text8 = TM.statusText('group', p8, TM.dashboardKPIs());
  check('8p group status uses 12', /0 \/ 12 group matches complete/.test(text8), text8);
  check('8p group status never shows overall 15', text8.indexOf('15') === -1, text8);
})();

/* Empty tournament status. */
(function () {
  TM.resetTournament();
  TM.setState(Object.assign(TM.getState(), { teams: [], matches: [], groups: { A: [], B: [] }, groupLabels: {} }));
  eq('status empty with no pairs', TM.dashboardStatus(), 'empty');
  const text = TM.statusText('empty', TM.progress(), TM.dashboardKPIs());
  check('empty status mentions no pairs', /No pairs configured yet/.test(text), text);
})();

/* Group-stage complete (awaiting knockout) status. */
(function () {
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 2 }), { regenerate: true, groups: ['A'] });
  TM.groupMatches().forEach(m => TM.saveGroupScore(m.id, 21, 15));
  TM.clearKnockout();
  eq('status ready when group stage complete', TM.dashboardStatus(), 'ready');
  const text = TM.statusText('ready', TM.progress(), TM.dashboardKPIs());
  check('ready status reads Group Stage complete · Knockout stage ready',
    text.indexOf('Group Stage complete · Knockout stage ready') !== -1, text);
})();

/* Knockout in progress: the strip names the live round and its own counts. */
(function () {
  function setup3() {
    TM.resetTournament();
    const t = [];
    ['A', 'B', 'C'].forEach(g => { for (let i = 1; i <= 3; i++) t.push({ id: g + i, group: g, name: g + i + ' pair' }); });
    TM.applyTeams(t, { regenerate: true, groups: ['A', 'B', 'C'] });
    TM.setQualification(2);
    TM.groupMatches().forEach(m => TM.saveGroupScore(m.id, m.teamA < m.teamB ? 21 : 15, m.teamA < m.teamB ? 15 : 21));
    ensureBracket();
  }
  setup3();
  eq('3x3 top2 status is knockout', TM.dashboardStatus(), 'knockout');
  const r = TM.currentKnockoutRound();
  eq('current knockout round is qf', r.key, 'qf');
  eq('current round display name is Quarter-finals', r.name, 'Quarter-finals');
  check('qf total counts real matches only (not byes)', r.total === 2, 'total ' + r.total);
  const text = TM.statusText('knockout', TM.progress(), TM.dashboardKPIs());
  check('knockout status names the round and counts', /Quarter-finals in progress · 0 \/ 2 complete/.test(text), text);
  check('knockout status never claims a group total', text.indexOf('group matches') === -1, text);

  // A 4-qualifier bracket has no quarter-final: the strip must say Semi-finals.
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 4 }), { regenerate: true, groups: ['A'] });
  TM.setQualification(4);
  TM.groupMatches().forEach(m => TM.saveGroupScore(m.id, 21, 15));
  ensureBracket();
  const sf = TM.currentKnockoutRound();
  eq('4-qualifier current round is sf', sf.key, 'sf');
  eq('4-qualifier round name is Semi-finals', sf.name, 'Semi-finals');
  check('unknown stage falls back to stored name', TM.stageDisplayName('zz', 'Custom Round') === 'Custom Round');
})();

/* Tournament complete status. */
(function () {
  TM.resetTournament();
  TM.applyTeams([
    { id: 'A1', group: 'A', name: 'Alpha Pair' }, { id: 'A2', group: 'A', name: 'Beta Pair' }
  ], { regenerate: true, groups: ['A'] });
  TM.setQualification(2);
  TM.groupMatches().forEach(m => TM.saveGroupScore(m.id, 21, 15));
  ensureBracket();
  const finalM = TM.getMatch('F-1');
  if (finalM) TM.saveKnockoutScore('F-1', [{ a: 21, b: 15 }, { a: 21, b: 15 }, { a: null, b: null }]);
  eq('status complete with champion', TM.dashboardStatus(), 'complete');
  const text = TM.statusText('complete', TM.progress(), TM.dashboardKPIs());
  check('complete status reads Tournament complete · Champion decided',
    text.indexOf('Tournament complete · Champion decided') !== -1, text);
})();

/* Live and available court counts come from the scheduler, not from constants. */
(function () {
  TM.resetTournament();
  // Ignore the wall clock so availability is deterministic regardless of when the
  // suite runs (the configured court windows are real tournament state).
  TM.getState().settings.allowOutsideAvailability = true;
  let s = TM.schedulerSummary();
  eq('fresh: no live matches', s.live, 0);
  eq('fresh: three courts available', s.available, 3);
  eq('fresh: twenty queued matches', s.queued, 20);
  check('fresh: ready matches do not exceed queued', s.ready <= s.queued);

  TM.startMatch(TM.groupMatches()[0].id, 1, NOON);
  s = TM.schedulerSummary();
  eq('live count after start', s.live, 1);
  eq('available drops to two when a court is busy', s.available, 2);
  eq('queued drops by the started match', s.queued, 19);
  check('ready never exceeds queued after start', s.ready <= s.queued);

  // The live status strip reports the scheduler counts.
  const text = TM.statusText('group', TM.progress(), TM.dashboardKPIs());
  check('live status strip reports matches live', /1 match live/.test(text), text);
  check('live status strip reports courts available', /2 courts available/.test(text), text);
  check('live status strip reports matches queued', /19 matches queued/.test(text), text);

  // Disabling a court lowers the available count without touching the matches.
  TM.resetTournament();
  TM.getState().settings.allowOutsideAvailability = true;
  TM.setCourtEnabled(3, false);
  eq('disabled court is not available', TM.schedulerSummary().available, 2);
  eq('disabled court is not counted as enabled', TM.dashboardKPIs().courts, 2);
})();

/* Waiting queue mirrors the scheduler's ordering, and is capped for display. */
(function () {
  TM.resetTournament();
  const full = TM.waitingQueue(0);
  const capped = TM.waitingQueue(4);
  eq('queue total equals queued group fixtures', full.total, 20);
  eq('capped queue returns four rows', capped.rows.length, 4);
  const ranked = TM.rankCandidates(0).map(r => r.match.id);
  eq('queue preserves scheduler order', capped.rows.map(r => r.id).join(','), ranked.slice(0, 4).join(','));
  check('queue rows carry a label and both teams',
    capped.rows.every(r => r.label && r.teamA && r.teamB), 'missing fields');

  // Once a match starts, its teams leave the queue (they can no longer start).
  TM.getState().settings.allowOutsideAvailability = true;
  TM.startMatch(TM.rankCandidates(0)[0].match.id, 1, NOON);
  const after = TM.waitingQueue(0);
  check('queue total shrinks when a match starts', after.total < full.total, after.total + ' vs ' + full.total);
})();

/* Stage display names: quarter/semi plurals, and no round invented. */
(function () {
  eq('qf display', TM.stageDisplayName('qf', 'Quarter-Final'), 'Quarter-finals');
  eq('sf display', TM.stageDisplayName('sf', 'Semi-Final'), 'Semi-finals');
  eq('final display', TM.stageDisplayName('final', 'Final'), 'Final');
  eq('r16 display', TM.stageDisplayName('r16', 'Round of 16'), 'Round of 16');
  // Dynamic bracket rounds still resolve their display name.
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 8, B: 8 }), { regenerate: true, groups: ['A', 'B'] });
  TM.setQualification(8);
  const names = TM.dashboardStages().map(x => TM.stageDisplayName(x.key, x.name));
  eq('16-qualifier stage names', JSON.stringify(names), JSON.stringify(['Round of 16', 'Quarter-finals', 'Semi-finals', 'Final']));
})();

/* Leaders expose the fields the dashboard table shows and stay in standings order. */
(function () {
  TM.resetTournament();
  TM.applyTeams(makeTeams({ A: 5, B: 5 }), { regenerate: true });
  eq('no leaders before results', TM.dashboardLeaders(5).length, 0);
  TM.groupMatches('A').slice(0, 6).forEach(m => TM.saveGroupScore(m.id, 21, 15));
  const leaders = TM.dashboardLeaders(5);
  const standby = TM.computeStandings('A').filter(r => r.played > 0);
  eq('leaders carry played', leaders[0].played, standby[0].played);
  eq('leaders carry wins', leaders[0].won, standby[0].won);
  eq('leaders carry points', leaders[0].pts, standby[0].pts);
  eq('leaders carry diff', leaders[0].diff, standby[0].diff);
  eq('leader is standings top', leaders[0].team.id, standby[0].team.id);
})();

/* ── 60. add / remove court keep matches, results, teams and groups intact ── */
(function () {
  // Add appends with defaults and never touches existing configuration or history.
  TM.resetTournament();
  TM.updateCourt(1, { name: 'Main Court' });
  const fixtureSig = () => TM.groupMatches().map(m => m.id + ':' + m.teamA + ':' + m.teamB).join(',');
  const teamsSig = () => JSON.stringify(TM.getState().teams);
  const groupsSig = () => JSON.stringify(TM.getState().groups);
  const fixturesBefore = fixtureSig();
  const teamsBefore = teamsSig();
  const groupsBefore = groupsSig();

  const add = TM.addCourt();
  check('addCourt ok', add.ok, add.msg);
  eq('court count grows', TM.getState().courts.length, 4);
  eq('new court is enabled', add.court.enabled, true);
  eq('new court has a unique id', new Set(TM.getState().courts.map(c => c.id)).size, 4);
  eq('existing rename preserved', TM.courtName(1), 'Main Court');
  eq('add left fixtures intact', fixtureSig(), fixturesBefore);
  eq('add left teams intact', teamsSig(), teamsBefore);
  eq('add left groups intact', groupsSig(), groupsBefore);

  // Up to MAX_COURTS, then refused.
  while (TM.getState().courts.length < TM.MAX_COURTS) TM.addCourt();
  const over = TM.addCourt();
  eq('add beyond the maximum refused', over.ok, false);
  check('max-court refusal explained', /maximum/i.test(over.msg), over.msg);
  eq('still at the maximum', TM.getState().courts.length, TM.MAX_COURTS);

  // Remove deletes only the court slot; a completed match keeps its court history.
  TM.resetTournament();
  TM.getState().settings.allowOutsideAvailability = true;
  const doneMatch = TM.groupMatches()[0];
  const teamsBeforeRemove = teamsSig();
  const groupsBeforeRemove = groupsSig();
  TM.startMatch(doneMatch.id, 3);
  TM.saveGroupScore(doneMatch.id, 21, 17);
  const rm = TM.removeCourt(3);
  check('removeCourt ok', rm.ok, rm.msg);
  eq('court removed from config', TM.getState().courts.some(c => c.id === 3), false);
  eq('completed match still exists', !!TM.getMatch(doneMatch.id), true);
  eq('completed match keeps status', TM.getMatch(doneMatch.id).status, 'completed');
  eq('completed match keeps its court id', TM.getMatch(doneMatch.id).court, 3);
  eq('completed match keeps its score', TM.getMatch(doneMatch.id).scoreA, 21);
  eq('removal left teams intact', teamsSig(), teamsBeforeRemove);
  eq('removal left groups intact', groupsSig(), groupsBeforeRemove);

  // A live match must block removal; after it finishes, removal is allowed.
  TM.resetTournament();
  TM.getState().settings.allowOutsideAvailability = true;
  const liveMatch = TM.groupMatches()[0];
  TM.startMatch(liveMatch.id, 2);
  const busy = TM.removeCourt(2);
  eq('cannot remove a busy court', busy.ok, false);
  check('busy removal explained', /in progress/i.test(busy.msg), busy.msg);
  eq('busy court still configured', TM.getState().courts.some(c => c.id === 2), true);
  eq('live match untouched', TM.getMatch(liveMatch.id).status, 'in_progress');
  eq('live match still on its court', TM.getMatch(liveMatch.id).court, 2);
  TM.saveGroupScore(liveMatch.id, 21, 18);
  const rm2 = TM.removeCourt(2);
  check('remove allowed once free', rm2.ok, rm2.msg);
  eq('late removal keeps the result', TM.getMatch(liveMatch.id).status, 'completed');

  // The minimum is enforced and the last enabled court is never left disabled.
  TM.resetTournament();
  TM.removeCourt(2);
  TM.removeCourt(3);
  eq('one court remains', TM.getState().courts.length, 1);
  eq('cannot remove the last court', TM.removeCourt(1).ok, false);
  // Removing an enabled court when the rest are disabled re-enables one.
  TM.resetTournament();
  TM.setCourtEnabled(2, false);
  TM.setCourtEnabled(3, false);
  TM.removeCourt(1);
  check('removal never leaves zero enabled courts', TM.enabledCourts().length >= 1, 'no enabled court left');
  const survivors = TM.getState().courts.filter(c => c.enabled !== false);
  check('a survivor was re-enabled', survivors.length >= 1, 'none enabled');
})();

/* ══════════════════════════════════════════════════════════
   58. configurable knockout match formats and scoring
   ══════════════════════════════════════════════════════════ */

// Complete the whole group stage for the current tournament.
function finishGroupStage() {
  TM.groupMatches().forEach(function (m) {
    TM.saveGroupScore(m.id, m.teamA < m.teamB ? 21 : 12, m.teamA < m.teamB ? 12 : 21);
  });
}

// TEST 1 — default configuration
(function () {
  TM.resetTournament();
  const kr = TM.getKnockoutRules();
  const byKey = {};
  kr.rounds.forEach(function (r) { byKey[r.key] = r; });
  eq('default: QF round present', !!byKey.qf, true);
  eq('default: QF format best_of_3', byKey.qf.format, 'best_of_3');
  eq('default: QF points 11', byKey.qf.pointsPerGame, 11);
  eq('default: SF format best_of_3', byKey.sf.format, 'best_of_3');
  eq('default: SF points 15', byKey.sf.pointsPerGame, 15);
  eq('default: Final format best_of_3', byKey.final.format, 'best_of_3');
  eq('default: Final points 21', byKey.final.pointsPerGame, 21);
  eq('default: default rules map qf', TM.DEFAULT_KNOCKOUT_RULES.qf.pointsPerGame, 11);
  eq('default: generated bracket QF carries the snapshot', TM.matchScoring({ stage: 'qf' }).pointsPerGame, 11);
})();

// TEST 2 — configuration persistence across save/reload
(function () {
  TM.resetTournament();
  check('set QF 15 ok', TM.setKnockoutRule('qf', { format: 'best_of_3', pointsPerGame: 15 }).ok);
  check('set SF 21 ok', TM.setKnockoutRule('sf', { format: 'best_of_3', pointsPerGame: 21 }).ok);
  check('set Final straight 21 ok', TM.setKnockoutRule('final', { format: 'single_game', pointsPerGame: 21 }).ok);
  TM.save();
  const snapshot = store[TM.STORAGE_KEY];
  TM.setState(JSON.parse(snapshot));
  const kr = TM.getKnockoutRules();
  const byKey = {};
  kr.rounds.forEach(function (r) { byKey[r.key] = r; });
  eq('persist: QF 15', byKey.qf.pointsPerGame, 15);
  eq('persist: SF 21', byKey.sf.pointsPerGame, 21);
  eq('persist: Final single_game', byKey.final.format, 'single_game');
  eq('persist: Final 21', byKey.final.pointsPerGame, 21);
})();

// TEST 3 — best-of-3 scoring: 11-8, 9-11, 11-7 → 2-1
(function () {
  TM.resetTournament();
  TM.setKnockoutRule('qf', { format: 'best_of_3', pointsPerGame: 11 });
  finishGroupStage();
  ensureBracket();
  const qf = TM.getMatch('QF-1');
  eq('bo3: QF snapshot format', TM.matchScoring(qf).format, 'best_of_3');
  eq('bo3: QF snapshot points', TM.matchScoring(qf).pointsPerGame, 11);
  const r = TM.saveKnockoutScore('QF-1', [{ a: 11, b: 8 }, { a: 9, b: 11 }, { a: 11, b: 7 }]);
  check('bo3: 2-1 accepted', r.ok, r.msg);
  eq('bo3: setsA 2', qf.setsA, 2);
  eq('bo3: setsB 1', qf.setsB, 1);
  eq('bo3: completed', qf.status, 'completed');
})();

// TEST 4 — best-of-3 early completion: 11-5, 11-7 → 2-0, no game 3
(function () {
  TM.resetTournament();
  TM.setKnockoutRule('qf', { format: 'best_of_3', pointsPerGame: 11 });
  finishGroupStage();
  ensureBracket();
  const r = TM.saveKnockoutScore('QF-1', [{ a: 11, b: 5 }, { a: 11, b: 7 }]);
  check('bo3 early: 2-0 accepted', r.ok, r.msg);
  const qf = TM.getMatch('QF-1');
  eq('bo3 early: setsA 2', qf.setsA, 2);
  eq('bo3 early: setsB 0', qf.setsB, 0);
  eq('bo3 early: completed', qf.status, 'completed');
  // a third game on a decided match is rejected
  const r2 = TM.validateKnockoutSets('QF-2', [{ a: 11, b: 5 }, { a: 11, b: 7 }, { a: 11, b: 3 }]);
  check('bo3 early: game 3 when 2-0 rejected', r2 !== null, r2);
})();

// TEST 5 — straight-set scoring: single game completes the match
(function () {
  TM.resetTournament();
  TM.setKnockoutRule('qf', { format: 'single_game', pointsPerGame: 21 });
  finishGroupStage();
  ensureBracket();
  const qf = TM.getMatch('QF-1');
  check('straight: snapshot format', TM.matchScoring(qf).format === 'single_game');
  eq('straight: snapshot points', TM.matchScoring(qf).pointsPerGame, 21);
  eq('straight: one set slot', qf.sets.length, 1);
  const r = TM.saveKnockoutScore('QF-1', [{ a: 21, b: 17 }]);
  check('straight: 21-17 accepted', r.ok, r.msg);
  eq('straight: completed', qf.status, 'completed');
  eq('straight: setsA 1', qf.setsA, 1);
  eq('straight: setsB 0', qf.setsB, 0);
  eq('straight: stored one game', qf.sets.length, 1);
  // a straight match cannot ask for game 2 / game 3
  const bad = TM.validateKnockoutSets('QF-1', [{ a: 21, b: 17 }, { a: 21, b: 19 }, null]);
  check('straight: extra game rejected', bad !== null, bad);
  const one = TM.validateKnockoutSets('QF-2', [{ a: 21, b: 17 }]);
  check('straight: single game valid', one === null, one);
  // best of 3 still needs two games (fresh bracket configured for best of 3)
  TM.resetTournament();
  TM.setKnockoutRule('qf', { format: 'best_of_3', pointsPerGame: 11 });
  finishGroupStage();
  ensureBracket();
  const needsTwo = TM.validateKnockoutSets('QF-1', [{ a: 11, b: 7 }]);
  check('bo3: one game is not enough', needsTwo !== null, needsTwo);
})();

// TEST 5b — straight set × 21 is exactly one game, and the winner is the higher score.
(function () {
  TM.resetTournament();
  TM.setKnockoutRule('qf', { format: 'single_game', pointsPerGame: 21 });
  finishGroupStage();
  ensureBracket();
  const qf = TM.getMatch('QF-1');
  // Exactly one game: a single set slot, one score entry per side, no second game.
  eq('ss21: one game slot', qf.sets.length, 1);
  check('ss21: single game validates', TM.validateKnockoutSets('QF-1', [{ a: 21, b: 17 }]) === null);
  check('ss21: a second game is rejected', TM.validateKnockoutSets('QF-1', [{ a: 21, b: 17 }, { a: 21, b: 19 }]) !== null);
  check('ss21: a third game is rejected', TM.validateKnockoutSets('QF-1', [{ a: 21, b: 17 }, { a: 21, b: 19 }, { a: 21, b: 15 }]) !== null);
  // Winner is the higher score, decided in one game.
  const r = TM.saveKnockoutScore('QF-1', [{ a: 21, b: 17 }]);
  check('ss21: 21–17 accepted', r.ok, r.msg);
  eq('ss21: winner is team A', qf.winner, qf.teamA);
  eq('ss21: loser is team B', qf.loser, qf.teamB);
  eq('ss21: one game won', qf.setsA, 1);
  eq('ss21: zero games for the loser', qf.setsB, 0);
  eq('ss21: exactly one game stored', qf.sets.length, 1);
  eq('ss21: completed', qf.status, 'completed');
  // The reverse result crowns the other side, still on one game.
  TM.resetTournament();
  TM.setKnockoutRule('qf', { format: 'single_game', pointsPerGame: 21 });
  finishGroupStage();
  ensureBracket();
  const qf2 = TM.getMatch('QF-2');
  TM.saveKnockoutScore('QF-2', [{ a: 15, b: 21 }]);
  eq('ss21: reverse winner is team B', qf2.winner, qf2.teamB);
  eq('ss21: reverse one game', qf2.sets.length, 1);
  // The format tag never reads "Best of 2".
  check('ss21: format tag is Straight set', TM.knockoutFormatTag('qf', { format: 'single_game', pointsPerGame: 21 }).indexOf('Straight set') !== -1);
  check('ss21: format tag has no Best of 2', TM.knockoutFormatTag('qf', { format: 'single_game', pointsPerGame: 21 }).indexOf('Best of 2') === -1);
})();

// TEST 5c — best of 3 completes only when one side wins two games.
(function () {
  [11, 15, 21].forEach(function (target) {
    TM.resetTournament();
    TM.setKnockoutRule('qf', { format: 'best_of_3', pointsPerGame: target });
    finishGroupStage();
    ensureBracket();
    const qf = TM.getMatch('QF-1');
    eq('bo3 x' + target + ': snapshot target', TM.matchScoring(qf).pointsPerGame, target);
    // one game is never enough
    check('bo3 x' + target + ': one game refused', TM.validateKnockoutSets('QF-1', [{ a: target, b: 5 }]) !== null);
    // 2–0 decides it
    const twoNil = TM.saveKnockoutScore('QF-1', [{ a: target, b: 5 }, { a: target, b: 7 }]);
    check('bo3 x' + target + ': 2–0 accepted', twoNil.ok, twoNil.msg);
    eq('bo3 x' + target + ': 2–0 wins', qf.setsA, 2);
    eq('bo3 x' + target + ': 2–0 completed', qf.status, 'completed');
  });
  // 1–1 then a decider: 2–1 decides it
  TM.resetTournament();
  TM.setKnockoutRule('qf', { format: 'best_of_3', pointsPerGame: 21 });
  finishGroupStage();
  ensureBracket();
  const qf = TM.getMatch('QF-1');
  const split = TM.saveKnockoutScore('QF-1', [{ a: 21, b: 18 }, { a: 19, b: 21 }, { a: 21, b: 16 }]);
  check('bo3 x21: 2–1 accepted', split.ok, split.msg);
  eq('bo3 x21: 2–1 wins', qf.setsA, 2);
  eq('bo3 x21: 2–1 losses', qf.setsB, 1);
  eq('bo3 x21: 2–1 completed', qf.status, 'completed');
})();


// TEST 8 — snapshot protection: a generated match keeps the rules it was created
// under, and once the bracket exists the Settings rules are locked.
(function () {
  TM.resetTournament();
  TM.setKnockoutRule('qf', { format: 'best_of_3', pointsPerGame: 11 });
  finishGroupStage();
  ensureBracket();
  const before = TM.getMatch('QF-1');
  eq('snapshot: QF created best_of_3', TM.matchScoring(before).format, 'best_of_3');
  eq('snapshot: QF created 11', TM.matchScoring(before).pointsPerGame, 11);
  // the rules are locked while the bracket exists
  eq('snapshot: rules locked after generation', TM.knockoutRulesLocked(), true);
  const locked = TM.setKnockoutRule('qf', { format: 'single_game', pointsPerGame: 21 });
  check('snapshot: locked edit refused', !locked.ok, locked.msg);
  check('snapshot: refusal explains the lock', /locked/i.test(locked.msg), locked.msg);
  eq('snapshot: existing QF format unchanged', TM.matchScoring(TM.getMatch('QF-1')).format, 'best_of_3');
  eq('snapshot: existing QF points unchanged', TM.matchScoring(TM.getMatch('QF-1')).pointsPerGame, 11);
  // and it still validates as a best-of-3 match
  const okBo3 = TM.validateKnockoutSets('QF-1', [{ a: 11, b: 7 }, { a: 9, b: 11 }, { a: 11, b: 6 }]);
  check('snapshot: existing QF still best of 3', okBo3 === null, okBo3);
  // resetting the knockout unlocks the rules; a rebuilt QF then uses the new rule
  TM.clearKnockout();
  eq('snapshot: rules unlocked after reset', TM.knockoutRulesLocked(), false);
  check('snapshot: unlocked edit accepted', TM.setKnockoutRule('qf', { format: 'single_game', pointsPerGame: 21 }).ok);
  ensureBracket();
  eq('snapshot: regenerated QF uses new setting', TM.matchScoring(TM.getMatch('QF-1')).format, 'single_game');
  eq('snapshot: regenerated QF uses new points', TM.matchScoring(TM.getMatch('QF-1')).pointsPerGame, 21);
})();

// TEST 9 — completed match protection: a completed result is never rewritten
(function () {
  TM.resetTournament();
  TM.setKnockoutRule('qf', { format: 'best_of_3', pointsPerGame: 11 });
  finishGroupStage();
  ensureBracket();
  TM.saveKnockoutScore('QF-1', [{ a: 11, b: 8 }, { a: 9, b: 11 }, { a: 11, b: 7 }]);
  const qf = TM.getMatch('QF-1');
  const resultBefore = JSON.stringify({ sets: qf.sets, setsA: qf.setsA, setsB: qf.setsB, winner: qf.winner, status: qf.status });
  // every rules edit is refused while the bracket exists
  check('completed protection: locked edit refused', !TM.setKnockoutRule('qf', { format: 'single_game', pointsPerGame: 21 }).ok);
  check('completed protection: locked sf edit refused', !TM.setKnockoutRule('sf', { format: 'single_game', pointsPerGame: 21 }).ok);
  check('completed protection: locked final edit refused', !TM.setKnockoutRule('final', { format: 'single_game', pointsPerGame: 21 }).ok);
  const after = TM.getMatch('QF-1');
  eq('completed protection: result unchanged', JSON.stringify({ sets: after.sets, setsA: after.setsA, setsB: after.setsB, winner: after.winner, status: after.status }), resultBefore);
  eq('completed protection: scoring snapshot unchanged', TM.matchScoring(after).format, 'best_of_3');
})();

// TEST 10 — migration: state without knockoutRules gains the defaults
(function () {
  const legacy = {
    version: 6,
    teams: [
      { id: 'A1', group: 'A', name: 'A One', players: ['x', 'y'], level: 'tunga' },
      { id: 'A2', group: 'A', name: 'A Two', players: ['x', 'y'], level: 'tunga' },
      { id: 'B1', group: 'B', name: 'B One', players: ['x', 'y'], level: 'bhadra' },
      { id: 'B2', group: 'B', name: 'B Two', players: ['x', 'y'], level: 'bhadra' }
    ],
    groups: { A: ['A1', 'A2'], B: ['B1', 'B2'] },
    matches: [
      { id: 'A-01', stage: 'group', group: 'A', round: 1, teamA: 'A1', teamB: 'A2', status: 'completed', scoreA: 21, scoreB: 15, winner: 'A1', loser: 'A2', target: null }
    ],
    settings: { qualification: { perGroup: 2 } }
  };
  const m = TM.migrate(JSON.parse(JSON.stringify(legacy)));
  eq('migration: knockoutRules seeded', !!m.settings.knockoutRules, true);
  eq('migration: QF default', m.settings.knockoutRules.qf.pointsPerGame, 11);
  eq('migration: SF default', m.settings.knockoutRules.sf.pointsPerGame, 15);
  eq('migration: Final default', m.settings.knockoutRules.final.pointsPerGame, 21);
  eq('migration: QF format', m.settings.knockoutRules.qf.format, 'best_of_3');
  // existing matches / results / groups untouched
  eq('migration: teams preserved', m.teams.length, 4);
  eq('migration: groups preserved', JSON.stringify(m.groups), JSON.stringify({ A: ['A1', 'A2'], B: ['B1', 'B2'] }));
  eq('migration: result preserved', m.matches[0].scoreA, 21);
  eq('migration: winner preserved', m.matches[0].winner, 'A1');
  eq('migration: no fixtures regenerated', m.matches.length, 1);
  // idempotent
  const m2 = TM.migrate(JSON.parse(JSON.stringify(m)));
  eq('migration: idempotent', JSON.stringify(m2.settings.knockoutRules), JSON.stringify(m.settings.knockoutRules));
  // legacy knockout match without a snapshot behaves as best of 3 at its target
  const legacyKo = TM.migrate({ matches: [{ id: 'QF-1', stage: 'qf', teamA: 'A1', teamB: 'B1', target: 21, sets: [{ a: 21, b: 10 }, { a: 21, b: 9 }, { a: null, b: null }] }] });
  eq('migration: legacy knockout match defaults best_of_3', TM.matchScoring(legacyKo.matches[0]).format, 'best_of_3');
  eq('migration: legacy knockout match target preserved', TM.matchScoring(legacyKo.matches[0]).pointsPerGame, 21);
})();

// TEST 11 — invalid configuration is rejected
(function () {
  TM.resetTournament();
  const bad = [
    ['points 0', { format: 'best_of_3', pointsPerGame: 0 }],
    ['points -1', { format: 'best_of_3', pointsPerGame: -1 }],
    ['points NaN', { format: 'best_of_3', pointsPerGame: NaN }],
    ['points Infinity', { format: 'best_of_3', pointsPerGame: Infinity }],
    ['points non-numeric', { format: 'best_of_3', pointsPerGame: 'eleven' }],
    ['points non-integer', { format: 'best_of_3', pointsPerGame: 11.5 }],
    ['bad format', { format: 'best_of_five', pointsPerGame: 11 }],
    ['missing format', { pointsPerGame: 11 }],
    ['above bound', { format: 'best_of_3', pointsPerGame: 1000 }],
    ['null rule', null]
  ];
  bad.forEach(function (pair) {
    const r = TM.setKnockoutRule('qf', pair[1]);
    check('invalid config rejected: ' + pair[0], !r.ok, JSON.stringify(pair[1]));
  });
  // rejected config never lands in state; the default remains
  eq('invalid config: state untouched', TM.getKnockoutRules().rules.qf.pointsPerGame, 11);
  // unknown round rejected
  check('invalid config: unknown round rejected', !TM.setKnockoutRule('zz', { format: 'best_of_3', pointsPerGame: 11 }).ok);
  // valid boundary accepted
  check('valid config: points 1 accepted', TM.setKnockoutRule('qf', { format: 'best_of_3', pointsPerGame: 1 }).ok);
  check('valid config: points 99 accepted', TM.setKnockoutRule('qf', { format: 'best_of_3', pointsPerGame: 99 }).ok);
  eq('valid config: persisted', TM.getKnockoutRules().rules.qf.pointsPerGame, 99);
  // a malformed stored rule is normalized back to the default on read
  TM.resetTournament();
  TM.getState().settings.knockoutRules.qf = { format: 'nonsense', pointsPerGame: 0 };
  eq('malformed stored rule falls back to default', TM.knockoutRuleFor('qf').pointsPerGame, 11);
})();

// TEST 12 — group stage regression: unaffected by knockout configuration
(function () {
  TM.resetTournament();
  const before = JSON.stringify(TM.groupMatches().map(function (m) { return [m.id, m.teamA, m.teamB]; }));
  TM.setKnockoutRule('qf', { format: 'single_game', pointsPerGame: 21 });
  TM.setKnockoutRule('sf', { format: 'single_game', pointsPerGame: 21 });
  TM.setKnockoutRule('final', { format: 'single_game', pointsPerGame: 21 });
  eq('group regression: group target still 21', TM.GROUP_TARGET, 21);
  eq('group regression: fixtures unchanged', JSON.stringify(TM.groupMatches().map(function (m) { return [m.id, m.teamA, m.teamB]; })), before);
  const gm = TM.groupMatches()[0];
  check('group regression: group score validated to 21', TM.validateGroupScore(21, 15) === null);
  check('group regression: 11-9 group score rejected', TM.validateGroupScore(11, 9) !== null);
  const r = TM.saveGroupScore(gm.id, 21, 15);
  check('group regression: group result saves', r.ok, r.msg);
  eq('group regression: win still 2 points', TM.computeStandings('A')[0].pts, 2);
})();

// TEST 13 — scheduler regression: ordering / court suggestions unchanged
(function () {
  TM.resetTournament();
  TM.getState().settings.allowOutsideAvailability = true;
  const r1 = TM.rankCandidates(0).map(function (r) { return r.match.id; }).join(',');
  const s1 = JSON.stringify(TM.suggestCourts());
  check('scheduler regression: candidate list non-empty', r1.length > 0, r1.length);
  check('scheduler regression: suggestions non-empty', s1.length > 4, s1);
  TM.setKnockoutRule('qf', { format: 'single_game', pointsPerGame: 21 });
  const r2 = TM.rankCandidates(0).map(function (r) { return r.match.id; }).join(',');
  const s2 = JSON.stringify(TM.suggestCourts());
  eq('scheduler regression: ranking unchanged', r2, r1);
  eq('scheduler regression: suggestions unchanged', s2, s1);
})();

// TEST 14 — knockout structure regression
(function () {
  TM.resetTournament();
  TM.setKnockoutRule('sf', { format: 'single_game', pointsPerGame: 21 });
  finishGroupStage();
  ensureBracket();
  eq('structure: 20 group matches', TM.groupMatches().length, 20);
  eq('structure: 4 quarter-finals', TM.getState().matches.filter(function (m) { return m.stage === 'qf'; }).length, 4);
  eq('structure: 8 qualifiers', (function () { let c = 0; const q = TM.getState().knockout.qualifiers; Object.keys(q).forEach(function (g) { c += q[g].length; }); return c; })(), 8);
  // play out the bracket
  let guard = 0;
  while (!TM.knockoutInfo().champion && guard++ < 40) {
    const queued = TM.getState().matches.filter(function (m) { return m.stage !== 'group' && m.status === 'queued' && m.teamA && m.teamB && !m.bye; });
    if (!queued.length) { ensureBracket(); continue; }
    queued.forEach(function (m) {
      const sc = TM.matchScoring(m);
      if (sc.format === 'single_game') TM.saveKnockoutScore(m.id, [{ a: sc.pointsPerGame, b: sc.pointsPerGame - 5 }]);
      else TM.saveKnockoutScore(m.id, [{ a: sc.pointsPerGame, b: sc.pointsPerGame - 5 }, { a: sc.pointsPerGame, b: sc.pointsPerGame - 6 }]);
    });
  }
  eq('structure: 2 semi-finals', TM.getState().matches.filter(function (m) { return m.stage === 'sf'; }).length, 2);
  eq('structure: 1 final', TM.getState().matches.filter(function (m) { return m.stage === 'final'; }).length, 1);
  eq('structure: 27 total matches', TM.progress().overallTotal, 27);
  check('structure: champion decided under mixed formats', !!TM.knockoutInfo().champion);
  // the straight-set SF actually stored one game
  const sf = TM.getState().matches.filter(function (m) { return m.stage === 'sf'; })[0];
  eq('structure: straight SF stored one game', sf.sets.length, 1);
})();

/* ── 47b. staged knockout workflow + rules lock ─────────── */
// Workflow: Group Stage → Configure Knockout Rules → Generate/Start Knockout
//   → 🔒 Knockout Rules Locked → QF → SF → Final
(function () {
  TM.resetTournament();
  // Step 1: group stage in progress — Configure is already available, nothing else is ready.
  let flow = TM.knockoutWorkflow();
  eq('flow: 5 steps', flow.length, 5);
  eq('flow: group current', flow[0].state, 'current');
  eq('flow: configure available during group stage', flow[1].state, 'current');
  eq('flow: generate pending during group stage', flow[2].state, 'pending');
  eq('flow: rules not locked before generation', TM.knockoutRulesLocked(), false);

  // Rules are freely configurable during the group stage.
  check('flow: rules configurable before generation', TM.setKnockoutRule('qf', { format: 'single_game', pointsPerGame: 21 }).ok);

  finishGroupStage();
  // Step 2: group stage complete, rules configured, knockout not yet started.
  flow = TM.knockoutWorkflow();
  eq('flow: group done', flow[0].state, 'done');
  eq('flow: configure current once group complete', flow[1].state, 'current');
  eq('flow: generate current once group complete', flow[2].state, 'current');
  eq('flow: locked still pending', flow[3].state, 'pending');
  check('flow: no bracket before starting', !TM.knockoutInfo().exists);
  check('flow: rules still editable before generation', TM.setKnockoutRule('sf', { format: 'single_game', pointsPerGame: 21 }).ok);

  // Step 3: start the knockout — this locks the rules.
  const gen = TM.generateKnockout();
  check('flow: generate/start ok', gen.ok, gen.msg);
  flow = TM.knockoutWorkflow();
  eq('flow: configure done', flow[1].state, 'done');
  eq('flow: generate done', flow[2].state, 'done');
  eq('flow: locked done', flow[3].state, 'done');
  eq('flow: bracket current', flow[4].state, 'current');
  eq('flow: rules locked after generation', TM.knockoutRulesLocked(), true);
  check('flow: locked rules refuse an edit', !TM.setKnockoutRule('qf', { format: 'best_of_3', pointsPerGame: 11 }).ok);
  check('flow: getKnockoutRules reports the lock', TM.getKnockoutRules().locked === true);
  // the QF generated from the pre-generation config keeps the configured rule
  eq('flow: generated QF used the configured rule', TM.matchScoring(TM.getMatch('QF-1')).format, 'single_game');

  // Resetting the knockout unlocks the rules again.
  TM.clearKnockout();
  eq('flow: reset unlocks rules', TM.knockoutRulesLocked(), false);
  check('flow: editable again after reset', TM.setKnockoutRule('qf', { format: 'best_of_3', pointsPerGame: 11 }).ok);
  flow = TM.knockoutWorkflow();
  eq('flow: bracket pending after reset', flow[4].state, 'pending');
  eq('flow: configure current again after reset', flow[1].state, 'current');

  // Full run to a champion ends with the bracket step done.
  ensureBracket();
  let guard = 0;
  while (!TM.knockoutInfo().champion && guard++ < 40) {
    const queued = TM.getState().matches.filter(function (m) { return m.stage !== 'group' && m.status === 'queued' && m.teamA && m.teamB && !m.bye; });
    if (!queued.length) { ensureBracket(); continue; }
    queued.forEach(function (m) {
      const sc = TM.matchScoring(m);
      if (sc.format === 'single_game') TM.saveKnockoutScore(m.id, [{ a: sc.pointsPerGame, b: sc.pointsPerGame - 5 }]);
      else TM.saveKnockoutScore(m.id, [{ a: sc.pointsPerGame, b: sc.pointsPerGame - 5 }, { a: sc.pointsPerGame, b: sc.pointsPerGame - 6 }]);
    });
  }
  check('flow: champion crowned', !!TM.knockoutInfo().champion);
  flow = TM.knockoutWorkflow();
  eq('flow: bracket done once champion decided', flow[4].state, 'done');
})();

// The workflow indicator is derived from live state only — nothing is persisted.
(function () {
  TM.resetTournament();
  const src = html;
  check('workflow: not stored in state', !/state\.knockoutWorkflow/.test(src) && !/state\.workflow\b/.test(src));
  check('workflow: no stored lock flag', !/state\.(settings|knockout)\.(rulesLocked|locked|knockoutRulesLocked)/.test(src));
  const raw = JSON.parse(TM.exportJSON());
  check('workflow: export has no workflow blob', raw.workflow === undefined && raw.knockoutWorkflow === undefined);
  // the lock is derived from the presence of knockout matches
  eq('workflow: unlocked with no bracket', TM.knockoutRulesLocked(), false);
  TM.getState().matches.push({ id: 'QF-9', stage: 'qf', teamA: 'A1', teamB: 'A2', status: 'queued' });
  eq('workflow: locked once any knockout match exists', TM.knockoutRulesLocked(), true);
})();

/* ── 47c. knockout scoring lock: edit freely before, locked after ────────── */
// The business rule: the QF/SF/Final format and points are editable at any time
// before the knockout is started (during the group stage, after it, before
// Generate / Start knockout), and permanently locked once it has started.
(function () {
  // (A) Configuration before the knockout — during the group stage.
  TM.resetTournament();
  eq('lock: unlocked during group stage', TM.knockoutRulesLocked(), false);
  check('lock: QF editable during group stage', TM.setKnockoutRule('qf', { format: 'single_game', pointsPerGame: 21 }).ok);
  check('lock: SF editable during group stage', TM.setKnockoutRule('sf', { format: 'best_of_3', pointsPerGame: 15 }).ok);
  check('lock: Final editable during group stage', TM.setKnockoutRule('final', { format: 'best_of_3', pointsPerGame: 21 }).ok);
  eq('lock: QF points took effect', TM.getKnockoutRules().rules.qf.pointsPerGame, 21);

  // (A) Configuration before the knockout — group stage complete, not started.
  finishGroupStage();
  eq('lock: still unlocked once groups complete', TM.knockoutRulesLocked(), false);
  check('lock: QF editable before starting', TM.setKnockoutRule('qf', { format: 'single_game', pointsPerGame: 21 }).ok);
  check('lock: SF editable before starting', TM.setKnockoutRule('sf', { format: 'best_of_3', pointsPerGame: 15 }).ok);
  check('lock: Final editable before starting', TM.setKnockoutRule('final', { format: 'best_of_3', pointsPerGame: 21 }).ok);
  eq('lock: no bracket yet', TM.knockoutInfo().exists, false);

  // (A) Generate → all three configured rules are applied to the generated matches.
  const gen = TM.generateKnockout();
  check('lock: generate/start ok', gen.ok, gen.msg);
  const qf = TM.getMatch('QF-1');
  eq('lock: generated QF = Straight set', TM.matchScoring(qf).format, 'single_game');
  eq('lock: generated QF = 21', TM.matchScoring(qf).pointsPerGame, 21);
  eq('lock: generated QF one game slot', qf.sets.length, 1);
  eq('lock: configured SF rule', TM.getKnockoutRules().rules.sf.format, 'best_of_3');
  eq('lock: configured SF points', TM.getKnockoutRules().rules.sf.pointsPerGame, 15);
  eq('lock: configured Final rule', TM.getKnockoutRules().rules.final.pointsPerGame, 21);

  // (B) Lock — every edit to every round is refused, and nothing changes.
  eq('lock: locked after starting', TM.knockoutRulesLocked(), true);
  const attempts = [
    ['QF format', 'qf', { format: 'best_of_3', pointsPerGame: 21 }],
    ['QF points', 'qf', { format: 'single_game', pointsPerGame: 11 }],
    ['SF format', 'sf', { format: 'single_game', pointsPerGame: 15 }],
    ['SF points', 'sf', { format: 'best_of_3', pointsPerGame: 21 }],
    ['Final format', 'final', { format: 'single_game', pointsPerGame: 21 }],
    ['Final points', 'final', { format: 'best_of_3', pointsPerGame: 11 }]
  ];
  attempts.forEach(function (a) {
    const r = TM.setKnockoutRule(a[1], a[2]);
    check('lock: ' + a[0] + ' change rejected', !r.ok, r.msg);
    check('lock: ' + a[0] + ' refusal explains the lock', /locked/i.test(r.msg) && /knockout stage has started/i.test(r.msg), r.msg);
  });
  eq('lock: QF rule unchanged after attempts', TM.getKnockoutRules().rules.qf.format, 'single_game');
  eq('lock: SF rule unchanged after attempts', TM.getKnockoutRules().rules.sf.pointsPerGame, 15);
  eq('lock: Final rule unchanged after attempts', TM.getKnockoutRules().rules.final.pointsPerGame, 21);

  // (B) Existing generated matches retain their scoring configuration.
  eq('lock: existing QF snapshot intact', TM.matchScoring(TM.getMatch('QF-1')).format, 'single_game');
  eq('lock: existing QF points intact', TM.matchScoring(TM.getMatch('QF-1')).pointsPerGame, 21);
})();

/* ── 47d. reset protection: a played knockout cannot be silently unlocked ── */
(function () {
  // (C) Generated but not played: a safe clear is allowed and unlocks the rules.
  TM.resetTournament();
  finishGroupStage();
  TM.generateKnockout();
  eq('reset: locked after generate', TM.knockoutRulesLocked(), true);
  eq('reset: no knockout result yet', TM.knockoutProtected(), false);
  const safeClear = TM.clearKnockout();
  check('reset: unplayed bracket clears safely', safeClear.ok, safeClear.msg);
  eq('reset: unplayed clear unlocks the rules', TM.knockoutRulesLocked(), false);
  check('reset: editable again after safe clear', TM.setKnockoutRule('qf', { format: 'best_of_3', pointsPerGame: 11 }).ok);

  // (C) In progress: clear/reset cannot silently unlock the scoring.
  TM.resetTournament();
  // Ignore the wall clock so the start is deterministic (Court 1's window is real state).
  TM.getState().settings.allowOutsideAvailability = true;
  finishGroupStage();
  TM.generateKnockout();
  const liveQf = TM.getState().matches.filter(function (m) { return m.stage === 'qf' && !m.bye && m.teamA && m.teamB; })[0];
  TM.startMatch(liveQf.id, 1, NOON);
  eq('reset: in-progress match protects the bracket', TM.knockoutProtected(), true);
  const liveClear = TM.clearKnockout();
  check('reset: in-progress clear refused', !liveClear.ok, liveClear.msg);
  check('reset: in-progress refusal explains the lock', /locked/i.test(liveClear.msg), liveClear.msg);
  eq('reset: in-progress clear left the lock on', TM.knockoutRulesLocked(), true);
  eq('reset: in-progress match survived', TM.getMatch(liveQf.id).status, 'in_progress');
  check('reset: in-progress rules still locked to edits', !TM.setKnockoutRule('qf', { format: 'single_game', pointsPerGame: 21 }).ok);
  check('reset: regeneration refused while in progress', !TM.regenerateFixtures().ok);

  // (C) Completed: a completed knockout result cannot be destroyed by a reset.
  TM.resetTournament();
  finishGroupStage();
  TM.generateKnockout();
  const doneQf = TM.getState().matches.filter(function (m) { return m.stage === 'qf' && !m.bye && m.teamA && m.teamB; })[0];
  TM.saveKnockoutScore(doneQf.id, [{ a: 11, b: 6 }, { a: 11, b: 8 }]);
  eq('reset: completed match protects the bracket', TM.knockoutProtected(), true);
  const doneClear = TM.clearKnockout();
  check('reset: completed clear refused', !doneClear.ok, doneClear.msg);
  eq('reset: completed clear left the lock on', TM.knockoutRulesLocked(), true);
  eq('reset: completed result survived', TM.getMatch(doneQf.id).status, 'completed');
  eq('reset: completed result score survived', TM.getMatch(doneQf.id).setsA, 2);
  check('reset: regeneration refused while a result exists', !TM.regenerateFixtures().ok);
  check('reset: generateGroupFixtures refused while a result exists', !TM.generateGroupFixtures().ok);

  // (C) Correcting a group result cannot silently discard a played knockout.
  const groupMatch = TM.groupMatches()[0];
  const groupReset = TM.resetMatch(groupMatch.id);
  check('reset: group-result reset refused once knockout played', !groupReset.ok, groupReset.msg);
  check('reset: group-result refusal explains the lock', /locked/i.test(groupReset.msg), groupReset.msg);

  // (C) A completed knockout result cannot be destroyed by a configuration change.
  const beforeRule = JSON.stringify(TM.getKnockoutRules().rules);
  const beforeResult = JSON.stringify({ sets: TM.getMatch(doneQf.id).sets, winner: TM.getMatch(doneQf.id).winner, status: TM.getMatch(doneQf.id).status });
  TM.setKnockoutRule('qf', { format: 'single_game', pointsPerGame: 21 });
  TM.setKnockoutRule('sf', { format: 'single_game', pointsPerGame: 21 });
  TM.setKnockoutRule('final', { format: 'single_game', pointsPerGame: 21 });
  eq('reset: rules unchanged by refused edits', JSON.stringify(TM.getKnockoutRules().rules), beforeRule);
  eq('reset: result unchanged by refused edits', JSON.stringify({ sets: TM.getMatch(doneQf.id).sets, winner: TM.getMatch(doneQf.id).winner, status: TM.getMatch(doneQf.id).status }), beforeResult);

  // (C) The lock latch survives later-round generation/advancement.
  const qfIds = TM.getState().matches.filter(function (m) { return m.stage === 'qf' && !m.bye; });
  qfIds.forEach(function (m) {
    if (m.status !== 'completed') TM.saveKnockoutScore(m.id, [{ a: 11, b: 4 }, { a: 11, b: 5 }]);
  });
  ensureBracket();
  check('reset: later round generated after QF results', TM.getState().matches.some(function (m) { return m.stage === 'sf'; }));
  eq('reset: lock survives later-round generation', TM.knockoutRulesLocked(), true);

  // (C) Only the explicit force reset clears a played knockout, and it unlocks.
  const forced = TM.clearKnockout('force');
  check('reset: force clear allowed', forced.ok, forced.msg);
  eq('reset: force clear removed the bracket', TM.getMatch('QF-1'), null);
  eq('reset: force clear unlocked the rules', TM.knockoutRulesLocked(), false);
  eq('reset: force clear reset the started latch', TM.getState().knockout.started, false);
  eq('reset: force clear kept group matches', TM.groupMatches().length > 0, true);
})();

/* ── 47e. the lock latch is durable state, healed by migration ───────────── */
(function () {
  // The latch is a property of state.knockout, not a separate workflow blob.
  TM.resetTournament();
  eq('latch: false on a fresh tournament', TM.getState().knockout.started, false);
  check('latch: no workflow blob stored', !/state\.knockoutWorkflow/.test(html) && !/state\.workflow\b/.test(html));

  // Migration heals a stored knockout that is missing the latch.
  const withBracket = TM.migrate({
    teams: [{ id: 'A1', group: 'A', name: 'a1' }, { id: 'A2', group: 'A', name: 'a2' }],
    groups: { A: ['A1', 'A2'] },
    matches: [{ id: 'F-1', stage: 'final', teamA: 'A1', teamB: 'A2', status: 'queued' }],
    knockout: { champion: null, qualifiers: null }
  });
  eq('latch: migration heals a bracket without a latch', withBracket.knockout.started, true);
  const noBracket = TM.migrate({
    teams: [{ id: 'A1', group: 'A', name: 'a1' }, { id: 'A2', group: 'A', name: 'a2' }],
    groups: { A: ['A1', 'A2'] },
    matches: [{ id: 'A-01', stage: 'group', group: 'A', teamA: 'A1', teamB: 'A2', status: 'queued' }]
  });
  eq('latch: migration leaves a group-only state unlocked', noBracket.knockout.started, false);

  // The latch round-trips through export/import.
  TM.resetTournament();
  finishGroupStage();
  TM.generateKnockout();
  const exported = TM.exportJSON();
  TM.resetTournament();
  check('latch: import ok', TM.importJSON(exported).ok);
  eq('latch: imported state keeps the lock', TM.knockoutRulesLocked(), true);
  check('latch: imported bracket still refuses edits', !TM.setKnockoutRule('qf', { format: 'best_of_3', pointsPerGame: 11 }).ok);
})();

/* ═══════════════════════════════════════════════════════════════════════════
   HARDENING: real-world corrections and participant editing
   ═══════════════════════════════════════════════════════════════════════════
   Covers the objective end to end:
     A. Knockout format configuration (QF/SF/Final, Straight vs BO3, points)
     B. Straight-set scoring semantics
     C. Best-of-3 scoring semantics
     D. Result correction propagating through the bracket
     E. Downstream protection (auto-update vs conflict + explicit repair)
     F. Knockout participant display-name editing
     G. Regression of existing behaviour
   ═══════════════════════════════════════════════════════════════════════════ */

// Build a full 4-qualifier bracket (QF1..QF4 → SF1..SF2 → Final) with the given
// per-round rules. Returns the state; the bracket is left with no results yet.
function buildBracketWithRules(rules) {
  TM.resetTournament();
  finishGroupStage();
  if (rules) Object.keys(rules).forEach(function (k) { TM.setKnockoutRule(k, rules[k]); });
  const g = TM.generateKnockout();
  if (!g.ok) throw new Error('generateKnockout failed: ' + g.msg);
  return TM.getState();
}
// The QF matches in bracket order, byes excluded.
function qfList() {
  return TM.getState().matches.filter(function (m) { return m.stage === 'qf' && !m.bye; }).sort(byNum);
}
function byNum(a, b) { return (parseInt(String(a.id).replace(/\D/g, ''), 10) || 0) - (parseInt(String(b.id).replace(/\D/g, ''), 10) || 0); }
// Save a decisive result for a knockout match to the given side, honouring the
// match's own snapshot: a straight set is one game, a best of 3 is two straight games.
function winBySide(m, side, sc) {
  const s = sc || TM.matchScoring(m);
  const t = s.pointsPerGame;
  const straight = s.format === 'single_game';
  const win = straight ? [{ a: t, b: t - 6 }] : [{ a: t, b: t - 6 }, { a: t, b: t - 4 }];
  const sets = side === 'A' ? win : win.map(function (g) { return { a: g.b, b: g.a }; });
  return TM.saveKnockoutScore(m.id, sets);
}
function winByA(m, sc) { return winBySide(m, 'A', sc); }
function winByB(m, sc) { return winBySide(m, 'B', sc); }
// Complete every not-yet-decided QF so the SF round is generated.
function completeQfs() {
  qfList().forEach(function (m) { if (m.status !== 'completed') winByA(m); });
}

/* ── A. configuration: QF/SF/Final independently, editable before, locked after ── */
(function () {
  // The exact example matrix from the objective.
  TM.resetTournament();
  eq('A: rules editable before generation', TM.knockoutRulesLocked(), false);
  check('A: QF straight × 21', TM.setKnockoutRule('qf', { format: 'single_game', pointsPerGame: 21 }).ok);
  check('A: SF best of 3 × 15', TM.setKnockoutRule('sf', { format: 'best_of_3', pointsPerGame: 15 }).ok);
  check('A: Final straight × 21', TM.setKnockoutRule('final', { format: 'single_game', pointsPerGame: 21 }).ok);
  let byKey = {};
  TM.getKnockoutRules().rounds.forEach(function (r) { byKey[r.key] = r; });
  eq('A: QF stored straight/21', byKey.qf.format + '/' + byKey.qf.pointsPerGame, 'single_game/21');
  eq('A: SF stored bo3/15', byKey.sf.format + '/' + byKey.sf.pointsPerGame, 'best_of_3/15');
  eq('A: Final stored straight/21', byKey.final.format + '/' + byKey.final.pointsPerGame, 'single_game/21');

  // Straight → BO3 and back again, before the knockout starts.
  check('A: straight → bo3 before knockout', TM.setKnockoutRule('qf', { format: 'best_of_3', pointsPerGame: 11 }).ok);
  eq('A: qf now bo3', TM.getKnockoutRules().rounds.find(function (r) { return r.key === 'qf'; }).format, 'best_of_3');
  check('A: bo3 → straight before knockout', TM.setKnockoutRule('qf', { format: 'single_game', pointsPerGame: 21 }).ok);
  eq('A: qf straight again', TM.getKnockoutRules().rounds.find(function (r) { return r.key === 'qf'; }).format, 'single_game');

  // Points change before the knockout.
  check('A: points change before knockout', TM.setKnockoutRule('sf', { format: 'best_of_3', pointsPerGame: 21 }).ok);
  eq('A: sf points updated', TM.getKnockoutRules().rounds.find(function (r) { return r.key === 'sf'; }).pointsPerGame, 21);

  // Independent configuration per round — changing one never touches another.
  check('A: qf independent of sf', TM.setKnockoutRule('qf', { format: 'best_of_3', pointsPerGame: 11 }).ok);
  byKey = {};
  TM.getKnockoutRules().rounds.forEach(function (r) { byKey[r.key] = r; });
  eq('A: sf untouched by qf edit', byKey.sf.pointsPerGame, 21);
  eq('A: final untouched by qf edit', byKey.final.format, 'single_game');

  // Generate/Start locks everything.
  finishGroupStage();
  const gen = TM.generateKnockout();
  check('A: generate ok', gen.ok, gen.msg);
  eq('A: locked after generate', TM.knockoutRulesLocked(), true);
  check('A: qf locked', !TM.setKnockoutRule('qf', { format: 'single_game', pointsPerGame: 21 }).ok);
  check('A: sf locked', !TM.setKnockoutRule('sf', { format: 'best_of_3', pointsPerGame: 15 }).ok);
  check('A: final locked', !TM.setKnockoutRule('final', { format: 'best_of_3', pointsPerGame: 21 }).ok);
  // Each generated round carries its own snapshot, not the current global setting.
  eq('A: QF snapshot straight/11', TM.matchScoring(TM.getMatch('QF-1')).format + '/' + TM.matchScoring(TM.getMatch('QF-1')).pointsPerGame, 'best_of_3/11');

  // The lock survives reload and export/import.
  const exported = TM.exportJSON();
  TM.resetTournament();
  check('A: import ok', TM.importJSON(exported).ok);
  eq('A: lock survives import', TM.knockoutRulesLocked(), true);
  check('A: imported rules still refuse edits', !TM.setKnockoutRule('qf', { format: 'single_game', pointsPerGame: 21 }).ok);
  // Reload path (localStorage) keeps the latch too.
  TM.load();
  eq('A: lock survives reload', TM.knockoutRulesLocked(), true);
  // No reset/regenerate path silently unlocks a played knockout.
  const played = TM.getMatch('QF-1');
  winByA(played);
  eq('A: clear refused while played', TM.clearKnockout().ok, false);
  eq('A: lock held after refused clear', TM.knockoutRulesLocked(), true);
  check('A: regenerate refused while played', !TM.regenerateFixtures().ok);
})();

/* ── B. straight-set scoring semantics ───────────────────────────────────── */
(function () {
  buildBracketWithRules({ qf: { format: 'single_game', pointsPerGame: 21 } });
  const m = qfList()[0];
  eq('B: straight snapshot format', TM.matchScoring(m).format, 'single_game');
  eq('B: straight snapshot points', TM.matchScoring(m).pointsPerGame, 21);
  eq('B: straight tag is not best-of-2', TM.matchFormatTag(m), 'Straight set × 21');

  // Exactly one game: the higher valid score wins.
  let r = TM.saveKnockoutScore(m.id, [{ a: 21, b: 15 }]);
  check('B: single game accepted', r.ok, r.msg);
  eq('B: one game stored', TM.getMatch(m.id).sets.filter(function (s) { return s.a !== null; }).length, 1);
  eq('B: higher score wins', TM.getMatch(m.id).winner, m.teamA);
  eq('B: sets won A', TM.getMatch(m.id).setsA, 1);

  // A straight match must never persist a second or third game.
  eq('B: no game 2 slot stored', TM.getMatch(m.id).sets.length, 1);
  // Attempts to submit multiple games are rejected before anything is stored.
  const before = JSON.stringify(TM.getMatch(m.id).sets);
  r = TM.saveKnockoutScore(m.id, [{ a: 21, b: 15 }, { a: 21, b: 15 }]);
  check('B: game 2 rejected', !r.ok, r.msg);
  r = TM.saveKnockoutScore(m.id, [{ a: 21, b: 15 }, { a: 21, b: 15 }, { a: 21, b: 15 }]);
  check('B: game 3 rejected', !r.ok, r.msg);
  eq('B: rejected multi-game left state intact', JSON.stringify(TM.getMatch(m.id).sets), before);

  // A tie / short game is not a valid single game.
  check('B: tie rejected', !TM.saveKnockoutScore(m.id, [{ a: 21, b: 21 }]).ok);
  check('B: short game rejected', !TM.saveKnockoutScore(m.id, [{ a: 19, b: 15 }]).ok);

  // The scoring snapshot, not the current global setting, drives validation.
  const sc = TM.matchScoring(TM.getMatch(m.id));
  check('B: 21 target enforced by snapshot', TM.validateSetScore(19, 15, sc.pointsPerGame) !== null);
})();

/* ── C. best-of-3 scoring semantics ──────────────────────────────────────── */
(function () {
  buildBracketWithRules({ qf: { format: 'best_of_3', pointsPerGame: 11 } });
  const m = qfList()[0];
  eq('C: bo3 snapshot format', TM.matchScoring(m).format, 'best_of_3');
  eq('C: bo3 tag', TM.matchFormatTag(m), 'Best of 3 × 11');

  // 2–0 finishes without a third game.
  let r = TM.saveKnockoutScore(m.id, [{ a: 11, b: 5 }, { a: 11, b: 7 }]);
  check('C: 2–0 accepted', r.ok, r.msg);
  eq('C: 2–0 sets A/B', TM.getMatch(m.id).setsA + '-' + TM.getMatch(m.id).setsB, '2-0');
  eq('C: 2–0 winner is A', TM.getMatch(m.id).winner, m.teamA);
  eq('C: 2–0 no game 3 played', TM.getMatch(m.id).sets[2].a, null);

  // 2–1 needs and accepts the third game.
  buildBracketWithRules({ qf: { format: 'best_of_3', pointsPerGame: 11 } });
  const m2 = qfList()[0];
  r = TM.saveKnockoutScore(m2.id, [{ a: 11, b: 9 }, { a: 8, b: 11 }, { a: 11, b: 6 }]);
  check('C: 2–1 accepted', r.ok, r.msg);
  eq('C: 2–1 sets A/B', TM.getMatch(m2.id).setsA + '-' + TM.getMatch(m2.id).setsB, '2-1');

  // A 1–1 split is not a completed result.
  buildBracketWithRules({ qf: { format: 'best_of_3', pointsPerGame: 11 } });
  const m3 = qfList()[0];
  r = TM.saveKnockoutScore(m3.id, [{ a: 11, b: 5 }, { a: 5, b: 11 }]);
  check('C: 1–1 rejected as a result', !r.ok, r.msg);
  check('C: 1–1 refusal explains the decider', /game 3|two games/i.test(r.msg), r.msg);
  eq('C: 1–1 did not complete the match', TM.getMatch(m3.id).status, 'queued');

  // An unnecessary third game after a 2–0 is rejected.
  r = TM.saveKnockoutScore(m3.id, [{ a: 11, b: 5 }, { a: 11, b: 5 }, { a: 11, b: 5 }]);
  check('C: unnecessary game 3 rejected', !r.ok, r.msg);
  // Only two games may decide; three games must be 2–1.
  r = TM.saveKnockoutScore(m3.id, [{ a: 11, b: 5 }, { a: 5, b: 11 }, { a: 11, b: 5 }]);
  check('C: valid decider accepted after a split', r.ok, r.msg);
})();

/* ── D. result correction propagates through the bracket ─────────────────── */
(function () {
  buildBracketWithRules({ qf: { format: 'single_game', pointsPerGame: 21 }, sf: { format: 'single_game', pointsPerGame: 21 }, final: { format: 'single_game', pointsPerGame: 21 } });
  const qfs = qfList();
  const qf1 = TM.getMatch(qfs[0].id);
  const origWinner = qf1.teamA, origLoser = qf1.teamB;

  // A wins QF1 → the winner feeds SF1.
  winByA(qf1);
  completeQfs();
  let sf1 = TM.getMatch('SF-1');
  check('D: SF1 exists after QFs', !!sf1);
  eq('D: SF1 A is QF1 winner', TM.matchParticipantId(sf1, 'A'), origWinner);
  eq('D: SF1 A is a source-derived slot', !!sf1.sourceA, true);
  eq('D: SF1 A source is QF1', sf1.sourceA.matchId, qf1.id);
  eq('D: SF1 label names the source', TM.sourceLabel(sf1, 'A'), 'Winner of QF-1');

  // Operator corrects QF1: B actually won.
  const corr = TM.saveKnockoutScore(qf1.id, [{ a: 9, b: 21 }]);
  check('D: QF1 correction accepted', corr.ok, corr.msg);
  eq('D: QF1 winner corrected', TM.getMatch(qf1.id).winner, origLoser);
  // SF1 (not started) is updated automatically and keeps its identity + scoring.
  eq('D: SF1 A updated to the corrected winner', TM.matchParticipantId(TM.getMatch('SF-1'), 'A'), origLoser);
  eq('D: SF1 id preserved', !!TM.getMatch('SF-1'), true);
  eq('D: SF1 scoring preserved', TM.matchScoring(TM.getMatch('SF-1')).pointsPerGame, 21);
  // No stale name anywhere in the bracket.
  const stale = TM.getState().matches.filter(function (m) {
    return m.stage !== 'group' && (m.teamA === origWinner || m.teamB === origWinner) && m.id !== qf1.id;
  });
  eq('D: no stale QF1 winner left downstream', stale.length, 0);

  // Correct an SF winner → the Final updates.
  const sf1Winner = TM.matchParticipantId(TM.getMatch('SF-1'), 'A');
  const sf1Other = TM.matchParticipantId(TM.getMatch('SF-1'), 'B');
  winByA(TM.getMatch('SF-1'));
  winByA(TM.getMatch('SF-2'));
  let f = TM.getMatch('F-1');
  check('D: Final exists after SFs', !!f);
  eq('D: Final A is SF1 winner', TM.matchParticipantId(f, 'A'), sf1Winner);
  // Correct SF1 to the other side.
  const corrSf = TM.saveKnockoutScore('SF-1', [{ a: 12, b: 21 }]);
  check('D: SF1 correction accepted', corrSf.ok, corrSf.msg);
  eq('D: SF1 winner corrected', TM.getMatch('SF-1').winner, sf1Other);
  // Final (not started) resolves from the current SF winner — never the old finalist.
  eq('D: Final A follows the corrected SF1 winner', TM.matchParticipantId(TM.getMatch('F-1'), 'A'), sf1Other);
  check('D: stale finalist name gone', TM.matchParticipantId(TM.getMatch('F-1'), 'A') !== sf1Winner);
})();

/* ── E. downstream protection: auto-update vs conflict + explicit repair ─── */
(function () {
  buildBracketWithRules({ qf: { format: 'single_game', pointsPerGame: 21 }, sf: { format: 'single_game', pointsPerGame: 21 } });
  const qf1 = qfList()[0];
  winByA(qf1);
  completeQfs();
  const sf1 = TM.getMatch('SF-1');
  const sf1A = TM.matchParticipantId(sf1, 'A');

  // (1) Dependent match NOT started → auto-update, preserve the match.
  winByB(TM.getMatch(qf1.id)); // QF1 flips
  eq('E: unplayed dependent auto-updates', TM.matchParticipantId(TM.getMatch('SF-1'), 'A') !== sf1A, true);
  eq('E: unplayed dependent preserved (same id)', !!TM.getMatch('SF-1'), true);
  eq('E: unplayed dependent not a conflict', TM.scanBracketConflicts().length, 0);

  // (2) Dependent match IN PROGRESS → conflict, never silently overwritten.
  const nowA = TM.matchParticipantId(TM.getMatch('SF-1'), 'A');
  TM.startMatch('SF-1', 1, NOON);
  eq('E: SF1 live participant', TM.getMatch('SF-1').teamA, nowA);
  // Correct QF1 the other way.
  winByA(TM.getMatch(qf1.id));
  let conflicts = TM.scanBracketConflicts();
  eq('E: live dependent raises a conflict', conflicts.length, 1);
  eq('E: conflict names the match', conflicts[0].matchId, 'SF-1');
  eq('E: conflict records the status', conflicts[0].status, 'in_progress');
  eq('E: live dependent participant preserved', TM.getMatch('SF-1').teamA, nowA);
  eq('E: live dependent still in progress', TM.getMatch('SF-1').status, 'in_progress');

  // (3) Explicit repair resolves it and preserves the match object + scoring.
  const sfId = TM.getMatch('SF-1').id;
  const rep = TM.repairBranch('QF-1');
  check('E: repair ok', rep.ok, rep.msg);
  eq('E: repair reset the dependent', rep.reset.indexOf('SF-1') !== -1, true);
  eq('E: repaired dependent re-queued', TM.getMatch(sfId).status, 'queued');
  eq('E: repaired dependent re-resolved', TM.matchParticipantId(TM.getMatch(sfId), 'A'), TM.matchParticipantId(TM.getMatch(qf1.id), 'A'));
  eq('E: repaired dependent keeps its id', !!TM.getMatch(sfId), true);
  eq('E: repaired dependent keeps scoring', TM.matchScoring(TM.getMatch(sfId)).pointsPerGame, 21);
  eq('E: no conflicts remain after repair', TM.scanBracketConflicts().length, 0);

  // (4) Dependent match COMPLETED → conflict, and no silent result loss.
  buildBracketWithRules({ qf: { format: 'single_game', pointsPerGame: 21 }, sf: { format: 'single_game', pointsPerGame: 21 } });
  const q2 = qfList()[0];
  winByA(q2);
  completeQfs();
  winByA(TM.getMatch('SF-1'));
  const recordedSf = JSON.stringify(TM.getMatch('SF-1').sets);
  const recordedWinner = TM.getMatch('SF-1').winner;
  winByB(TM.getMatch(q2.id)); // flip QF1 after SF1 is completed
  conflicts = TM.scanBracketConflicts();
  eq('E: completed dependent raises a conflict', conflicts.length, 1);
  eq('E: completed dependent status recorded', conflicts[0].status, 'completed');
  eq('E: completed dependent result untouched', JSON.stringify(TM.getMatch('SF-1').sets), recordedSf);
  eq('E: completed dependent winner untouched', TM.getMatch('SF-1').winner, recordedWinner);
  // Repair is explicit; it clears the recorded dependent result and re-resolves.
  const rep2 = TM.repairBranch('QF-1');
  check('E: completed-branch repair ok', rep2.ok, rep2.msg);
  eq('E: completed dependent cleared on repair', TM.getMatch('SF-1').status, 'queued');
  eq('E: completed dependent winner cleared on repair', TM.getMatch('SF-1').winner, null);
  // The cleared result is preserved in the match's history, so the repair is auditable.
  check('E: repair recorded the cleared result in history', Array.isArray(TM.getMatch('SF-1').history) && TM.getMatch('SF-1').history.length >= 1);
  const hist = TM.getMatch('SF-1').history.slice(-1)[0];
  eq('E: history entry is marked a branch repair', hist.reason, 'branch-repair');
  eq('E: history keeps the cleared winner', hist.winner, recordedWinner);
  eq('E: history keeps the cleared sets', JSON.stringify(hist.sets), recordedSf);
})();

/* ── E2. sources survive reload / export / import ────────────────────────── */
(function () {
  buildBracketWithRules({ qf: { format: 'single_game', pointsPerGame: 21 }, sf: { format: 'single_game', pointsPerGame: 21 } });
  completeQfs();
  const sf1 = TM.getMatch('SF-1');
  eq('E2: SF1 has a source descriptor', !!sf1.sourceA && !!sf1.sourceB, true);
  eq('E2: source names the feeder', sf1.sourceA.matchId, 'QF-1');

  // Export → import preserves the dependency (not a frozen winner).
  const exported = TM.exportJSON();
  TM.resetTournament();
  check('E2: import ok', TM.importJSON(exported).ok);
  eq('E2: source survives import', TM.getMatch('SF-1').sourceA.matchId, 'QF-1');
  // And the import re-derives the participant from the (still correct) feeder.
  eq('E2: import re-derives the participant', TM.matchParticipantId(TM.getMatch('SF-1'), 'A'), TM.getMatch('QF-1').winner);

  // A corrected feeder after import still flows through (dependency, not a copy).
  const before = TM.matchParticipantId(TM.getMatch('SF-1'), 'A');
  winByB(TM.getMatch('QF-1'));
  check('E2: corrected feeder changes the dependent after import', TM.matchParticipantId(TM.getMatch('SF-1'), 'A') !== before);

  // Reload (localStorage) also keeps the dependency.
  TM.load();
  eq('E2: source survives reload', TM.getMatch('SF-1').sourceA.matchId, 'QF-1');
})();

/* ── F. knockout participant display-name editing ────────────────────────── */
(function () {
  buildBracketWithRules({ qf: { format: 'single_game', pointsPerGame: 21 } });
  const qf = qfList()[0];
  const teamId = qf.teamA;
  const registered = TM.getTeam(teamId).name;
  const teamsBefore = JSON.stringify(TM.getState().teams);
  const groupsBefore = JSON.stringify(TM.getState().groups);
  const standingsBefore = JSON.stringify(TM.computeStandings(TM.getTeam(teamId).group));

  // Edit a QF participant's display name.
  let r = TM.setParticipantName(teamId, 'Praveen KG & Gagan Kumar');
  check('F: set QF participant name ok', r.ok, r.msg);
  eq('F: knockout display name set', TM.knockoutDisplayName(teamId), 'Praveen KG & Gagan Kumar');
  eq('F: registered name unchanged', TM.getTeam(teamId).name, registered);
  eq('F: override flagged', TM.hasParticipantOverride(teamId), true);
  eq('F: bracket label uses the override', TM.matchParticipantLabel(qf, 'A'), 'Praveen KG & Gagan Kumar');
  // Group-stage data is untouched.
  eq('F: teams untouched', JSON.stringify(TM.getState().teams), teamsBefore);
  eq('F: groups untouched', JSON.stringify(TM.getState().groups), groupsBefore);
  eq('F: standings untouched', JSON.stringify(TM.computeStandings(TM.getTeam(teamId).group)), standingsBefore);
  eq('F: fixtures untouched', TM.groupMatches().length, 20);

  // The override survives export/import and reload.
  const exported = TM.exportJSON();
  TM.resetTournament();
  check('F: import ok', TM.importJSON(exported).ok);
  eq('F: override survives import', TM.knockoutDisplayName(teamId), 'Praveen KG & Gagan Kumar');
  TM.load();
  eq('F: override survives reload', TM.knockoutDisplayName(teamId), 'Praveen KG & Gagan Kumar');
  eq('F: registered still unchanged after round-trip', TM.getTeam(teamId).name, registered);

  // Edit an SF participant (derived) and a Final participant.
  buildBracketWithRules({ qf: { format: 'single_game', pointsPerGame: 21 }, sf: { format: 'single_game', pointsPerGame: 21 } });
  completeQfs();
  const sf = TM.getMatch('SF-1');
  const sfTeam = TM.matchParticipantId(sf, 'A');
  check('F: set SF participant name ok', TM.setParticipantName(sfTeam, 'SF Display Pair').ok);
  eq('F: SF display name applies', TM.matchParticipantLabel(sf, 'A'), 'SF Display Pair');
  winByA(TM.getMatch('SF-1'));
  winByA(TM.getMatch('SF-2'));
  const f = TM.getMatch('F-1');
  const fTeam = TM.matchParticipantId(f, 'A');
  check('F: set Final participant name ok', TM.setParticipantName(fTeam, 'Final Display Pair').ok);
  eq('F: Final display name applies', TM.matchParticipantLabel(f, 'A'), 'Final Display Pair');

  // Clearing an override restores the registered name.
  const cleared = TM.setParticipantName(teamId, '');
  check('F: clearing an override ok', cleared.ok);
  eq('F: override removed', TM.hasParticipantOverride(teamId), false);
  eq('F: label falls back to the registered name', TM.knockoutDisplayName(teamId), registered);
})();

/* ── G. regression: existing behaviour is unchanged ─────────────────────── */
(function () {
  // Group scheduling / standings / rolling courts still behave.
  TM.resetTournament();
  eq('G: 20 group matches', TM.groupMatches().length, 20);
  const sug = TM.suggestCourts(NOON);
  check('G: courts still suggest matches', Object.keys(sug).length > 0);
  finishGroupStage();
  eq('G: standings reflect results', TM.computeStandings('A').reduce(function (s, r) { return s + r.played; }, 0), 20);

  // Knockout seeding + dynamic groups still behave.
  const gen = TM.generateKnockout();
  check('G: knockout still generates', gen.ok, gen.msg);
  eq('G: bracket is the classic QF layout', TM.getState().matches.filter(function (m) { return m.stage === 'qf'; }).length, 4);
  // Every knockout match carries a scoring snapshot and (later rounds) sources.
  TM.getState().matches.filter(function (m) { return m.stage !== 'group'; }).forEach(function (m) {
    check('G: ' + m.id + ' has a scoring snapshot', !!TM.matchScoring(m).format);
  });
  // Existing reset protection still holds.
  const firstQf = qfList()[0];
  winByA(firstQf);
  eq('G: knockout protected after a result', TM.knockoutProtected(), true);
  eq('G: clear refused while protected', TM.clearKnockout().ok, false);
})();


/* ── league-stage score statistics (dashboard) ─────────── */
// The dashboard's League standings section is a pure view over computeStandings,
// the tournament engine's single source of truth. These tests pin the aggregation
// down: P/W/L/PF/PA/PD/Pts come from completed league matches only, and the
// ranking/tie-breaks are untouched.
function setScoreFor(m, teamId, mine, theirs) {
  return m.teamA === teamId ? TM.saveGroupScore(m.id, mine, theirs) : TM.saveGroupScore(m.id, theirs, mine);
}
function rowFor(group, teamId) {
  return TM.computeStandings(group).find(r => r.team.id === teamId);
}

// TEST 1 — a single completed match, both sides.
(function () {
  TM.resetTournament();
  TM.getState().settings.allowOutsideAvailability = true;
  const m = TM.groupMatches('A')[0];
  setScoreFor(m, m.teamA, 21, 15);

  const w = rowFor('A', m.teamA);
  eq('T1 winner P', w.played, 1);
  eq('T1 winner W', w.won, 1);
  eq('T1 winner L', w.lost, 0);
  eq('T1 winner PF', w.pf, 21);
  eq('T1 winner PA', w.pa, 15);
  eq('T1 winner PD', w.diff, 6);
  eq('T1 winner Pts', w.pts, 2);

  const l = rowFor('A', m.teamB);
  eq('T1 loser P', l.played, 1);
  eq('T1 loser W', l.won, 0);
  eq('T1 loser L', l.lost, 1);
  eq('T1 loser PF', l.pf, 15);
  eq('T1 loser PA', l.pa, 21);
  eq('T1 loser PD', l.diff, -6);
  eq('T1 loser Pts', l.pts, 0);
})();

// TEST 2 — multiple matches: 21-15, 18-21, 21-12, 21-19 → P4 W3 L1 PF81 PA67 PD+14 Pts6.
(function () {
  TM.resetTournament();
  TM.getState().settings.allowOutsideAvailability = true;
  const team = 'A1';
  const mine = TM.groupMatches('A').filter(m => m.teamA === team || m.teamB === team);
  eq('T2 team has 4 league matches', mine.length, 4);
  const scores = [[21, 15], [18, 21], [21, 12], [21, 19]];
  mine.forEach((m, i) => setScoreFor(m, team, scores[i][0], scores[i][1]));

  const r = rowFor('A', team);
  eq('T2 P', r.played, 4);
  eq('T2 W', r.won, 3);
  eq('T2 L', r.lost, 1);
  eq('T2 PF', r.pf, 81);
  eq('T2 PA', r.pa, 67);
  eq('T2 PD', r.diff, 14);
  eq('T2 Pts', r.pts, 6);
})();

// TEST 3 — no completed matches: every figure is zero (never NaN/undefined).
(function () {
  TM.resetTournament();
  TM.computeStandings('A').forEach(r => {
    eq('T3 ' + r.team.id + ' P', r.played, 0);
    eq('T3 ' + r.team.id + ' W', r.won, 0);
    eq('T3 ' + r.team.id + ' L', r.lost, 0);
    eq('T3 ' + r.team.id + ' PF', r.pf, 0);
    eq('T3 ' + r.team.id + ' PA', r.pa, 0);
    eq('T3 ' + r.team.id + ' PD', r.diff, 0);
    eq('T3 ' + r.team.id + ' Pts', r.pts, 0);
  });
})();

// TEST 4 — live and scheduled matches must not contribute to league statistics.
(function () {
  TM.resetTournament();
  TM.getState().settings.allowOutsideAvailability = true;
  const gm = TM.groupMatches('A');
  const snapshot = () => JSON.stringify(TM.computeStandings('A').map(r => [r.team.id, r.played, r.won, r.lost, r.pts, r.pf, r.pa, r.diff]));
  const before = snapshot();

  TM.startMatch(gm[0].id, 1);              // in_progress — live
  eq('T4 match is live', TM.getMatch(gm[0].id).status, 'in_progress');
  eq('T4 live match untouched league stats', snapshot(), before);
  // The remaining group fixtures are still queued; none may contribute either.
  eq('T4 other fixtures still queued', gm.slice(1).every(m => m.status === 'queued'), true);
  eq('T4 scheduled matches untouched league stats', snapshot(), before);
})();

// TEST 5 — knockout results must never alter league statistics.
(function () {
  TM.resetTournament();
  TM.getState().settings.allowOutsideAvailability = true;
  TM.groupMatches().forEach(m => setScoreFor(m, m.teamA, 21, 12));
  ensureBracket();
  const before = JSON.stringify(TM.getState().matches.filter(m => m.stage === 'group').length) +
    '|' + JSON.stringify(TM.computeStandings('A').map(r => [r.team.id, r.played, r.won, r.lost, r.pts, r.pf, r.pa, r.diff])) +
    '|' + JSON.stringify(TM.computeStandings('B').map(r => [r.team.id, r.played, r.won, r.lost, r.pts, r.pf, r.pa, r.diff]));

  let guard = 0;
  while (guard++ < 40) {
    const queued = TM.getState().matches.filter(m => m.stage !== 'group' && m.status === 'queued' && m.teamA && m.teamB && !m.bye);
    if (!queued.length) break;
    queued.forEach(m => {
      const sc = TM.matchScoring(m);
      if (sc.format === 'single_game') TM.saveKnockoutScore(m.id, [{ a: sc.pointsPerGame, b: sc.pointsPerGame - 5 }]);
      else TM.saveKnockoutScore(m.id, [{ a: sc.pointsPerGame, b: sc.pointsPerGame - 5 }, { a: sc.pointsPerGame, b: sc.pointsPerGame - 6 }]);
    });
    ensureBracket();
  }
  const koDone = TM.getState().matches.filter(m => m.stage !== 'group' && m.status === 'completed');
  check('T5 knockout matches were completed', koDone.length > 0, 'none');

  const after = JSON.stringify(TM.getState().matches.filter(m => m.stage === 'group').length) +
    '|' + JSON.stringify(TM.computeStandings('A').map(r => [r.team.id, r.played, r.won, r.lost, r.pts, r.pf, r.pa, r.diff])) +
    '|' + JSON.stringify(TM.computeStandings('B').map(r => [r.team.id, r.played, r.won, r.lost, r.pts, r.pf, r.pa, r.diff]));
  eq('T5 league stats unchanged by knockout', after, before);
})();

// TEST 6 — tie-breaking is still points → point difference → points scored.
(function () {
  TM.resetTournament();
  TM.getState().settings.allowOutsideAvailability = true;
  TM.applyTeams(makeTeams({ A: 4 }), { regenerate: true, groups: ['A'] });
  // Set a whole round-robin explicitly, keyed by pairing so fixture order cannot
  // matter. Every match is to 21 with a clear margin, so validation accepts it.
  function setPair(a, b, sa, sb) {
    const m = TM.groupMatches('A').find(m =>
      (m.teamA === a && m.teamB === b) || (m.teamA === b && m.teamB === a));
    check('T6 fixture ' + a + '-' + b + ' exists', !!m);
    const res = TM.saveGroupScore(m.id, m.teamA === a ? sa : sb, m.teamA === a ? sb : sa);
    check('T6 score ' + a + '-' + b + ' saved', res.ok, res.msg);
  }
  setPair('A2', 'A1', 21, 13);  // A1 loses (-8)
  setPair('A1', 'A3', 21, 13);  // A1 wins (+8)
  setPair('A1', 'A4', 21, 13);  // A1 wins (+8)
  setPair('A2', 'A3', 21, 5);   // A2 wins (+16)
  setPair('A4', 'A2', 21, 5);   // A2 loses (-16)
  setPair('A3', 'A4', 21, 10);

  const rows = TM.computeStandings('A');
  const at = id => rows.findIndex(r => r.team.id === id);
  const rA1 = rowFor('A', 'A1'), rA2 = rowFor('A', 'A2');
  const rA3 = rowFor('A', 'A3'), rA4 = rowFor('A', 'A4');

  // A1 and A2 tie on league points and on point difference — only PF separates them.
  eq('T6 A1/A2 equal points', rA1.pts, rA2.pts);
  eq('T6 A1/A2 equal PD', rA1.diff, rA2.diff);
  eq('T6 A1 PD value', rA1.diff, 8);
  check('T6 A1 PF > A2 PF', rA1.pf > rA2.pf);
  check('T6 more points scored ranks first', at('A1') < at('A2'));
  // A3 and A4 tie on points — the better point difference ranks first.
  eq('T6 A3/A4 equal points', rA3.pts, rA4.pts);
  check('T6 better PD ranks first', rA4.diff > rA3.diff && at('A4') < at('A3'));
})();

// TEST 7 — multiple groups calculate independently.
(function () {
  TM.resetTournament();
  TM.getState().settings.allowOutsideAvailability = true;
  TM.groupMatches('A').forEach(m => setScoreFor(m, m.teamA, 21, 10));
  const a = TM.computeStandings('A');
  const b = TM.computeStandings('B');
  eq('T7 group A all played', a.every(r => r.played === 4), true);
  eq('T7 group B untouched', b.every(r => r.played === 0 && r.pf === 0 && r.pa === 0 && r.pts === 0), true);
  eq('T7 group A PF total', a.reduce((s, r) => s + r.pf, 0), 310);
  eq('T7 group A PA total', a.reduce((s, r) => s + r.pa, 0), 310);
})();

/* ── report ─────────────────────────────────────────────── */
console.log('\n' + (fail === 0 ? '✅ ALL TESTS PASSED' : '❌ FAILURES'));
console.log('passed: ' + pass + '  failed: ' + fail);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
