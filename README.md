# 🏸 ShuttleDraw — Badminton Doubles Tournament Manager

A lightweight, single-file badminton **doubles** tournament manager built for a real
20-player / 10-pair / 2-group tournament run on 3 courts.

No server, no database, no login, no build step — open `index.html` and run the tournament.
Everything is client-side and stores its state in your browser's `localStorage`.

The organizer can run the whole event from a phone.

---

## Table of contents

- [Tournament format](#tournament-format)
- [Scoring](#scoring)
- [Group stage](#group-stage)
- [Rolling court scheduling](#rolling-court-scheduling)
- [Court configuration](#court-configuration)
- [Team level configuration](#team-level-configuration)
- [Knockout structure](#knockout-structure)
- [Match numbering](#match-numbering)
- [Screens](#screens)
- [Data persistence](#data-persistence)
- [Backup and restore](#backup-and-restore)
- [How to run](#how-to-run)
- [How to reset](#how-to-reset)
- [Mobile usage](#mobile-usage)
- [Error prevention / validation](#error-prevention--validation)
- [Architecture overview](#architecture-overview)
- [Testing](#testing)
- [File structure](#file-structure)

---

## Tournament format

| Item | Value |
|------|-------|
| Players | 20 |
| Doubles pairs | 10 |
| Groups | 2 (Group A, Group B) |
| Pairs per group | 5 |
| Courts | 3 (fully editable — see [Court configuration](#court-configuration)) |
| Court 1 window | 06:00 AM → 09:00 AM (default) |
| Courts 2 & 3 window | 06:00 AM → 08:00 AM (default) |

### Group A

| # | Pair | Level |
|---|------|-------|
| A1 | Naveen & Chandan | Tunga |
| A2 | Harshit & Yakshit | Bhadra |
| A3 | RK & Vinay | Kaveri |
| A4 | Manjanna & Madhu | Tunga |
| A5 | Nihar & Rajeev | Kaveri |

### Group B

| # | Pair | Level |
|---|------|-------|
| B1 | Praveen KG & Gagan | Tunga |
| B2 | Gangadhar & Manju | Bhadra |
| B3 | Praveen & Vinay | Bhadra |
| B4 | Prabhakar & Phani | Kaveri |
| B5 | Anil & TBD | Unassigned |

The default distribution is therefore Tunga = 3, Bhadra = 3, Kaveri = 3, Unassigned = 1.

**Two different players are named Vinay** — `RK & Vinay` (A3) and `Praveen & Vinay` (B3).
They are separate pairs and are never treated as the same player.

**Anil's partner is intentionally `TBD`** and remains editable on the **Teams** screen at any time.
Pair names, individual player names, and pair levels can all be edited after setup.

**Levels are configurable, not hard-coded.** `Tunga`, `Bhadra` and `Kaveri` are only the *default*
levels. The organizer can add, rename, disable or remove levels in
**Settings → Team Level Configuration**, and the distribution can be changed freely — for example
Tunga = 4 / Bhadra = 3 / Kaveri = 3. The level dropdown on the Teams screen is populated from this
configuration, so there is a single source of truth.

**Level and Group are independent.** A pair has a `level` (Tunga / Bhadra / Kaveri / a configured
level / Unassigned) and a `group` (A or B). Changing a pair's level never moves it between groups
and never regenerates fixtures. Group-stage fixtures are built from Group A/B only.

**Unassigned pairs never block the tournament.** A pair without a level is valid and is reported
with a warning so the organizer can assign it later. `Anil & TBD` deliberately remains Unassigned
by default rather than being auto-assigned.

See [Team level configuration](#team-level-configuration) for the full behaviour.

---

## Scoring

### Group stage

Each group match is a **single game to 21 points**.

- Win = **2 tournament points**
- Loss = **0 tournament points**
- Draws are not possible

The winner is calculated automatically from the entered scores — you never pick a winner manually.

### Tie-breaks

Standings are ordered by:

1. Tournament points
2. Point difference (PF − PA)
3. Points scored (PF)

Standings columns: **# · Team · P · W · L · Pts · PF · PA · Diff**.

---

## Group stage

A complete **round-robin** is generated inside each group: every pair plays every other
pair in its group exactly once.

- 5 pairs per group → **10 matches per group**
- 2 groups → **20 group-stage matches**
- Each pair plays exactly **4 matches**

Group matches occupy match numbers `A-01…A-10` and `B-01…B-10`.

Once all 20 group matches are complete, the **top 4 from each group qualify**
automatically (`A1–A4`, `B1–B4`); the fifth-placed pair in each group is eliminated.
Qualifiers are never entered by hand.

---

## Rolling court scheduling

This is the heart of the app, and it deliberately does **not** use fixed time slots.

The scheduler never hard-codes a court number, name or time. It reads the live
`settings.courts` configuration (see [Court configuration](#court-configuration)), so an
administrator can add courts, rename them, change their hours or disable them mid-tournament.
Every court whose configured window is currently open is *idle* and immediately offers the
**next eligible match**.

Every time the Courts view is rendered, the scheduler:

1. Recomputes which matches are **eligible** — queued, both teams known, and neither team
   currently on court.
2. Ranks them with a **deterministic, explainable** ordering:
   1. Prefer matches where **neither team just stepped off court** (avoid back-to-back).
   2. Prefer matches whose **least-rested team has waited the longest** (fair rotation /
      teams that have been waiting longer go first).
   3. **Interleave the two groups** so neither group is starved.
   4. Fall back to the fixed generation order.
3. Assigns one **distinct** eligible match per idle court, never using the same match or the
   same team twice.

Because the ordering is deterministic, the same state always produces the same suggestion,
and the UI shows the reason each match was chosen (e.g. *“Naveen & Chandan waited 3 · …”*).

Hard guarantees enforced by `startMatch`:

- A team can never be on two courts at once.
- A court can never host two matches at once.
- A completed match cannot be started again.
- A disabled court never receives a new match (not even with the outside-hours override on).
- At most one match is ever in progress per enabled court.

Completing a match frees its court instantly and the next eligible match appears.
If the ideal next match would make a team play immediately again, another eligible match is
chosen when one exists — and if one does not, the UI says so explicitly.

Availability windows are **half-open**: a court configured `06:00 → 08:00` accepts new matches
from 06:00 up to (but not including) 08:00. They gate **starting a new match only** — a match
already in progress always plays to a finish, even past its court's closing time. Starting
matches after a window closes requires the **“Allow starting matches outside court hours”**
setting in Settings (off by default).

> The original venue windows are Court 1 `06:00–09:00` and Courts 2 & 3 `06:00–08:00`. Those are
> now just the defaults of an editable configuration rather than constants in the scheduler.

---

## Court configuration

Courts are **not** hard-coded. Settings → **Court configuration** lets the administrator change,
at any time, including mid-tournament:

- **Number of courts** — `1` to `8`. A row appears for every court.
- **Name** — e.g. rename `Court 1` to `Main Court`. The new name is used everywhere: Settings,
  Dashboard, Courts screen, match details and the scheduler.
- **Available from / until** — per-court time windows using native time inputs.
- **Enabled** — a per-court toggle.

The configuration is stored in tournament state, so it survives refresh, restart and
backup/import:

```js
settings.courts: [
  { id: 1, name: "Court 1", startTime: "06:00", endTime: "09:00", enabled: true },
  { id: 2, name: "Court 2", startTime: "06:00", endTime: "08:00", enabled: true },
  { id: 3, name: "Court 3", startTime: "06:00", endTime: "08:00", enabled: true }
]
```

`id` is stable internal identity; everything else is editable.

Behaviour and safety rules:

- **Changing a window takes effect immediately** for scheduling and **never interrupts a match
  already in progress**. A match that starts at 07:59 on a court closing at 08:00 runs to
  completion; that court then simply stops taking new matches.
- **Disabling** a court removes it from suggestions and shows it as *Disabled* on the Courts
  screen. It never receives a new match — not even when the outside-hours override is on.
- **Reducing the count** disables the surplus courts instead of deleting them, so their
  configuration and their completed-match history are preserved and they can be restored by
  raising the count again. **Increasing the count** appends new courts with sensible defaults.
- **Changing court configuration never** regenerates the 20 group matches, resets results,
  resets standings or resets knockout progression. Only availability changes.
- **Completed matches keep the court they actually played on.** Reducing the court count does
  not rewrite history.
- **Validation** rejects an empty or duplicate name, a malformed time, an end time not later
  than the start time, and a count outside `1–8`. Rejected edits are atomic — the live
  configuration is left untouched and the reason is shown inline. Disabling, or dropping via
  the count, a court that currently has a match in progress is refused with a clear warning
  rather than silently affecting the running match.

Existing backups remain backwards compatible.

---

## Team level configuration

Team levels are **not** hard-coded. `Tunga`, `Bhadra` and `Kaveri` are only the initial defaults;
the organizer controls the levels themselves from **Settings → Team Level Configuration**.

The section lists every configured level with its pair count, plus the always-present
`Unassigned` row and a total:

```
Level        Number of Pairs
Tunga        3
Bhadra       3
Kaveri       3
Unassigned   1
Total pairs: 10 · Assigned: 9 · Unassigned: 1
```

**One source of truth.** Levels live in tournament state:

```js
settings.levels: [
  { id: "tunga",  name: "Tunga",  enabled: true },
  { id: "bhadra", name: "Bhadra", enabled: true },
  { id: "kaveri", name: "Kaveri", enabled: true }
]
```

`id` is a stable slug that pairs reference; `name` is the editable label. The Teams dropdown,
Settings, validation and every display read this one configuration. No screen keeps its own list.

**Counts are derived, never stored.** Each count shown in Settings is calculated from the actual
`level` on each pair, so Settings can never disagree with the Teams screen. If three pairs have
`level: "kaveri"`, Settings shows `Kaveri — 3 pairs`.

What the organizer can do:

- **Add** a level (e.g. `Ganga`). It immediately appears in the Teams level dropdown.
- **Rename** a level — the label updates everywhere.
- **Enable / disable** a level.
- **Remove** a level — any pair assigned to it moves to `Unassigned` rather than becoming invalid.
- **Redistribute freely** — the distribution is not limited to the defaults. Tunga = 4 / Bhadra = 3
  / Kaveri = 3, or any other split, is allowed.

### Level vs Group

`Level` and `Group` are independent properties:

| Pair | Level | Group |
|------|-------|-------|
| Naveen & Chandan | Tunga | A |
| RK & Vinay | Kaveri | A |
| Anil & TBD | Unassigned | B |
| Praveen & Vinay | Bhadra | B |

- Group-stage fixtures are generated from **Group A / Group B**, never from Level.
- **Changing a pair's level never moves it between groups and never regenerates fixtures.**
- Changing a group keeps the existing structural safeguards (blocked once matches have started).

### Editing rules

- **Before any results exist:** levels can be changed freely and pairs moved between levels.
- **After results exist:** level changes are *still* allowed, because level does not affect
  fixtures. Group and pair-ID changes remain locked until reset.
- An **unassigned** pair is valid. A warning is shown and the tournament runs normally; level is
  never required to start a match.

Existing backups remain backwards compatible: old tournaments that stored levels as
`"Tunga" / "Bhadra" / "Kaveri"` import correctly and are mapped onto the configured level ids.

---

## Knockout structure

| Round | Match IDs | Format | Sets to |
|-------|-----------|--------|---------|
| Quarter-finals | QF-1 … QF-4 | Best of 3 | 11 |
| Semi-finals | SF-1 … SF-2 | Best of 3 | 15 |
| Final | F-1 | Best of 3 | 21 |

Pairings are generated automatically from the group standings:

- **QF-1** Group A #1 vs Group B #4
- **QF-2** Group B #1 vs Group A #4
- **QF-3** Group A #2 vs Group B #3
- **QF-4** Group B #2 vs Group A #3

- **SF-1** Winner QF-1 vs Winner QF-2
- **SF-2** Winner QF-3 vs Winner QF-4
- **Final** Winner SF-1 vs Winner SF-2

Each round unlocks automatically as the previous round finishes — QFs need a complete group
stage, SFs need all four QFs, the final needs both SFs. Every set score is validated (played
to the round's target, won by 2 clear points, a set cannot be tied, sets must be filled in
order, and a third set is rejected if one team already won the first two).

When the final is decided the app shows a clear **🏆 CHAMPION** card.

---

## Match numbering

| Stage | IDs |
|-------|-----|
| Group A | `A-01` … `A-10` |
| Group B | `B-01` … `B-10` |
| Quarter-finals | `QF-1` … `QF-4` |
| Semi-finals | `SF-1`, `SF-2` |
| Final | `F-1` |

---

## Screens

| Screen | Purpose |
|--------|---------|
| **Dashboard** | Progress (Group Stage `n / 20`, Overall `n / 27`), court cards, next matches, live standings, recent results |
| **Matches** | All group and knockout matches with enter/edit/undo actions |
| **Courts** | Rolling court queue — current match, next eligible match, start/complete, waiting list |
| **Standings** | Group A and Group B tables with qualifying positions highlighted |
| **Knockout** | QF → SF → Final bracket plus the champion card |
| **Teams** | Edit pair names, players, level (dropdown from the configured levels) and group; add/remove pairs |
| **Settings** | Tournament name, **Team Level Configuration** (levels and derived pair counts), **editable court configuration** (count, names, hours, enable/disable), scheduling options, backup, reset |

Each court card shows the court's configured name, status (*Available / In progress / Closed /
Disabled*), its availability window, the current match with its match number and teams, the next
eligible match, and Start/Complete buttons.

---

## Data persistence

State is saved to `localStorage` under the key `shuttledraw_v4` and includes:

- tournament metadata and name
- teams, players, levels and group membership
- the **level configuration** (`settings.levels`) and every pair's level assignment
- groups and all matches
- scores, sets, winners and losers
- court states, **court configuration** (count, names, availability windows, enabled flags) and start/completion timestamps
- standings (derived live from results)
- knockout progression and qualifiers
- settings and the current screen

Refresh the browser and the tournament continues exactly where it left off.

---

## Backup and restore

On the **Settings** screen:

- **Export backup** downloads the entire tournament as a JSON file
  (`shuttledraw-backup-YYYYMMDD-HHMM.json`).
- **Import backup** restores a previously exported JSON file. Invalid or unrelated files are
  rejected with a clear message.
- **Reset tournament** restores the default 20-player / 3-court configuration and deletes all
  results (confirmation required).
- **Clear results only** keeps teams and fixtures but deletes every score and the knockout
  bracket (confirmation required).

Court configuration (count, names, hours, enabled flags) has its own section and is edited
independently — see [Court configuration](#court-configuration). Changing it never resets
results or standings, and **Reset tournament** is the way to restore the default three-court
layout.

---

## How to run

No build step, no dependencies.

1. Download or clone the repository.
2. Open `index.html` in any modern browser (double-click it, or drag it into the browser).
3. The default tournament — 10 pairs, 2 groups, 3 courts — is ready immediately.

That's it. To host it, put `index.html` on any static host (GitHub Pages, Netlify, an S3 bucket,
a USB stick, …).

> Optional: because the app uses the Google Fonts CDN, a fully offline first load falls back to
> system fonts. All functionality works offline once the file is opened.

---

## How to reset

- **Reset tournament** (Settings) — back to the default configuration, all data gone.
- **Clear results only** (Settings) — keep teams and fixtures, delete all results.
- **Reset** on an individual match — clear that match and return it to the queue. Resetting a
  group match also clears the knockout bracket (because qualification changes); resetting a QF
  clears the SFs and final. The confirmation dialog states the exact cascade.
- To wipe everything manually, clear the site's data in your browser, which removes the
  `shuttledraw_v4` localStorage entry.

---

## Mobile usage

The UI is mobile-first:

- Full-width, large-touch-target buttons (44 px+).
- Horizontally scrollable tab bar — no cramped icons.
- Modals slide up from the bottom of the screen as sheets.
- Large numeric score inputs with numeric keyboards (`inputmode="numeric"`).
- Court cards stack on phones and go N-across on tablets/desktop.
- The bracket scrolls horizontally (intentional) so all four stages stay readable.
- Standings tables scroll horizontally inside their card, so the page itself never overflows.

Layouts are checked at 375 px, 390 px and 412 px widths.

---

## Error prevention / validation

- A team cannot be assigned to two simultaneous matches.
- A completed match cannot be started again (its card offers *Edit* / *Reset* instead).
- A match cannot be started until both teams are known.
- A match cannot be completed without valid scores.
- Group scores must reach 21, must be won by 2 clear points (or hit the 30-point cap), and
  cannot be tied.
- Knockout set scores are validated against the round's target.
- A third set is rejected when one team has already won the first two.
- QFs cannot be generated until the group stage is complete.
- SFs cannot be generated until all QFs are complete; the final cannot start until both SFs
  are complete.
- Teams/groups/IDs cannot be restructured once matches have started (renames stay allowed).
- Destructive operations require explicit confirmation.

---

## Architecture overview

A single `index.html` with no external JavaScript dependencies, split into two clearly
separated layers:

```
┌────────────────────────────────────────────────────────────┐
│  TM  (pure core logic, no DOM)                             │
│  • deterministic round-robin generator                     │
│  • match state model + validation                          │
│  • rolling court scheduler (eligibility, ranking, suggest) │
│  • editable court configuration + validation               │
│  • standings (points / PF / PA / diff / tie-breaks)        │
│  • knockout generation + cascade resets                    │
│  • localStorage save/load, migrate, export/import          │
└────────────────────────────────────────────────────────────┘
                          ▲  window.TM
                          │
┌────────────────────────────────────────────────────────────┐
│  App  (UI layer, DOM only)                                 │
│  • tab navigation and view rendering                       │
│  • score-entry modal with live winner preview              │
│  • courts, standings, bracket, teams, settings views       │
│  • court configuration editor (count / name / hours / on)  │
│  • toasts and confirmation dialogs                         │
└────────────────────────────────────────────────────────────┘
```

The core is deliberately DOM-free, which keeps all tournament rules in one testable place and
lets the UI stay a thin rendering layer.

### State model

```js
{
  version,                    // schema version for migrations
  tournament: { name, createdAt },
  teams:      [ { id, group, name, players[], level } ],
  groups:     { A: [teamId…], B: [teamId…] },
  matches:    [ {
      id, stage, group, round,
      teamA, teamB,
      court, status,          // 'queued' | 'in_progress' | 'completed'
      startedAt, completedAt, completedSeq,
      scoreA, scoreB,         // group stage
      sets[], setsA, setsB,   // knockout
      winner, loser, target
  } ],
  courts:    [ { id, name, startTime, endTime, enabled, closed } ],
  //           id is stable identity; preparation/UI editor writes name/times/enabled
  knockout:  { generated, champion, qualifiers },
  settings:  {
    allowOutsideAvailability,
    levels:  [ { id, name, enabled } ]
    //       configured levels; each team.level references a level id (or "unassigned")
    //       pair counts are derived from teams, never stored here
  },
  meta:      { seq },         // monotonic completion counter for fair rotation
  ui:        { screen }
}
```

`completedSeq` is a monotonic counter stamped on every completed match. The scheduler uses it
to compute how many matches have finished since each team last played, which is what makes the
“teams waiting longer play first” rule deterministic.

---

## Testing

A dependency-free test suite lives in `tests/`:

```bash
node tests/core.test.js
```

It extracts the DOM-free `TM` layer from `index.html` and asserts:

- exactly 10 matches per group and 20 overall, no duplicate pairings, every pair plays 4
- win = 2 points, loss = 0, correct PF / PA / Diff, tie-break ordering
- score validation (ties, sub-21, non-2-clear, cap)
- at most 3 simultaneous matches, no team twice on court, a freed court unblocks the queue
- deterministic scheduling and back-to-back avoidance preference
- automatic qualification, correct QF pairings, QF → SF → Final progression, champion
- knockout cascade resets
- localStorage round-trip, export/import, reset
- team-edit guards (rename allowed, structural change blocked once results exist)
- a full automatic group stage driven entirely by the rolling scheduler
- court availability gating (start blocked outside hours, in-progress match unaffected, override)
- **editable court configuration**: default windows, per-court time changes honoured by the
  scheduler, disabling a court (never suggested, never started, override does not bypass it),
  renaming flows through `courtName`, increasing and decreasing the court count, completed
  matches retaining their original court, live matches surviving configuration changes,
  invalid names/times/counts rejected atomically, and config surviving reload and backup
- migration of the pre-v5 `{ start, end }` court shape onto `{ startTime, endTime, enabled }`
- **configurable team levels**: the default levels and the default distribution
  (Tunga 3 / Bhadra 3 / Kaveri 3 / Unassigned 1), the Teams dropdown drawing from the configured
  levels, counts updating as pairs move between levels, moving a pair to Unassigned, level changes
  never regenerating fixtures or changing Group A/B, level changes allowed after results while
  group changes stay blocked, level assignments surviving reload and export/import, duplicate and
  reserved level ids/names rejected, the two Vinay pairs staying distinct, adding a new level,
  disabling a level moving its pairs to Unassigned, and old backups that stored levels as
  `"Tunga"/"Bhadra"/"Kaveri"` still importing
- corrupt/absent/denied localStorage never throws and defaults rebuild

`tests/core.test.js` is the only file committed for tests because it needs nothing beyond Node.
The browser/render checks below were run against a real headless Chromium during development and
are not committed, so the repository keeps zero dependencies:

- every screen renders at 375 px, 390 px and 412 px with no page-level horizontal overflow
- the knockout bracket scrolls inside its own container instead of widening the page
- score inputs and buttons meet a 44 px touch target, inputs request a numeric keypad
- the full flow (group stage → standings → qualifiers → QF → SF → final → champion) in-browser
- state survives a real page reload, and export → import → reset round-trips

Manual checks worth repeating before an event: open the app, run the group stage, then the
knockout, refresh mid-way to confirm persistence, and try an invalid score to confirm it is
rejected.

---

## File structure

```
Tournament/
├── index.html          ← entire application (core logic + UI, single file)
├── tests/
│   └── core.test.js    ← dependency-free core rules test suite
└── README.md
```

---

## License

MIT — free to use, modify, and distribute.
