// Turns raw engine verdicts for every position of a game into a review: move grades, accuracy,
// explanations. Pure logic with no browser or engine dependencies, so it can be tested in Node.
import { Chess } from 'chess.js';
import type { Cls, Color, GameAnalysis, MoveInfo, PGame, Phase, PosEval, SideStats, XMove } from './types';
import { other } from './types';
import { mateFor, moveAccuracy, winPct } from './winprob';
import { offerOf, type Offer } from './see';
import { clamp, materialBalance, pieceCount, PIECE_NAME, sanLine, SIDE_NAME, START_FEN, uciToMove } from './chessutil';
import type { Book } from './openings';

export const REVIEW_VERSION = 1;

export interface BuildOpts {
  gameId: string;
  nodes: number;
  book: Book | null;
  ratings?: { w?: number; b?: number };
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function stddev(xs: number[]): number {
  if (!xs.length) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/**
 * Whole-game accuracy per side, following the method Lichess publishes: each move's accuracy is
 * weighted by how volatile the game was around it, then averaged with the harmonic mean so that a
 * few terrible moves count for more than many fine ones.
 */
export function gameAccuracy(winsWhite: number[], colors: Color[]): SideStats<number> {
  const n = colors.length;
  const windowSize = clamp(Math.floor(n / 10), 2, 8);
  const windows: number[][] = [];
  const head = winsWhite.slice(0, windowSize);
  for (let i = 0; i < Math.min(windowSize, winsWhite.length) - 2; i++) windows.push(head);
  for (let i = 0; i + windowSize <= winsWhite.length; i++) windows.push(winsWhite.slice(i, i + windowSize));
  const weights = windows.map((w) => clamp(stddev(w), 0.5, 12));

  const per: Record<Color, { acc: number; weight: number }[]> = { w: [], b: [] };
  for (let i = 0; i < n; i++) {
    const c = colors[i];
    const before = c === 'w' ? winsWhite[i] : 100 - winsWhite[i];
    const after = c === 'w' ? winsWhite[i + 1] : 100 - winsWhite[i + 1];
    per[c].push({ acc: moveAccuracy(before, after), weight: weights[i] ?? 0.5 });
  }
  const side = (c: Color): number => {
    const xs = per[c];
    if (!xs.length) return 0;
    const wsum = xs.reduce((a, x) => a + x.weight, 0);
    const weighted = xs.reduce((a, x) => a + x.acc * x.weight, 0) / wsum;
    const harmonic = xs.length / xs.reduce((a, x) => a + 1 / Math.max(1, x.acc), 0);
    return (weighted + harmonic) / 2;
  };
  return { w: side('w'), b: side('b') };
}

/** Rough playing-strength guess from accuracy, pulled halfway toward the player's real rating when known. */
export function estimateElo(acc: number, rating?: number): number {
  const pts: [number, number][] = [
    [0, 100],
    [40, 300],
    [50, 500],
    [60, 800],
    [70, 1100],
    [75, 1300],
    [80, 1550],
    [85, 1800],
    [90, 2100],
    [93, 2300],
    [96, 2600],
    [99, 3000],
    [100, 3200],
  ];
  let est = pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i++) {
    if (acc <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      est = y0 + ((acc - x0) / (x1 - x0)) * (y1 - y0);
      break;
    }
  }
  if (rating && rating > 0) est = (est + rating) / 2;
  return Math.round(est / 50) * 50;
}

function computePhases(game: PGame, bookPlies: number): Phase[] {
  const out: Phase[] = [];
  let phase: Phase = 'opening';
  for (let i = 0; i < game.moves.length; i++) {
    const pieces = pieceCount(game.fens[i]);
    if (phase === 'opening' && (i >= Math.max(bookPlies, 20) || pieces <= 10)) phase = 'middlegame';
    if (phase !== 'endgame' && pieces <= 6) phase = 'endgame';
    out.push(phase);
  }
  return out;
}

/** Material for `pov` after following a line, running on a little if the line stops mid-exchange. */
function materialAfter(fen: string, ucis: string[] | undefined, pov: Color, plies: number): number {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return 0;
  }
  const line = ucis ?? [];
  for (let i = 0; i < line.length; i++) {
    const mv = uciToMove(line[i]);
    if (i >= plies && !chess.get(mv.to as never)) break;
    try {
      chess.move(mv);
    } catch {
      break;
    }
  }
  return materialBalance(chess.fen(), pov);
}

