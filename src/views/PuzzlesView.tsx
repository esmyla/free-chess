import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board, type Shape } from '../components/Board';
import { LineChart } from '../components/charts';
import { arrowShape, badgeShape, Icon, Segmented, Spinner } from '../components/common';
import { START_FEN, tryMove, uciToMove } from '../lib/chessutil';
import {
  applyResult,
  loadIndex,
  loadProgress,
  markSeen,
  pickPuzzle,
  saveProgress,
  themeLabels,
  THEMES,
  type Puzzle,
  type PuzzleProgress,
} from '../lib/puzzles';
import { playEnd, playMove, playRight, playWrong } from '../lib/sound';
import { go, settings, useSettings } from '../lib/store';
import type { Color, XMove } from '../lib/types';

type Status = 'intro' | 'solve' | 'reply' | 'done';

const isMate = (fen: string): boolean => {
  try {
    return new Chess(fen).isCheckmate();
  } catch {
    return false;
  }
};

/** Drives one puzzle: plays the lead-in move, checks the solver's moves, plays the replies. */
function useSolver(
  puzzle: Puzzle | null,
  opts: { wrongEnds: boolean; onFail: () => void; onDone: (clean: boolean) => void },
) {
  const [fen, setFen] = useState(puzzle?.fen ?? START_FEN);
  const [last, setLast] = useState<[string, string] | null>(null);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<Status>('intro');
  const [hint, setHint] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);
  const [errors, setErrors] = useState(0);
  /** True right after a wrong move, until the next correct one. */
  const [slipped, setSlipped] = useState(false);
  const failed = useRef(false);
  const timers = useRef<number[]>([]);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  useEffect(() => {
    clearTimers();
    failed.current = false;
    setLast(null);
    setStep(0);
    setStatus('intro');
    setHint(0);
    setRevealed(false);
    setWrong(null);
    setErrors(0);
    setSlipped(false);
    if (!puzzle) return;
    setFen(puzzle.fen);
    later(() => {
      const m = tryMove(puzzle.fen, uciToMove(puzzle.moves[0]));
      if (m) {
        setFen(m.after);
        setLast([m.from, m.to]);
        playMove(!!m.captured);
      }
      setStep(1);
      setStatus('solve');
    }, 500);
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle?.id]);

  const solver: Color = puzzle ? (puzzle.fen.split(' ')[1] === 'w' ? 'b' : 'w') : 'w';

  const markFail = () => {
    if (!failed.current) {
      failed.current = true;
      optsRef.current.onFail();
    }
  };

  const onMove = (m: XMove) => {
    if (!puzzle || status !== 'solve') return;
    const mate = isMate(m.after);
    if (m.uci === puzzle.moves[step] || mate) {
      playMove(!!m.captured);
      setFen(m.after);
      setLast([m.from, m.to]);
      setHint(0);
      setWrong(null);
      setSlipped(false);
      if (mate || step + 1 >= puzzle.moves.length) {
        setStatus('done');
        optsRef.current.onDone(!failed.current);
        return;
      }
      setStatus('reply');
      later(() => {
        const r = tryMove(m.after, uciToMove(puzzle.moves[step + 1]));
        if (r) {
          setFen(r.after);
          setLast([r.from, r.to]);
          playMove(!!r.captured);
        }
        setStep(step + 2);
        setStatus('solve');
      }, 420);
    } else {
      playWrong();
      setErrors((e) => e + 1);
      setSlipped(true);
      setWrong(m.to);
      later(() => setWrong(null), 800);
      markFail();
      if (optsRef.current.wrongEnds) {
        setStatus('done');
        optsRef.current.onDone(false);
      }
    }
  };

  const giveHint = () => {
    if (status !== 'solve') return;
    const next = Math.min(2, hint + 1);
    if (next === 2) markFail();
    setHint(next);
  };

  const reveal = () => {
    if (!puzzle || status !== 'solve') return;
    markFail();
    setRevealed(true);
    setHint(0);
    setStatus('reply');
    const playOn = (cur: string, idx: number) => {
      const mv = idx < puzzle.moves.length ? tryMove(cur, uciToMove(puzzle.moves[idx])) : null;
      if (!mv) {
        setStatus('done');
        optsRef.current.onDone(false);
        return;
      }
      setFen(mv.after);
      setLast([mv.from, mv.to]);
      playMove(!!mv.captured);
      later(() => playOn(mv.after, idx + 1), 700);
    };
    playOn(fen, step);
  };

  const shapes = useMemo<Shape[]>(() => {
    const out: Shape[] = [];
    if (puzzle && status === 'solve' && hint > 0) {
      const e = puzzle.moves[step];
      if (hint === 1) out.push({ orig: e.slice(0, 2) as Shape['orig'], brush: 'yellow' });
      else out.push(arrowShape(e.slice(0, 2), e.slice(2, 4), 'green'));
    }
    if (wrong) out.push({ orig: wrong as Shape['orig'], label: { text: '×', fill: '#ef4444' } });
    if (status === 'done' && last && !revealed && !wrong) out.push(badgeShape(last[1], 'best'));
    return out;
  }, [puzzle, status, hint, step, wrong, last, revealed]);

  return { fen, last, solver, status, hint, revealed, errors, slipped, shapes, onMove, giveHint, reveal };
}

