import { useMemo, useRef, useState } from 'react';
import { LineChart, ScoreBars } from '../components/charts';
import { ClsBadge, ProgressBar, Segmented, WdlBar } from '../components/common';
import { CLS_META } from '../lib/clsMeta';
import { useGames } from '../lib/hooks';
import { computeInsights, scoreOf, type Outcome, type WDL } from '../lib/insights';
import { isAbort, reviewGame } from '../lib/review';
import { go, reviewPath, settings, useSettings } from '../lib/store';
import type { Cls, Color, GameMeta, Phase } from '../lib/types';

type Period = '30' | '90' | '365' | 'all';
type TimeClass = 'all' | 'rapid' | 'blitz' | 'bullet' | 'daily';

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYPARTS: [string, number, number][] = [
  ['Night', 0, 6],
  ['Morning', 6, 12],
  ['Afternoon', 12, 18],
  ['Evening', 18, 24],
];

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tile">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
      {sub && <span className="muted">{sub}</span>}
    </div>
  );
}

function WdlRow({ label, wdl }: { label: string; wdl: WDL }) {
  return (
    <div className="wdl-row">
      <span className="wdl-label">{label}</span>
      <WdlBar wdl={wdl} />
      <span className="wdl-score">{wdl.n ? pct(scoreOf(wdl)) : '–'}</span>
      <span className="muted wdl-n">{wdl.n}</span>
    </div>
  );
}

function CountList({ title, counts }: { title: string; counts: Record<string, number> }) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((a, [, v]) => a + v, 0);
  return (
    <div>
      <h4>{title}</h4>
      {rows.length ? (
        rows.map(([k, v]) => (
          <div className="count-row" key={k}>
            <span>{k}</span>
            <span className="muted">
              {v} · {pct(v / total)}
            </span>
          </div>
        ))
      ) : (
        <p className="muted">None yet.</p>
      )}
    </div>
  );
}