function materialWords(d: number): string {
  if (d >= 8) return "about a queen's worth of material";
  if (d >= 5) return "about a rook's worth of material";
  if (d >= 3) return 'a piece';
  if (d >= 2) return 'material';
  return 'a pawn';
}

/** 4 winning, 3 better, 2 roughly equal, 1 worse, 0 losing. */
const band = (win: number): number => (win >= 90 ? 4 : win >= 65 ? 3 : win > 35 ? 2 : win > 10 ? 1 : 0);

interface Ctx {
  mv: XMove;
  cls: Cls;
  eb: PosEval;
  ea: PosEval;
  winBefore: number;
  winAfter: number;
  altWin?: number;
  bestSan?: string;
  replySan?: string;
  offer: Offer | null;
  isRecapture: boolean;
  /** Material the move wins compared with the last few positions; 0 when it only restores the balance. */
  netWin: number;
  openingName?: string;
}

function explain(c: Ctx): string {
  const { mv, cls, eb, ea, winBefore, winAfter, bestSan, replySan } = c;
  const side = SIDE_NAME[mv.color];
  const opp = other(mv.color);

  switch (cls) {
    case 'book':
      return c.openingName ? `Book move. ${c.openingName}.` : 'A standard opening move.';
    case 'forced':
      return 'The only legal move.';
    case 'brilliant': {
      const what = c.offer ? `the ${PIECE_NAME[c.offer.piece] ?? 'piece'}` : 'material';
      return `Brilliant. ${side} offers ${what}, and it is the strongest move on the board.`;
    }
    case 'great': {
      const b = band(winBefore);
      const a = c.altWin !== undefined ? band(c.altWin) : b;
      if (b >= 3 && a < b) return 'A great find: the only move that keeps the advantage.';
      if (b === 2 && a < b) return 'A great find: the only move that holds the balance.';
      return 'A great find: every other move is clearly worse.';
    }
    case 'best': {
      if (ea.over === mv.color) return 'Checkmate.';
      const m = mateFor(eb, mv.color);
      if (m) return `Best. It forces mate in ${m}.`;
      if (c.netWin >= 1) return `Best. It wins ${materialWords(c.netWin)}.`;
      if (c.isRecapture) return 'The best move: it takes back.';
      return 'The best move in the position.';
    }
    case 'excellent':
      return bestSan && bestSan !== mv.san
        ? `An excellent move, practically as good as ${bestSan}.`
        : 'An excellent move.';
    case 'good':
      return bestSan && bestSan !== mv.san ? `A reasonable move. ${bestSan} was a little stronger.` : 'A reasonable move.';
    default:
      break;
  }

  // Inaccuracy, mistake, miss, blunder: say what went wrong.
  let reason = '';
  const mateAgainst = mateFor(ea, opp);
  const hadMate = mateFor(eb, mv.color);
  if (mateAgainst && !mateFor(eb, opp)) {
    reason = `This allows a forced mate in ${mateAgainst}.`;
  } else if (hadMate && !mateFor(ea, mv.color) && ea.over !== mv.color) {
    reason = bestSan
      ? `${side} had a forced mate in ${hadMate}, starting with ${bestSan}.`
      : `${side} had a forced mate in ${hadMate}.`;
  } else {
    const now = materialBalance(mv.before, mv.color);
    const afterBest = materialAfter(mv.before, eb.pv, mv.color, 6);
    const afterPlayed = materialAfter(mv.after, ea.pv, mv.color, 5);
    const drop = now - afterPlayed;
    const gainBest = afterBest - now;
    if (drop >= 1 && afterBest - afterPlayed >= 1) {
      reason = replySan
        ? `After ${replySan}, ${side} loses ${materialWords(drop)}.`
        : `This loses ${materialWords(drop)}.`;
    } else if (gainBest >= 1 && afterBest - afterPlayed >= 1 && bestSan) {
      reason = `This misses the chance to win ${materialWords(gainBest)} with ${bestSan}.`;
    } else {
      const b = band(winBefore);
      const a = band(winAfter);
      if (b === 4 && a >= 3) reason = 'This lets a large part of the advantage slip.';
      else if (b === 4 && a === 2) reason = 'This throws away a winning position.';
      else if (b >= 3 && a <= 1) reason = `This turns a good position into a bad one for ${side}.`;
      else if (b === 3 && a === 2) reason = 'This gives away the advantage.';
      else if (b === 2 && a === 1) reason = `This hands ${SIDE_NAME[opp]} the better game.`;
      else if (b === 2 && a === 0) reason = `After this, ${SIDE_NAME[opp]} is winning.`;
      else if (b === 1 && a === 0) reason = 'This makes a difficult position much worse.';
      else if (b >= 3) reason = 'This gives up part of the advantage.';
      else if (b === 2) reason = `This gives ${SIDE_NAME[opp]} the easier game.`;
      else reason = 'This makes a difficult position worse.';
    }
  }
  if (bestSan && bestSan !== mv.san && !reason.includes(bestSan)) reason += ` ${bestSan} was best.`;
  return reason;
}

