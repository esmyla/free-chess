import type { Color } from './types';

/** A score from White's point of view. */
export interface Ev {
  cp?: number;
  mate?: number;
  over?: 'w' | 'b' | 'draw';
}

/** Centipawns from White's side, capped at ±1000. Forced mates and finished games count as ±1000. */
export function evCp(e: Ev): number {
  if (e.over) return e.over === 'w' ? 1000 : e.over === 'b' ? -1000 : 0;
  if (e.mate !== undefined) return e.mate > 0 ? 1000 : -1000;
  return Math.max(-1000, Math.min(1000, e.cp ?? 0));
}

/**
 * Winning chances in percent (0-100) for `pov`.
 * Same logistic curve Lichess publishes for its accuracy metric.
 */
export function winPct(e: Ev, pov: Color = 'w'): number {
  const w = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * evCp(e))) - 1);
  return pov === 'w' ? w : 100 - w;
}

/** Accuracy of one move from the winning chances before and after it (mover's point of view). */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100;
  const diff = winBefore - winAfter;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * diff) - 3.166924740191411 + 1;
  return Math.max(0, Math.min(100, raw));
}

/** If the score is a forced mate for `color`, the number of moves; otherwise 0. */
export function mateFor(e: Ev, color: Color): number {
  if (e.over || e.mate === undefined || e.mate === 0) return 0;
  return e.mate > 0 === (color === 'w') ? Math.abs(e.mate) : 0;
}

/** "+1.3", "-0.4", "M5", "-M2", "1-0". */
export function formatEval(e: Ev | undefined | null): string {
  if (!e) return '';
  if (e.over) return e.over === 'w' ? '1-0' : e.over === 'b' ? '0-1' : '½-½';
  if (e.mate !== undefined) return `${e.mate < 0 ? '-' : ''}M${Math.abs(e.mate)}`;
  const v = (e.cp ?? 0) / 100;
  const s = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
  return v > 0 ? `+${s}` : s === '-0.0' ? '0.0' : s;
}

/** Unsigned short form for the eval bar. */
export function formatEvalShort(e: Ev | undefined | null): string {
  if (!e) return '';
  if (e.over) return e.over === 'draw' ? '½' : e.over === 'w' ? '1-0' : '0-1';
  if (e.mate !== undefined) return `M${Math.abs(e.mate)}`;
  const v = Math.abs((e.cp ?? 0) / 100);
  return v >= 10 ? v.toFixed(0) : v.toFixed(1);
}

/** Convert an engine score (side to move's point of view) to White's point of view. */
export function toWhitePov(score: { cp?: number; mate?: number }, turn: Color): Ev {
  const sign = turn === 'w' ? 1 : -1;
  if (score.mate !== undefined) return { mate: sign * score.mate };
  return { cp: sign * (score.cp ?? 0) };
}
