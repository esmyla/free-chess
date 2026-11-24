# Free Chess

A personal chess trainer that runs entirely in your browser. It is a separate app built from open
parts. It does not unlock, bypass or copy anything on chess.com; it does its own analysis on your
computer.

Live at https://esmyla.github.io/free-chess/

## Run it locally

```bash
npm install
npm run dev
```

Then open http://localhost:5176.

## Publish

```bash
npm run deploy
```

Builds the app and pushes it to the `gh-pages` branch, which GitHub Pages serves.

## What it does

| Screen | What you get |
| --- | --- |
| Games | Pulls your finished games from chess.com's public API by username (no login), or imports PGN |
| Game review | Stockfish 19 checks every position: accuracy per side, graded moves (brilliant to blunder), a plain-language note per move, the engine's better line, an evaluation graph, and "retry your mistakes" |
| Analysis | Free board with live multi-line engine evaluation; paste any FEN or PGN |
| Openings | Opening explorer: master games, online games, and your own imported games |
| Puzzles | 44,000+ puzzles with a local rating, practice by theme, and a timed sprint. No daily limit |
| Play | Nine computer opponents from about 400 to full engine strength; finished games can be reviewed |
| Insights | Results by colour, opening, opponent strength, weekday and time of day; rating and accuracy trends |

Everything you import or solve is stored in this browser (IndexedDB and localStorage).

## How the numbers are made

- **Accuracy** uses the winning-chances method Lichess publishes. It will not match chess.com's
  figure for the same game, because chess.com's formula is its own.
- **Move grades** come from how much winning chance a move gives up (0-2 points excellent, up to 5
  good, up to 10 inaccuracy, up to 20 mistake, more is a blunder), plus rules for book moves,
  sacrifices (brilliant), only-moves (great) and missed chances. The logic is in
  `src/lib/reviewCore.ts`.
- **Engine effort** is set in Settings: Fast, Standard or Deep.

## Data

| Data | Source | Rebuild |
| --- | --- | --- |
| Engine | `stockfish` npm package (Stockfish 19 lite, WASM) | `npm run setup:engine` |
| Opening names | github.com/lichess-org/chess-openings (CC0) | `npm run build:openings` |
| Puzzles | database.lichess.org (CC0), a sample of the full set | `npm run build:puzzles` |

For a bigger puzzle pack: `PER_BAND=6000 ROWS=1500000 npm run build:puzzles` (needs `curl` and `zstd`).

## Licences

Stockfish, chessground and the cburnett piece set are GPL-3, so this app as a whole is
GPL-3.0-or-later. chess.js is BSD-2. The Lichess puzzle and opening data are CC0. Not affiliated
with chess.com or Lichess.
