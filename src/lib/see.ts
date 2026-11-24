import { Chess, type Move, type Square } from 'chess.js';

const VAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

/**
 * Static exchange evaluation: the material the side to move nets by starting a capture sequence on
 * `square`, with both sides always recapturing with their cheapest piece and free to stop when
 * continuing would lose material. 0 when there is nothing worth taking. Uses legal moves, so pins
 * are respected.
 */
export function see(chess: Chess, square: Square, depth = 0): number {
  if (depth > 12) return 0;
  const caps = (chess.moves({ verbose: true }) as Move[]).filter((m) => m.to === square && m.captured);
  if (!caps.length) return 0;
  caps.sort((a, b) => VAL[a.piece] - VAL[b.piece]);
  const m = caps[0];
  const gain = VAL[m.captured!] + (m.promotion ? VAL[m.promotion] - 1 : 0);
  chess.move({ from: m.from, to: m.to, promotion: m.promotion });
  const reply = see(chess, square, depth + 1);
  chess.undo();
  return Math.max(0, gain - reply);
}

export interface Offer {
  /** Material the move itself captured. */
  gained: number;
  /** Material the opponent nets by taking the piece that just moved. */
  oppGain: number;
  /** Type of the piece that moved (a promoting pawn stays 'p'). */
  piece: string;
  /** True when the move gives up a piece for less than it is worth: a real sacrifice. */
  sacrifice: boolean;
}

/** What a move puts on offer on its destination square. */
export function offerOf(before: string, mv: { from: string; to: string; promotion?: string }): Offer | null {
  let chess: Chess;
  let m: Move;
  try {
    chess = new Chess(before);
    m = chess.move(mv);
  } catch {
    return null;
  }
  const gained = m.captured ? VAL[m.captured] : 0;
  if (chess.isGameOver()) return { gained, oppGain: 0, piece: m.piece, sacrifice: false };
  const oppGain = see(chess, m.to as Square);
  const sacrifice = m.piece !== 'p' && m.piece !== 'k' && oppGain >= 2 && VAL[m.piece] - gained >= 2;
  return { gained, oppGain, piece: m.piece, sacrifice };
}
