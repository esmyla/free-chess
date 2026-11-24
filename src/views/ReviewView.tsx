import { useEffect, useMemo, useRef, useState } from 'react';
import { Board, type Shape } from '../components/Board';
import { EngineLines } from '../components/EngineLines';
import { EvalGraph } from '../components/EvalGraph';
import { MoveList } from '../components/MoveList';
import { arrowShape, badgeShape, ClsBadge, EvalBar, Icon, PlayerBar, ProgressBar, Segmented } from '../components/common';
import { buildLine, clamp, moveLabel, numberLine, tryMove, uciToMove } from '../lib/chessutil';
import { CLS_META, CLS_ORDER, KEY_CLS, RETRY_CLS } from '../lib/clsMeta';
import { getGame } from '../lib/db';
import { getLiveEngine } from '../lib/engine';
import { useKeys, useLiveEval } from '../lib/hooks';
import { parsePgn } from '../lib/pgn';
import { isAbort, loadReview, reviewGame, type ReviewProgress } from '../lib/review';
import { terminalEval } from '../lib/reviewCore';
import { playMove, playRight, playWrong } from '../lib/sound';
import { go, REVIEW_PROFILES, settings, useSettings } from '../lib/store';
import type { Cls, Color, GameAnalysis, GameMeta, PGame, Phase, XMove } from '../lib/types';
import { formatEval, toWhitePov, winPct, type Ev } from '../lib/winprob';

interface Explore {
  /** Game position (number of moves played) the side line starts from. */
  base: number;
  line: XMove[];
  /** How many moves of the side line are on the board. */
  idx: number;
}

interface Retry {
  /** Indexes of the moves to redo. */
  queue: number[];
  pos: number;
  status: 'ask' | 'checking' | 'right' | 'wrong' | 'shown';
  tried?: XMove;
  verdict?: string;
  hint: number;
}

const QUIET_BEST = new Set<Cls>(['book', 'forced', 'best', 'great', 'brilliant']);
const PHASES: [Phase, string][] = [
  ['opening', 'Opening'],
  ['middlegame', 'Middlegame'],
  ['endgame', 'Endgame'],
];

function resultText(meta: GameMeta): string {
  if (meta.result === '1-0') return 'White won';
  if (meta.result === '0-1') return 'Black won';
  if (meta.result === '1/2-1/2') return 'Draw';
  return 'Unfinished';
}

