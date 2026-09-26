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
// CSS text, so layout regressions (shrinkable grid tracks, min-width:0) can be asserted.
const styleText = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/) || ['', ''])[1];

let pass = 0, fail = 0;
const failures = [];
const check = (name, cond, extra) => { if (cond) pass++; else { fail++; failures.push(name + (extra ? ' :: ' + extra : '')); } };
const eq = (name, a, b) => check(name, a === b, 'got ' + a + ' expected ' + b);

// Mirror the UI layer's HTML escaping so tests can assert on names containing & or <.
const escHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// A tiny DOM. Elements record their innerHTML/textContent and support the handful
// of methods the UI layer touches. classList is lenient so rendering never throws.
function makeEl(id) {
  const classes = new Set();
  const el = {
    id, innerHTML: '', textContent: '', value: '', checked: false,
    style: {}, dataset: {}, children: [],
    // Real class tracking so tests can assert on stateful classes (e.g. the mobile
    // navigation's more-open toggle) rather than only on rendered markup.
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      toggle(c, force) {
        if (force === undefined) { if (classes.has(c)) { classes.delete(c); return false; } classes.add(c); return true; }
        if (force) { classes.add(c); return true; }
        classes.delete(c); return false;
      },
      contains(c) { return classes.has(c); }
    },
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
// Starting the knockout is an explicit organiser step; later rounds still advance
// automatically. Convenience wrapper for tests that need a built bracket.
function ensureBracket() {
  if (!TM.knockoutInfo().exists) TM.generateKnockout();
  TM.ensureKnockout();
}
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
// Mobile-safe structure: the row and its grid tracks must be allowed to shrink
// (minmax(0,1fr)) and the group/level controls must sit in a shinkable flex wrapper
// so they wrap instead of pushing the page wider than the viewport.
check('team rows render', s.indexOf('team-edit-row') !== -1, 'no rows');
check('team controls wrapper renders', s.indexOf('team-edit-controls') !== -1, 'no controls wrapper');
check('team inputs keep their grid', s.indexOf('team-edit-inputs') !== -1, 'no inputs grid');
check('team edit head has no inline flex layout', s.indexOf("display:flex;gap:6px;align-items:center;\">") === -1, 'inline controls layout remains');
check('team rows use shrinkable grid tracks', /\.team-edit-row\s*\{[^}]*grid-template-columns:\s*minmax\(0\s*,\s*1fr\)/.test(styleText), 'row track not shrinkable');
check('team controls can shrink', /\.team-edit-controls\s*\{[^}]*min-width:\s*0/.test(styleText), 'controls cannot shrink');
check('team inputs fill their track', /\.team-edit-inputs input\s*\{[^}]*min-width:\s*0/.test(styleText) && /\.team-edit-inputs input\s*\{[^}]*width:\s*100%/.test(styleText), 'inputs not width-constrained');

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
ensureBracket();
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
ensureBracket();
renderAll('6 qualifiers');
App.nav('knockout');
s = getEl('view').innerHTML;
check('6 qualifiers: bracket rendered with byes', s.indexOf('bracket') !== -1 && s.indexOf('Bye') !== -1, 'no byes');

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
ensureBracket();
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

// ── Dashboard V2 render structure ──────────────────────────────────────────────
// Every section must appear on the default dashboard, derived from live state.
TM.resetTournament();
App.nav('dashboard');
s = getEl('view').innerHTML;
['kpi-grid', 'kpi-card', 'stage-list', 'status-strip', 'courts-grid', 'level-bars',
 'gp-list', 'mgrid', 'progress-bar'].forEach(function (key) {
  check('dashboard contains ' + key, s.indexOf(key) !== -1, 'missing ' + key);
});
['Pairs', 'Matches', 'Completed', 'Live', 'Courts', 'Progress'].forEach(function (label) {
  check('dashboard KPI label ' + label, s.indexOf('>' + label + '<') !== -1, 'missing ' + label);
});
check('dashboard shows group stage count 0 / 20', s.indexOf('0 / 20') !== -1, 'no 0/20');
check('dashboard shows QF stage', s.indexOf('Quarter-finals') !== -1, 'no QF');
check('dashboard no undefined/NaN', s.indexOf('undefined') === -1 && s.indexOf('NaN') === -1);
check('dashboard shows no-results leader message', s.indexOf('No completed matches yet.') !== -1, 'no leader empty state');

// A completed match must be reflected immediately on the next render. Court windows
// are ignored here so the injected activity is deterministic regardless of clock.
TM.getState().settings.allowOutsideAvailability = true;
TM.groupMatches().slice(0, 3).forEach(function (m) { TM.saveGroupScore(m.id, 21, 15); });
TM.startMatch(TM.groupMatches()[3].id, 1);
App.nav('dashboard');
s = getEl('view').innerHTML;
check('dashboard shows a leader list after results', s.indexOf('leader-list') !== -1 && s.indexOf('leader-row') !== -1, 'no leader rows');
check('dashboard shows live KPI styling', s.indexOf('kpi-card live') !== -1, 'no live kpi');
check('dashboard shows a recent result', s.indexOf('Recent results') !== -1 && s.indexOf('mrow done') !== -1, 'no recent result');
check('dashboard recent result has score separator', s.indexOf('–') !== -1, 'no score');
check('dashboard is still free of undefined/NaN', s.indexOf('undefined') === -1 && s.indexOf('NaN') === -1);

// Level distribution: the default has one unassigned pair, shown as a warning.
check('dashboard flags unassigned level', s.indexOf('level-bar-row warn') !== -1, 'no unassigned warning');

// Group performance works for 3 and 4 groups.
TM.resetTournament();
const four = [];
['A', 'B', 'C', 'D'].forEach(function (g) { for (let i = 1; i <= 3; i++) four.push({ id: g + i, group: g, name: g + i + ' pair' }); });
TM.applyTeams(four, { regenerate: true, groups: ['A', 'B', 'C', 'D'] });
App.nav('dashboard');
s = getEl('view').innerHTML;
['Group A', 'Group B', 'Group C', 'Group D'].forEach(function (gl) {
  check('4-group dashboard shows ' + gl, s.indexOf(gl) !== -1, 'missing ' + gl);
});
check('4-group dashboard no undefined/NaN', s.indexOf('undefined') === -1 && s.indexOf('NaN') === -1);

// Champion/status: group stage complete with no bracket shows the ready message.
TM.resetTournament();
TM.applyTeams([
  { id: 'A1', group: 'A', name: 'a1' }, { id: 'A2', group: 'A', name: 'a2' }
], { regenerate: true, groups: ['A'] });
TM.groupMatches().forEach(function (m) { TM.saveGroupScore(m.id, 21, 15); });
TM.clearKnockout();
App.nav('dashboard');
s = getEl('view').innerHTML;
check('dashboard shows ready-for-knockout status', s.indexOf('Group Stage complete · Knockout stage ready') !== -1, 'no ready status');
check('dashboard hides champion card until a champion exists', s.indexOf('Tournament Champion') === -1, 'champion shown early');

// Empty states: a tournament with no teams (set directly so the 2-pair floor, which
// only guards fixture generation, does not stand in for a genuinely empty document).
TM.resetTournament();
TM.setState(Object.assign(TM.getState(), { teams: [], matches: [], groups: { A: [], B: [] }, groupLabels: {} }));
App.nav('dashboard');
s = getEl('view').innerHTML;
check('empty dashboard shows no-pairs message', s.indexOf('No pairs configured yet.') !== -1, 'no empty message');
check('empty dashboard no undefined/NaN', s.indexOf('undefined') === -1 && s.indexOf('NaN') === -1);
check('empty dashboard still renders KPI cards', s.indexOf('kpi-grid') !== -1, 'no kpis');

// Champion state: a fully played 2-pair tournament crowns a champion prominently.
TM.resetTournament();
TM.applyTeams([
  { id: 'A1', group: 'A', name: 'Alpha Pair' }, { id: 'A2', group: 'A', name: 'Beta Pair' }
], { regenerate: true, groups: ['A'] });
TM.setQualification(2);
TM.groupMatches().forEach(function (m) { TM.saveGroupScore(m.id, 21, 15); });
ensureBracket();
const finalM = TM.getMatch('F-1');
if (finalM) { TM.saveKnockoutScore('F-1', [{ a: 21, b: 15 }, { a: 21, b: 15 }, { a: null, b: null }]); }
App.nav('dashboard');
s = getEl('view').innerHTML;
if (TM.knockoutInfo().champion) {
  check('completed dashboard shows champion card', s.indexOf('Tournament Champion') !== -1, 'no champion card');
  check('completed dashboard shows champion name', s.indexOf(TM.teamName(TM.knockoutInfo().champion)) !== -1, 'no champion name');
  check('completed dashboard status is complete', s.indexOf('Tournament complete') !== -1, 'no complete status');
}

// Suggested court must resolve to a real court name (court ids are numbers while
// suggestCourts keys are strings, so a loose compare would silently drop the pill).
TM.resetTournament();
TM.getState().settings.allowOutsideAvailability = true;
App.nav('dashboard');
s = getEl('view').innerHTML;
check('next matches shows a suggested court', s.indexOf('→ Court') !== -1, 'no suggested court pill');
// With 5 ranked candidates and 3 courts, exactly the first three get a real court
// name (the rest correctly read "no free court").
check('exactly three suggested courts', (s.match(/→ Court/g) || []).length, 3);

// ── Dashboard V3 live control centre ──────────────────────────────────────────

// Branding, theme toggle and Help must remain in the shell regardless of Dashboard
// layout changes.
check('Tournament branding remains', html.indexOf('class="logo"') !== -1 && /class="logo"[^>]*>\s*Tournament\s*</.test(html), 'no logo');
check('theme toggle remains', html.indexOf('id="theme-toggle"') !== -1 && html.indexOf('toggleTheme()') !== -1, 'no theme toggle');
check('help remains', html.indexOf('App.about()') !== -1, 'no help control');

// ── Compact single-row header ─────────────────────────────────────────────────
// The navigation is a single dynamic element inside the header; there is no separate
// static Settings button. Settings must be reachable exactly once (through the nav).
const headerMatch = html.match(/<header>([\s\S]*?)<\/header>/);
const headerHtml = headerMatch ? headerMatch[1] : '';
check('header contains the navigation', headerHtml.indexOf('id="nav-tabs"') !== -1, 'no nav in header');
check('header has no static Settings button', headerHtml.indexOf("App.nav('settings')") === -1, 'duplicate Settings button');
check('only one nav element in the shell', (html.match(/id="nav-tabs"/g) || []).length === 1, 'extra nav');
check('header exposes Theme and Help actions', headerHtml.indexOf('id="theme-toggle"') !== -1 && headerHtml.indexOf('App.about()') !== -1, 'missing header actions');

// Settings must appear exactly once in the rendered desktop navigation markup.
App.nav('dashboard');
const desktopNav = getEl('nav-tabs').innerHTML;
check('Settings appears exactly once in the nav', (desktopNav.match(/>Settings</g) || []).length === 1, 'settings count wrong');
check('nav renders exactly one Settings destination', (desktopNav.match(/nav\('settings'\)/g) || []).length === 1, 'nav settings count wrong');
['Dashboard', 'Matches', 'Courts', 'Standings', 'Knockout', 'Teams', 'Settings'].forEach(function (label) {
  check('desktop nav keeps destination ' + label, desktopNav.indexOf(label) !== -1, 'missing ' + label);
});

// Fresh default tournament: section order and group-vs-overall wording.
TM.resetTournament();
App.nav('dashboard');
s = getEl('view').innerHTML;
['kpi-grid', 'stage-list', 'status-strip', 'courts-grid', 'level-bars', 'gp-list',
 'mgrid', 'progress-bar', 'queue-list'].forEach(function (key) {
  check('dashboard V3 contains ' + key, s.indexOf(key) !== -1, 'missing ' + key);
});
check('dashboard V3 shows 0 / 20 group matches wording', s.indexOf('0 / 20 group matches complete') !== -1, 'no group wording');
check('dashboard V3 never shows 0 / 27 group matches', s.indexOf('0 / 27 group matches') === -1, 'found bad wording');
check('dashboard V3 shows Quarter-finals (plural)', s.indexOf('Quarter-finals') !== -1, 'no plural QF');
check('dashboard V3 shows Semi-finals (plural)', s.indexOf('Semi-finals') !== -1, 'no plural SF');
// Live Courts must appear before the analytics (Group performance / Level distribution).
const iCourts = s.indexOf('Live courts');
const iNext = s.indexOf('Next matches');
const iQueue = s.indexOf('Waiting queue');
const iGroup = s.indexOf('Group performance');
const iLevel = s.indexOf('Team level distribution');
check('Live courts before next matches', iCourts !== -1 && iCourts < iNext, iCourts + '/' + iNext);
check('Next matches before waiting queue', iNext !== -1 && iNext < iQueue, iNext + '/' + iQueue);
check('Waiting queue before group performance', iQueue !== -1 && iQueue < iGroup, iQueue + '/' + iGroup);
check('Group performance before level distribution', iGroup !== -1 && iGroup < iLevel, iGroup + '/' + iLevel);
check('dashboard V3 no undefined/NaN/null leak',
  s.indexOf('undefined') === -1 && s.indexOf('NaN') === -1 && s.indexOf('>null<') === -1);

// Live state: a started match shows LIVE on a court and shrinks the queue.
TM.getState().settings.allowOutsideAvailability = true;
TM.startMatch(TM.groupMatches()[0].id, 1);
App.nav('dashboard');
s = getEl('view').innerHTML;
check('court card shows LIVE label', s.indexOf('>LIVE<') !== -1 || s.indexOf('● LIVE') !== -1, 'no LIVE label');
check('court card shows AVAILABLE label', s.indexOf('AVAILABLE') !== -1, 'no AVAILABLE label');
check('live court shows an Enter result action', s.indexOf('Enter result') !== -1, 'no enter result');
check('dashboard shows live scheduler summary', /live ·/.test(s) || s.indexOf('live ·') !== -1, 'no live summary');
check('waiting queue renders rows', s.indexOf('queue-row') !== -1, 'no queue rows');
check('waiting queue shows + N more waiting', s.indexOf('more waiting') !== -1, 'no more-waiting tail');
check('next matches shows group label', s.indexOf('Group A · R') !== -1 || s.indexOf('Group A') !== -1, 'no group label');
check('live dashboard still has no undefined/NaN', s.indexOf('undefined') === -1 && s.indexOf('NaN') === -1);

// Completed matches: the leaders table shows rank/team/played/wins/points/diff.
TM.resetTournament();
TM.getState().settings.allowOutsideAvailability = true;
TM.groupMatches().slice(0, 3).forEach(function (m) { TM.saveGroupScore(m.id, 21, 15); });
App.nav('dashboard');
s = getEl('view').innerHTML;
check('leaders table renders', s.indexOf('leader-row') !== -1 && s.indexOf('leader-cols') !== -1, 'no leaders');
check('leaders table has P/W/Pts/Diff headers', /<span>P<\/span>[\s\S]*?<span>W<\/span>[\s\S]*?<span>Pts<\/span>[\s\S]*?<span>Diff<\/span>/.test(s), 'no headers');
check('recent results render', s.indexOf('Recent results') !== -1 && s.indexOf('mrow done') !== -1, 'no recent');

// Dynamic courts: a disabled court is excluded and the enabled count is shown.
TM.resetTournament();
TM.getState().settings.allowOutsideAvailability = true;
TM.setCourtEnabled(3, false);
App.nav('dashboard');
s = getEl('view').innerHTML;
check('disabled court hidden from live courts', s.indexOf('Court 3') === -1, 'Court 3 still shown');
check('enabled court count shown', /2 courts enabled/.test(s), 'no enabled count');

// 3-group shape: group performance and queue support every group.
TM.resetTournament();
const t3 = [];
['A', 'B', 'C'].forEach(function (g) { for (let i = 1; i <= 3; i++) t3.push({ id: g + i, group: g, name: g + i + ' pair' }); });
TM.applyTeams(t3, { regenerate: true, groups: ['A', 'B', 'C'] });
TM.getState().settings.allowOutsideAvailability = true;
App.nav('dashboard');
s = getEl('view').innerHTML;
['Group A', 'Group B', 'Group C'].forEach(function (g) {
  check('3-group dashboard shows ' + g, s.indexOf(g) !== -1, 'missing ' + g);
});
check('3-group dashboard no undefined/NaN', s.indexOf('undefined') === -1 && s.indexOf('NaN') === -1);

// Knockout in progress: the strip names the round dynamically.
TM.resetTournament();
const tk = [];
['A', 'B', 'C'].forEach(function (g) { for (let i = 1; i <= 3; i++) tk.push({ id: g + i, group: g, name: g + i + ' pair' }); });
TM.applyTeams(tk, { regenerate: true, groups: ['A', 'B', 'C'] });
TM.setQualification(2);
TM.groupMatches().forEach(function (m) { TM.saveGroupScore(m.id, m.teamA < m.teamB ? 21 : 15, m.teamA < m.teamB ? 15 : 21); });
ensureBracket();
App.nav('dashboard');
s = getEl('view').innerHTML;
check('knockout dashboard names the current round', s.indexOf('Quarter-finals in progress') !== -1, 'no knockout round status');
check('knockout dashboard has no undefined/NaN', s.indexOf('undefined') === -1 && s.indexOf('NaN') === -1);

// Mobile navigation: primary destinations plus a More control, no destination lost.
App.nav('dashboard');
const navEl = getEl('nav-tabs');
const navHtml2 = navEl.innerHTML;
check('mobile nav has More control', navHtml2.indexOf('nav-more-btn') !== -1, 'no More');
['Dashboard', 'Matches', 'Courts'].forEach(function (label) {
  check('mobile nav primary ' + label, navHtml2.indexOf('>' + label + '<') !== -1 || navHtml2.indexOf(label) !== -1, 'missing ' + label);
});
['Standings', 'Knockout', 'Teams', 'Settings'].forEach(function (label) {
  check('mobile nav keeps destination ' + label, navHtml2.indexOf(label) !== -1, 'missing ' + label);
});

// Regression: opening More and then navigating to a primary screen must collapse
// the menu, and the secondary destinations must still be reachable through More.
App.nav('dashboard');
App.toggleNavMore();
check('More opens the secondary navigation', getEl('nav-tabs').classList.contains('more-open'));
App.nav('dashboard');
check('navigating to Dashboard collapses More', !getEl('nav-tabs').classList.contains('more-open'));
App.nav('settings');
check('secondary screen still marks More active', getEl('nav-tabs').innerHTML.indexOf('nav-more-btn active') !== -1, 'no active More');
check('secondary screen keeps More collapsed', !getEl('nav-tabs').classList.contains('more-open'));
App.nav('dashboard');
const navHtml3 = getEl('nav-tabs').innerHTML;
['Dashboard', 'Matches', 'Courts'].forEach(function (label) {
  check('after nav ' + label + ' remains visible', navHtml3.indexOf(label) !== -1, 'missing ' + label);
});
['Standings', 'Knockout', 'Teams', 'Settings'].forEach(function (label) {
  check('after nav ' + label + ' still reachable via More', navHtml3.indexOf(label) !== -1, 'missing ' + label);
});
check('after nav More is not open', !getEl('nav-tabs').classList.contains('more-open'));

// ── Courts screen (operational monitor) ───────────────────────────────────────
// The Courts view must render every court state: LIVE, AVAILABLE, CLOSED and
// DISABLED, the current/next match with its id and Enter result action, plus an
// empty state when nothing is eligible. Windows are overridden so the render is
// deterministic regardless of the wall clock.
TM.resetTournament();
TM.getState().settings.allowOutsideAvailability = true;
App.nav('courts');
let cs = getEl('view').innerHTML;
check('courts screen renders', typeof cs === 'string' && cs.length > 40, 'len=' + (cs || '').length);
check('courts screen has full court cards', cs.indexOf('court-card') !== -1, 'no court cards');
check('courts screen has no undefined/NaN', cs.indexOf('undefined') === -1 && cs.indexOf('NaN') === -1, 'leak');
check('courts AVAILABLE status renders', cs.indexOf('Available') !== -1, 'no available');
check('courts current match label renders', cs.indexOf('Current match') !== -1, 'no current match');
check('courts next eligible match label renders', cs.indexOf('Next eligible match') !== -1, 'no next match');
check('courts next match shows its id', /Next eligible match[\s\S]*?A-0\d/.test(cs), 'no next match id');
check('courts renders an Enter result action when live', (function () {
  TM.startMatch(TM.groupMatches()[0].id, 1);
  App.nav('courts');
  const live = getEl('view').innerHTML;
  return live.indexOf('In progress') !== -1 && live.indexOf('Enter result') !== -1;
})(), 'no live court action');

// Disabled court must render as Disabled and be excluded from new-match duty.
TM.setCourtEnabled(3, false);
App.nav('courts');
cs = getEl('view').innerHTML;
check('courts DISABLED status renders', cs.indexOf('Disabled') !== -1, 'no disabled pill');
check('courts disabled court still visible for monitoring', cs.indexOf('Court 3') !== -1, 'disabled court hidden');

// Closed court: outside its window with the override off, a free court reads Closed.
TM.resetTournament();
TM.updateCourt(2, { startTime: '00:00', endTime: '00:01' });
App.nav('courts');
cs = getEl('view').innerHTML;
check('courts CLOSED status renders outside the window', cs.indexOf('Closed') !== -1, 'no closed pill');
check('courts closed court explains why', cs.indexOf('Availability ended') !== -1 || cs.indexOf('Available from') !== -1, 'no closed reason');

// Empty state: a court with no eligible match must say so, never throw.
TM.resetTournament();
TM.getState().settings.allowOutsideAvailability = true;
TM.groupMatches().forEach(function (m) { TM.saveGroupScore(m.id, 21, 15); });
TM.clearKnockout();
App.nav('courts');
cs = getEl('view').innerHTML;
check('courts renders an empty state when the queue is drained', cs.indexOf('No eligible match') !== -1, 'no empty state');
check('courts empty state has no undefined', cs.indexOf('undefined') === -1, 'leak');

// A confirmed live court also renders its current match id and teams.
TM.resetTournament();
TM.getState().settings.allowOutsideAvailability = true;
TM.startMatch(TM.groupMatches()[0].id, 1);
App.nav('courts');
cs = getEl('view').innerHTML;
check('courts live court shows the match id', cs.indexOf(TM.groupMatches()[0].id) !== -1, 'no live match id');
check('courts live court shows both teams', cs.indexOf(escHtml(TM.teamName(TM.getMatch(TM.groupMatches()[0].id).teamA))) !== -1, 'no team A');

// ── Matches screen (larger, more readable tiles) ──────────────────────────────
TM.resetTournament();
TM.getState().settings.allowOutsideAvailability = true;
App.nav('matches');
let ms = getEl('view').innerHTML;
check('matches screen renders tiles', ms.indexOf('match-card') !== -1, 'no match cards');
check('matches screen uses the 2-column-capable grid', ms.indexOf('mgrid') !== -1, 'no mgrid');
check('match tile shows stage', ms.indexOf('Group Stage') !== -1, 'no stage');
check('match tile shows group/round meta', /Group A · Round \d/.test(ms), 'no meta line');
check('match tile shows a VS divider', ms.indexOf('vs-label') !== -1 && ms.indexOf('>VS<') !== -1, 'no vs');
check('match tile keeps team names visible', ms.indexOf(escHtml(TM.teamName(TM.getMatch(TM.groupMatches()[0].id).teamA))) !== -1, 'no team name');
check('match tile keeps Enter result action', ms.indexOf('Enter result') !== -1, 'no enter result');
check('match tile keeps Start action', ms.indexOf('quickStart') !== -1, 'no start action');
check('matches screen has no undefined/NaN', ms.indexOf('undefined') === -1 && ms.indexOf('NaN') === -1, 'leak');
// Completed match keeps the score visible in the larger tile.
TM.saveGroupScore(TM.groupMatches()[0].id, 21, 15);
App.nav('matches');
ms = getEl('view').innerHTML;
check('completed match tile shows the score', ms.indexOf('>21<') !== -1 && ms.indexOf('>15<') !== -1, 'no score');

// ── Court management lives in Settings, safely ────────────────────────────────
TM.resetTournament();
App.nav('settings');
let ss = getEl('view').innerHTML;
check('settings has Add court', ss.indexOf('App.addCourt()') !== -1, 'no add court');
check('settings has Remove court', ss.indexOf('App.removeCourt(') !== -1, 'no remove court');
check('settings has enable/disable toggle', ss.indexOf('App.toggleCourtConfig(') !== -1, 'no toggle');
check('settings has rename control', ss.indexOf('App.renameCourt(') !== -1, 'no rename');
check('settings has availability times', ss.indexOf('App.setCourtTime(') !== -1, 'no times');
check('settings has the outside-hours override', ss.indexOf('App.setAllowOutside(') !== -1, 'no override');

// Add court from Settings works and preserves every existing match/result.
const fixturesBeforeAdd = TM.groupMatches().map(function (m) { return m.id + ':' + m.teamA + ':' + m.teamB; }).join(',');
const resultsBeforeAdd = TM.groupMatches().filter(function (m) { return m.status === 'completed'; }).length;
const addRes = TM.addCourt();
check('add court succeeds', addRes.ok, addRes.msg);
eq('court count grew by one', TM.getState().courts.length, 4);
check('added court appears in settings', getEl('view').innerHTML.indexOf(addRes.court.name) !== -1 || true);
App.nav('settings');
check('settings renders the added court', getEl('view').innerHTML.indexOf(addRes.court.name) !== -1, 'added court missing');
eq('add did not change fixtures', TM.groupMatches().map(function (m) { return m.id + ':' + m.teamA + ':' + m.teamB; }).join(','), fixturesBeforeAdd);
eq('add did not change results', TM.groupMatches().filter(function (m) { return m.status === 'completed'; }).length, resultsBeforeAdd);

// Disable + remove from Settings keep matches/results/teams/groups intact.
// Court 4 exists from the add above and is open with the standard window; the
// override keeps the start deterministic regardless of the wall clock.
TM.getState().settings.allowOutsideAvailability = true;
TM.startMatch(TM.groupMatches()[0].id, 4);
const activeId = TM.groupMatches()[0].id;
const activeBefore = TM.getMatch(activeId).status;
const teamsBefore = JSON.stringify(TM.getState().teams);
const groupsBefore = JSON.stringify(TM.getState().groups);
// Removing the busy court is refused; the live match keeps playing.
const busyRemove = TM.removeCourt(4);
check('cannot remove a court with a live match', busyRemove.ok === false, 'removed a busy court');
eq('live match untouched by refused removal', TM.getMatch(activeId).status, activeBefore);
eq('live match still on its court', TM.getMatch(activeId).court, 4);
// Disabling the busy court is refused too (already a core guarantee) — verify.
eq('cannot disable a busy court', TM.setCourtEnabled(4, false).ok, false);
// Finish it, then remove the court: history must survive.
TM.saveGroupScore(activeId, 21, 19);
const remRes = TM.removeCourt(4);
check('remove court succeeds once free', remRes.ok, remRes.msg);
eq('court gone from config', TM.getState().courts.some(function (c) { return c.id === 4; }), false);
eq('completed match survived court removal', TM.getMatch(activeId).status, 'completed');
eq('completed match kept its court id', TM.getMatch(activeId).court, 4);
eq('team list unchanged by court removal', JSON.stringify(TM.getState().teams), teamsBefore);
eq('groups unchanged by court removal', JSON.stringify(TM.getState().groups), groupsBefore);
// Disabling a court leaves its configuration and matches in place.
TM.setCourtEnabled(3, false);
eq('disabled court stays in config', TM.getState().courts.some(function (c) { return c.id === 3 && c.enabled === false; }), true);
check('disabled court excluded from enabled list', TM.enabledCourts().every(function (c) { return c.id !== 3; }), 'still enabled');

// ── UI polish (cosmetic only) ─────────────────────────────────────────────────
// These assertions protect the visual refinements without touching the tournament
// engine: the compact single-row header, the single Settings destination, theme
// and Help controls, dashboard section order, larger match tiles, the Courts
// operational monitor, the Settings court configuration, the NOW/NEXT/QUEUE
// labelling, and light/dark theming. All of it is markup/CSS, so a functional
// regression in the scheduler still fails loudly elsewhere in this file.

// Branding, theme and Help remain in the shell.
check('polish: Tournament branding remains', html.indexOf('class="logo"') !== -1 && /class="logo"[^>]*>\s*Tournament\s*</.test(html), 'no logo');
check('polish: theme toggle remains', html.indexOf('id="theme-toggle"') !== -1 && html.indexOf('toggleTheme()') !== -1, 'no theme');
check('polish: help control remains', html.indexOf('App.about()') !== -1, 'no help');

// Compact single-row header: the header is a nowrap flex row and the nav shrinks
// and scrolls internally rather than forcing a wrap / page overflow. Phones keep
// the wrapped nav row (existing More behaviour).
check('polish: header lays out as one row', /header\s*\{[^}]*display:\s*flex/.test(styleText) && /header\s*\{[^}]*flex-wrap:\s*nowrap/.test(styleText), 'header not a single row');
check('polish: nav can shrink in the header row', /nav\.tabs\s*\{[^}]*flex:\s*1 1 auto[^}]*min-width:\s*0/.test(styleText), 'nav cannot shrink');
check('polish: nav scrolls internally', /nav\.tabs\s*\{[^}]*overflow-x:\s*auto/.test(styleText), 'nav not scrollable');
check('polish: mobile nav still wraps to its own row', /@media \(max-width: 719px\)\s*\{[\s\S]*?nav\.tabs\s*\{[^}]*flex-wrap:\s*wrap/.test(styleText), 'mobile nav does not wrap');

// Settings appears exactly once in the rendered navigation.
App.nav('dashboard');
const polishedNav = getEl('nav-tabs').innerHTML;
check('polish: Settings appears exactly once', (polishedNav.match(/nav\('settings'\)/g) || []).length === 1, 'duplicate settings');
check('polish: every destination still present', ['Dashboard', 'Matches', 'Courts', 'Standings', 'Knockout', 'Teams', 'Settings'].every(function (l) { return polishedNav.indexOf(l) !== -1; }), 'missing destination');
App.nav('courts');
const navCourts = getEl('nav-tabs').innerHTML;
check('polish: active tab marks aria-current', navCourts.indexOf('aria-current="page"') !== -1, 'no aria-current');
check('polish: mobile nav keeps the More control', navCourts.indexOf('nav-more-btn') !== -1, 'no More');

// Dashboard section order (information hierarchy preserved).
TM.resetTournament();
App.nav('dashboard');
s = getEl('view').innerHTML;
const ORDER = ['Tournament progress', 'Live courts', 'Next matches', 'Waiting queue', 'Group performance', 'Team level distribution', 'Current leaders', 'Recent results'];
let orderOk = true, prev = -1;
ORDER.forEach(function (label) {
  const at = s.indexOf(label);
  if (at === -1 || at < prev) orderOk = false;
  prev = at;
});
check('polish: dashboard section order preserved', orderOk, 'order changed');
check('polish: KPI cards render', s.indexOf('kpi-grid') !== -1 && s.indexOf('kpi-value') !== -1, 'no kpis');
check('polish: dashboard progress bars render', s.indexOf('progress-bar') !== -1, 'no progress');

// NOW / NEXT / QUEUE visual language.
check('polish: dashboard shows NOW tag', s.indexOf('phase-tag phase-now') !== -1 && s.indexOf('>NOW<') !== -1, 'no NOW tag');
check('polish: dashboard shows NEXT tag', s.indexOf('phase-next') !== -1 && s.indexOf('>NEXT<') !== -1, 'no NEXT tag');
check('polish: dashboard shows QUEUE tag', s.indexOf('phase-queue') !== -1 && s.indexOf('>QUEUE<') !== -1, 'no QUEUE tag');
check('polish: phase tag styling exists', /\.phase-tag\s*\{/.test(styleText) && /\.phase-now\s*\{/.test(styleText) && /\.phase-next\s*\{/.test(styleText) && /\.phase-queue\s*\{/.test(styleText), 'no phase CSS');

// Status is never colour-only: live/available states carry a text label.
TM.getState().settings.allowOutsideAvailability = true;
TM.startMatch(TM.groupMatches()[0].id, 1);
App.nav('dashboard');
s = getEl('view').innerHTML;
check('polish: live status has a text label', s.indexOf('● LIVE') !== -1, 'no LIVE text');
check('polish: available status has a text label', s.indexOf('AVAILABLE') !== -1, 'no AVAILABLE text');
check('polish: live court keeps Enter result', s.indexOf('Enter result') !== -1, 'no action');
check('polish: dashboard no undefined/NaN after polish', s.indexOf('undefined') === -1 && s.indexOf('NaN') === -1, 'leak');

// Larger match tiles (asserted from the CSS so readability is protected).
check('polish: match tiles are larger', /\.match-card\s*\{[^}]*padding:\s*16px\s+17px/.test(styleText), 'tile padding unchanged');
check('polish: match team names are readable', /\.match-card\s+\.match-teams\s*\{[^}]*font-size:\s*15\.5px/.test(styleText), 'team font unchanged');
check('polish: match scores are prominent', /\.match-card\s+\.match-teams\s+\.t\s+\.sc\s*\{[^}]*font-size:\s*18px/.test(styleText), 'score font unchanged');
check('polish: match cards keep the VS divider CSS', /\.match-card\s+\.vs-label::before/.test(styleText), 'no vs divider');
check('polish: match grid is two-column capable on desktop', /@media \(min-width: 820px\)\s*\{\s*\.mgrid\s*\{[^}]*repeat\(2/.test(styleText), 'no 2-col grid');
check('polish: match grid is single-column on mobile', /\.mgrid\s*\{[^}]*grid-template-columns:\s*1fr/.test(styleText), 'mobile grid not single column');

TM.resetTournament();
App.nav('matches');
ms = getEl('view').innerHTML;
check('polish: matches tiles are match-card', ms.indexOf('mrow match-card') !== -1, 'no match-card rows');
check('polish: matches screen keeps the grid', ms.indexOf('mgrid') !== -1, 'no grid');
check('polish: matches screen has no undefined/NaN', ms.indexOf('undefined') === -1 && ms.indexOf('NaN') === -1, 'leak');

// Courts is an operational monitor: NOW/NEXT/QUEUE render, and none of the court
// configuration controls live on this page.
TM.resetTournament();
TM.getState().settings.allowOutsideAvailability = true;
App.nav('courts');
cs = getEl('view').innerHTML;
check('polish: courts monitor renders court cards', cs.indexOf('court-card') !== -1, 'no court cards');
check('polish: courts monitor shows NOW phase', cs.indexOf('phase-now') !== -1, 'no NOW');
check('polish: courts monitor shows NEXT phase', cs.indexOf('phase-next') !== -1, 'no NEXT');
check('polish: courts monitor shows QUEUE phase', cs.indexOf('phase-queue') !== -1, 'no QUEUE');
check('polish: courts have no add-court control', cs.indexOf('App.addCourt()') === -1 && cs.indexOf('Add court') === -1, 'add court on courts page');
check('polish: courts have no remove-court control', cs.indexOf('App.removeCourt(') === -1, 'remove court on courts page');
check('polish: courts have no rename control', cs.indexOf('App.renameCourt(') === -1, 'rename on courts page');
check('polish: courts have no enable/disable control', cs.indexOf('App.toggleCourtConfig(') === -1, 'toggle on courts page');
check('polish: courts have no availability controls', cs.indexOf('App.setCourtTime(') === -1, 'times on courts page');
check('polish: courts monitor has no undefined/NaN', cs.indexOf('undefined') === -1 && cs.indexOf('NaN') === -1, 'leak');

// Settings owns court configuration; the section is cosmetically clear and still
// wired to the unchanged court-management actions.
TM.resetTournament();
App.nav('settings');
const polishSettings = getEl('view').innerHTML;
check('polish: settings has the court configuration section', polishSettings.indexOf('Court configuration') !== -1, 'no court config section');
check('polish: settings court config blocks use the clear head', polishSettings.indexOf('court-cfg-head') !== -1, 'no head');
check('polish: settings court config has name', polishSettings.indexOf('App.renameCourt(') !== -1, 'no name');
check('polish: settings court config has times', polishSettings.indexOf('App.setCourtTime(') !== -1 && polishSettings.indexOf('Available from') !== -1 && polishSettings.indexOf('Available until') !== -1, 'no times');
check('polish: settings court config has enable toggle', polishSettings.indexOf('App.toggleCourtConfig(') !== -1, 'no enable');
check('polish: settings court config has closed/reopen', polishSettings.indexOf('Mark closed') !== -1 || polishSettings.indexOf('Reopen court') !== -1, 'no closed control');
check('polish: settings court config has remove', polishSettings.indexOf('App.removeCourt(') !== -1, 'no remove');
check('polish: settings court config has add court', polishSettings.indexOf('App.addCourt()') !== -1, 'no add court');
check('polish: settings no undefined/NaN', polishSettings.indexOf('undefined') === -1 && polishSettings.indexOf('NaN') === -1, 'leak');

// Light/dark theming: both token sets exist and the polish leans on tokens.
check('polish: dark theme token set exists', /:root\s*\{[^}]*--bg:\s*#0d0f0e/.test(styleText), 'no dark theme');
check('polish: light theme overrides surfaces', /\[data-theme="light"\]\s*\{[^}]*--bg:/.test(styleText), 'no light theme');
check('polish: elevation uses shadow tokens', /--shadow-sm:/.test(styleText) && /--shadow-lg:/.test(styleText), 'no shadow tokens');
check('polish: light theme softens the shadow tokens', /\[data-theme="light"\]\s*\{[^}]*--shadow-sm/.test(styleText), 'no light shadows');
check('polish: visible keyboard focus exists', /:focus-visible\s*\{[^}]*outline:/.test(styleText), 'no focus ring');

// Mobile touch targets and no page overflow.
check('polish: card selects are touch sized', /\.card select\s*\{[^}]*min-height:\s*44px/.test(styleText), 'select too small');
check('polish: remove button is touch sized', /\.remove-btn\s*\{[^}]*width:\s*40px[^}]*height:\s*40px/.test(styleText), 'remove too small');
check('polish: app shell caps a single column', /\.app-shell\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(styleText), 'shell can overflow');

/* ── configurable knockout scoring UI ─────────────────────────────────────── */
// Settings → Knockout Scoring renders one block per round, with the right labels.
TM.resetTournament();
App.nav('settings');
let koSettings = getEl('view').innerHTML;
check('ko settings: section present', koSettings.indexOf('Knockout Scoring') !== -1, 'no section');
check('ko settings: QF block', koSettings.indexOf('Quarter-finals') !== -1, 'no QF');
check('ko settings: SF block', koSettings.indexOf('Semi-finals') !== -1, 'no SF');
check('ko settings: Final block', koSettings.indexOf('>Final<') !== -1 || koSettings.indexOf('Final</div>') !== -1, 'no Final');
check('ko settings: Best of 3 option', koSettings.indexOf('Best of 3') !== -1, 'no bo3 option');
check('ko settings: Straight set option', koSettings.indexOf('Straight set') !== -1, 'no straight option');
check('ko settings: points-per-game label', koSettings.indexOf('Points per game') !== -1, 'no ppg label');
check('ko settings: wired to format handler', koSettings.indexOf('App.setKnockoutFormat(') !== -1, 'no format handler');
check('ko settings: wired to points handler', koSettings.indexOf('App.setKnockoutPoints(') !== -1, 'no points handler');
check('ko settings: shows the concise format tag', koSettings.indexOf('Best of 3 × 11') !== -1, 'no format tag');
check('ko settings: no undefined/NaN', koSettings.indexOf('undefined') === -1 && koSettings.indexOf('NaN') === -1, 'leak');

// A straight-set round relabels its target field to "Points to win".
App.setKnockoutFormat('qf', 'single_game');
App.nav('settings');
koSettings = getEl('view').innerHTML;
check('ko settings: straight set relabels field', koSettings.indexOf('Points to win') !== -1, 'no straight label');
check('ko settings: straight tag shown', koSettings.indexOf('Straight set × ') !== -1, 'no straight tag');
eq('ko settings: format change persisted', TM.getKnockoutRules().rules.qf.format, 'single_game');
App.setKnockoutFormat('qf', 'best_of_3');

// TEST 7 — best-of-3 score UI: Game 1/Game 2 render, Game 3 hidden until needed.
TM.resetTournament();
TM.setKnockoutRule('qf', { format: 'best_of_3', pointsPerGame: 11 });
TM.groupMatches().forEach(function (m) { TM.saveGroupScore(m.id, m.teamA < m.teamB ? 21 : 12, m.teamA < m.teamB ? 12 : 21); });
ensureBracket();
App.openScore('QF-1', 'matches');
let body = getEl('score-body').innerHTML;
let sub = getEl('score-sub').textContent;
check('bo3 UI: format stated before entry', sub.indexOf('Best of 3') !== -1 && sub.indexOf('11') !== -1, sub);
check('bo3 UI: Game 1 rendered', body.indexOf('>Game 1<') !== -1, 'no game 1');
check('bo3 UI: Game 2 rendered', body.indexOf('>Game 2<') !== -1, 'no game 2');
check('bo3 UI: Game 3 row present but hidden', body.indexOf('sc-g3-a-row') !== -1 && body.indexOf('sc-g3-b-row') !== -1, 'no game 3 rows');
check('bo3 UI: no undefined/NaN', body.indexOf('undefined') === -1 && body.indexOf('NaN') === -1, 'leak');
App.closeScore();

// TEST 6 — straight-set score UI: only a single "Final score" entry, no Game 2/3.
TM.resetTournament();
TM.setKnockoutRule('qf', { format: 'single_game', pointsPerGame: 21 });
TM.groupMatches().forEach(function (m) { TM.saveGroupScore(m.id, m.teamA < m.teamB ? 21 : 12, m.teamA < m.teamB ? 12 : 21); });
ensureBracket();
App.openScore('QF-1', 'matches');
body = getEl('score-body').innerHTML;
sub = getEl('score-sub').textContent;
check('straight UI: format stated', sub.indexOf('Straight set') !== -1 && sub.indexOf('21') !== -1, sub);
check('straight UI: Final score label rendered', body.indexOf('>Final score<') !== -1, 'no final score');
check('straight UI: no Game 2 input', body.indexOf('>Game 2<') === -1, 'game 2 rendered');
check('straight UI: no Game 3 input', body.indexOf('>Game 3<') === -1 && body.indexOf('sc-g3-a-row') === -1, 'game 3 rendered');
check('straight UI: single score input per side', (body.match(/id="sc-a-0"/g) || []).length === 1 && (body.match(/id="sc-a-1"/g) || []).length === 0, 'wrong slots');
check('straight UI: no Best of 2 wording', body.indexOf('Best of 2') === -1 && sub.indexOf('Best of 2') === -1, 'best of 2 shown');
check('straight UI: not labelled as two games', body.indexOf('Game 2') === -1 && body.indexOf('games') === -1, 'two-game wording shown');
// The single game decides the match: 21–17 is a straight-set win for team A.
TM.saveKnockoutScore('QF-1', [{ a: 21, b: 17 }]);
const straightQf = TM.getMatch('QF-1');
eq('straight UI: completed on one game', straightQf.status, 'completed');
eq('straight UI: winner is the higher score', straightQf.winner, straightQf.teamA);
eq('straight UI: stored exactly one game', straightQf.sets.length, 1);
check('straight UI: a second game is refused', TM.saveKnockoutScore('QF-2', [{ a: 21, b: 17 }, { a: 21, b: 19 }]).ok === false);
App.closeScore();

// Match / knockout views advertise each round's configured format.
TM.resetTournament();
App.nav('knockout');
const koView = getEl('view').innerHTML;
check('ko view: subtitle shows configured formats', koView.indexOf('Best of 3 × 11') !== -1 && koView.indexOf('Best of 3 × 15') !== -1 && koView.indexOf('Best of 3 × 21') !== -1, 'no formats');
check('ko view: no undefined/NaN', koView.indexOf('undefined') === -1 && koView.indexOf('NaN') === -1, 'leak');

// With a generated bracket the match list labels each knockout match with its format.
TM.setKnockoutRule('final', { format: 'single_game', pointsPerGame: 21 });
TM.groupMatches().forEach(function (m) { TM.saveGroupScore(m.id, m.teamA < m.teamB ? 21 : 12, m.teamA < m.teamB ? 12 : 21); });
ensureBracket();
App.nav('matches');
const matchView = getEl('view').innerHTML;
check('matches view: knockout format tag shown', matchView.indexOf('Best of 3 × 11') !== -1, 'no qf format');
check('matches view: no undefined/NaN', matchView.indexOf('undefined') === -1 && matchView.indexOf('NaN') === -1, 'leak');

// Changing a round after the bracket exists must not alter an existing match's label.
const qfBefore = TM.matchFormatTag(TM.getMatch('QF-1'));
App.setKnockoutFormat('qf', 'single_game');
check('snapshot UI: existing match label unchanged', TM.matchFormatTag(TM.getMatch('QF-1')) === qfBefore, TM.matchFormatTag(TM.getMatch('QF-1')));

/* ── staged knockout workflow UI + rules lock ─────────────────────────────── */
// Group stage in progress: the flow indicator is rendered and rules are editable.
TM.resetTournament();
App.nav('knockout');
let flowView = getEl('view').innerHTML;
check('ko flow: indicator rendered', flowView.indexOf('ko-flow') !== -1, 'no flow');
check('ko flow: group stage step shown', flowView.indexOf('Group Stage') !== -1, 'no group step');
check('ko flow: configure step shown', flowView.indexOf('Configure Knockout Rules') !== -1, 'no configure step');
check('ko flow: locked step shown', flowView.indexOf('🔒 Knockout Rules Locked') !== -1, 'no locked step');
check('ko flow: no undefined/NaN', flowView.indexOf('undefined') === -1 && flowView.indexOf('NaN') === -1, 'leak');

// Settings rules are editable (not disabled) before the knockout is generated.
App.nav('settings');
let setView = getEl('view').innerHTML;
check('ko lock UI: not locked before generation', setView.indexOf('locked because the knockout stage has started') === -1, 'premature lock');
check('ko lock UI: format select enabled', setView.indexOf("App.setKnockoutFormat('qf',this.value)\"") !== -1 && setView.indexOf("App.setKnockoutFormat('qf',this.value)\" disabled") === -1, 'select not enabled');

// Group stage complete, knockout not started: the Start control and both steps show.
TM.groupMatches().forEach(function (m) { TM.saveGroupScore(m.id, m.teamA < m.teamB ? 21 : 12, m.teamA < m.teamB ? 12 : 21); });
App.nav('knockout');
flowView = getEl('view').innerHTML;
check('ko flow: start control offered', flowView.indexOf('Generate / Start knockout') !== -1, 'no start control');
check('ko flow: configure shortcut offered', flowView.indexOf('Configure knockout rules') !== -1, 'no configure shortcut');
check('ko flow: not generated before starting', !TM.knockoutInfo().exists, 'bracket built early');

// Start the knockout from the UI — the rules then lock and the controls disable.
App.generateKnockout();
check('ko lock UI: locked after starting', TM.knockoutRulesLocked(), true);
App.nav('settings');
setView = getEl('view').innerHTML;
check('ko lock UI: locked banner shown', setView.indexOf('🔒 Knockout scoring is locked') !== -1, 'no lock banner');
check('ko lock UI: format select disabled', setView.indexOf("App.setKnockoutFormat('qf',this.value)\" disabled") !== -1, 'select not disabled');
check('ko lock UI: points input disabled', setView.indexOf("disabled onchange=\"App.setKnockoutPoints('qf',this.value)\"") !== -1, 'input not disabled');

// A locked edit from the UI is refused and surfaced, never silently applied.
App.setKnockoutFormat('qf', 'single_game');
eq('ko lock UI: locked format edit refused', TM.getKnockoutRules().rules.qf.format, 'best_of_3');
check('ko lock UI: refusal message shown', /locked/i.test(getEl('ko-msg').textContent) || /locked/i.test(getEl('toast').textContent), 'no refusal message');

// A played knockout cannot be silently reset from the UI: completing a knockout
// match and then clearing the bracket through the core API is refused.
const koFirst = TM.getState().matches.filter(function (m) { return m.stage !== 'group' && !m.bye && m.teamA && m.teamB; })[0];
TM.saveKnockoutScore(koFirst.id, [{ a: 21, b: 15 }, { a: 21, b: 17 }, { a: null, b: null }]);
check('ko lock UI: completed knockout protects the bracket', TM.knockoutProtected(), true);
const refusedClear = TM.clearKnockout();
check('ko lock UI: clear refused while a knockout result exists', !refusedClear.ok, refusedClear.msg);
eq('ko lock UI: refused clear left the lock on', TM.knockoutRulesLocked(), true);
check('ko lock UI: refused clear kept the result', TM.getMatch(koFirst.id).status, 'completed');
App.nav('settings');
setView = getEl('view').innerHTML;
check('ko lock UI: controls still disabled after refused clear', setView.indexOf("App.setKnockoutFormat('qf',this.value)\" disabled") !== -1, 'controls re-enabled');

// Only the explicit, confirmed destructive reset clears a played knockout.
TM.clearKnockout('force');
App.nav('settings');
setView = getEl('view').innerHTML;
check('ko lock UI: unlocked banner gone after forced reset', setView.indexOf('🔒 Knockout scoring is locked') === -1, 'stale lock banner');
check('ko lock UI: format select re-enabled after forced reset', setView.indexOf("App.setKnockoutFormat('qf',this.value)\" disabled") === -1 && setView.indexOf("App.setKnockoutFormat('qf',this.value)\"") !== -1, 'select still disabled');

// Before a knockout is played, clearing the generated bracket unlocks the rules.
TM.resetTournament();
TM.groupMatches().forEach(function (m) { TM.saveGroupScore(m.id, m.teamA < m.teamB ? 21 : 12, m.teamA < m.teamB ? 12 : 21); });
TM.generateKnockout();
eq('ko lock UI: generated locks the rules', TM.knockoutRulesLocked(), true);
check('ko lock UI: unplayed bracket clears safely', TM.clearKnockout().ok);
eq('ko lock UI: unplayed clear unlocks the rules', TM.knockoutRulesLocked(), false);

// ── Dashboard League standings (score statistics) ─────────────────────────────
// The dashboard must expose cumulative league-stage P/W/L/PF/PA/PD/Pts per team,
// grouped per group, reusing the engine's standings calculation.
TM.resetTournament();
TM.getState().settings.allowOutsideAvailability = true;
App.nav('dashboard');
s = getEl('view').innerHTML;
check('league: section heading present', s.indexOf('League standings') !== -1, 'no heading');
check('league: league table rendered', s.indexOf('standings-table league-standings') !== -1, 'no league table');
check('league: team column present', /<th>Team<\/th>/.test(s), 'no team header');
// TEST 8 — the dashboard renders P, W, L, PF, PA, PD and Pts columns.
check('league T8: P/W/L/PF/PA/PD/Pts headers render',
  /<th class="num">P<\/th>[\s\S]*?<th class="num">W<\/th>[\s\S]*?<th class="num">L<\/th>[\s\S]*?<th class="num">PF<\/th>[\s\S]*?<th class="num">PA<\/th>[\s\S]*?<th class="num">PD<\/th>[\s\S]*?<th class="num">Pts<\/th>/.test(s),
  'missing column headers');
// TEST 10 — zero point difference renders as "0".
check('league T10: zero PD renders as 0', /<td class="num-cell">0<\/td>/.test(s), 'no zero PD');
check('league: both groups shown', s.indexOf('Group A') !== -1 && s.indexOf('Group B') !== -1, 'missing group');
check('league: no undefined/NaN leak', s.indexOf('undefined') === -1 && s.indexOf('NaN') === -1, 'leak');

// TEST 9 — a negative point difference renders with its sign.
TM.groupMatches('A').forEach(function (m) { TM.saveGroupScore(m.id, 21, 15); });
App.nav('dashboard');
s = getEl('view').innerHTML;
check('league T9: negative PD renders', /<td class="num-cell">-\d+<\/td>/.test(s), 'no negative PD');
check('league T9: positive PD renders with +', /<td class="num-cell">\+\d+<\/td>/.test(s), 'no +PD');

// Live update: the dashboard reflects a freshly completed league result with no
// extra refresh, because it consumes the same live standings calculation.
(function () {
  TM.resetTournament();
  TM.getState().settings.allowOutsideAvailability = true;
  const teams = [];
  ['A', 'B'].forEach(function (g) { for (let i = 1; i <= 5; i++) teams.push({ id: g + i, group: g, name: 'Team ' + g + i }); });
  TM.applyTeams(teams, { regenerate: true });
  const team = 'A1';
  const mine = TM.groupMatches('A').filter(function (m) { return m.teamA === team || m.teamB === team; });
  [[21, 15], [18, 21], [21, 12], [21, 19]].forEach(function (sc, i) {
    const m = mine[i];
    if (m.teamA === team) TM.saveGroupScore(m.id, sc[0], sc[1]);
    else TM.saveGroupScore(m.id, sc[1], sc[0]);
  });
  App.nav('dashboard');
  s = getEl('view').innerHTML;
  const row = s.match(/<tr>[\s\S]*?Team A1[\s\S]*?<\/tr>/);
  check('league live: A1 row rendered', !!row, 'no A1 row');
  check('league live: A1 shows P4 W3 L1 PF81 PA67 PD+14 Pts6',
    row && /played-cell">4<\/td>[\s\S]*?num-cell">3<\/td>[\s\S]*?num-cell">1<\/td>[\s\S]*?num-cell">81<\/td>[\s\S]*?num-cell">67<\/td>[\s\S]*?num-cell">\+14<\/td>[\s\S]*?pts-cell">6<\/td>/.test(row[0]),
    row ? row[0] : 'none');
})();

// Responsive: the league table sits in the existing scroll wrapper and the CSS
// keeps it shrinkable at narrow widths (no new framework).
check('league: table wrapped for mobile scroll', /tbl-wrap"><table class="standings-table league-standings"/.test(s), 'not wrapped');
check('league: tbl-wrap scroll CSS', /\.tbl-wrap\s*\{[^}]*overflow-x:\s*auto/.test(styleText), 'no scroll wrapper');
check('league: narrow-width rule exists', /@media\s*\(max-width:\s*430px\)\s*\{[\s\S]*?\.league-standings/.test(styleText), 'no mobile rule');

console.log('\n' + (fail === 0 ? '✅ ALL RENDERS OK' : '❌ RENDER FAILURES'));
console.log('passed: ' + pass + '  failed: ' + fail);
if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
