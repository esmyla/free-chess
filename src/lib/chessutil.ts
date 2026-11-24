import { Chess, type Move } from 'chess.js';
import type { Color, XMove } from './types';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const PIECE_NAME: Record<string, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};
export const SIDE_NAME: Record<Color, string> = { w: 'White', b: 'Black' };

export function uciToMove(uci: string): { from: string; to: string; promotion?: string } {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined };
}

export function toXMove(m: Move, clk?: number): XMove {
  return {
    san: m.san,
    uci: m.from + m.to + (m.promotion ?? ''),
    from: m.from,
    to: m.to,
    promotion: m.promotion,
    color: m.color,
    piece: m.piece,
    captured: m.captured,
    before: m.before,
    after: m.after,
    clk,
  };
}

export function safeChess(fen?: string): Chess | null {
  try {
    return fen ? new Chess(fen) : new Chess();
  } catch {
    return null;
  }
}

/** Make one move from a position. Returns null when the move is illegal. */
export function tryMove(fen: string, mv: { from: string; to: string; promotion?: string } | string): XMove | null {
  const chess = safeChess(fen);
  if (!chess) return null;
  try {
    return toXMove(chess.move(mv));
  } catch {
    return null;
  }
}

/** Play a UCI line from a position; stops quietly at the first illegal move. */
export function buildLine(fen: string, ucis: string[] | undefined, max = 99): XMove[] {
  const out: XMove[] = [];
  const chess = safeChess(fen);
  if (!chess || !ucis) return out;
  for (const u of ucis.slice(0, max)) {
    try {
      out.push(toXMove(chess.move(uciToMove(u))));
    } catch {
      break;
    }
  }
  return out;
}

export const sanLine = (fen: string, ucis: string[] | undefined, max = 99): string[] =>
  buildLine(fen, ucis, max).map((m) => m.san);

/** Adds move numbers to a SAN line that starts from `fen`: "12. Nf3 Nc6 13. Bb5" or "12... Nc6 13. Bb5". */
export function numberLine(fen: string, sans: string[]): string {
  const parts = fen.split(' ');
  let turn = parts[1] === 'b' ? 'b' : 'w';
  let num = Number(parts[5]) || 1;
  const out: string[] = [];
  sans.forEach((san, i) => {
    if (turn === 'w') out.push(`${num}. ${san}`);
    else {
      out.push(i === 0 ? `${num}... ${san}` : san);
      num++;
    }
    turn = turn === 'w' ? 'b' : 'w';
  });
  return out.join(' ');
}

/** Move number label for the move at index `ply` (0-based) of a game that starts from `startFen`. */
export function moveLabel(startFen: string, ply: number, san: string): string {
  const parts = startFen.split(' ');
  const startBlack = parts[1] === 'b';
  const startNum = Number(parts[5]) || 1;
  const abs = ply + (startBlack ? 1 : 0);
  const num = startNum + Math.floor(abs / 2);
  return abs % 2 === 0 ? `${num}. ${san}` : `${num}... ${san}`;
}

/** Material balance in pawns for `pov`, read straight off the FEN. */
export function materialBalance(fen: string, pov: Color): number {
  let w = 0;
  let b = 0;
  for (const ch of fen.split(' ')[0]) {
    const lower = ch.toLowerCase();
    const v = PIECE_VALUE[lower];
    if (v === undefined) continue;
    if (ch === lower) b += v;
    else w += v;
  }
  return pov === 'w' ? w - b : b - w;
}

/** Number of knights, bishops, rooks and queens left on the board. */
export function pieceCount(fen: string): number {
  let n = 0;
  for (const ch of fen.split(' ')[0]) if ('nbrqNBRQ'.includes(ch)) n++;
  return n;
}

const START_COUNTS: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };

/** Pieces each side has lost, for the strips beside the player names. */
export function capturedPieces(fen: string): { w: string[]; b: string[]; diff: number } {
  const have: Record<Color, Record<string, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  };
  for (const ch of fen.split(' ')[0]) {
    const lower = ch.toLowerCase();
    if (!(lower in START_COUNTS)) continue;
    have[ch === lower ? 'b' : 'w'][lower]++;
  }
  const lost = (c: Color) => {
    const out: string[] = [];
    for (const p of ['q', 'r', 'b', 'n', 'p']) {
      for (let i = have[c][p]; i < START_COUNTS[p]; i++) out.push(p);
    }
    return out;
  };
  return { w: lost('w'), b: lost('b'), diff: materialBalance(fen, 'w') };
}

export interface Outcome {
  over: boolean;
  winner?: Color;
  reason?: 'checkmate' | 'stalemate' | 'repetition' | 'insufficient' | 'fifty';
}

export function outcomeOf(chess: Chess): Outcome {
  if (chess.isCheckmate()) return { over: true, winner: chess.turn() === 'w' ? 'b' : 'w', reason: 'checkmate' };
  if (chess.isStalemate()) return { over: true, reason: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { over: true, reason: 'insufficient' };
  if (chess.isThreefoldRepetition()) return { over: true, reason: 'repetition' };
  if (chess.isDrawByFiftyMoves()) return { over: true, reason: 'fifty' };
  return { over: false };
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function formatClock(sec: number | undefined): string {
  if (sec === undefined || !Number.isFinite(sec)) return '';
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  const ss = s < 20 && !h ? r.toFixed(1).padStart(4, '0') : String(Math.floor(r)).padStart(2, '0');
  return `${h ? `${h}:` : ''}${mm}:${ss}`;
}
