# 🏸 ShuttleDraw — Badminton Tournament Manager

A lightweight, single-file tournament manager for badminton. No server, no database, no installation — just open `index.html` and play.

**Live demo:** `https://yourusername.github.io/badminton-tournament/`

---

## Features

- **Round-robin scheduling** — every team plays every other team exactly once
- **Multi-court support** — matches are automatically distributed across available courts
- **Click-to-record results** — tap a team to mark them as winner; tap again to undo
- **Live standings** — points table updates in real time as results come in
- **Persistent storage** — all data is saved to browser localStorage; closing and reopening the tab restores your tournament exactly where you left off
- **Odd team handling** — if you have an odd number of teams, a bye is automatically assigned each round
- **No dependencies** — pure HTML, CSS, and JavaScript; one file, works offline

---

## Scoring Rules

| Result | Points |
|--------|--------|
| Win    | 3 pts  |
| Loss   | 0 pts  |
| Draw   | Not applicable |

Teams are ranked by total points. In the event of a tie, the team with more wins ranks higher.

---

## How to Use

### 1. Setup
- Enter the number of teams (2–16) and the number of available courts (1–8)
- Fill in each team's name and an optional description (e.g. school name, category, player names)
- Click **Generate matches**

### 2. Matches
- Matches are grouped by round and assigned to courts automatically
- Click a team button to mark them as the **winner** of that match
- Click the same team again to **undo** the result
- A progress bar tracks how many matches have been completed

### 3. Standings
- View the full points table at any time via **View standings**
- The table shows matches played (P), wins (W), losses (L), and total points (Pts)
- Top 3 positions are highlighted with 🥇 🥈 🥉

---

## Hosting on GitHub Pages

1. Create a new GitHub repository (e.g. `badminton-tournament`)
2. Upload `index.html` to the root of the repository
3. Go to **Settings → Pages**
4. Under **Source**, select `main` branch and `/ (root)` folder
5. Click **Save**
6. Your app will be live at:
   ```
   https://yourusername.github.io/badminton-tournament/
   ```

> GitHub Pages may take 1–2 minutes to go live after the first deploy.

---

## Data & Privacy

All tournament data is stored exclusively in your browser's **localStorage**. Nothing is sent to any server. Clearing your browser data or using a different browser/device will start fresh.

To manually reset the tournament, click the **Reset** button in the top-right corner of the app.

---

## File Structure

```
badminton-tournament/
├── index.html   ← entire application (single file)
└── README.md
```

---

## License

MIT — free to use, modify, and distribute.
