# 🏸 Tournament — Configurable Badminton Doubles Tournament Manager

A lightweight, single-file badminton **doubles** tournament manager. It is fully
**configurable**: run any number of pairs, split them across any number of groups, and let the
app generate the group fixtures and the knockout bracket automatically from your configuration.

No server, no database, no login, no build step — open `index.html` and run the tournament.
Everything is client-side and stores its state in your browser's `localStorage`.

The organizer can run the whole event from a phone.

The familiar **20-player / 10-pair / 2-group / 3-court** tournament is only the *default
example* the app starts from. Nothing in the tournament engine assumes it.

---

## Table of contents

- [Tournament format](#tournament-format)
- [Configuring the tournament](#configuring-the-tournament)
- [Scoring](#scoring)
- [Group stage](#group-stage)
- [Rolling court scheduling](#rolling-court-scheduling)
- [Court configuration](#court-configuration)
- [Team level configuration](#team-level-configuration)
- [Knockout workflow](#knockout-workflow)
- [Knockout structure](#knockout-structure)
- [Multi-group knockout](#multi-group-knockout)
- [Qualification](#qualification)
- [Match numbering](#match-numbering)
- [Regenerating fixtures](#regenerating-fixtures)
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

Everything below is **configuration**, not a constant. The app ships with the default example
loaded; change any of it and the fixtures and bracket are regenerated accordingly.
**10 pairs is only the default example** — the app is a general configurable tournament manager.

| Item | Default example | Range / rule |
|------|-----------------|--------------|
| Doubles pairs | 10 | 2 – 32 |
| Groups | 2 (Group A, Group B) | 1 – 8, empty groups allowed until fixtures are generated |
| Pairs per group | 5 / 5 | derived from actual assignments |
| Qualifiers | top 4 per group | configurable per group |
| Courts | 3 (fully editable) | 1 – 8 |

The default example uses this pair list (edit or replace it freely):

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
**Settings → Team Level Configuration**, and the distribution can be changed freely. The level
dropdown on the Teams screen is populated from this configuration, so there is a single source of
truth.

**Level and Group are independent.** A pair has a `level` (Tunga / Bhadra / Kaveri / a configured
level / Unassigned) and a `group` (A or B, or any configured group). Changing a pair's level never
moves it between groups and never regenerates fixtures.

**Unassigned pairs never block the tournament.** A pair without a level is valid and is reported
with a warning so the organizer can assign it later.

See [Team level configuration](#team-level-configuration) for the full behaviour.

---

## Configuring the tournament

**Settings** is the central configuration area. It has a section for every knob:

| Section | What you configure |
|---------|--------------------|
| **Tournament Configuration** | Tournament name, and a read-out of the number of pairs, groups and group matches calculated from your data |
| **Groups** | Add an (empty) group, rename a group's label, remove an empty group; each row shows its pair count and group-match count, derived from actual assignments |
| **Qualification** | How many pairs qualify from each group, with a per-group breakdown |
| **Knockout Scoring** | Per-round format (Best of 3 / Straight set) and points target; freely configurable before the knockout starts, locked once it has started |
| **Regenerate Fixtures** | Current vs new pair/group/fixture/result counts, and an explicit regenerate action |
| **Team Level Configuration** | Add, rename, disable or remove levels; pair counts are derived |
| **Court configuration** | Court count, names, availability windows, enable/disable |
| **Scheduling** | Whether matches may start outside court hours |
| **Backup / Danger zone** | Export, import, reset |

Pairs themselves are edited on the **Teams** screen, which is the source of truth for the pair
list. The number of pairs comes from the Teams configuration — the app never creates placeholder
teams to reach a fixed count.

To run a shorter event, edit the pair list (remove pairs) or add pairs, and the tournament
operates as an N-pair tournament automatically. For example, removing two pairs from the default
10 leaves an 8-pair tournament with no empty/placeholder pairs.

### Adding, removing and renaming groups

Groups are stable containers with ids (`A`, `B`, `C`, …) and an optional friendly label.

- **Add group** (Settings → Groups, or the Teams screen) creates an **empty** group. It never
  moves an existing pair into it, never regenerates fixtures and never clears results.
- **Rename** only changes the cosmetic label — it never affects ids, fixtures or results.
- An empty group takes part in nothing until you assign pairs to it: it generates 0 matches and
  the dashboard keeps showing the real totals. Settings flags it with a warning so you know it
  needs pairs before fixtures can be generated for it.
- **Remove** is offered only for an **empty** group. A group that still holds pairs must have them
  moved out first. Removing an empty group never regenerates fixtures and never clears results —
  there is nothing to regenerate, because an empty group has no fixtures.
- Assign pairs to a group on the **Teams** screen (or in Settings once the group exists). A
  group with exactly one pair is rejected — a round-robin needs at least two.

In short: **adding, removing and renaming groups are never structural.** Only adding, removing or
moving **pairs** changes the playing structure, and only those actions ask for confirmation when
results already exist.

### Worked example — changing the tournament size

| Configuration | Groups | Group matches | Knockout | Overall |
|---------------|--------|---------------|----------|---------|
| 8 pairs, top 2 qualify | 4 + 4 | 6 + 6 = **12** | 4 qualify → SF → Final (3) | **15** |
| 9 pairs, top 4 qualify | 5 + 4 | 10 + 6 = **16** | 8 qualify → QF → SF → Final (7) | **23** |
| 10 pairs, top 4 qualify | 5 + 5 | 10 + 10 = **20** | 8 qualify → QF → SF → Final (7) | **27** |
| 3 groups × 3, top 2 qualify | 3 + 3 + 3 | 3 + 3 + 3 = **9** | 6 qualify → 2 byes + QF → SF → Final (5) | **14** |
| 3 groups (5 + 4 + 3), top 2 | 5 + 4 + 3 | 10 + 6 + 3 = **19** | 6 qualify → 2 byes + QF → SF → Final (5) | **24** |

Every number here is computed from the configuration, never stored. Adding, removing or renaming
a group never changes any of these numbers; only changing the pairs does.

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
pair in its group exactly once. The generator reads the actual group membership, so the number
of matches is always `N × (N − 1) / 2` for a group of N pairs.

| Pairs in a group | Group matches |
|------------------|---------------|
| 2 | 1 |
| 3 | 3 |
| 4 | 6 |
| 5 | 10 |
| 6 | 15 |

The total group-match count is the sum across the real groups:

| Tournament | Groups | Group matches |
|------------|--------|---------------|
| 8 pairs | 4 + 4 | 12 |
| 9 pairs | 5 + 4 | 16 |
| 10 pairs (default) | 5 + 5 | 20 |

There is no fixed "20 group matches". A group of 6 pairs produces `A-01` … `A-15`; a group of 4
produces `A-01` … `A-06`. Fixtures are never generated for empty or nonexistent pairs, and a pair
is never scheduled against itself.

### Round-robin correctness

For every group:

- every pair plays every other pair exactly once;
- there are no duplicate pairings and no self-matches;
- the match count is exactly `N × (N − 1) / 2`.

A round-based presentation (used while scheduling) may leave a pair idle in a given round when the
group size is odd, but a bye is **never** turned into a fake match — the round-robin generator
produces only real pairings.

Once the group stage is complete the configured number of qualifiers advance. See
[Qualification](#qualification).

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

- **Add court / Remove court** — append a new court with defaults, or remove a court slot
  entirely. `1`–`8` courts.
- **Number of courts** — `1` to `8`. A row appears for every court.
- **Name** — e.g. rename `Court 1` to `Main Court`. The new name is used everywhere: Settings,
  Dashboard, Courts screen, match details and the scheduler.
- **Available from / until** — per-court time windows using native time inputs.
- **Enabled** — a per-court toggle.
- **Mark closed / Reopen** — a transient per-session override.

All court management lives in Settings. The **Courts** screen is an operational monitor only —
it shows status and current/next matches and offers Start and Enter result, never configuration.

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
  screen. It never receives a new match — not even when the outside-hours override is on. Its
  configuration, matches and results are all preserved.
- **Removing** a court deletes only the court slot. Matches, results, teams and groups are
  untouched, and a completed match keeps the court id it actually played on. Removing a court
  that currently has a match in progress is refused with a clear warning.
- **Reducing the count** disables the surplus courts instead of deleting them, so their
  configuration and their completed-match history are preserved and they can be restored by
  raising the count again. **Increasing the count** appends new courts with sensible defaults.
- **Changing court configuration never** regenerates the fixtures, resets results,
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

The section lists every configured level with its pair count and pairs, plus the always-present
`Unassigned` group:

```
10 pairs · 9 assigned · 1 unassigned

Tunga        3 pairs
  Naveen & Chandan            [ Tunga ▼ ]
  Manjanna & Madhu            [ Tunga ▼ ]
  Praveen KG & Gagan          [ Tunga ▼ ]
Bhadra       3 pairs
  Harshit & Yakshit           [ Bhadra ▼ ]
  Gangadhar & Manju           [ Bhadra ▼ ]
  Praveen & Vinay             [ Bhadra ▼ ]
Kaveri       3 pairs
  RK & Vinay                  [ Kaveri ▼ ]
  Nihar & Rajeev              [ Kaveri ▼ ]
  Prabhakar & Phani           [ Kaveri ▼ ]
Unassigned   1 pair
  Anil & TBD                  [ Unassigned ▼ ]

⚠ 1 pair is unassigned: Anil & TBD

[ Repair level assignments ]
```

Changing a pair's level with one of those controls updates the counts immediately. It only changes
that pair's `level` property — it never regenerates fixtures, clears results, changes group
membership, alters match history or touches the knockout bracket.

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
`level: "kaveri"`, Settings shows `Kaveri — 3 pairs`. There is deliberately no separately stored
count anywhere.

### The canonical level resolver

Every read of a pair's level goes through one resolver, `resolveLevel(value)`, so the Teams screen,
Settings counts, the level chips and the settings dropdowns can never disagree. Given a stored
value it resolves, in order:

1. exact canonical id — `kaveri` → `kaveri`
2. case-insensitive id — `KAVERI` → `kaveri`
3. exact display name — `Kaveri` → `kaveri`
4. case-insensitive display name — `kaveri` (as a name) → `kaveri`
5. normalized slug — ` Kaveri! ` → `kaveri`
6. only then the `unassigned` sentinel

A validly assigned pair is **never** moved to Unassigned merely because its stored value is a
display name or a different case. The resolver reads only stored id/name information — it never
infers a level from a pair's name or players. An unknown value remains `unassigned`.

Migration uses this same resolver against the document's `settings.levels`, so an existing
tournament with legacy `"Tunga" / "Bhadra" / "Kaveri"` values loads with the correct assignments.
Migration is idempotent: running it repeatedly produces exactly the same state.

### Repairing existing assignments

**Repair level assignments** is a non-destructive button in the Team Level Configuration section.
It normalizes legacy stored representations (display names, mixed case, slugs) to canonical ids
through the same resolver, resolves ids/names case-insensitively, repairs valid existing
assignments, and leaves genuinely unknown values as Unassigned. It never modifies groups, never
regenerates fixtures, never deletes results and never touches the knockout bracket — it saves only
when something actually changed. It reports either `3 level assignments repaired.` or
`No level assignments required repair.`

The repair path also means an existing browser's localStorage never needs to be cleared: bad
assignments are fixed on load by migration and can be normalized further with the repair button.

What the organizer can do:

- **Add** a level (e.g. `Ganga`). It immediately appears in the Teams level dropdown.
- **Rename** a level — the label updates everywhere.
- **Enable / disable** a level.
- **Remove** a level — any pair assigned to it moves to `Unassigned` rather than becoming invalid.
- **Redistribute freely** — the distribution is not limited to the defaults. Tunga = 4 / Bhadra = 3
  / Kaveri = 3, or any other split, is allowed.

### Teams page

The Teams page keeps its level dropdown and uses exactly the same canonical resolver and configured
level list as Settings. Every row shows `RK & Vinay · Kaveri`, so the two screens cannot disagree.
Both derive their information from the same underlying `state.teams`.

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

## Knockout workflow

The knockout follows a staged workflow, shown as an indicator on the **Knockout** screen and in
**Settings → Knockout Scoring**:

```
Group Stage
    ↓
Configure Knockout Rules
    ↓
Generate/Start Knockout
    ↓
🔒 Knockout Rules Locked
    ↓
QF → SF → Final
```

Each step is derived from live tournament state — nothing is stored separately — so the indicator
can never disagree with the engine. The one durable signal is `knockout.started`, a latch set when
the knockout is started and cleared only by an explicit reset.

1. **Group Stage** — while group matches are being played, the knockout rules can be configured
   freely (see below). The bracket does not exist yet, and the knockout cannot be started.
2. **Configure Knockout Rules** — **Settings → Knockout Scoring** sets each round's format and
   points target. This is the only time the rules can be changed.
3. **Generate/Start Knockout** — once every group match is complete, the Knockout screen offers
   **Generate / Start knockout**. Starting the knockout builds the first bracket round from the
   final standings. This is an explicit step; the bracket is **not** generated automatically on
   the last group result, so the rules are always configured first.
4. **🔒 Knockout Rules Locked** — starting the knockout locks the scoring rules permanently. From
   here the Settings controls are disabled and any attempt to change a rule is refused with a
   clear message. The lock is a durable latch, so it survives clearing the bracket and cannot be
   reopened by a side effect.
5. **QF → SF → Final** — each later round unlocks automatically as the previous round finishes.
   Every match keeps the rules it was created under, so the lock never rewrites a live or
   completed match.

### Resetting the knockout

Clearing the bracket unlocks the rules only while the knockout is **unplayed**. As soon as any
knockout match is in progress or completed, the bracket is protected:

- **Reset** on a group result, **Regenerate fixtures** and the ordinary clear all refuse and
  explain why, so a played knockout can never be discarded by a side effect.
- The explicit **Clear results only** action (Settings → Danger zone) is the sanctioned way to
  discard a played knockout; it asks for confirmation, clears the bracket and releases the lock.
- An unplayed bracket — generated but with no result recorded — can still be cleared to
  reconfigure and start again.

A single knockout match can still be reset on its own (**↺ Reset** on the match). That clears only
that match and its later dependants, so the lock stays on.

The final step's label is derived from the qualifier count: a top-4 field reads
`QF → SF → Final`, a top-2 field reads `SF → Final`, and a larger bracket reads
`R16 → QF → SF → Final`.

---

## Knockout structure

The bracket is generated from the **number of qualifiers**, not from a fixed round list. If N
pairs qualify, the engine builds the single-elimination bracket for N:

| Qualifiers | Rounds |
|------------|--------|
| 2 | Final |
| 4 | Semi-finals → Final |
| 8 | Quarter-finals → Semi-finals → Final |
| 16 | Round of 16 → Quarter-finals → Semi-finals → Final |
| 32 | Round of 32 → Round of 16 → Quarter-finals → Semi-finals → Final |

Round formats (best of 3):

| Round | Match IDs | Sets to |
|-------|-----------|---------|
| Round of 32 | R32-1 … R32-16 | 11 |
| Round of 16 | R16-1 … R16-8 | 11 |
| Quarter-finals | QF-1 … QF-4 | 11 |
| Semi-finals | SF-1 … SF-2 | 15 |
| Final | F-1 | 21 |

Seeding depends on how many groups are configured, and every configured group contributes its
qualifiers — none is ever dropped or duplicated.

**Two groups (the default example)** use the classic cross seeding. With top 4 qualifying
(`A1`…`A4`, `B1`…`B4`):

- **QF-1** Group A #1 vs Group B #4
- **QF-2** Group B #1 vs Group A #4
- **QF-3** Group A #2 vs Group B #3
- **QF-4** Group B #2 vs Group A #3

- **SF-1** Winner QF-1 vs Winner QF-2
- **SF-2** Winner QF-3 vs Winner QF-4
- **Final** Winner SF-1 vs Winner SF-2

With top 2 qualifying from each group, the engine goes straight to semi-finals (`A1 vs B2`,
`B1 vs A2`) — no quarter-finals are created.

**Three or more groups** use a deterministic balanced draw:

1. **Rank-interleave** — rank 1 of every group, then rank 2 of every group, and so on, so no
   group dominates the top or bottom of the list.
2. **Snake-fold** — the strongest seed is drawn against the weakest, the second strongest
   against the second weakest, and so on.

For example, three groups of three with top 2 each produce six seeds in the order
`A1, C2, B1, B2, C1, A2`, and the two byes go to the strongest seeds (`A1`, `B1`). The bracket is
always the next power of two ≥ the total qualifiers, byes are `bracket size − qualifiers`, and the
number of real knockout matches is always `qualifiers − 1`.

With a different number of qualifiers the bracket is built accordingly, and if the qualifier count
is not a power of two, **byes** are inserted automatically.

### Byes

A bye advances a pair without creating a fake match. A bye:

- never appears as a schedulable match — the rolling scheduler ignores it;
- cannot be started, scored or reset;
- never has two real opponents;
- never counts toward the played or total match counts;
- automatically advances its real team into the next round.

For example, with **6 qualifiers** the engine creates an 8-slot bracket: 2 byes and 2 real
quarter-finals, then semi-finals and a final — 5 real knockout matches in total (`6 − 1`).

Each round unlocks automatically as the previous round finishes. Every set score is validated
(played to the round's target, won by 2 clear points, a set cannot be tied, sets must be filled in
order, and a third set is rejected if one team already won the first two).

**Best of 3** is decided when one team wins two games (2–0 or 2–1); a single game is never enough.
**Straight set** is decided by exactly one game — the higher score wins, no second game is accepted,
and there is no best-of-2 variant. Both formats share the round's points-per-game target.

When the final is decided the app shows a clear **🏆 CHAMPION** card.

The total match count is always `group matches + (qualifiers − 1)`; nothing is hard-coded.

---

## Multi-group knockout

The bracket is built from **all** configured groups, whatever their number. Every group that has
qualifiers contributes them, and no qualifier is ever dropped or duplicated.

The rules are:

1. **Qualifiers** come from each group via Settings → Qualification (top *n* per group).
2. **Bracket size** is the next power of two ≥ the total number of qualifiers.
3. **Byes** = bracket size − qualifiers, and they go to the strongest seeds. A bye advances a team
   without creating a fake match.
4. **Real knockout matches** = qualifiers − 1, always.

Seeding by group count:

| Groups | Strategy |
|--------|----------|
| 1 | Qualifiers in standing order |
| 2 | Classic cross-seed: `A1 vs Bk`, `B1 vs Ak`, `A2 vs B(k−1)`, `B2 vs A(k−1)`, … |
| 3+ | Rank-interleave (rank 1 of each group, then rank 2, …), then snake-fold so the strongest seed meets the weakest |

See [Knockout structure](#knockout-structure) for the concrete examples and the worked pairings.

Worked multi-group examples:

| Configuration | Group matches | Qualifiers | Bracket | Byes | Real KO | Overall |
|---------------|---------------|------------|---------|------|---------|---------|
| 3 × 3, top 2 | 9 | 6 | 8 | 2 | 5 | 14 |
| 5 + 4 + 3, top 2 | 19 | 6 | 8 | 2 | 5 | 24 |
| 3 + 3 + 3 + 3, top 1 | 12 | 4 | 4 | 0 | 3 | 15 |
| 4 + 3 + 2 + 2, top 2 | 11 | 8 | 8 | 0 | 7 | 18 |

---

## Qualification

**Settings → Qualification** controls how many pairs advance from each group. The selection is
validated: it cannot exceed the largest group size, and changing it after the bracket exists
requires regenerating the fixtures first.

Examples:

- **8 pairs, 4 + 4, top 2 each** → 4 qualifiers → Semi-finals (`A1 vs B2`, `B1 vs A2`) → Final.
- **10 pairs, 5 + 5, top 4 each** → 8 qualifiers → Quarter-finals → Semi-finals → Final.
- **9 pairs, 5 + 4, top 4 each** → 8 qualifiers → Quarter-finals → Semi-finals → Final.
- **3 groups of 3, top 2 each** → 6 qualifiers → 8-slot bracket with 2 byes → Quarter-finals →
  Semi-finals → Final (5 real knockout matches).

A group smaller than the configured qualifier count simply qualifies all of its pairs.

The overall match count is always `group matches + (qualifiers − 1)`:

| Configuration | Group matches | Qualifiers | Knockout | Overall |
|---------------|---------------|------------|----------|---------|
| 8 pairs (4 + 4), top 2 | 12 | 4 | 3 | 15 |
| 9 pairs (5 + 4), top 4 | 16 | 8 | 7 | 23 |
| 10 pairs (5 + 5), top 4 | 20 | 8 | 7 | 27 |
| 3 × 3, top 2 | 9 | 6 | 5 (+2 byes) | 14 |

None of these numbers is hard-coded — each is derived from the configuration.

---

## Match numbering

Match IDs are generated from the actual fixtures and rounds, never assumed:

| Stage | IDs |
|-------|-----|
| Group A (N pairs) | `A-01` … `A-0N(N−1)/2` |
| Group B (N pairs) | `B-01` … `B-0N(N−1)/2` |
| Round of 16 | `R16-1` … |
| Quarter-finals | `QF-1` … |
| Semi-finals | `SF-1`, `SF-2` |
| Final | `F-1` |

For example, a 4-pair group reaches `A-06`, a 6-pair group reaches `A-15`. Rounds the tournament
does not use (e.g. quarter-finals in an 8-pair, top-2 tournament) are never created.

---

## Regenerating fixtures

**Settings → Regenerate Fixtures** is the safe way to rebuild the schedule after a structural
change. It shows the current state and the result before committing:

```
Current: 10 pairs · 5 / 5 groups · 20 fixtures · 7 completed
After regenerating: 20 group fixtures + 7 knockout matches
```

The confirmation states that regenerating will remove existing match results and standings. Only
on explicit confirmation are fixtures rebuilt and results cleared.

### Editing rules

Before any fixtures/results exist, pairs can be freely added, removed, edited, moved between
groups and assigned levels. Adding or removing an *empty* group is also always safe — it never
touches a pair or a fixture.

Once results exist, the app distinguishes:

- **Non-structural edits** — renaming a pair, editing players, changing a level, renaming a group
  label, adding an empty group, removing an empty group — always apply and never disturb fixtures
  or results.
- **Structural edits** — adding/removing a pair or changing group membership — would invalidate the
  fixtures, so the app warns
  *“Changing the number of pairs or group membership will regenerate fixtures. Existing results
  will be lost.”* and requires explicit confirmation.

Results are never silently destroyed, and removing a pair never leaves matches pointing at a
deleted team ID — the fixtures are regenerated from the surviving pairs.

---

## Screens

| Screen | Purpose |
|--------|---------|
| **Dashboard** | Progress (Group Stage `n / <group matches>`, Overall `n / <total>` — both computed from the configuration), court cards, next matches, live standings, recent results |
| **Matches** | All group and knockout matches with enter/edit/undo actions |
| **Courts** | Operational monitor — current match, next eligible match, start/complete, waiting list (no configuration controls) |
| **Standings** | One table per group with qualifying positions highlighted |
| **Knockout** | The staged workflow indicator (group stage → configure rules → start → 🔒 locked → rounds), the generated bracket (whatever rounds apply) plus the champion card |
| **Teams** | Edit pair names, players, level (dropdown from the configured levels) and group; add/remove pairs |
| **Settings** | Central configuration: tournament name, groups, qualification, regenerate fixtures, levels, court configuration, scheduling, backup, reset |

The dashboard labels are derived from the live configuration, e.g. `Group Stage 7 / 16` and
`Overall 10 / 21` for a 9-pair tournament — never the fixed `7 / 20` of a 10-pair example.

Standings work for any group size: they are not assumed to have exactly five rows. Every group
shows **# · Team · Played · Won · Lost · Pts · PF · PA · Diff**, with the qualifying rows
highlighted.

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
- **qualification configuration** (`settings.qualification`)
- standings (derived live from results)
- knockout progression and qualifiers
- settings and the current screen

Refresh the browser and the tournament continues exactly where it left off.

---

## Backup and restore

On the **Settings** screen:

- **Export backup** downloads the entire tournament as a JSON file
  (`Tournament-backup-YYYYMMDD-HHMM.json`).
- **Import backup** restores a previously exported JSON file. Invalid or unrelated files are
  rejected with a clear message.
- **Reset tournament** restores the default example configuration (10 pairs, 2 groups, 3 courts)
  and deletes all results (confirmation required).
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
3. The default example — 10 pairs, 2 groups, 3 courts — is ready immediately. Edit the pairs and
   groups in **Teams** / **Settings** to run any size of tournament.

That's it. To host it, put `index.html` on any static host (GitHub Pages, Netlify, an S3 bucket,
a USB stick, …).

> Optional: because the app uses the Google Fonts CDN, a fully offline first load falls back to
> system fonts. All functionality works offline once the file is opened.

---

## How to reset

- **Reset tournament** (Settings) — back to the default example configuration, all data gone.
- **Clear results only** (Settings) — keep teams and fixtures, delete all results.
- **Regenerate fixtures** (Settings) — rebuild fixtures for the current pairs/groups, clearing
  results (confirmation required).
- **Reset** on an individual match — clear that match and return it to the queue. Resetting a
  group match also clears the knockout bracket (because qualification changes); resetting a
  quarter-final clears the semi-finals and final. The confirmation dialog states the exact
  cascade. A bye cannot be reset — it advances a pair automatically.
- To wipe everything manually, clear the site's data in your browser, which removes the
  `shuttledraw_v4` localStorage entry.

---

## Mobile usage

The UI is mobile-first:

- Full-width, large-touch-target buttons (44 px+).
- **One compact header row on desktop** — branding, every navigation destination
  (Dashboard, Matches, Courts, Standings, Knockout, Teams, Settings) and the Theme/Help
  actions share a single flex row. No second navigation row and no duplicate Settings button.
- On mobile the nav collapses to the primary screens (Dashboard, Matches, Courts) plus a
  **More** menu holding Standings, Knockout, Teams and Settings.
- Modals slide up from the bottom of the screen as sheets.
- Large numeric score inputs with numeric keyboards (`inputmode="numeric"`).
- Courts are an operational monitor: status/current/next per court, no configuration controls.
- Match tiles use a slightly larger, more readable card — match id/stage, group/round, both
  teams with a VS divider, then status/court/level and the score or action. They sit in a
  responsive grid that is two columns on desktop and a single column on phones.
- The bracket scrolls horizontally (intentional) so all four stages stay readable.
- Standings tables scroll horizontally inside their card, so the page itself never overflows.

Layouts are checked at 375 px, 390 px and 412 px widths, and the desktop header is checked for
single-row, no-horizontal-overflow behaviour.

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
- The first knockout round cannot be generated until the group stage is complete; each later
  round cannot be built until all of its feeders are decided.
- The qualifying configuration cannot exceed the largest group size, and cannot be changed once
  the bracket exists.
- Structural changes (pair count or group membership) cannot be applied once matches have started
  without explicit confirmation to regenerate fixtures; renames, player edits and level changes
  stay allowed.
- A bye is never schedulable, scorable or resettable.
- The pair list must satisfy the configuration limits: 2–32 pairs, at least 2 pairs per group,
  at most 8 groups, unique names within a group, and every pair assigned to a group.
- Destructive operations require explicit confirmation.

---

## Architecture overview

A single `index.html` with no external JavaScript dependencies, split into two clearly
separated layers:

```
┌────────────────────────────────────────────────────────────┐
│  TM  (pure core logic, no DOM)                             │
│  • generic round-robin generator (any group size)          │
│  • match state model + validation                          │
│  • dynamic group fixtures + dynamic match ids              │
│  • rolling court scheduler (eligibility, ranking, suggest) │
│  • editable court configuration + validation               │
│  • standings (points / PF / PA / diff / tie-breaks)        │
│  • qualification + generic knockout generation w/ byes     │
│  • fixture regeneration and cascade resets                 │
│  • localStorage save/load, migrate, export/import          │
└────────────────────────────────────────────────────────────┘
                          ▲  window.TM
                          │
┌────────────────────────────────────────────────────────────┐
│  App  (UI layer, DOM only)                                 │
│  • tab navigation and view rendering                       │
│  • score-entry modal with live winner preview              │
│  • courts, standings, bracket, teams, settings views       │
│  • settings: tournament, groups, qualification, levels,    │
│    courts, regenerate, backup                              │
│  • toasts and confirmation dialogs                         │
└────────────────────────────────────────────────────────────┘
```

The core is deliberately DOM-free, which keeps all tournament rules in one testable place and
lets the UI stay a thin rendering layer.

### Core API

The core exposes a generic tournament engine — nothing is tied to 10 pairs or 2×5:

```js
createTournament(config)
addTeam(team)                    removeTeam(teamId)
updateTeam(teamId, changes)      assignTeamToGroup(teamId, groupId)
addGroup(groupId?)               removeGroup(groupId)
renameGroup(groupId, label)      groupLabel(groupId)
nextGroupId()                    nextTeamId(group)
validateGroups(groups, teams)    validateTeams(teams)
regenerateFixtures()             regeneratePlan()
generateGroupFixtures()          buildGroupMatches()
getGroupMatchCount(groupId)      getTotalGroupMatchCount()
getQualifiedTeams()              setQualification(perGroup)
generateKnockout()               bracketRounds(n)
ensureKnockout()                 knockoutInfo()
getKnockoutRules()               setKnockoutRule(stage, rule)
knockoutRulesLocked()            knockoutWorkflow()
bracketStageLabel()              getTotalMatchCount()
progress()
```

`generateKnockout()` is the explicit **Generate/Start knockout** step. `ensureKnockout()` only
advances *later* rounds once their feeders are decided — it never builds the first round, so the
knockout rules can always be configured first. `setKnockoutRule()` refuses edits while
`knockoutRulesLocked()` is true (i.e. while any knockout match exists). `knockoutWorkflow()`
returns the staged indicator (`Group Stage → Configure Knockout Rules → Generate/Start Knockout
→ 🔒 Knockout Rules Locked → <rounds>`), derived entirely from live state.

### State model

```js
{
  version,                    // schema version for migrations
  tournament: { name, createdAt },
  teams:      [ { id, group, name, players[], level } ],
  groups:     { /* groupId: [teamId…] */ },   // any number of groups, any size (0 allowed)
  groupLabels:{ /* groupId: "friendly name" */ },  // cosmetic, optional
  matches:    [ {
      id, stage, group, round,
      teamA, teamB,
      court, status,          // 'queued' | 'in_progress' | 'completed'
      startedAt, completedAt, completedSeq,
      scoreA, scoreB,         // group stage
      sets[], setsA, setsB,   // knockout
      winner, loser, target, bye
  } ],
  courts:    [ { id, name, startTime, endTime, enabled, closed } ],
  //           id is stable identity; preparation/UI editor writes name/times/enabled
  knockout:  { generated, champion, qualifiers },
  settings:  {
    allowOutsideAvailability,
    qualification: { perGroup },  // how many advance from each group
    levels:  [ { id, name, enabled } ]
    //       configured levels; each team.level references a level id (or "unassigned")
    //       pair counts are derived from teams, never stored here
  },
  meta:      { seq },         // monotonic completion counter for fair rotation
  ui:        { screen }
}
```

Every count is derived: `teams.length`, `groups[groupId].length`, `matches.length`,
`qualifiers.length`. There are deliberately no `teams.length === 10` or `groups.A.length === 5`
assumptions anywhere in the app.

`completedSeq` is a monotonic counter stamped on every completed match. The scheduler uses it
to compute how many matches have finished since each team last played, which is what makes the
“teams waiting longer play first” rule deterministic.

---

## Testing

A dependency-free test suite lives in `tests/`:

```bash
node tests/core.test.js
node tests/render.test.js
```

It extracts the DOM-free `TM` layer from `index.html` and asserts, among ~1900 checks:

- **dynamic group stage**: correct round-robin counts for 2/3/4/5/6 pairs (1/3/6/10/15) and for
  8 pairs 4+4 (12), 9 pairs 5+4 (16), 10 pairs 5+5 (20); no duplicate pairings, no self-matches,
  every pair plays every other pair exactly once
- **dynamic match ids**: a 4-pair group is `A-01`…`A-06`, a 6-pair group reaches `A-15`; no
  assumed `A-10`/`B-10`
- **generic state model**: no `teams.length === 10` / `groups.A.length === 5` assumptions, no
  hard-coded "20 group matches" or "27 matches", score target 21 preserved as a rule
- **pair management**: add, remove, rename, edit players, move between groups; removing two pairs
  from the default 10 leaves 8 pairs with 12 matches and no placeholders or orphan fixtures
- **regeneration safety**: structural changes after results require confirmation and change
  nothing until confirmed; regenerate clears results and rebuilds for the new shape;
  `regeneratePlan()` reports current pairs, distribution, results and new fixture count
- **qualification**: per-group qualifier count validated against the largest group; refused once
  the bracket exists; 8-pair top-2 yields SF (no QF) and 4 qualifiers
- **staged knockout workflow**: the indicator walks `Group Stage → Configure Knockout Rules →
  Generate/Start Knockout → 🔒 Knockout Rules Locked → <rounds>` and is derived entirely from
  live state (never persisted or exported); the first bracket round is an explicit
  `generateKnockout()` step, not auto-generated on the last group result; rules are editable
  during the group stage, locked the moment the bracket exists, and unlocked again by a knockout
  reset; a locked `setKnockoutRule()` is refused with an explanatory message and changes nothing
- **dynamic knockout**: 2 → Final, 4 → SF+Final, 8 → QF onward (7 matches), 16 → R16 onward
  (15 matches), 17–32 → Round of 32 onward; every qualifier count from 2 to 16 is played through
  to a champion; non-power-of-two qualifier counts (3, 5, 6, 7, 9, 10, 12, 14) create byes that
  auto-advance a real pair and are never schedulable, scorable or resettable
- **dynamic groups**: add an empty group (never moves a pair, never changes fixtures), remove an
  empty group, refusal to remove a non-empty group, refusal to remove the last group, stable
  sequential ids, max-groups cap, and cosmetic group labels that never touch fixtures
- **empty-group safety**: with completed results present, adding, removing or renaming an empty
  group leaves every completed result, every group fixture and any knockout bracket byte-for-byte
  unchanged — proven by snapshotting the completed matches before and after. Structural pair
  edits (add/remove/move) still require confirmation when results exist and change nothing until
  confirmed; confirming clears results and rebuilds with no orphaned matches
- **multi-group knockout**: 8 pairs 4+4 top 2 → 12 group + 3 knockout = 15; 9 pairs 5+4 top 4 →
  16 + 7 = 23; 10 pairs 5+5 top 4 → 20 + 7 = 27; 3 groups × 3 top 2 → 9 group matches, 6
  qualifiers, 2 byes, 5 real knockout matches; unequal 3-group (5+4+3) and 4-group (3+3+3+3 and
  4+3+2+2) configurations. In every case all configured groups contribute their qualifiers, no
  qualifier is dropped or duplicated, the bracket is the next power of two ≥ the qualifiers, and
  real knockout matches equal `qualifiers − 1`
- **seeding**: the classic two-group cross-seed (`A1 vs B4`, `B1 vs A4`, `A2 vs B3`, `B2 vs A3`;
  and `A1 vs B2`, `B1 vs A2` for top 2) is preserved exactly; one group seeds in standing order;
  three groups rank-interleave and snake-fold so the strongest seed is drawn against the weakest
- **multi-group persistence**: groups, labels, fixtures and the multi-group bracket survive
  reload and export/import intact
- **pair validation**: duplicate pair names (tournament-wide), empty names, duplicate ids, empty
  group assignment, too few pairs, a one-pair group, and a pair in an undeclared group
- **standings** for groups of 3 and 6 rows, with all columns present
- **scheduler** on a 12-match queue: no team on two courts, no court double booking,
  deterministic selection, distinct matches per court, disabled courts ignored
- **dashboard progress** computed for 8/9/10-pair tournaments (`12`/`16`/`20` group and
  `15`/`23`/`27` overall) and partial-progress labels
- **levels** derived from assignments and independent of groups (survive a group move), and
  **courts** independent of pair count
- **end-to-end scenarios A–E**: 8 pairs (4+4, top 2 → 15), 9 pairs (5+4, top 4 → 23),
  10 pairs (5+5, top 4 → 27), three groups of three (9 group matches) and 6 qualifiers (5
  knockout matches with 2 byes). Each runs from the group stage through qualifiers and the
  knockout to a champion using the same generic engine with no special-case code
- **regeneration safety**: the plan's before/after counts; structural changes (add/remove/move)
  refused after results without explicit confirmation; cancel keeps results; confirming clears
  results and rebuilds with no orphaned matches; renames and level changes never regenerate
- **group configuration persistence**: empty groups and labels survive reload and export/import
- **persistence, export and import** of an arbitrary-size tournament
- win = 2 points, loss = 0, correct PF / PA / Diff, tie-break ordering
- score validation (ties, sub-21, non-2-clear, cap)
- at most 3 simultaneous matches, no team twice on court, a freed court unblocks the queue
- deterministic scheduling and back-to-back avoidance preference
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

Two committed test files, both dependency-free:

- `tests/core.test.js` — extracts the DOM-free `core-logic` script and exercises the whole `TM`
  engine. Run with `node tests/core.test.js`.
- `tests/render.test.js` — loads the full single-file app (core + UI) under a minimal DOM shim and
  renders every screen for the default 10-pair layout, 8 pairs (4+4), 9 pairs (5+4), a
  6-qualifier bracket with byes, and three groups of three, asserting the dynamic counts appear
  (e.g. `/ 12` not `/ 20`) and no `undefined`/`NaN` leaks into the markup. Run with
  `node tests/render.test.js`.

The browser checks below were run against a real headless Chromium during development and are not
committed, so the repository keeps zero dependencies:

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
│   ├── core.test.js    ← dependency-free core rules test suite
│   └── render.test.js  ← dependency-free UI render smoke suite
└── README.md
```

---

## License

MIT — free to use, modify, and distribute.
