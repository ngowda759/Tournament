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
  const r = TM.startMatch(a.id, 1);
  check('completed match cannot start', !r.ok, r.msg);
})();

/* ── 5. scheduling rules ───────────────────────────────── */
(function () {
  const busy = TM.busyTeamIds();
  TM.startMatch('A-02', 1);
  TM.startMatch('A-03', 2);
  TM.startMatch('A-04', 3);
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
  eq('court1 end 09:00', st.courts.find(c => c.id === 1).end, '09:00');
  eq('court2 end 08:00', st.courts.find(c => c.id === 2).end, '08:00');
  eq('court3 end 08:00', st.courts.find(c => c.id === 3).end, '08:00');
  // roll through all group matches with automatic court allocation
  let guard = 0;
  while (TM.groupMatches().some(m => m.status !== 'completed') && guard++ < 100) {
    const sug = TM.suggestCourts();
    const ids = Object.keys(sug);
    if (!ids.length) { failures.push('scheduler stalled at ' + guard); break; }
    ids.forEach(cid => {
      const r = TM.startMatch(sug[cid].match.id, Number(cid));
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

/* ── report ─────────────────────────────────────────────── */
console.log('\n' + (fail === 0 ? '✅ ALL TESTS PASSED' : '❌ FAILURES'));
console.log('passed: ' + pass + '  failed: ' + fail);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
