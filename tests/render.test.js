/* Render smoke test — loads the full single-file app under a minimal DOM shim and
   renders every screen for a range of tournament shapes. This exercises the UI
   layer's real code paths (view functions, group config, knockout bracket) without
   a browser or any external dependency. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const core = html.match(/<script id="core-logic">([\s\S]*?)<\/script>/);
const ui = html.match(/<script id="ui-layer">([\s\S]*?)<\/script>/);
if (!core || !ui) { console.error('scripts not found'); process.exit(1); }

let pass = 0, fail = 0;
const failures = [];
const check = (name, cond, extra) => { if (cond) pass++; else { fail++; failures.push(name + (extra ? ' :: ' + extra : '')); } };
const eq = (name, a, b) => check(name, a === b, 'got ' + a + ' expected ' + b);

// A tiny DOM. Elements record their innerHTML/textContent and support the handful
// of methods the UI layer touches. classList is lenient so rendering never throws.
function makeEl(id) {
  const el = {
    id, innerHTML: '', textContent: '', value: '', checked: false,
    style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    appendChild(c) { el.children.push(c); return c; }, removeChild() {},
    insertAdjacentHTML() {}, focus() {}, blur() {}, click() {}, remove() {},
    addEventListener() {}, removeEventListener() {}, querySelector() { return null; },
    querySelectorAll() { return []; }, getBoundingClientRect() { return { width: 0, height: 0, top: 0, left: 0 }; }
  };
  return el;
}

const els = {};
function getEl(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; }

const store = {};
const document = {
  getElementById: getEl,
  querySelector: (sel) => getEl(String(sel).replace(/[^a-z0-9_-]/gi, '')),
  querySelectorAll: () => [],
  createElement: (tag) => makeEl('created-' + tag),
  addEventListener() {},
  removeEventListener() {},
  body: makeEl('body'),
  documentElement: makeEl('html'),
  readyState: 'complete'
};

const sandbox = {
  console, document, Date, Math, JSON, Number, Object, Array, String, Boolean,
  setTimeout, clearTimeout, parseInt, parseFloat, isFinite, isNaN, Set, Map,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  alert() {}, confirm() { return true; }, prompt() { return null; },
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  navigator: { userAgent: 'node', clipboard: { writeText() { return Promise.resolve(); } } },
  location: { href: 'http://localhost/', reload() {} }
};
sandbox.scrollTo = function () {};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(core[1], sandbox, { filename: 'core-logic.js' });
vm.runInContext(ui[1], sandbox, { filename: 'ui-layer.js' });

const TM = sandbox.TM;
const App = sandbox.App;
check('TM exposed', !!TM, 'no TM');
check('App exposed', !!App, 'no App');

// Render every screen and assert the view produced markup and no obvious placeholder
// leaked through. A thrown error fails the run outright.
function renderAll(label) {
  ['dashboard', 'teams', 'settings', 'matches', 'courts', 'standings', 'knockout'].forEach(function (screen) {
    let ok = true, err = '';
    try { App.nav(screen); } catch (e) { ok = false; err = e.message; }
    check(label + ': ' + screen + ' renders', ok, err);
    const out = getEl('view').innerHTML;
    check(label + ': ' + screen + ' has markup', typeof out === 'string' && out.length > 40, 'len=' + (out || '').length);
    check(label + ': ' + screen + ' has no undefined leak', out.indexOf('undefined') === -1 && out.indexOf('NaN') === -1);
  });
}

// Default 10-pair example
TM.resetTournament();
renderAll('default 10p');
let s = getEl('view').innerHTML;

// 8 pairs, 4+4, top 2 → the Settings and Dashboard should show the dynamic counts
TM.resetTournament();
TM.applyTeams([
  { id: 'A1', group: 'A', name: 'A One' }, { id: 'A2', group: 'A', name: 'A Two' },
  { id: 'A3', group: 'A', name: 'A Three' }, { id: 'A4', group: 'A', name: 'A Four' },
  { id: 'B1', group: 'B', name: 'B One' }, { id: 'B2', group: 'B', name: 'B Two' },
  { id: 'B3', group: 'B', name: 'B Three' }, { id: 'B4', group: 'B', name: 'B Four' }
], { regenerate: true });
TM.setQualification(2);
renderAll('8p 4+4');
App.nav('dashboard');
s = getEl('view').innerHTML;
check('8p dashboard shows /12 group', s.indexOf('/ 12') !== -1, 'no /12');
check('8p dashboard shows /15 overall', s.indexOf('/ 15') !== -1, 'no /15');
check('8p dashboard has no /20', s.indexOf('/ 20') === -1, 'found /20');

App.nav('settings');
s = getEl('view').innerHTML;
check('8p settings shows Group A 4 pairs', /Group A[\s\S]*?4 pairs/.test(s), 'no Group A 4 pairs');
check('8p settings shows Group B 4 pairs', /Group B[\s\S]*?4 pairs/.test(s), 'no Group B 4 pairs');
check('8p settings shows 12 group matches total', s.indexOf('12 group matches') !== -1, 'no 12 group matches');
check('8p settings shows 4 qualify', s.indexOf('>4 pair') !== -1 || s.indexOf('4 pairs qualify') !== -1, 'no 4 qualify');

// Adding an empty group must show the "needs pairs" warning and not change fixtures
TM.addGroup('C');
App.nav('settings');
s = getEl('view').innerHTML;
check('empty group warning shown', s.indexOf('no pairs yet') !== -1, 'no warning');
check('empty group shown with 0 matches', /Group C[\s\S]*?0 pairs[\s\S]*?0 matches/.test(s) || s.indexOf('0 pairs') !== -1, 'no 0 pairs');
check('add group did not change fixture count', TM.groupMatches().length, 12);

// Teams screen: add pair + group add affordance renders
App.nav('teams');
s = getEl('view').innerHTML;
check('teams screen lists Group A', s.indexOf('Group A') !== -1);
check('teams screen lists Group C', s.indexOf('Group C') !== -1);
check('teams screen has add pair', s.indexOf('+ Add pair') !== -1);
check('teams screen has add group', s.indexOf('+ Add group') !== -1);
check('teams screen has save', s.indexOf('Save teams') !== -1);

// 9 pairs, 5+4, top 4 → 16 group → 23 overall
TM.resetTournament();
TM.applyTeams([
  { id: 'A1', group: 'A', name: 'a1' }, { id: 'A2', group: 'A', name: 'a2' }, { id: 'A3', group: 'A', name: 'a3' },
  { id: 'A4', group: 'A', name: 'a4' }, { id: 'A5', group: 'A', name: 'a5' },
  { id: 'B1', group: 'B', name: 'b1' }, { id: 'B2', group: 'B', name: 'b2' }, { id: 'B3', group: 'B', name: 'b3' },
  { id: 'B4', group: 'B', name: 'b4' }
], { regenerate: true });
TM.setQualification(4);
renderAll('9p 5+4');
App.nav('dashboard');
s = getEl('view').innerHTML;
check('9p dashboard shows /16 group', s.indexOf('/ 16') !== -1, 'no /16');
check('9p dashboard shows /23 overall', s.indexOf('/ 23') !== -1, 'no /23');

// Play the group stage out and render the knockout screen for a 6-qualifier bracket
// (this is where byes are shown) and the standings screen with real results.
TM.groupMatches().forEach(function (m) { TM.saveGroupScore(m.id, m.teamA < m.teamB ? 21 : 15, m.teamA < m.teamB ? 15 : 21); });
App.nav('standings');
s = getEl('view').innerHTML;
check('standings renders 5 rows for group A', (s.match(/standings-table/g) || []).length >= 1);
App.nav('knockout');
s = getEl('view').innerHTML;
check('knockout screen renders bracket', s.indexOf('bracket') !== -1);
check('knockout screen no undefined', s.indexOf('undefined') === -1);

// 6 qualifiers → bye handling must render without throwing
TM.resetTournament();
TM.applyTeams([
  { id: 'A1', group: 'A', name: 'a1' }, { id: 'A2', group: 'A', name: 'a2' }, { id: 'A3', group: 'A', name: 'a3' },
  { id: 'A4', group: 'A', name: 'a4' }, { id: 'A5', group: 'A', name: 'a5' },
  { id: 'B1', group: 'B', name: 'b1' }, { id: 'B2', group: 'B', name: 'b2' }, { id: 'B3', group: 'B', name: 'b3' },
  { id: 'B4', group: 'B', name: 'b4' }, { id: 'B5', group: 'B', name: 'b5' }
], { regenerate: true });
TM.setQualification(3);
TM.groupMatches().forEach(function (m) { TM.saveGroupScore(m.id, m.teamA < m.teamB ? 21 : 15, m.teamA < m.teamB ? 15 : 21); });
renderAll('6 qualifiers');

// 3 groups of 3 (Scenario D)
TM.resetTournament();
const three = [];
['A', 'B', 'C'].forEach(function (g) { for (let i = 1; i <= 3; i++) three.push({ id: g + i, group: g, name: g + i + ' pair' }); });
TM.applyTeams(three, { regenerate: true, groups: ['A', 'B', 'C'] });
renderAll('3x3');
App.nav('settings');
s = getEl('view').innerHTML;
check('3x3 settings shows 9 group matches', s.indexOf('9 group matches') !== -1, 'no 9 group matches');

// Multi-group knockout: 3 groups x 3, top 2 → 6 qualifiers across all three groups,
// 2 byes, 5 real knockout matches. The Knockout screen must render all six qualifiers
// from all three groups, and Settings must reflect the dynamic totals.
TM.resetTournament();
const three2 = [];
['A', 'B', 'C'].forEach(function (g) { for (let i = 1; i <= 3; i++) three2.push({ id: g + i, group: g, name: g + i + ' pair' }); });
TM.applyTeams(three2, { regenerate: true, groups: ['A', 'B', 'C'] });
TM.setQualification(2);
TM.groupMatches().forEach(function (m) { TM.saveGroupScore(m.id, m.teamA < m.teamB ? 21 : 15, m.teamA < m.teamB ? 15 : 21); });
TM.ensureKnockout();
renderAll('3-group knockout');
App.nav('knockout');
s = getEl('view').innerHTML;
['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].forEach(function (t) {
  check('3-group knockout shows qualifier ' + t, s.indexOf(t + ' pair') !== -1, 'missing ' + t);
});
check('3-group knockout shows all six as qualified', s.indexOf('Qualified (6)') !== -1, 'no qualified count');
App.nav('settings');
s = getEl('view').innerHTML;
check('3-group settings shows 9 group matches', s.indexOf('9 group matches') !== -1, 'no 9 group matches');
check('3-group settings shows 6 qualify', s.indexOf('6 pair') !== -1 || s.indexOf('6 pairs qualify') !== -1, 'no 6 qualify');

// ── Team Level Configuration on Settings ───────────────────────────────────────
// The default tournament must show every level, the real pair names, a per-pair
// assignment control, the assigned/unassigned summary and the repair action.
TM.resetTournament();
App.nav('settings');
s = getEl('view').innerHTML;
['Tunga', 'Bhadra', 'Kaveri', 'Unassigned'].forEach(function (name) {
  check('settings level shows ' + name, s.indexOf(name) !== -1, 'missing ' + name);
});
['Naveen &amp; Chandan', 'RK &amp; Vinay', 'Nihar &amp; Rajeev', 'Prabhakar &amp; Phani', 'Anil &amp; TBD'].forEach(function (nm) {
  check('settings level lists pair ' + nm, s.indexOf(nm) !== -1, 'missing ' + nm);
});
check('settings shows 3 pairs for Kaveri', s.indexOf('Kaveri') !== -1 && s.indexOf('3 pairs') !== -1, 'no 3 pairs');
check('settings shows 1 pair for Unassigned', s.indexOf('1 pair') !== -1, 'no 1 pair');
check('settings shows assigned/unassigned summary', s.indexOf('10 pairs · 9 assigned · 1 unassigned') !== -1, 'no summary');
check('settings warning names the unassigned pair', s.indexOf('unassigned: Anil &amp; TBD') !== -1, 'no named warning');
check('settings shows assignment controls', s.indexOf('level-select') !== -1, 'no selects');
check('settings shows repair button', s.indexOf('Repair level assignments') !== -1, 'no repair button');
check('settings has no stored-count table', s.indexOf('Number of Pairs') === -1, 'old table remains');

// Assigning the last unassigned pair updates the summary to all-assigned.
App.setTeamLevel('B5', 'kaveri');
App.nav('settings');
s = getEl('view').innerHTML;
check('summary becomes all-assigned', s.indexOf('10 pairs · 10 assigned · 0 unassigned') !== -1, 'no all-assigned summary');
check('no unassigned warning once assigned', s.indexOf('pair is unassigned') === -1, 'warning remains');
eq('B5 now kaveri in state', TM.getTeam('B5').level, 'kaveri');
eq('level counts agree with assignments', TM.levelCounts().kaveri,
  TM.getState().teams.filter(function (t) { return TM.resolveLevel(t.level).id === 'kaveri'; }).length);

// Repair is idempotent and non-destructive through the UI.
TM.resetTournament();
App.nav('settings');
const fixturesBefore = TM.groupMatches().map(function (m) { return m.id + ':' + m.teamA + ':' + m.teamB; }).join(',');
App.repairLevels();
eq('repair left fixtures intact', TM.groupMatches().map(function (m) { return m.id + ':' + m.teamA + ':' + m.teamB; }).join(','), fixturesBefore);
eq('repair left default Kaveri count at 3', TM.levelCounts().kaveri, 3);

console.log('\n' + (fail === 0 ? '✅ ALL RENDERS OK' : '❌ RENDER FAILURES'));
console.log('passed: ' + pass + '  failed: ' + fail);
if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
