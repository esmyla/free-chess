import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { Board, type Shape } from '../components/Board';
import { EngineLines } from '../components/EngineLines';
import { MoveList } from '../components/MoveList';
import { arrowShape, EvalBar, Icon, Segmented, SplitBar, Spinner } from '../components/common';
import { START_FEN, toXMove, tryMove, uciToMove } from '../lib/chessutil';
import { buildTrie, fetchExplorer, trieResult, type ExplorerDb, type ExplorerResult } from '../lib/explorer';
import { useBook, useGames, useKeys, useLiveEval } from '../lib/hooks';
import { buildPgn } from '../lib/pgn';
import { playMove } from '../lib/sound';
import { useRoute, useSettings } from '../lib/store';
import type { Color, XMove } from '../lib/types';

interface BoardState {
  startFen: string;
  line: XMove[];
  idx: number;
}

// Survives switching between screens, so the position is still there when you come back.
let saved: BoardState = { startFen: START_FEN, line: [], idx: 0 };

type Source = ExplorerDb | 'mine';

/** Parse pasted text as a FEN or a PGN. Returns null when it is neither. */
function parseInput(text: string): BoardState | null {
  const t = text.trim();
  if (!t) return null;
  try {
    const c = new Chess(t);
    return { startFen: c.fen(), line: [], idx: 0 };
  } catch {
    /* not a FEN */
  }
  try {
    const c = new Chess();
    c.loadPgn(t);
    const hist = c.history({ verbose: true });
    if (!hist.length) return null;
    return { startFen: hist[0].before, line: hist.map((m) => toXMove(m)), idx: hist.length };
  } catch {
    return null;
  }
}