// ---- Rated and practice puzzles ---------------------------------------------------------------

function Trainer({ mode }: { mode: 'rated' | 'practice' }) {
  const s = useSettings();
  const [progress, setProgress] = useState<PuzzleProgress>(loadProgress);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [outcome, setOutcome] = useState<{ solved: boolean; delta: number } | null>(null);
  const [theme, setTheme] = useState('');
  const [offset, setOffset] = useState(0);
  const rated = mode === 'rated';
  const ticket = useRef(0);

  const update = (p: PuzzleProgress) => {
    progressRef.current = p;
    setProgress(p);
    saveProgress(p);
  };

  const next = useCallback(async () => {
    const id = ++ticket.current;
    setLoading(true);
    setOutcome(null);
    const cur = progressRef.current;
    const target = cur.rating + (rated ? 0 : offset);
    const want = { theme: rated ? undefined : theme || undefined };
    let p = await pickPuzzle(target, { ...want, seen: new Set(cur.seen) });
    // Everything nearby has been seen already: allow repeats.
    if (!p) p = await pickPuzzle(target, want);
    if (id !== ticket.current) return;
    setPuzzle(p);
    setMissing(!p);
    setLoading(false);
  }, [rated, theme, offset]);

  useEffect(() => {
    void next();
  }, [next]);

  const sv = useSolver(puzzle, {
    wrongEnds: false,
    onFail: () => {
      if (!puzzle) return;
      if (rated) {
        const { next: np, delta } = applyResult(progressRef.current, puzzle, false);
        update(np);
        setOutcome({ solved: false, delta });
      } else {
        update(markSeen(progressRef.current, puzzle.id));
        setOutcome({ solved: false, delta: 0 });
      }
    },
    onDone: (clean) => {
      if (!puzzle) return;
      if (clean) {
        playRight();
        if (rated) {
          const { next: np, delta } = applyResult(progressRef.current, puzzle, true);
          update(np);
          setOutcome({ solved: true, delta });
        } else {
          update(markSeen(progressRef.current, puzzle.id));
          setOutcome({ solved: true, delta: 0 });
        }
        if (settings.get().puzzleAutoNext) window.setTimeout(() => void next(), 900);
      }
    },
  });

  const done = sv.status === 'done';
  let headline = 'Loading…';
  let tone = '';
  if (missing) headline = 'No puzzles found.';
  else if (!loading && puzzle) {
    if (done && outcome?.solved) {
      headline = 'Solved!';
      tone = 'good';
    } else if (done) {
      headline = sv.revealed ? 'Here is the solution.' : 'Solved, with a slip along the way.';
      tone = sv.revealed ? '' : 'warn';
    } else if (sv.slipped && sv.status === 'solve') {
      headline = 'Not that one. Try again.';
      tone = 'bad';
    } else if (sv.status === 'reply') headline = 'Good. Keep going…';
    else if (sv.status === 'intro') headline = 'Watch the last move…';
    else headline = `Your turn: find the best move for ${sv.solver === 'w' ? 'White' : 'Black'}.`;
  }

  const total = progress.solved + progress.failed;
  return (
    <div className="stage">
      <div className="board-col">
        <div className="board-fit">
          <div className="board-caption">
            <span className={`side-dot ${sv.solver === 'w' ? 'white' : 'black'}`} />
            <span>{sv.solver === 'w' ? 'White' : 'Black'} to play</span>
            <span className="spacer" />
            {puzzle && done && <span className="muted">Puzzle rating {puzzle.rating}</span>}
          </div>
          <div className="board-row no-bar">
            <Board
              fen={sv.fen}
              orientation={sv.solver}
              lastMove={sv.last}
              interactive={sv.status === 'solve' ? sv.solver : false}
              onMove={sv.onMove}
              shapes={sv.shapes}
            />
          </div>
        </div>
      </div>

      <aside className="panel">
        <div className="rating-card">
          <div>
            <span className="muted">{rated ? 'Your puzzle rating' : 'Practice (rating not affected)'}</span>
            <div className="big-number">
              {progress.rating}
              {rated && outcome && outcome.delta !== 0 && (
                <span className={`delta ${outcome.delta > 0 ? 'up' : 'down'}`}>
                  {outcome.delta > 0 ? '+' : ''}
                  {outcome.delta}
                </span>
              )}
            </div>
          </div>
          <div className="mini-stats">
            <span>
              <strong>{progress.solved}</strong> solved
            </span>
            <span>
              <strong>{total ? Math.round((progress.solved / total) * 100) : 0}%</strong> success
            </span>
            <span>
              <strong>{progress.streak}</strong> streak (best {progress.bestStreak})
            </span>
          </div>
        </div>

        {!rated && (
          <div className="card tight practice-opts">
            <label className="field">
              <span>Theme</span>
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                <option value="">Any theme</option>
                {THEMES.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <span>Difficulty</span>
              <Segmented
                small
                value={offset}
                onChange={setOffset}
                options={[
                  { value: -300, label: 'Easier' },
                  { value: 0, label: 'My level' },
                  { value: 300, label: 'Harder' },
                ]}
              />
            </div>
          </div>
        )}

        <div className={`verdict ${tone}`}>
          {loading && <Spinner size={14} />}
          <span>{headline}</span>
        </div>
        {missing && (
          <p className="fine">
            The puzzle pack is missing. Run <code>npm run build:puzzles</code> in the project folder to download it.
          </p>
        )}

        <div className="row gap wrap">
          {!done ? (
            <>
              <button className="btn" onClick={sv.giveHint} disabled={sv.status !== 'solve' || sv.hint >= 2}>
                <Icon name="hint" size={16} /> {sv.hint === 0 ? 'Hint' : 'Show the move'}
              </button>
              <button className="btn" onClick={sv.reveal} disabled={sv.status !== 'solve'}>
                Show solution
              </button>
              <button className="btn" onClick={() => void next()} disabled={loading} title={rated && !outcome ? 'Skipping does not change your rating' : ''}>
                Skip
              </button>
            </>
          ) : (
            <>
              <button className="btn primary" onClick={() => void next()}>
                Next puzzle
              </button>
              <button className="btn" onClick={() => puzzle && go(`analysis?fen=${encodeURIComponent(sv.fen)}`)}>
                Analyze position
              </button>
            </>
          )}
        </div>

        {puzzle && done && (
          <div className="card tight">
            <div className="chips">
              {themeLabels(puzzle.themes).map((t) => (
                <span className="chip" key={t}>
                  {t}
                </span>
              ))}
            </div>
            <p className="fine">
              Puzzle {puzzle.id} from the{' '}
              <a href={`https://lichess.org/training/${puzzle.id}`} target="_blank" rel="noreferrer">
                Lichess puzzle database
              </a>
              .
            </p>
          </div>
        )}

        <label className="check">
          <input type="checkbox" checked={s.puzzleAutoNext} onChange={(e) => settings.set({ puzzleAutoNext: e.target.checked })} />
          <span>Go to the next puzzle automatically after a clean solve</span>
        </label>

        {rated && progress.history.length > 2 && (
          <div className="card tight">
            <span className="muted">Rating over your last {progress.history.length} puzzles</span>
            <LineChart points={progress.history.map((v, i) => ({ t: i, v }))} byIndex height={110} />
          </div>
        )}
      </aside>
    </div>
  );
}

// ---- Sprint -----------------------------------------------------------------------------------

type SprintKind = '3' | '5' | 'survival';
const SPRINT_LABEL: Record<SprintKind, string> = { '3': '3 minutes', '5': '5 minutes', survival: 'Survival (no clock)' };
const MAX_STRIKES = 3;

function Sprint() {
  const [kind, setKind] = useState<SprintKind>('3');
  const [phase, setPhase] = useState<'setup' | 'run' | 'over'>('setup');
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [score, setScore] = useState(0);
  const [strikes, setStrikes] = useState(0);
  const [left, setLeft] = useState(0);
  const [best, setBest] = useState<Record<string, number>>(() => loadProgress().sprintBest);
  const [record, setRecord] = useState(false);
  const run = useRef({ score: 0, strikes: 0, index: 0, seen: new Set<string>(), over: true, end: 0 });

  const finish = useCallback(() => {
    const r = run.current;
    if (r.over) return;
    r.over = true;
    playEnd();
    const p = loadProgress();
    const prev = p.sprintBest[kind] ?? 0;
    if (r.score > prev) {
      p.sprintBest = { ...p.sprintBest, [kind]: r.score };
      saveProgress(p);
      setBest(p.sprintBest);
      setRecord(true);
    }
    setPhase('over');
  }, [kind]);

  const nextPuzzle = useCallback(async () => {
    const r = run.current;
    // Sprints start easy and climb.
    const target = Math.min(2600, 500 + r.index * 40);
    r.index++;
    const p = await pickPuzzle(target, { seen: r.seen, spread: 60 });
    if (r.over) return;
    if (p) r.seen.add(p.id);
    setPuzzle(p);
    if (!p) finish();
  }, [finish]);

  const start = () => {
    run.current = {
      score: 0,
      strikes: 0,
      index: 0,
      seen: new Set(),
      over: false,
      end: kind === 'survival' ? 0 : Date.now() + Number(kind) * 60_000,
    };
    setScore(0);
    setStrikes(0);
    setRecord(false);
    setLeft(kind === 'survival' ? 0 : Number(kind) * 60);
    setPuzzle(null);
    setPhase('run');
    void nextPuzzle();
  };

  useEffect(() => {
    if (phase !== 'run' || kind === 'survival') return;
    const t = window.setInterval(() => {
      const remaining = Math.max(0, (run.current.end - Date.now()) / 1000);
      setLeft(remaining);
      if (remaining <= 0) finish();
    }, 200);
    return () => window.clearInterval(t);
  }, [phase, kind, finish]);

  // Leaving the screen ends the run quietly.
  useEffect(
    () => () => {
      run.current.over = true;
    },
    [],
  );

  const sv = useSolver(phase === 'run' ? puzzle : null, {
    wrongEnds: true,
    onFail: () => {
      const r = run.current;
      r.strikes++;
      setStrikes(r.strikes);
    },
    onDone: (clean) => {
      const r = run.current;
      if (r.over) return;
      if (clean) {
        r.score++;
        setScore(r.score);
        playRight();
      }
      if (r.strikes >= MAX_STRIKES) {
        window.setTimeout(finish, 500);
        return;
      }
      window.setTimeout(() => void nextPuzzle(), clean ? 350 : 800);
    },
  });

  const mm = Math.floor(left / 60);
  const ss = Math.floor(left % 60);
  return (
    <div className="stage">
      <div className="board-col">
        <div className="board-fit">
          <div className="board-caption">
            {phase === 'run' && puzzle ? (
              <>
                <span className={`side-dot ${sv.solver === 'w' ? 'white' : 'black'}`} />
                <span>{sv.solver === 'w' ? 'White' : 'Black'} to play</span>
              </>
            ) : (
              <span className="muted">Solve as many as you can. Three misses end the run.</span>
            )}
          </div>
          <div className="board-row no-bar">
            <Board
              fen={phase === 'run' && puzzle ? sv.fen : START_FEN}
              orientation={phase === 'run' && puzzle ? sv.solver : 'w'}
              lastMove={phase === 'run' ? sv.last : null}
              interactive={phase === 'run' && sv.status === 'solve' ? sv.solver : false}
              onMove={sv.onMove}
              shapes={phase === 'run' ? sv.shapes : undefined}
            />
          </div>
        </div>
      </div>

      <aside className="panel">
        {phase === 'setup' && (
          <>
            <div className="panel-head">
              <div className="panel-title">
                <strong>Puzzle sprint</strong>
                <span className="muted">Puzzles start easy and get harder. One wrong move is a miss.</span>
              </div>
            </div>
            <div className="sprint-kinds">
              {(Object.keys(SPRINT_LABEL) as SprintKind[]).map((k) => (
                <button key={k} className={`kind-card${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>
                  <strong>{SPRINT_LABEL[k]}</strong>
                  <span className="muted">Best: {best[k] ?? 0}</span>
                </button>
              ))}
            </div>
            <button className="btn primary big" onClick={start}>
              <Icon name="bolt" size={18} /> Start
            </button>
          </>
        )}

        {phase !== 'setup' && (
          <>
            <div className="sprint-hud">
              <div>
                <span className="muted">Solved</span>
                <div className="big-number">{score}</div>
              </div>
              {kind !== 'survival' && (
                <div>
                  <span className="muted">Time</span>
                  <div className={`big-number${left < 20 && phase === 'run' ? ' low' : ''}`}>
                    {mm}:{String(ss).padStart(2, '0')}
                  </div>
                </div>
              )}
              <div>
                <span className="muted">Misses</span>
                <div className="strikes">
                  {Array.from({ length: MAX_STRIKES }, (_, i) => (
                    <span key={i} className={i < strikes ? 'hit' : ''}>
                      ×
                    </span>
                  ))}
                </div>
              </div>
            </div>
            {phase === 'run' && puzzle && <p className="muted">Puzzle rating about {puzzle.rating}</p>}
            {phase === 'over' && (
              <div className="card tight">
                <h3>{record ? 'New personal best!' : 'Run over'}</h3>
                <p>
                  You solved <strong>{score}</strong> puzzle{score === 1 ? '' : 's'} in {SPRINT_LABEL[kind].toLowerCase()}. Your best is{' '}
                  {best[kind] ?? score}.
                </p>
                <div className="row gap">
                  <button className="btn primary" onClick={start}>
                    Go again
                  </button>
                  <button className="btn" onClick={() => setPhase('setup')}>
                    Change mode
                  </button>
                </div>
              </div>
            )}
            {phase === 'run' && (
              <button className="btn" onClick={finish}>
                End run
              </button>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

// ---- Screen -----------------------------------------------------------------------------------

type Mode = 'rated' | 'practice' | 'sprint';

export function PuzzlesView() {
  const [mode, setMode] = useState<Mode>('rated');
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    void loadIndex().then((i) => setCount(i?.total ?? 0));
  }, []);
  return (
    <div className="with-topbar">
      <div className="topbar">
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'rated', label: 'Rated' },
            { value: 'practice', label: 'Practice by theme' },
            { value: 'sprint', label: 'Sprint' },
          ]}
        />
        {count !== null && count > 0 && <span className="muted">{count.toLocaleString()} puzzles, no daily limit</span>}
      </div>
      {mode === 'sprint' ? <Sprint /> : <Trainer key={mode} mode={mode} />}
    </div>
  );
}
