// Runs a full-game review in the browser: farms positions out to the engine pool, then grades.
import { getPool, type Engine, type SearchResult } from './engine';
import { buildAnalysis, REVIEW_VERSION, terminalEval } from './reviewCore';
import { toWhitePov } from './winprob';
import { parsePgn } from './pgn';
import { getAnalysis, putAnalysis } from './db';
import { loadBook } from './openings';
import type { Color, GameAnalysis, GameMeta, PGame, PosEval, ReviewSummary } from './types';

export interface ReviewProgress {
  done: number;
  total: number;
  /** Verdicts so far, indexed by position; holes are still being analysed. */
  evals: (PosEval | undefined)[];
}

export interface ReviewOptions {
  nodes: number;
  workers: number;
  signal?: AbortSignal;
  onProgress?: (p: ReviewProgress) => void;
}

const abortError = () => new DOMException('Review cancelled', 'AbortError');
export const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

function toPosEval(fen: string, res: SearchResult | null): PosEval {
  const turn = fen.split(' ')[1] as Color;
  const l1 = res?.lines.find((l) => l.multipv === 1) ?? res?.lines[0];
  if (!l1) return { cp: 0, depth: 0 };
  const e: PosEval = { ...toWhitePov(l1.score, turn), depth: l1.depth, best: l1.pv[0], pv: l1.pv.slice(0, 12) };
  const l2 = res?.lines.find((l) => l.multipv === 2);
  if (l2 && l2.pv[0] !== l1.pv[0]) e.alt = { ...toWhitePov(l2.score, turn), move: l2.pv[0] };
  return e;
}

// Reviews share one engine pool, so they run one at a time.
let chain: Promise<unknown> = Promise.resolve();

/** Evaluate every position of a game. Resolves to one verdict per position. */
export function analyzePositions(fens: string[], opts: ReviewOptions): Promise<PosEval[]> {
  const run = async (): Promise<PosEval[]> => {
    const { signal } = opts;
    if (signal?.aborted) throw abortError();
    const evals: (PosEval | undefined)[] = new Array(fens.length);
    const todo: number[] = [];
    fens.forEach((fen, i) => {
      // Only the last position can be decided on the board.
      const t = i === fens.length - 1 ? terminalEval(fen) : null;
      if (t) evals[i] = t;
      else todo.push(i);
    });
    const total = fens.length;
    let done = total - todo.length;
    opts.onProgress?.({ done, total, evals });
    if (!todo.length) return evals as PosEval[];

    const engines = await getPool(opts.workers);
    if (signal?.aborted) throw abortError();
    const stopAll = () => engines.forEach((e) => e.stop());
    signal?.addEventListener('abort', stopAll);

    // Each worker takes a contiguous stretch of the game and walks it backwards, so what the
    // engine learned about later positions (kept in its hash table) informs the earlier ones.
    const k = Math.min(engines.length, todo.length);
    const size = Math.ceil(todo.length / k);
    const work = async (engine: Engine, idxs: number[]) => {
      await engine.newGame();
      for (const i of idxs) {
        if (signal?.aborted) throw abortError();
        const res = await engine.search(fens[i], { nodes: opts.nodes, multipv: 2 });
        if (signal?.aborted) throw abortError();
        evals[i] = toPosEval(fens[i], res);
        done++;
        opts.onProgress?.({ done, total, evals });
      }
    };
    try {
      await Promise.all(
        Array.from({ length: k }, (_, w) => work(engines[w], todo.slice(w * size, (w + 1) * size).reverse())),
      );
    } finally {
      signal?.removeEventListener('abort', stopAll);
    }
    return evals as PosEval[];
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

export function summaryOf(a: GameAnalysis): ReviewSummary {
  return { acc: a.accuracy, counts: a.counts, phaseAcc: a.phaseAcc, est: a.est };
}

/** A stored review is reusable when it was made by this version of the grader at the same or greater effort. */
export async function loadReview(gameId: string, minNodes = 0): Promise<GameAnalysis | null> {
  const a = await getAnalysis(gameId);
  if (!a || a.v !== REVIEW_VERSION || a.nodes < minNodes) return null;
  return a;
}

/** Review a stored game from scratch and save the result. */
export async function reviewGame(
  meta: GameMeta,
  opts: ReviewOptions,
  parsed?: PGame,
): Promise<{ game: PGame; analysis: GameAnalysis }> {
  const game = parsed ?? parsePgn(meta.pgn);
  const book = await loadBook();
  const evals = await analyzePositions(game.fens, opts);
  const analysis = buildAnalysis(game, evals, {
    gameId: meta.id,
    nodes: opts.nodes,
    book,
    ratings: { w: meta.whiteElo, b: meta.blackElo },
  });
  await putAnalysis(analysis, summaryOf(analysis));
  return { game, analysis };
}