function Explorer(props: { fen: string; sans: string[] | null; onPlay: (san: string) => void }) {
  const { fen, sans } = props;
  const s = useSettings();
  const { games } = useGames();
  const [source, setSource] = useState<Source>('masters');
  const [color, setColor] = useState<Color>('w');
  const [data, setData] = useState<ExplorerResult | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const user = s.username.trim().toLowerCase();

  const trie = useMemo(
    () => (source === 'mine' ? buildTrie(games.filter((g) => g.source === 'chesscom' && g.owner === user), color) : null),
    [source, games, user, color],
  );

  useEffect(() => {
    if (source === 'mine') {
      setState('idle');
      setData(trie && sans ? trieResult(trie, sans) : null);
      return;
    }
    let alive = true;
    setState('loading');
    // Wait a moment so stepping quickly through moves does not fire a request per move.
    const timer = window.setTimeout(() => {
      fetchExplorer(source, fen)
        .then((d) => {
          if (!alive) return;
          setData(d);
          setState('idle');
        })
        .catch((e: unknown) => {
          if (!alive) return;
          setData(null);
          setMessage(e instanceof Error ? e.message : 'Could not load explorer data.');
          setState('error');
        });
    }, 260);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [source, fen, trie, sans]);

  const mineUnavailable = source === 'mine' && !sans;
  return (
    <div className="explorer">
      <div className="row between wrap gap">
        <Segmented<Source>
          small
          value={source}
          onChange={setSource}
          options={[
            { value: 'masters', label: 'Masters', title: 'Over-the-board games by titled players' },
            { value: 'lichess', label: 'Online', title: 'Rated online games, 1400 and above' },
            { value: 'mine', label: 'My games', title: 'Your own imported games' },
          ]}
        />
        {source === 'mine' && (
          <Segmented<Color>
            small
            value={color}
            onChange={setColor}
            options={[
              { value: 'w', label: 'As White' },
              { value: 'b', label: 'As Black' },
            ]}
          />
        )}
      </div>

      {state === 'loading' && (
        <div className="status">
          <Spinner size={12} /> Loading…
        </div>
      )}
      {state === 'error' && <div className="status error">{message}</div>}
      {mineUnavailable && <div className="empty-note">Your games can only be matched from the normal starting position.</div>}
      {source === 'mine' && !user && <div className="empty-note">Load your games on the Games screen first.</div>}

      {state !== 'error' && !mineUnavailable && data && data.moves.length > 0 && (
        <table className="explorer-table">
          <thead>
            <tr>
              <th>Move</th>
              <th className="num">Games</th>
              <th>White / Draw / Black</th>
            </tr>
          </thead>
          <tbody>
            {data.moves.map((m) => (
              <tr key={m.san} onClick={() => props.onPlay(m.san)}>
                <td className="san">{m.san}</td>
                <td className="num">{m.total.toLocaleString()}</td>
                <td>
                  <SplitBar white={m.white} draws={m.draws} black={m.black} />
                </td>
              </tr>
            ))}
            <tr className="total-row">
              <td>All</td>
              <td className="num">{data.total.toLocaleString()}</td>
              <td>
                <SplitBar white={data.white} draws={data.draws} black={data.black} />
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {state === 'idle' && !mineUnavailable && (!data || !data.moves.length) && (source !== 'mine' || user) && (
        <div className="empty-note">No games reach this position.</div>
      )}
      {source !== 'mine' && <p className="fine">Statistics from the Lichess opening explorer.</p>}
    </div>
  );
}

export function AnalysisView({ initialTab = 'engine' }: { initialTab?: 'engine' | 'explorer' }) {
  const s = useSettings();
  const route = useRoute();
  const book = useBook();
  const [st, setSt] = useState<BoardState>(saved);
  const [orientation, setOrientation] = useState<Color>('w');
  const [engineOn, setEngineOn] = useState(true);
  const [tab, setTab] = useState<'engine' | 'explorer'>(initialTab);
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState(false);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    saved = st;
  }, [st]);
  useEffect(() => setTab(initialTab), [initialTab]);

  // A position handed over from another screen: #/analysis?fen=...
  const qFen = route.query.get('fen');
  useEffect(() => {
    if (!qFen) return;
    const parsed = parseInput(qFen);
    if (parsed) {
      setSt(parsed);
      setOrientation(parsed.startFen.split(' ')[1] === 'b' ? 'b' : 'w');
    }
  }, [qFen]);

  const fen = st.idx > 0 ? st.line[st.idx - 1].after : st.startFen;
  const lastMove = st.idx > 0 ? st.line[st.idx - 1] : null;
  const live = useLiveEval(fen, engineOn, s.lines);

  const standard = st.startFen === START_FEN;
  const played = useMemo(() => st.line.slice(0, st.idx), [st]);
  const sans = useMemo(() => (standard ? played.map((m) => m.san) : null), [standard, played]);
  const opening = useMemo(
    () => (book && standard ? book.detect([st.startFen, ...played.map((m) => m.after)]).opening : undefined),
    [book, standard, st.startFen, played],
  );

  const push = (m: XMove) => {
    playMove(!!m.captured);
    setSt((cur) => {
      // Replaying the move that is already next in the line just steps forward.
      if (cur.idx < cur.line.length && cur.line[cur.idx].uci === m.uci) return { ...cur, idx: cur.idx + 1 };
      return { ...cur, line: [...cur.line.slice(0, cur.idx), m], idx: cur.idx + 1 };
    });
  };
  const play = (mv: string | { from: string; to: string; promotion?: string }) => {
    const m = tryMove(fen, mv);
    if (m) push(m);
  };
  const goto = (idx: number) => setSt((cur) => ({ ...cur, idx: Math.max(0, Math.min(cur.line.length, idx)) }));

  useKeys((e) => {
    if (e.key === 'ArrowLeft') goto(st.idx - 1);
    else if (e.key === 'ArrowRight') goto(st.idx + 1);
    else if (e.key === 'ArrowUp') goto(0);
    else if (e.key === 'ArrowDown') goto(st.line.length);
    else if (e.key === 'f') setOrientation((o) => (o === 'w' ? 'b' : 'w'));
    else return;
    e.preventDefault();
  });

  const shapes = useMemo<Shape[]>(() => {
    const out: Shape[] = [];
    if (!engineOn || !live) return out;
    live.lines.slice(0, 3).forEach((l, i) => {
      const u = l.pv[0];
      if (u) out.push(arrowShape(u.slice(0, 2), u.slice(2, 4), i === 0 ? 'blue' : 'yellow', i > 0));
    });
    return out;
  }, [engineOn, live]);

  const copy = async (what: 'FEN' | 'PGN') => {
    const text =
      what === 'FEN'
        ? fen
        : buildPgn({ Event: 'Analysis', Result: '*' }, played.map((m) => m.san), standard ? undefined : st.startFen);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(''), 1500);
    } catch {
      setCopied('');
    }
  };

  const loadInput = () => {
    const parsed = parseInput(input);
    if (!parsed) {
      setInputError(true);
      return;
    }
    setInputError(false);
    setInput('');
    setSt(parsed);
    setOrientation(parsed.startFen.split(' ')[1] === 'b' && !parsed.line.length ? 'b' : 'w');
  };

  const turn = fen.split(' ')[1] as Color;
  return (
    <div className="stage">
      <div className="board-col">
        <div className="board-fit">
          <div className="board-caption">
            <span className={`side-dot ${turn === 'w' ? 'white' : 'black'}`} />
            <span>{turn === 'w' ? 'White' : 'Black'} to move</span>
            <span className="spacer" />
            <span className="muted">{opening ? `${opening.eco} · ${opening.name}` : standard && !st.idx ? 'Starting position' : ''}</span>
          </div>
          <div className="board-row">
            <EvalBar ev={engineOn ? (live?.ev ?? null) : null} orientation={orientation} />
            <Board
              fen={fen}
              orientation={orientation}
              lastMove={lastMove ? [lastMove.from, lastMove.to] : null}
              interactive
              onMove={push}
              shapes={shapes}
            />
          </div>
          <div className="controls">
            <button className="icon-btn" title="Start (↑)" onClick={() => goto(0)}>
              <Icon name="first" />
            </button>
            <button className="icon-btn" title="Back (←)" onClick={() => goto(st.idx - 1)}>
              <Icon name="prev" />
            </button>
            <button className="icon-btn" title="Forward (→)" onClick={() => goto(st.idx + 1)}>
              <Icon name="next" />
            </button>
            <button className="icon-btn" title="End (↓)" onClick={() => goto(st.line.length)}>
              <Icon name="last" />
            </button>
            <span className="spacer" />
            <button className="btn small" onClick={() => setSt({ startFen: START_FEN, line: [], idx: 0 })}>
              New board
            </button>
            <button className={`icon-btn${engineOn ? ' on' : ''}`} title="Engine on/off" onClick={() => setEngineOn((v) => !v)}>
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
          <div className="panel-title">
            <strong>{initialTab === 'explorer' ? 'Opening explorer' : 'Analysis board'}</strong>
            <span className="muted">Move the pieces freely. Nothing here is saved to your games.</span>
          </div>
        </div>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'engine', label: 'Engine' },
            { value: 'explorer', label: 'Opening explorer' },
          ]}
        />

        {tab === 'engine' ? (
          engineOn ? (
            <EngineLines live={live} fen={fen} onPick={(uci) => play(uciToMove(uci))} />
          ) : (
            <div className="empty-note">The engine is off. Turn it on with the chip button under the board.</div>
          )
        ) : (
          <Explorer fen={fen} sans={sans} onPlay={(san) => play(san)} />
        )}

        <MoveList startFen={st.startFen} moves={st.line} ply={st.idx} onSelect={goto} />

        <div className="paste-box">
          <div className="row gap">
            <input
              className={inputError ? 'invalid' : ''}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setInputError(false);
              }}
              onKeyDown={(e) => e.key === 'Enter' && loadInput()}
              placeholder="Paste a FEN or PGN to load it"
              spellCheck={false}
            />
            <button className="btn small" onClick={loadInput} disabled={!input.trim()}>
              Load
            </button>
          </div>
          {inputError && <div className="status error">That is not a valid FEN or PGN.</div>}
          <div className="row gap">
            <button className="btn small" onClick={() => void copy('FEN')}>
              {copied === 'FEN' ? 'Copied' : 'Copy FEN'}
            </button>
            <button className="btn small" onClick={() => void copy('PGN')} disabled={!st.idx}>
              {copied === 'PGN' ? 'Copied' : 'Copy PGN'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
