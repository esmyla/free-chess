// Statistics over the user's own games.
import { openingFamily } from './openings';
import type { Cls, Color, GameMeta, Phase } from './types';

export interface WDL {
  n: number;
  w: number;
  d: number;
  l: number;
}

export const emptyWdl = (): WDL => ({ n: 0, w: 0, d: 0, l: 0 });

/** Score as a fraction: wins plus half the draws. */
export const scoreOf = (x: WDL): number => (x.n ? (x.w + x.d / 2) / x.n : 0);

export type Outcome = 'w' | 'd' | 'l';

/** Result from the user's side, or null when the game has no result or no known side. */
export function outcomeFor(g: GameMeta): Outcome | null {
  if (!g.me || g.result === '*') return null;
  if (g.result === '1/2-1/2') return 'd';
  return (g.result === '1-0') === (g.me === 'w') ? 'w' : 'l';
}

function add(x: WDL, o: Outcome): void {
  x.n++;
  x[o]++;
}

export interface OpeningRow {
  name: string;
  wdl: WDL;
}

export interface Insights {
  total: WDL;
  byColor: Record<Color, WDL>;
  byTimeClass: Record<string, WDL>;
  /** The user's rating after each rated game, oldest first, per time class. */
  ratings: Record<string, { t: number; r: number }[]>;
  endings: Record<Outcome, Record<string, number>>;
  openings: Record<Color, OpeningRow[]>;
  byHour: WDL[];
  byDay: WDL[];
  vsRating: { label: string; wdl: WDL }[];
  avgPlies: number;
  bestWin?: GameMeta;
  longestWinStreak: number;
  accuracy: {
    n: number;
    avg: number;
    byColor: Partial<Record<Color, number>>;
    byOutcome: Partial<Record<Outcome, number>>;
    phase: Partial<Record<Phase, number>>;
    /** Accuracy per reviewed game, oldest first. */
    series: { t: number; acc: number }[];
    /** Average count per game of each kind of error. */
    perGame: Partial<Record<Cls, number>>;
  };
}

const ENDING_LABEL: Record<string, string> = {
  checkmated: 'Checkmate',
  resigned: 'Resignation',
  timeout: 'Time ran out',
  abandoned: 'Abandoned',
  agreed: 'Draw agreed',
  repetition: 'Repetition',
  stalemate: 'Stalemate',
  insufficient: 'Insufficient material',
  '50move': '50-move rule',
  timevsinsufficient: 'Timeout vs insufficient material',
};

export const endingLabel = (code: string | undefined): string => (code ? (ENDING_LABEL[code] ?? code) : 'Other');

