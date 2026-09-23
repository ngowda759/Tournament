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
| Courts | 3 |
| Court 1 window | 06:00 AM → 09:00 AM |
| Courts 2 & 3 window | 06:00 AM → 08:00 AM |

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
| B5 | Anil & TBD | Kaveri |

**Two different players are named Vinay** — `RK & Vinay` (A3) and `Praveen & Vinay` (B3).
They are separate pairs and are never treated as the same player.

**Anil's partner is intentionally `TBD`** and remains editable on the **Teams** screen at any time.
Pair names, individual player names, and pair levels can all be edited after setup.

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

Available courts: **Court 1, Court 2, Court 3** (Court 1 runs an hour longer).
When a court becomes free, the app immediately offers the **next eligible match** for it.

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
- At most 3 matches are ever in progress.

Completing a match frees its court instantly and the next eligible match appears.
If the ideal next match would make a team play immediately again, another eligible match is
chosen when one exists — and if one does not, the UI says so explicitly.

Court availability windows (`06:00–09:00` for Court 1, `06:00–08:00` for the others) are recorded
and displayed. They gate **starting a new match only**: a match already in progress always plays
to a finish, even past the nominal close. Schedule starts after a window closes only if the
administrator turns on the **“Allow starting matches outside court hours”** setting in Settings
(off by default, so the rolling schedule stays honest to the venue's real hours).

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
| **Teams** | Edit pair names, players and levels; add/remove pairs |
| **Settings** | Tournament name, courts, scheduling options, backup, reset |

Each court card shows the court number, status (*Available / In progress / Closed*), the
current match with its match number and teams, the next eligible match, and Start/Complete
buttons.

---

## Data persistence

State is saved to `localStorage` under the key `shuttledraw_v4` and includes:

- tournament metadata and name
- teams, players, levels and group membership
- groups and all matches
- scores, sets, winners and losers
- court states and start/completion timestamps
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
- **Reset tournament** restores the default 20-player configuration and deletes all results
  (confirmation required).
- **Clear results only** keeps teams and fixtures but deletes every score and the knockout
  bracket (confirmation required).

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
- Court cards stack on phones and go three-across on tablets/desktop.
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
  courts:    [ { id, name, start, end, closed } ],
  knockout:  { generated, champion, qualifiers },
  settings:  { allowOutsideAvailability },
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
