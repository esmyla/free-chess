// Puzzle pack loading, selection and the player's local puzzle rating.
import { clamp } from './chessutil';
import { loadJson, saveJson } from './store';

export interface Puzzle {
  id: string;
  /** Position before the opponent's lead-in move. */
  fen: string;
  /** UCI moves: the opponent's lead-in first, then the solver's moves and the replies, alternating. */
  moves: string[];
  rating: number;
  themes: string[];
}

type Raw = [string, string, string, number, string];

interface PuzzleIndex {
  total: number;
  bands: Record<string, number>;
}

let indexP: Promise<PuzzleIndex | null> | null = null;
const bandCache = new Map<number, Promise<Puzzle[]>>();
const base = () => `${import.meta.env.BASE_URL}puzzles/`;

export function loadIndex(): Promise<PuzzleIndex | null> {
  if (!indexP) {
    indexP = fetch(`${base()}index.json`)
      .then((r) => (r.ok ? (r.json() as Promise<PuzzleIndex>) : null))
      .catch(() => null);
  }
  return indexP;
}

function loadBand(band: number): Promise<Puzzle[]> {
  let p = bandCache.get(band);
  if (!p) {
    p = fetch(`${base()}b${band}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Raw[]>) : []))
      .then((rows) => rows.map(([id, fen, moves, rating, themes]) => ({ id, fen, moves: moves.split(' '), rating, themes: themes.split(' ') })))
      .catch(() => []);
    bandCache.set(band, p);
  }
  return p;
}

/** A random unseen puzzle near `target`, widening the search until something fits. Null when none are left. */
export async function pickPuzzle(
  target: number,
  opts: { theme?: string; seen?: Set<string>; spread?: number } = {},
): Promise<Puzzle | null> {
  const idx = await loadIndex();
  if (!idx) return null;
  const bands = Object.keys(idx.bands).map(Number).sort((a, b) => a - b);
  if (!bands.length) return null;
  const lo = bands[0];
  const hi = bands[bands.length - 1];
  const bandOf = (r: number) => clamp(Math.floor(r / 100) * 100, lo, hi);
  const t = clamp(target, lo, hi + 99);
  const spreads = [opts.spread ?? 80, 160, 320, 700, 4000].filter((s, i, a) => a.indexOf(s) === i).sort((a, b) => a - b);
  for (const spread of spreads) {
    const from = bandOf(t - spread);
    const to = bandOf(t + spread);
    const lists = await Promise.all(bands.filter((b) => b >= from && b <= to).map(loadBand));
    const cands = lists
      .flat()
      .filter(
        (p) =>
          Math.abs(p.rating - t) <= spread &&
          (!opts.theme || p.themes.includes(opts.theme)) &&
          !(opts.seen && opts.seen.has(p.id)),
      );
    if (cands.length) return cands[Math.floor(Math.random() * cands.length)];
  }
  return null;
}

export const THEMES: [string, string][] = [
  ['mateIn1', 'Mate in 1'],
  ['mateIn2', 'Mate in 2'],
  ['mateIn3', 'Mate in 3'],
  ['fork', 'Fork'],
  ['pin', 'Pin'],
  ['skewer', 'Skewer'],
  ['discoveredAttack', 'Discovered attack'],
  ['doubleCheck', 'Double check'],
  ['sacrifice', 'Sacrifice'],
  ['deflection', 'Deflection'],
  ['attraction', 'Attraction'],
  ['capturingDefender', 'Remove the defender'],
  ['hangingPiece', 'Hanging piece'],
  ['trappedPiece', 'Trapped piece'],
  ['backRankMate', 'Back-rank mate'],
  ['smotheredMate', 'Smothered mate'],
  ['intermezzo', 'Zwischenzug'],
  ['quietMove', 'Quiet move'],
  ['defensiveMove', 'Defensive move'],
  ['xRayAttack', 'X-ray'],
  ['clearance', 'Clearance'],
  ['interference', 'Interference'],
  ['zugzwang', 'Zugzwang'],
  ['promotion', 'Promotion'],
  ['advancedPawn', 'Advanced pawn'],
  ['exposedKing', 'Exposed king'],
  ['kingsideAttack', 'Kingside attack'],
  ['queensideAttack', 'Queenside attack'],
  ['opening', 'Opening'],
  ['middlegame', 'Middlegame'],
  ['endgame', 'Endgame'],
  ['pawnEndgame', 'Pawn endgame'],
  ['rookEndgame', 'Rook endgame'],
  ['queenEndgame', 'Queen endgame'],
  ['knightEndgame', 'Knight endgame'],
  ['bishopEndgame', 'Bishop endgame'],
];

const THEME_LABEL = new Map(THEMES);
const HIDDEN_THEMES = new Set(['short', 'long', 'veryLong', 'oneMove', 'master', 'masterVsMaster', 'superGM', 'mate']);

/** Readable labels for the themes worth showing on a solved puzzle. */
export function themeLabels(themes: string[]): string[] {
  return themes
    .filter((t) => !HIDDEN_THEMES.has(t))
    .map((t) => THEME_LABEL.get(t) ?? t.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()));
}

// ---- Progress ---------------------------------------------------------------------------------

export interface PuzzleProgress {
  rating: number;
  played: number;
  solved: number;
  failed: number;
  streak: number;
  bestStreak: number;
  /** Rating after each rated puzzle, most recent last. */
  history: number[];
  seen: string[];
  /** Best sprint score per mode. */
  sprintBest: Record<string, number>;
}

const KEY = 'freechess.puzzles.v1';
const fresh: PuzzleProgress = {
  rating: 1200,
  played: 0,
  solved: 0,
  failed: 0,
  streak: 0,
  bestStreak: 0,
  history: [],
  seen: [],
  sprintBest: {},
};

export const loadProgress = (): PuzzleProgress => loadJson(KEY, fresh);
export const saveProgress = (p: PuzzleProgress): void => saveJson(KEY, p);

export function markSeen(p: PuzzleProgress, id: string): PuzzleProgress {
  if (p.seen.includes(id)) return p;
  return { ...p, seen: [...p.seen, id].slice(-6000) };
}

/** Elo update after a rated puzzle. Early puzzles move the rating faster so it settles quickly. */
export function applyResult(p: PuzzleProgress, puzzle: Puzzle, solved: boolean): { next: PuzzleProgress; delta: number } {
  const k = Math.max(16, 44 - p.played * 2);
  const expected = 1 / (1 + 10 ** ((puzzle.rating - p.rating) / 400));
  const delta = Math.round(k * ((solved ? 1 : 0) - expected));
  const rating = Math.max(100, p.rating + delta);
  const streak = solved ? p.streak + 1 : 0;
  const next: PuzzleProgress = {
    ...markSeen(p, puzzle.id),
    rating,
    played: p.played + 1,
    solved: p.solved + (solved ? 1 : 0),
    failed: p.failed + (solved ? 0 : 1),
    streak,
    bestStreak: Math.max(p.bestStreak, streak),
    history: [...p.history, rating].slice(-300),
  };
  return { next, delta: rating - p.rating };
}