const RATING_BUCKETS: [string, number, number][] = [
  ['Much lower (100+ below)', -Infinity, -100],
  ['Lower (25 to 100 below)', -100, -25],
  ['Similar (within 25)', -25, 25],
  ['Higher (25 to 100 above)', 25, 100],
  ['Much higher (100+ above)', 100, Infinity],
];

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function computeInsights(all: GameMeta[]): Insights {
  const games = all.filter((g) => outcomeFor(g) !== null).sort((a, b) => a.endTime - b.endTime);
  const ins: Insights = {
    total: emptyWdl(),
    byColor: { w: emptyWdl(), b: emptyWdl() },
    byTimeClass: {},
    ratings: {},
    endings: { w: {}, d: {}, l: {} },
    openings: { w: [], b: [] },
    byHour: Array.from({ length: 24 }, emptyWdl),
    byDay: Array.from({ length: 7 }, emptyWdl),
    vsRating: RATING_BUCKETS.map(([label]) => ({ label, wdl: emptyWdl() })),
    avgPlies: avg(games.map((g) => g.plies)),
    longestWinStreak: 0,
    accuracy: { n: 0, avg: 0, byColor: {}, byOutcome: {}, phase: {}, series: [], perGame: {} },
  };
  const openings: Record<Color, Map<string, WDL>> = { w: new Map(), b: new Map() };
  const accs: number[] = [];
  const accByColor: Record<Color, number[]> = { w: [], b: [] };
  const accByOutcome: Record<Outcome, number[]> = { w: [], d: [], l: [] };
  const phaseAcc: Record<Phase, number[]> = { opening: [], middlegame: [], endgame: [] };
  const errorTotals: Partial<Record<Cls, number>> = {};
  let streak = 0;

  for (const g of games) {
    const o = outcomeFor(g)!;
    const me = g.me!;
    add(ins.total, o);
    add(ins.byColor[me], o);
    const tc = g.source === 'bot' ? 'vs computer' : (g.timeClass ?? 'other');
    add((ins.byTimeClass[tc] ??= emptyWdl()), o);
    const end = endingLabel(g.termination);
    ins.endings[o][end] = (ins.endings[o][end] ?? 0) + 1;

    const myElo = me === 'w' ? g.whiteElo : g.blackElo;
    const oppElo = me === 'w' ? g.blackElo : g.whiteElo;
    if (myElo && g.rated !== false && g.source === 'chesscom') (ins.ratings[tc] ??= []).push({ t: g.endTime, r: myElo });
    if (myElo && oppElo) {
      const diff = oppElo - myElo;
      const idx = RATING_BUCKETS.findIndex(([, lo, hi]) => diff >= lo && diff < hi);
      if (idx >= 0) add(ins.vsRating[idx].wdl, o);
      if (o === 'w' && (!ins.bestWin || oppElo > ((ins.bestWin.me === 'w' ? ins.bestWin.blackElo : ins.bestWin.whiteElo) ?? 0))) {
        ins.bestWin = g;
      }
    }

    if (g.opening) {
      const fam = openingFamily(g.opening);
      let row = openings[me].get(fam);
      if (!row) openings[me].set(fam, (row = emptyWdl()));
      add(row, o);
    }

    const d = new Date(g.endTime);
    add(ins.byHour[d.getHours()], o);
    add(ins.byDay[d.getDay()], o);

    streak = o === 'w' ? streak + 1 : 0;
    ins.longestWinStreak = Math.max(ins.longestWinStreak, streak);

    if (g.summary) {
      const a = g.summary.acc[me];
      accs.push(a);
      accByColor[me].push(a);
      accByOutcome[o].push(a);
      ins.accuracy.series.push({ t: g.endTime, acc: a });
      for (const p of ['opening', 'middlegame', 'endgame'] as Phase[]) {
        const v = g.summary.phaseAcc[me][p];
        if (v !== undefined) phaseAcc[p].push(v);
      }
      for (const c of ['inaccuracy', 'mistake', 'miss', 'blunder', 'brilliant', 'great'] as Cls[]) {
        errorTotals[c] = (errorTotals[c] ?? 0) + (g.summary.counts[me][c] ?? 0);
      }
    }
  }

  for (const c of ['w', 'b'] as Color[]) {
    ins.openings[c] = [...openings[c].entries()]
      .map(([name, wdl]) => ({ name, wdl }))
      .sort((a, b) => b.wdl.n - a.wdl.n)
      .slice(0, 12);
  }
  const acc = ins.accuracy;
  acc.n = accs.length;
  acc.avg = avg(accs);
  for (const c of ['w', 'b'] as Color[]) if (accByColor[c].length) acc.byColor[c] = avg(accByColor[c]);
  for (const o of ['w', 'd', 'l'] as Outcome[]) if (accByOutcome[o].length) acc.byOutcome[o] = avg(accByOutcome[o]);
  for (const p of ['opening', 'middlegame', 'endgame'] as Phase[]) if (phaseAcc[p].length) acc.phase[p] = avg(phaseAcc[p]);
  if (accs.length) for (const [c, total] of Object.entries(errorTotals)) acc.perGame[c as Cls] = (total ?? 0) / accs.length;
  return ins;
}
