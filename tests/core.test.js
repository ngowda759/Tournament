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

  const info = TM.knockoutInfo();
  check('QF auto-generated', info.qfExists);
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
  // play the whole group stage so the bracket is generated
  TM.groupMatches().forEach(m => {
    TM.saveGroupScore(m.id, m.teamA < m.teamB ? 21 : 11, m.teamA < m.teamB ? 11 : 21);
  });
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
  eq('legacy: new schema version', mig.version, 5);

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
  TM.ensureKnockout(); // generates QFs from the completed group stage
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
  check('block message still explains the lock', /after matches have started/i.test(r.msg), r.msg);

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

/* ── report ─────────────────────────────────────────────── */
console.log('\n' + (fail === 0 ? '✅ ALL TESTS PASSED' : '❌ FAILURES'));
console.log('passed: ' + pass + '  failed: ' + fail);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