export function InsightsView() {
  const s = useSettings();
  const { games, loaded } = useGames();
  const [period, setPeriod] = useState<Period>('90');
  const [tc, setTc] = useState<TimeClass>('all');
  const [batch, setBatch] = useState<{ done: number; total: number; current: string } | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const user = s.username.trim().toLowerCase();

  const pool = useMemo(() => {
    const since = period === 'all' ? 0 : Date.now() - Number(period) * 86_400_000;
    return games.filter(
      (g) =>
        g.me &&
        g.endTime >= since &&
        (g.source !== 'chesscom' || g.owner === user) &&
        (tc === 'all' || g.timeClass === tc) &&
        // Bot and imported games only count toward the "all" view.
        (tc === 'all' || g.source === 'chesscom'),
    );
  }, [games, period, tc, user]);

  const ins = useMemo(() => computeInsights(pool), [pool]);
  const unreviewed = useMemo(() => pool.filter((g) => !g.summary && g.plies >= 10), [pool]);

  const runBatch = async (count: number) => {
    const list = unreviewed.slice(0, count);
    if (!list.length) return;
    const ac = new AbortController();
    abort.current = ac;
    setBatchError(null);
    try {
      for (let i = 0; i < list.length; i++) {
        const g: GameMeta = list[i];
        setBatch({ done: i, total: list.length, current: `${g.white} vs ${g.black}` });
        const cfg = settings.get();
        try {
          await reviewGame(g, { nodes: cfg.reviewNodes, workers: cfg.workers, signal: ac.signal });
        } catch (e) {
          if (isAbort(e)) throw e;
          console.warn('Skipped a game that could not be reviewed:', g.id, e);
        }
      }
    } catch (e) {
      if (!isAbort(e)) setBatchError(e instanceof Error ? e.message : 'The batch review failed.');
    } finally {
      setBatch(null);
      abort.current = null;
    }
  };

  if (loaded && !games.some((g) => g.me)) {
    return (
      <div className="page center-note">
        <h2>Insights need some games</h2>
        <p>Load your chess.com games first, then come back for statistics on your play.</p>
        <button className="btn primary" onClick={() => go('games')}>
          Go to your games
        </button>
      </div>
    );
  }

  const ratingKey = tc !== 'all' ? tc : (Object.entries(ins.ratings).sort((a, b) => b[1].length - a[1].length)[0]?.[0] ?? '');
  const ratingSeries = ins.ratings[ratingKey] ?? [];
  const acc = ins.accuracy;
  const dayparts = DAYPARTS.map(([label, from, to]) => {
    const w: WDL = { n: 0, w: 0, d: 0, l: 0 };
    for (let h = from; h < to; h++) {
      w.n += ins.byHour[h].n;
      w.w += ins.byHour[h].w;
      w.d += ins.byHour[h].d;
      w.l += ins.byHour[h].l;
    }
    return { label, wdl: w };
  });
  const bestOpp = ins.bestWin ? (ins.bestWin.me === 'w' ? ins.bestWin.blackElo : ins.bestWin.whiteElo) : undefined;
  const outcomeNames: Record<Outcome, string> = { w: 'wins', d: 'draws', l: 'losses' };

  return (
    <div className="page insights-page">
      <header className="page-head">
        <div>
          <h1>Insights</h1>
          <p className="lede">Patterns in your own games: results, openings, when you play best, and how accurately you play.</p>
        </div>
        <div className="row gap wrap">
          <Segmented<TimeClass>
            small
            value={tc}
            onChange={setTc}
            options={[
              { value: 'all', label: 'All' },
              { value: 'rapid', label: 'Rapid' },
              { value: 'blitz', label: 'Blitz' },
              { value: 'bullet', label: 'Bullet' },
              { value: 'daily', label: 'Daily' },
            ]}
          />
          <Segmented<Period>
            small
            value={period}
            onChange={setPeriod}
            options={[
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' },
              { value: '365', label: '1 year' },
              { value: 'all', label: 'All time' },
            ]}
          />
        </div>
      </header>

      {!ins.total.n ? (
        <div className="empty">
          <h3>No games in this range</h3>
          <p>Pick a longer period, or load older months from the Games screen.</p>
        </div>
      ) : (
        <>
          <div className="tiles">
            <Tile label="Games" value={String(ins.total.n)} sub={`${ins.total.w} W · ${ins.total.d} D · ${ins.total.l} L`} />
            <Tile label="Score" value={pct(scoreOf(ins.total))} sub="wins + half of draws" />
            <Tile
              label="Accuracy"
              value={acc.n ? acc.avg.toFixed(1) : '–'}
              sub={acc.n ? `over ${acc.n} reviewed game${acc.n === 1 ? '' : 's'}` : 'review games to see this'}
            />
            <Tile label="Longest win streak" value={String(ins.longestWinStreak)} sub={`avg game ${Math.round(ins.avgPlies / 2)} moves`} />
            {ins.bestWin && bestOpp ? (
              <button className="tile link-tile" onClick={() => go(reviewPath(ins.bestWin!.id))}>
                <span className="muted">Best win</span>
                <strong>{bestOpp}</strong>
                <span className="muted">vs {ins.bestWin.me === 'w' ? ins.bestWin.black : ins.bestWin.white}</span>
              </button>
            ) : null}
          </div>

          <div className="grid-2">
            <section className="card">
              <h3>Rating {ratingKey ? `· ${ratingKey}` : ''}</h3>
              <LineChart points={ratingSeries.map((p) => ({ t: p.t, v: p.r }))} byIndex height={170} />
            </section>

            <section className="card">
              <h3>Results</h3>
              <WdlRow label="Overall" wdl={ins.total} />
              <WdlRow label="As White" wdl={ins.byColor.w} />
              <WdlRow label="As Black" wdl={ins.byColor.b} />
              {Object.entries(ins.byTimeClass)
                .sort((a, b) => b[1].n - a[1].n)
                .map(([k, w]) => (
                  <WdlRow key={k} label={k[0].toUpperCase() + k.slice(1)} wdl={w} />
                ))}
              <p className="fine legend">
                <span className="swatch wdl-w" /> won <span className="swatch wdl-d" /> drawn <span className="swatch wdl-l" /> lost · the percentage is your score
              </p>
            </section>
          </div>

          <section className="card">
            <div className="row between wrap gap">
              <h3>Accuracy</h3>
              {batch ? (
                <div className="batch">
                  <span className="muted">
                    Reviewing {batch.done + 1} of {batch.total}: {batch.current}
                  </span>
                  <ProgressBar value={batch.done} max={batch.total} />
                  <button className="btn small" onClick={() => abort.current?.abort()}>
                    Stop
                  </button>
                </div>
              ) : unreviewed.length ? (
                <div className="row gap">
                  <span className="muted">{unreviewed.length} games here are not reviewed yet</span>
                  <button className="btn small" onClick={() => void runBatch(10)}>
                    Review 10
                  </button>
                  {unreviewed.length > 10 && (
                    <button className="btn small" onClick={() => void runBatch(50)}>
                      Review {Math.min(50, unreviewed.length)}
                    </button>
                  )}
                </div>
              ) : null}
            </div>
            {batchError && <div className="status error">{batchError}</div>}
            {acc.n ? (
              <div className="grid-2 inner">
                <div>
                  <LineChart points={acc.series.map((p) => ({ t: p.t, v: p.acc }))} byIndex smooth={5} height={160} format={(v) => v.toFixed(0)} />
                  <p className="fine">Accuracy per reviewed game, smoothed over 5 games.</p>
                </div>
                <div className="acc-breakdown">
                  {(['w', 'b'] as Color[]).map((c) =>
                    acc.byColor[c] !== undefined ? (
                      <div className="count-row" key={c}>
                        <span>As {c === 'w' ? 'White' : 'Black'}</span>
                        <strong>{acc.byColor[c]!.toFixed(1)}</strong>
                      </div>
                    ) : null,
                  )}
                  {(['opening', 'middlegame', 'endgame'] as Phase[]).map((p) =>
                    acc.phase[p] !== undefined ? (
                      <div className="count-row" key={p}>
                        <span>In the {p}</span>
                        <strong>{acc.phase[p]!.toFixed(1)}</strong>
                      </div>
                    ) : null,
                  )}
                  {(['w', 'd', 'l'] as Outcome[]).map((o) =>
                    acc.byOutcome[o] !== undefined ? (
                      <div className="count-row" key={o}>
                        <span>In your {outcomeNames[o]}</span>
                        <strong>{acc.byOutcome[o]!.toFixed(1)}</strong>
                      </div>
                    ) : null,
                  )}
                  <div className="per-game">
                    {(['blunder', 'mistake', 'miss', 'inaccuracy', 'great', 'brilliant'] as Cls[]).map((c) => (
                      <span key={c} title={`${CLS_META[c].label} per game`}>
                        <ClsBadge cls={c} size={16} /> {(acc.perGame[c] ?? 0).toFixed(1)}
                      </span>
                    ))}
                    <span className="muted">per game</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="muted">Review some games (here, or by opening them from the Games screen) to see accuracy trends.</p>
            )}
          </section>

          <div className="grid-2">
            {(['w', 'b'] as Color[]).map((c) => (
              <section className="card" key={c}>
                <h3>Openings as {c === 'w' ? 'White' : 'Black'}</h3>
                {ins.openings[c].length ? (
                  ins.openings[c].map((o) => <WdlRow key={o.name} label={o.name} wdl={o.wdl} />)
                ) : (
                  <p className="muted">No games as {c === 'w' ? 'White' : 'Black'} in this range.</p>
                )}
              </section>
            ))}
          </div>

          <div className="grid-2">
            <section className="card">
              <h3>By opponent strength</h3>
              {ins.vsRating.map((r) => (
                <WdlRow key={r.label} label={r.label} wdl={r.wdl} />
              ))}
            </section>
            <section className="card">
              <h3>How your games end</h3>
              <div className="grid-3">
                <CountList title="Wins" counts={ins.endings.w} />
                <CountList title="Losses" counts={ins.endings.l} />
                <CountList title="Draws" counts={ins.endings.d} />
              </div>
            </section>
          </div>

          <div className="grid-2">
            <section className="card">
              <h3>Score by day of the week</h3>
              <ScoreBars data={DAYS.map((label, i) => ({ label, wdl: ins.byDay[i] }))} />
            </section>
            <section className="card">
              <h3>Score by time of day</h3>
              <ScoreBars data={dayparts} />
              <p className="fine">Bars above the line mean you score better than 50% then. Faded bars have few games.</p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
