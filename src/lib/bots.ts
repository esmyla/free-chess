// Computer opponents. Strong ones use Stockfish's own strength limiter; the beginner levels,
// which sit below what that limiter supports, mix shallow searches with honest random moves.
import { Chess } from 'chess.js';
import { getPlayEngine } from './engine';

export interface Bot {
  id: string;
  name: string;
  elo: number;
  blurb: string;
}

export const BOTS: Bot[] = [
  { id: 'sprout', name: 'Sprout', elo: 400, blurb: 'Just learned how the pieces move. Leaves things hanging.' },
  { id: 'pip', name: 'Pip', elo: 700, blurb: 'Spots one-move threats, misses most tactics.' },
  { id: 'rowan', name: 'Rowan', elo: 1000, blurb: 'Plays sensible moves with the odd blunder.' },
  { id: 'marlow', name: 'Marlow', elo: 1350, blurb: 'A steady beginner club player.' },
  { id: 'tess', name: 'Tess', elo: 1600, blurb: 'Solid club player who punishes loose pieces.' },
  { id: 'ansel', name: 'Ansel', elo: 1900, blurb: 'Strong club player. Few gifts.' },
  { id: 'vesper', name: 'Vesper', elo: 2200, blurb: 'Master strength.' },
  { id: 'orrin', name: 'Orrin', elo: 2600, blurb: 'Grandmaster strength.' },
  { id: 'engine', name: 'Full engine', elo: 3200, blurb: 'Stockfish with the brakes off.' },
];

const LIMITER_MIN = 1320;
const LIMITER_MAX = 3190;

/** Pick the bot's move for a position. Returns UCI, or null when there is no legal move. */
export async function chooseBotMove(fen: string, bot: Bot): Promise<string | null> {
  const legal = new Chess(fen).moves({ verbose: true });
  if (!legal.length) return null;
  const engine = getPlayEngine();
  const fallback = () => {
    const m = legal[Math.floor(Math.random() * legal.length)];
    return m.from + m.to + (m.promotion ?? '');
  };

  if (bot.elo > LIMITER_MAX) {
    await engine.setOptions({ UCI_LimitStrength: false, 'Skill Level': 20 });
    const res = await engine.search(fen, { nodes: 900_000 });
    return res?.bestmove ?? fallback();
  }
  if (bot.elo >= LIMITER_MIN) {
    await engine.setOptions({ 'Skill Level': 20, UCI_LimitStrength: true, UCI_Elo: bot.elo });
    const res = await engine.search(fen, { movetime: 500 });
    return res?.bestmove ?? fallback();
  }

  // Beginner levels: t runs from 0 (weakest) to 1 (just under the limiter's floor).
  const t = Math.max(0, Math.min(1, (bot.elo - 400) / (LIMITER_MIN - 400)));
  const randomChance = 0.02 + 0.26 * (1 - t) ** 1.5;
  const temperature = 220 - 160 * t;
  const depth = 4 + Math.round(3 * t);
  if (Math.random() < randomChance) return fallback();

  await engine.setOptions({ UCI_LimitStrength: false, 'Skill Level': 20 });
  const res = await engine.search(fen, { depth, multipv: Math.min(legal.length, 8) });
  const lines = res?.lines ?? [];
  if (!lines.length) return res?.bestmove ?? fallback();
  const scores = lines.map((l) =>
    l.score.mate !== undefined ? (l.score.mate > 0 ? 100_000 - 1000 * l.score.mate : -100_000 - 1000 * l.score.mate) : (l.score.cp ?? 0),
  );
  const top = Math.max(...scores);
  const weights = scores.map((s) => Math.exp((s - top) / temperature));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lines.length; i++) {
    r -= weights[i];
    if (r <= 0) return lines[i].pv[0];
  }
  return lines[0].pv[0];
}