export function ReviewView({ id }: { id: string }) {
  const s = useSettings();
  const [meta, setMeta] = useState<GameMeta | null | undefined>(undefined);
  const [game, setGame] = useState<PGame | null>(null);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [progress, setProgress] = useState<ReviewProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ply, setPly] = useState(0);
  const [orientation, setOrientation] = useState<Color>('w');
  const [explore, setExplore] = useState<Explore | null>(null);
  const [retry, setRetry] = useState<Retry | null>(null);
  const [engineOn, setEngineOn] = useState(false);
  const [tab, setTab] = useState<'summary' | 'moves'>('summary');
  const [runKey, setRunKey] = useState(0);
  const retryToken = useRef(0);

  // Load the game.
  useEffect(() => {
    let alive = true;
    getGame(id)
      .then((m) => {
        if (!alive) return;
        if (!m) {
          setMeta(null);
          return;
        }
        try {
          setGame(parsePgn(m.pgn));
        } catch {
          setError('This game could not be read: its PGN is not a legal game.');
        }
        setOrientation(m.me === 'b' ? 'b' : 'w');
        setMeta(m);
      })
      .catch(() => alive && setMeta(null));
    return () => {
      alive = false;
    };
  }, [id]);

  // Reuse a stored review, or run one.
  useEffect(() => {
    if (!meta || !game || !game.moves.length) return;
    let alive = true;
    const ac = new AbortController();
    (async () => {
      if (runKey === 0) {
        const cached = await loadReview(meta.id);
        if (!alive) return;
        if (cached && cached.moves.length === game.moves.length) {
          setAnalysis(cached);
          return;
        }
      }
      setAnalysis(null);
      setError(null);
      setProgress({ done: 0, total: game.fens.length, evals: [] });
      try {
        const cfg = settings.get();
        const res = await reviewGame(
          meta,
          {
            nodes: cfg.reviewNodes,
            workers: cfg.workers,
            signal: ac.signal,
            onProgress: (p) => alive && setProgress({ done: p.done, total: p.total, evals: p.evals.slice() }),
          },
          game,
        );
        if (!alive) return;
        setAnalysis(res.analysis);
        setProgress(null);
      } catch (e) {
        if (!alive || isAbort(e)) return;
        console.error(e);
        setProgress(null);
        setError(e instanceof Error ? `The review failed: ${e.message}` : 'The review failed.');
      }
    })();
    return () => {
      alive = false;
      ac.abort();
    };
  }, [meta, game, runKey]);

  const n = game?.moves.length ?? 0;
  const retryIdx = retry ? retry.queue[retry.pos] : -1;

  // What the board shows.
  const view = useMemo(() => {
    if (!game) return null;
    if (retry) {
      const base = game.fens[retryIdx];
      if (retry.tried && retry.status !== 'ask') {
        return { fen: retry.tried.after, last: [retry.tried.from, retry.tried.to] as [string, string] };
      }
      const prev = retryIdx > 0 ? game.moves[retryIdx - 1] : undefined;
      return { fen: base, last: prev ? ([prev.from, prev.to] as [string, string]) : null };
    }
    if (explore) {
      const m = explore.idx > 0 ? explore.line[explore.idx - 1] : explore.base > 0 ? game.moves[explore.base - 1] : undefined;
      return {
        fen: explore.idx > 0 ? explore.line[explore.idx - 1].after : game.fens[explore.base],
        last: m ? ([m.from, m.to] as [string, string]) : null,
      };
    }
    const m = ply > 0 ? game.moves[ply - 1] : undefined;
    return { fen: game.fens[ply], last: m ? ([m.from, m.to] as [string, string]) : null };
  }, [game, ply, explore, retry, retryIdx]);

  const liveFen = view && !retry && (engineOn || explore) ? view.fen : null;
  const live = useLiveEval(liveFen, !!liveFen, s.lines);

  const info = analysis && !explore && !retry && ply > 0 ? analysis.moves[ply - 1] : null;
  const reviewEval = !explore && !retry ? (analysis?.evals[ply] ?? progress?.evals[ply]) : undefined;
  const barEv: Ev | null = retry ? null : (live?.ev ?? reviewEval ?? null);

  const shapes = useMemo<Shape[]>(() => {
    const out: Shape[] = [];
    if (!game) return out;
    if (retry && analysis) {
      const best = analysis.evals[retryIdx]?.best;
      if (retry.status === 'ask' && retry.hint === 1 && best) out.push({ orig: best.slice(0, 2) as Shape['orig'], brush: 'yellow' });
      if (best && ((retry.status === 'ask' && retry.hint >= 2) || retry.status === 'shown')) {
        out.push(arrowShape(best.slice(0, 2), best.slice(2, 4), 'green'));
      }
      if (retry.tried && retry.status === 'right') out.push(badgeShape(retry.tried.to, 'best'));
      if (retry.tried && retry.status === 'wrong') out.push(badgeShape(retry.tried.to, 'mistake'));
      return out;
    }
    if (!explore && analysis && ply > 0) {
      const mv = game.moves[ply - 1];
      const mi = analysis.moves[ply - 1];
      out.push(badgeShape(mv.to, mi.cls));
      const best = analysis.evals[ply - 1].best;
      if (best && best !== mv.uci && !QUIET_BEST.has(mi.cls)) out.push(arrowShape(best.slice(0, 2), best.slice(2, 4), 'green'));
    }
    const pv = live?.lines[0]?.pv[0];
    if (pv && (explore || engineOn)) out.push(arrowShape(pv.slice(0, 2), pv.slice(2, 4), 'blue', true));
    return out;
  }, [game, analysis, ply, explore, retry, retryIdx, live, engineOn]);

  const goto = (p: number) => {
    if (!game) return;
    const t = clamp(p, 0, n);
    if (!explore && t === ply + 1) playMove(!!game.moves[ply].captured);
    setExplore(null);
    setPly(t);
    if (t > 0) setTab('moves');
  };

  const step = (dir: 1 | -1) => {
    if (retry) return;
    if (explore) {
      const idx = explore.idx + dir;
      if (idx < 0) {
        setExplore(null);
        setPly(explore.base);
      } else if (idx <= explore.line.length) {
        if (dir === 1) playMove(!!explore.line[idx - 1].captured);
        setExplore({ ...explore, idx });
      }
      return;
    }
    goto(ply + dir);
  };

  const jumpKey = (dir: 1 | -1) => {
    if (!analysis) return;
    for (let i = ply - 1 + dir; i >= 0 && i < n; i += dir) {
      if (KEY_CLS.has(analysis.moves[i].cls)) {
        goto(i + 1);
        return;
      }
    }
  };

  // ---- Retry mistakes ----

  const retryQueue = (side: Color | null): number[] =>
    analysis && game
      ? analysis.moves.map((_, i) => i).filter((i) => RETRY_CLS.has(analysis.moves[i].cls) && (!side || game.moves[i].color === side))
      : [];

  const startRetry = (side: Color | null) => {
    const queue = retryQueue(side);
    if (!queue.length || !game) return;
    setExplore(null);
    setTab('moves');
    setOrientation(game.moves[queue[0]].color);
    setRetry({ queue, pos: 0, status: 'ask', hint: 0 });
  };

  const nextRetry = () => {
    if (!retry || !game) return;
    const pos = retry.pos + 1;
    retryToken.current++;
    if (pos >= retry.queue.length) {
      setPly(retry.queue[retry.queue.length - 1] + 1);
      setRetry(null);
      return;
    }
    setOrientation(game.moves[retry.queue[pos]].color);
    setRetry({ queue: retry.queue, pos, status: 'ask', hint: 0 });
  };

  const tryRetry = async (m: XMove) => {
    if (!retry || !analysis || !game || retry.status !== 'ask') return;
    const i = retryIdx;
    const token = ++retryToken.current;
    const best = analysis.evals[i].best;
    const bestSan = analysis.moves[i].bestSan;
    playMove(!!m.captured);
    if (m.uci === best) {
      playRight();
      setRetry({ ...retry, status: 'right', tried: m, verdict: 'That is the engine’s top move.' });
      return;
    }
    if (m.uci === game.moves[i].uci) {
      playWrong();
      setRetry({ ...retry, status: 'wrong', tried: m, verdict: 'That is the move from the game. Look for something better.' });
      return;
    }
    setRetry({ ...retry, status: 'checking', tried: m });
    let ev: Ev | null = terminalEval(m.after);
    if (!ev) {
      const res = await getLiveEngine().search(m.after, { nodes: 250_000 }, undefined, { supersede: true });
      const top = res?.lines[0];
      ev = top ? toWhitePov(top.score, m.color === 'w' ? 'b' : 'w') : null;
    }
    if (token !== retryToken.current) return;
    const mover = game.moves[i].color;
    const lost = ev ? analysis.moves[i].winBefore - winPct(ev, mover) : 100;
    if (lost <= 4) {
      playRight();
      setRetry((r) => r && { ...r, status: 'right', tried: m, verdict: bestSan ? `A good move. The engine slightly prefers ${bestSan}.` : 'A good move.' });
    } else {
      playWrong();
      setRetry((r) => r && { ...r, status: 'wrong', tried: m, verdict: `Not quite. ${m.san} still gives up too much.` });
    }
  };

  const onBoardMove = (m: XMove) => {
    if (!game) return;
    if (retry) {
      void tryRetry(m);
      return;
    }
    playMove(!!m.captured);
    if (explore) {
      setExplore({ base: explore.base, line: [...explore.line.slice(0, explore.idx), m], idx: explore.idx + 1 });
    } else if (ply < n && game.moves[ply].uci === m.uci) {
      setPly(ply + 1);
      setTab('moves');
    } else {
      setExplore({ base: ply, line: [m], idx: 1 });
      setTab('moves');
    }
  };

  const exploreLine = (base: number, ucis: string[] | undefined) => {
    if (!game || !ucis?.length) return;
    const line = buildLine(game.fens[base], ucis);
    if (line.length) setExplore({ base, line, idx: 1 });
  };

  const playEngineMove = (uci: string) => {
    if (!view) return;
    const m = tryMove(view.fen, uciToMove(uci));
    if (m) onBoardMove(m);
  };

  useKeys((e) => {
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowUp' && !retry) goto(0);
    else if (e.key === 'ArrowDown' && !retry) goto(n);
    else if (e.key === 'f') setOrientation((o) => (o === 'w' ? 'b' : 'w'));
    else if (e.key === 'Escape') {
      if (retry) {
        retryToken.current++;
        setRetry(null);
      } else if (explore) {
        setExplore(null);
      }
    } else return;
    e.preventDefault();
  });

  if (meta === undefined) return <div className="page center-note">Loading game…</div>;
  if (meta === null || !game || !view) {
    return (
      <div className="page center-note">
        <p>{error ?? 'That game is not stored in this browser any more.'}</p>
        <button className="btn" onClick={() => go('games')}>
          Back to your games
        </button>
      </div>
    );
  }

  const basePly = retry ? retryIdx : explore ? explore.base : ply;
  const clockOf = (c: Color): number | undefined => {
    for (let i = basePly - 1; i >= 0; i--) if (game.moves[i].color === c && game.moves[i].clk !== undefined) return game.moves[i].clk;
    return undefined;
  };
  const turn = view.fen.split(' ')[1] as Color;
  const bar = (c: Color) => (
    <PlayerBar
      name={c === 'w' ? meta.white : meta.black}
      rating={c === 'w' ? meta.whiteElo : meta.blackElo}
      color={c}
      fen={view.fen}
      clock={clockOf(c)}
      active={turn === c}
      extra={analysis ? <span className="acc-mini" title="Accuracy">{analysis.accuracy[c].toFixed(1)}</span> : null}
    />
  );
  const top: Color = orientation === 'w' ? 'b' : 'w';
  const mySide = meta.me ?? null;
  const myRetry = retryQueue(mySide).length;

  return (
    <div className="stage">
      <div className="board-col">
        <div className="board-fit">
          {bar(top)}
          <div className="board-row">
            <EvalBar ev={barEv} orientation={orientation} />
            <Board
              fen={view.fen}
              orientation={orientation}
              lastMove={view.last}
              interactive={retry ? (retry.status === 'ask' ? game.moves[retryIdx].color : false) : true}
              onMove={onBoardMove}
              shapes={shapes}
            />
          </div>
          {bar(orientation)}
          <div className="controls">
            <button className="icon-btn" title="Start (↑)" onClick={() => goto(0)} disabled={!!retry}>
              <Icon name="first" />
            </button>
            <button className="icon-btn" title="Back (←)" onClick={() => step(-1)} disabled={!!retry}>
              <Icon name="prev" />
            </button>
            <button className="icon-btn" title="Forward (→)" onClick={() => step(1)} disabled={!!retry}>
              <Icon name="next" />
            </button>
            <button className="icon-btn" title="End (↓)" onClick={() => goto(n)} disabled={!!retry}>
              <Icon name="last" />
            </button>
            <span className="spacer" />
            {analysis && !retry && (
              <>
                <button className="btn small" onClick={() => jumpKey(-1)} title="Previous key moment">
                  ‹ Key move
                </button>
                <button className="btn small" onClick={() => jumpKey(1)} title="Next key moment">
                  Key move ›
                </button>
              </>
            )}
            <button className={`icon-btn${engineOn ? ' on' : ''}`} title="Live engine lines" onClick={() => setEngineOn((v) => !v)} disabled={!!retry}>
              <Icon name="engine" />
            </button>
            <button className="icon-btn" title="Flip board (F)" onClick={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))}>
              <Icon name="flip" />
            </button>
          </div>
        </div>
      </div>

      <aside className="panel">
        <div className="panel-head">
          <button className="icon-btn ghost" onClick={() => go('games')} title="Back to your games">
            <Icon name="back" />
          </button>
          <div className="panel-title">
            <strong>
              {meta.white} vs {meta.black}
            </strong>
            <span className="muted">
              {resultText(meta)} · {analysis?.opening?.name ?? meta.opening ?? 'Game review'}
            </span>
          </div>
          {meta.url && (
            <a className="icon-btn ghost" href={meta.url} target="_blank" rel="noreferrer" title="Open the original game">
              <Icon name="link" size={18} />
            </a>
          )}
        </div>

        {progress && (
          <div className="card tight">
            <div className="row between">
              <span>Stockfish is reviewing the game…</span>
              <span className="muted">
                {progress.done} / {progress.total}
              </span>
            </div>
            <ProgressBar value={progress.done} max={progress.total} />
          </div>
        )}
        {error && (
          <div className="card tight error-card">
            <span>{error}</span>
            <button className="btn small" onClick={() => setRunKey((k) => k + 1)}>
              Try again
            </button>
          </div>
        )}

        {(analysis || progress) && (
          <EvalGraph
            evals={analysis?.evals ?? progress?.evals.concat(new Array(Math.max(0, n + 1 - (progress?.evals.length ?? 0)))) ?? []}
            moves={analysis?.moves}
            ply={basePly}
            onSelect={(p) => !retry && goto(p)}
          />
        )}

        {retry && analysis ? (
          <RetryCard
            retry={retry}
            game={game}
            analysis={analysis}
            onHint={() => setRetry({ ...retry, hint: Math.min(2, retry.hint + 1) })}
            onShow={() => {
              retryToken.current++;
              setRetry({ ...retry, status: 'shown', tried: undefined });
            }}
            onAgain={() => setRetry({ ...retry, status: 'ask', tried: undefined, verdict: undefined })}
            onNext={nextRetry}
            onQuit={() => {
              retryToken.current++;
              setRetry(null);
            }}
          />
        ) : (
          <>
            {analysis && (
              <Segmented
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'summary', label: 'Summary' },
                  { value: 'moves', label: 'Move by move' },
                ]}
              />
            )}

            {analysis && tab === 'summary' ? (
              <div className="panel-scroll">
                <div className="acc-tiles">
                  {(['w', 'b'] as Color[]).map((c) => (
                    <div className="acc-tile" key={c}>
                      <span className="acc-name">
                        <span className={`side-dot ${c === 'w' ? 'white' : 'black'}`} />
                        {c === 'w' ? meta.white : meta.black}
                      </span>
                      <span className="acc-value">{analysis.accuracy[c].toFixed(1)}</span>
                      <span className="muted">accuracy{analysis.est ? ` · played like ~${analysis.est[c]}` : ''}</span>
                    </div>
                  ))}
                </div>

                <table className="counts">
                  <tbody>
                    {CLS_ORDER.map((cls) => {
                      const w = analysis.counts.w[cls] ?? 0;
                      const b = analysis.counts.b[cls] ?? 0;
                      if (cls === 'forced' && !w && !b) return null;
                      return (
                        <tr key={cls}>
                          <td className={`num${w ? '' : ' zero'}`} style={w ? { color: CLS_META[cls].color } : undefined}>
                            {w}
                          </td>
                          <td className="cls-cell">
                            <ClsBadge cls={cls} size={18} />
                            <span>{CLS_META[cls].label}</span>
                          </td>
                          <td className={`num${b ? '' : ' zero'}`} style={b ? { color: CLS_META[cls].color } : undefined}>
                            {b}
                          </td>
                        </tr>
                      );
                    })}
                    {PHASES.map(([p, label]) => {
                      const w = analysis.phaseAcc.w[p];
                      const b = analysis.phaseAcc.b[p];
                      if (w === undefined && b === undefined) return null;
                      return (
                        <tr key={p} className="phase-row">
                          <td className="num">{w !== undefined ? w.toFixed(0) : '–'}</td>
                          <td className="cls-cell plain">{label} accuracy</td>
                          <td className="num">{b !== undefined ? b.toFixed(0) : '–'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div className="row gap wrap">
                  <button className="btn primary" onClick={() => goto(Math.min(n, Math.max(1, analysis.bookPlies)))}>
                    Step through the game
                  </button>
                  {mySide ? (
                    <button className="btn" disabled={!myRetry} onClick={() => startRetry(mySide)}>
                      <Icon name="retry" size={16} /> Retry your mistakes ({myRetry})
                    </button>
                  ) : (
                    (['w', 'b'] as Color[]).map((c) => {
                      const k = retryQueue(c).length;
                      return (
                        <button className="btn" key={c} disabled={!k} onClick={() => startRetry(c)}>
                          <Icon name="retry" size={16} /> Retry {c === 'w' ? 'White' : 'Black'}’s mistakes ({k})
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="reanalyze">
                  <span className="muted">Engine effort</span>
                  <Segmented
                    small
                    value={s.reviewNodes}
                    onChange={(v) => settings.set({ reviewNodes: v })}
                    options={REVIEW_PROFILES.map((p) => ({ value: p.nodes, label: p.label, title: p.hint }))}
                  />
                  <button className="btn small" onClick={() => setRunKey((k) => k + 1)} disabled={!!progress}>
                    Re-analyze
                  </button>
                </div>
              </div>
            ) : (
              <>
                {info && ply > 0 && (
                  <div className="move-card" style={{ borderLeftColor: CLS_META[info.cls].color }}>
                    <div className="move-card-head">
                      <ClsBadge cls={info.cls} size={22} />
                      <strong>{moveLabel(game.startFen, ply - 1, game.moves[ply - 1].san)}</strong>
                      <span style={{ color: CLS_META[info.cls].color }}>
                        {info.cls === 'book' || info.cls === 'forced' ? CLS_META[info.cls].label : `is ${CLS_META[info.cls].phrase}`}
                      </span>
                      <span className="spacer" />
                      <span className="ev-text">{formatEval(analysis!.evals[ply])}</span>
                    </div>
                    <p>{info.text}</p>
                    {!QUIET_BEST.has(info.cls) && info.bestLine && info.bestLine.length > 0 && (
                      <button className="line-btn" onClick={() => exploreLine(ply - 1, analysis!.evals[ply - 1].pv)} title="Play through the engine's line">
                        <span className="line-tag best">Best</span>
                        <span className="line-moves">{numberLine(game.fens[ply - 1], info.bestLine.slice(0, 6))}</span>
                        <span className="ev-text">{formatEval(analysis!.evals[ply - 1])}</span>
                      </button>
                    )}
                    {info.replyLine && info.replyLine.length > 0 && (info.loss >= 5 || info.cls === 'brilliant') && (
                      <button className="line-btn" onClick={() => exploreLine(ply, analysis!.evals[ply].pv)} title="Play through what happens next">
                        <span className="line-tag">Then</span>
                        <span className="line-moves">{numberLine(game.fens[ply], info.replyLine.slice(0, 6))}</span>
                        <span className="ev-text">{formatEval(analysis!.evals[ply])}</span>
                      </button>
                    )}
                  </div>
                )}
                {!info && !explore && ply === 0 && (
                  <div className="move-card neutral">
                    <p>
                      {analysis
                        ? 'Use the arrow keys or click a move to step through the game. You can also play your own moves on the board to try ideas.'
                        : 'You can already step through the game while the review runs.'}
                    </p>
                  </div>
                )}

                {explore && (
                  <div className="explore-bar">
                    <div className="row between">
                      <span className="tag">Trying a line</span>
                      <button className="link" onClick={() => setExplore(null)}>
                        Back to the game
                      </button>
                    </div>
                    <div className="explore-moves">
                      {explore.line.map((m, j) => {
                        const label = moveLabel(game.startFen, explore.base + j, m.san);
                        const text = j > 0 && m.color === 'b' ? m.san : label;
                        return (
                          <button key={j} className={`mv${explore.idx === j + 1 ? ' on' : ''}${j >= explore.idx ? ' ahead' : ''}`} onClick={() => setExplore({ ...explore, idx: j + 1 })}>
                            {text}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {(engineOn || explore) && <EngineLines live={live} fen={view.fen} onPick={playEngineMove} />}

                <MoveList startFen={game.startFen} moves={game.moves} infos={analysis?.moves} ply={explore ? -1 : ply} onSelect={goto} />
              </>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

function RetryCard(props: {
  retry: Retry;
  game: PGame;
  analysis: GameAnalysis;
  onHint: () => void;
  onShow: () => void;
  onAgain: () => void;
  onNext: () => void;
  onQuit: () => void;
}) {
  const { retry, game, analysis } = props;
  const i = retry.queue[retry.pos];
  const mv = game.moves[i];
  const mi = analysis.moves[i];
  const last = retry.pos === retry.queue.length - 1;
  return (
    <div className="retry-card">
      <div className="row between">
        <span className="tag">
          Mistake {retry.pos + 1} of {retry.queue.length}
        </span>
        <button className="link" onClick={props.onQuit}>
          Stop
        </button>
      </div>
      <h3>
        <ClsBadge cls={mi.cls} size={20} /> In the game: {moveLabel(game.startFen, i, mv.san)}
      </h3>
      {retry.status === 'ask' && <p>Find a better move for {mv.color === 'w' ? 'White' : 'Black'}.</p>}
      {retry.status === 'checking' && <p>Checking {retry.tried?.san}…</p>}
      {retry.status === 'right' && <p className="good-text">{retry.verdict}</p>}
      {retry.status === 'wrong' && <p className="bad-text">{retry.verdict}</p>}
      {retry.status === 'shown' && (
        <p>
          The best move was <strong>{mi.bestSan}</strong>. {mi.text}
        </p>
      )}
      <div className="row gap wrap">
        {retry.status === 'ask' && (
          <>
            <button className="btn" onClick={props.onHint} disabled={retry.hint >= 2}>
              <Icon name="hint" size={16} /> {retry.hint === 0 ? 'Hint' : 'Show the move'}
            </button>
            <button className="btn" onClick={props.onShow}>
              Give up
            </button>
          </>
        )}
        {retry.status === 'wrong' && (
          <>
            <button className="btn primary" onClick={props.onAgain}>
              Try again
            </button>
            <button className="btn" onClick={props.onShow}>
              Show the answer
            </button>
          </>
        )}
        {(retry.status === 'right' || retry.status === 'shown') && (
          <button className="btn primary" onClick={props.onNext}>
            {last ? 'Finish' : 'Next mistake'}
          </button>
        )}
      </div>
    </div>
  );
}