export function buildAnalysis(game: PGame, evals: PosEval[], opts: BuildOpts): GameAnalysis {
  const n = game.moves.length;
  const standardStart = game.startFen.split(' ')[0] === START_FEN.split(' ')[0];
  const det = opts.book && standardStart ? opts.book.detect(game.fens) : { bookPlies: 0, opening: undefined };
  const phases = computePhases(game, det.bookPlies);
  const winsWhite = evals.map((e) => winPct(e, 'w'));

  const moves: MoveInfo[] = [];
  const counts: SideStats<Partial<Record<Cls, number>>> = { w: {}, b: {} };
  const phaseAccs: SideStats<Record<Phase, number[]>> = {
    w: { opening: [], middlegame: [], endgame: [] },
    b: { opening: [], middlegame: [], endgame: [] },
  };
  let lastOpeningName: string | undefined;

  for (let i = 0; i < n; i++) {
    const mv = game.moves[i];
    const pov = mv.color;
    const eb = evals[i];
    const ea = evals[i + 1];
    const winBefore = winPct(eb, pov);
    const winAfter = winPct(ea, pov);
    const loss = Math.max(0, winBefore - winAfter);
    const acc = moveAccuracy(winBefore, winAfter);
    const altWin = eb.alt ? winPct(eb.alt, pov) : undefined;
    const isBest = eb.best === mv.uci;

    let legalCount = 2;
    try {
      legalCount = new Chess(mv.before).moves().length;
    } catch {
      /* keep default */
    }

    const named = opts.book?.lookup(mv.after);
    if (named && i < det.bookPlies) lastOpeningName = named.name;

    let cls: Cls;
    let offer: Offer | null = null;
    const prev = i > 0 ? game.moves[i - 1] : undefined;
    const isRecapture = !!(mv.captured && prev?.captured && prev.to === mv.to);
    if (legalCount === 1) {
      cls = 'forced';
    } else if (i < det.bookPlies) {
      cls = 'book';
    } else {
      offer = offerOf(mv.before, mv);
      const freeMaterial = !!(mv.captured && offer && offer.gained - offer.oppGain >= 2);

      if (isBest) cls = 'best';
      else if (loss <= 2) cls = 'excellent';
      else if (loss <= 5) cls = 'good';
      else if (loss <= 10) cls = 'inaccuracy';
      else if (loss <= 20) cls = 'mistake';
      else cls = 'blunder';

      // Brilliant: a real sacrifice that is (nearly) the best move, in a position that was not
      // already trivially won some other way.
      if ((isBest || loss <= 1.5) && offer?.sacrifice && winAfter >= 50) {
        const otherWin = isBest ? (altWin ?? 0) : winBefore;
        if (otherWin < 90) cls = 'brilliant';
      }
      // Great: the one move that works, and not an automatic recapture or a free piece.
      if (
        cls === 'best' &&
        altWin !== undefined &&
        winBefore - altWin >= 12 &&
        winAfter >= 35 &&
        !isRecapture &&
        !freeMaterial
      ) {
        cls = 'great';
      }
      // Miss: the opponent slipped and this move let them off the hook.
      if ((cls === 'mistake' || cls === 'blunder') && i > 0 && moves[i - 1].loss >= 10 && winAfter >= 40) {
        cls = 'miss';
      }
      if (
        (cls === 'mistake' || cls === 'blunder') &&
        mateFor(eb, pov) &&
        !mateFor(ea, pov) &&
        ea.over !== pov &&
        winAfter >= 50
      ) {
        cls = 'miss';
      }
      // Walking into a short forced mate is never a small slip, even from a bad position.
      const newMate = mateFor(ea, other(pov));
      if (newMate && newMate <= 5 && !mateFor(eb, other(pov))) {
        if (winBefore >= 20) cls = 'blunder';
        else if (cls === 'good' || cls === 'inaccuracy' || cls === 'excellent') cls = 'mistake';
      }
      // Delivering mate is simply the best move.
      if (ea.over === pov && cls === 'great') cls = 'best';
    }

    let netWin = 0;
    if (mv.captured && offer) {
      const settled = materialBalance(mv.after, pov) - offer.oppGain;
      let recent = -Infinity;
      for (let k = Math.max(0, i - 3); k <= i; k++) recent = Math.max(recent, materialBalance(game.fens[k], pov));
      netWin = Math.max(0, settled - recent);
    }

    const bestLine = sanLine(mv.before, eb.pv, 8);
    const replyLine = sanLine(mv.after, ea.pv, 8);
    const info: MoveInfo = {
      cls,
      loss,
      acc,
      winBefore,
      winAfter,
      phase: phases[i],
      bestSan: bestLine[0],
      bestLine,
      replyLine,
      text: '',
    };
    info.text = explain({
      mv,
      cls,
      eb,
      ea,
      winBefore,
      winAfter,
      altWin,
      bestSan: bestLine[0],
      replySan: replyLine[0],
      offer,
      isRecapture,
      netWin,
      openingName: named?.name ?? lastOpeningName,
    });
    moves.push(info);
    counts[pov][cls] = (counts[pov][cls] ?? 0) + 1;
    phaseAccs[pov][phases[i]].push(acc);
  }

  const accuracy = gameAccuracy(
    winsWhite,
    game.moves.map((m) => m.color),
  );
  const phaseAcc: SideStats<Partial<Record<Phase, number>>> = { w: {}, b: {} };
  for (const c of ['w', 'b'] as Color[]) {
    for (const p of ['opening', 'middlegame', 'endgame'] as Phase[]) {
      if (phaseAccs[c][p].length) phaseAcc[c][p] = mean(phaseAccs[c][p]);
    }
  }

  return {
    gameId: opts.gameId,
    v: REVIEW_VERSION,
    nodes: opts.nodes,
    createdAt: Date.now(),
    evals,
    moves,
    accuracy,
    counts,
    phaseAcc,
    opening: det.opening,
    bookPlies: det.bookPlies,
    est: n >= 16 ? { w: estimateElo(accuracy.w, opts.ratings?.w), b: estimateElo(accuracy.b, opts.ratings?.b) } : undefined,
  };
}

/** Engine verdict for a position that is already decided on the board, or null if play continues. */
export function terminalEval(fen: string): PosEval | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return { cp: 0, depth: 0 };
  }
  if (chess.isCheckmate()) return { over: chess.turn() === 'w' ? 'b' : 'w', depth: 0 };
  if (chess.isStalemate() || chess.isInsufficientMaterial()) return { over: 'draw', depth: 0 };
  return null;
}
