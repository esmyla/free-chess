import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board, type Shape } from '../components/Board';
import { MoveList } from '../components/MoveList';
import { arrowShape, EvalBar, Icon, PlayerBar, Segmented, Spinner } from '../components/common';
import { BOTS, chooseBotMove, type Bot } from '../lib/bots';
import { outcomeOf, START_FEN, toXMove, uciToMove, type Outcome } from '../lib/chessutil';
import { putGames } from '../lib/db';
import { getLiveEngine } from '../lib/engine';
import { useLiveEval } from '../lib/hooks';
import { getBook } from '../lib/openings';
import { buildPgn } from '../lib/pgn';
import { playEnd, playMove } from '../lib/sound';
import { go, loadJson, reviewPath, saveJson } from '../lib/store';
import type { Color, GameMeta, Result, XMove } from '../lib/types';

interface Saved {
  botId: string;
  color: Color;
  sans: string[];
  startedAt: number;
  /** Set when the game ended by resignation rather than on the board. */
  resigned?: boolean;
  savedId?: string;
}

const KEY = 'freechess.play.v1';
const PREF_KEY = 'freechess.play.prefs.v1';

function restore(): { saved: Saved; moves: XMove[] } | null {
  const raw = loadJson<{ game: Saved | null }>(KEY, { game: null }).game;
  if (!raw) return null;
  const chess = new Chess();
  const moves: XMove[] = [];
  try {
    for (const san of raw.sans) moves.push(toXMove(chess.move(san)));
  } catch {
    return null;
  }
  return { saved: raw, moves };
}

function describeEnd(o: Outcome, resigned: boolean, me: Color): { title: string; detail: string; result: Result } {
  if (resigned) return { title: 'You resigned', detail: 'Better luck next game.', result: me === 'w' ? '0-1' : '1-0' };
  if (o.reason === 'checkmate') {
    const won = o.winner === me;
    return {
      title: won ? 'You won!' : 'You lost',
      detail: 'Checkmate.',
      result: o.winner === 'w' ? '1-0' : '0-1',
    };
  }
  const why: Record<string, string> = {
    stalemate: 'Stalemate.',
    repetition: 'The same position came up three times.',
    insufficient: 'Neither side has enough material to mate.',
    fifty: 'Fifty moves without a capture or pawn move.',
  };
  return { title: 'Draw', detail: why[o.reason ?? ''] ?? '', result: '1/2-1/2' };
}

export function PlayView() {
  const initial = useMemo(restore, []);
  const prefs = useMemo(() => loadJson(PREF_KEY, { botId: 'rowan', color: 'w' as Color | 'random' }), []);
  const [botId, setBotId] = useState(initial?.saved.botId ?? prefs.botId);
  const [pick, setPick] = useState<Color | 'random'>(prefs.color);
  const [game, setGame] = useState<Saved | null>(initial?.saved ?? null);
  const [moves, setMoves] = useState<XMove[]>(initial?.moves ?? []);
  const [thinking, setThinking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [hinting, setHinting] = useState(false);
  const [showEval, setShowEval] = useState(false);
  const [orientation, setOrientation] = useState<Color>(initial?.saved.color ?? 'w');
  const token = useRef(0);

  const bot: Bot = BOTS.find((b) => b.id === (game?.botId ?? botId)) ?? BOTS[2];
  const fen = moves.length ? moves[moves.length - 1].after : START_FEN;
  const me = game?.color ?? 'w';

  const state = useMemo(() => {
    const chess = new Chess();
    try {
      for (const m of moves) chess.move(m.san);
    } catch {
      /* cannot happen: moves were legal when made */
    }
    return { turn: chess.turn() as Color, outcome: outcomeOf(chess) };
  }, [moves]);
  const over = !!game && (state.outcome.over || !!game.resigned);
  const end = over && game ? describeEnd(state.outcome, !!game.resigned, me) : null;

  const persist = (g: Saved | null, mv: XMove[]) => {
    saveJson(KEY, { game: g ? { ...g, sans: mv.map((m) => m.san) } : null });
  };

  const apply = (g: Saved, mv: XMove[]) => {
    setMoves(mv);
    persist(g, mv);
  };

  // Bot to move.
  useEffect(() => {
    if (!game || over || state.turn === me) return;
    const id = ++token.current;
    setThinking(true);
    const started = performance.now();
    (async () => {
      let uci: string | null = null;
      try {
        uci = await chooseBotMove(fen, bot);
      } catch (e) {
        console.error('Bot failed to move:', e);
      }
      // A short pause keeps the bot from answering instantly.
      const wait = Math.max(0, 450 + Math.random() * 400 - (performance.now() - started));
      await new Promise((r) => window.setTimeout(r, wait));
      if (id !== token.current) return;
      setThinking(false);
      if (!uci) return;
      try {
        const chess = new Chess(fen);
        const m = toXMove(chess.move(uciToMove(uci)));
        playMove(!!m.captured);
        apply(game, [...moves, m]);
      } catch (e) {
        console.error('Bot chose an illegal move:', uci, e);
      }
    })();
    return () => {
      token.current++;
      setThinking(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, moves, over, state.turn]);

  useEffect(() => {
    if (over) playEnd();
  }, [over]);

  const start = () => {
    const color: Color = pick === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : pick;
    const g: Saved = { botId, color, sans: [], startedAt: Date.now() };
    saveJson(PREF_KEY, { botId, color: pick });
    setHint(null);
    setOrientation(color);
    setGame(g);
    apply(g, []);
  };

  const onMove = (m: XMove) => {
    if (!game || over || state.turn !== me) return;
    playMove(!!m.captured);
    setHint(null);
    apply(game, [...moves, m]);
  };

  const takeBack = () => {
    if (!game || !moves.length) return;
    token.current++;
    setThinking(false);
    setHint(null);
    // Undo back to the user's own last turn.
    let k = moves.length - 1;
    while (k > 0 && moves[k].color !== me) k--;
    const g = { ...game, resigned: false, savedId: undefined };
    setGame(g);
    apply(g, moves.slice(0, moves[k]?.color === me ? k : 0));
  };

  const askHint = async () => {
    if (!game || over || state.turn !== me || hinting) return;
    setHinting(true);
    try {
      const res = await getLiveEngine().search(fen, { nodes: 300_000 }, undefined, { supersede: true });
      setHint(res?.bestmove ?? null);
    } finally {
      setHinting(false);
    }
  };

  const resign = () => {
    if (!game || over) return;
    token.current++;
    setHint(null);
    const g = { ...game, resigned: true };
    setGame(g);
    persist(g, moves);
  };

  const newGame = () => {
    token.current++;
    setGame(null);
    setMoves([]);
    setHint(null);
    persist(null, []);
  };

  const review = async () => {
    if (!game || !end || !moves.length) return;
    let id = game.savedId;
    if (!id) {
      id = `bot:${game.startedAt}`;
      const white = me === 'w' ? 'You' : bot.name;
      const black = me === 'b' ? 'You' : bot.name;
      const d = new Date(game.startedAt);
      const date = `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}`;
      const sans = moves.map((m) => m.san);
      const det = getBook()?.detectFromSans(sans);
      const meta: GameMeta = {
        id,
        source: 'bot',
        white,
        black,
        whiteElo: me === 'w' ? undefined : bot.elo,
        blackElo: me === 'b' ? undefined : bot.elo,
        result: end.result,
        termination: game.resigned ? 'resigned' : state.outcome.reason === 'checkmate' ? 'checkmated' : state.outcome.reason,
        endTime: Date.now(),
        eco: det?.opening?.eco,
        opening: det?.opening?.name,
        plies: moves.length,
        me,
        pgn: buildPgn({ Event: `Game against ${bot.name}`, Site: 'Free Chess', Date: date, White: white, Black: black, Result: end.result }, sans),
      };
      await putGames([meta]);
      const g = { ...game, savedId: id };
      setGame(g);
      persist(g, moves);
    }
    go(reviewPath(id));
  };

  const live = useLiveEval(game && showEval ? fen : null, !!game && showEval, 1, 2_000_000);
  const shapes = useMemo<Shape[]>(() => (hint ? [arrowShape(hint.slice(0, 2), hint.slice(2, 4), 'green')] : []), [hint]);
  const last = moves.length ? moves[moves.length - 1] : null;
  const top: Color = orientation === 'w' ? 'b' : 'w';
  const bar = (c: Color) => (
    <PlayerBar
      name={game ? (c === me ? 'You' : bot.name) : c === 'w' ? 'White' : 'Black'}
      rating={game && c !== me ? bot.elo : undefined}
      color={c}
      fen={fen}
      active={!!game && !over && state.turn === c}
      extra={game && c !== me && thinking ? <Spinner size={12} /> : null}
    />
  );

  return (
    <div className="stage">
      <div className="board-col">
        <div className="board-fit">
          {bar(top)}
          <div className={`board-row${showEval && game ? '' : ' no-bar'}`}>
            {showEval && game && <EvalBar ev={live?.ev ?? null} orientation={orientation} />}
            <Board
              fen={fen}
              orientation={orientation}
              lastMove={last ? [last.from, last.to] : null}
              interactive={game && !over ? me : false}
              onMove={onMove}
              shapes={shapes}
            />
          </div>
          {bar(orientation)}
          {game && (
            <div className="controls">
              <button className="btn small" onClick={takeBack} disabled={!moves.some((m) => m.color === me)}>
                Take back
              </button>
              <button className="btn small" onClick={() => void askHint()} disabled={over || state.turn !== me || hinting}>
                <Icon name="hint" size={15} /> Hint
              </button>
              <button className="btn small" onClick={resign} disabled={over || !moves.length}>
                Resign
              </button>
              <span className="spacer" />
              <button className={`icon-btn${showEval ? ' on' : ''}`} title="Show the evaluation bar" onClick={() => setShowEval((v) => !v)}>
                <Icon name="engine" />
              </button>
              <button className="icon-btn" title="Flip board" onClick={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))}>
                <Icon name="flip" />
              </button>
            </div>
          )}
        </div>
      </div>

      <aside className="panel">
        {!game ? (
          <>
            <div className="panel-head">
              <div className="panel-title">
                <strong>Play the computer</strong>
                <span className="muted">Every level is open. Finished games can be reviewed like any other.</span>
              </div>
            </div>
            <div className="bot-list">
              {BOTS.map((b) => (
                <button key={b.id} className={`bot-card${botId === b.id ? ' on' : ''}`} onClick={() => setBotId(b.id)}>
                  <span className="bot-elo">{b.elo >= 3200 ? '3200+' : b.elo}</span>
                  <span className="bot-text">
                    <strong>{b.name}</strong>
                    <span className="muted">{b.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="row between wrap gap">
              <Segmented<Color | 'random'>
                value={pick}
                onChange={setPick}
                options={[
                  { value: 'w', label: 'White' },
                  { value: 'random', label: 'Random' },
                  { value: 'b', label: 'Black' },
                ]}
              />
              <button className="btn primary big" onClick={start}>
                Play
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="panel-head">
              <div className="panel-title">
                <strong>
                  You vs {bot.name} ({bot.elo >= 3200 ? '3200+' : bot.elo})
                </strong>
                <span className="muted">
                  {over ? 'Game over' : state.turn === me ? 'Your move' : `${bot.name} is thinking…`}
                </span>
              </div>
            </div>
            {end && (
              <div className="card tight result-card">
                <h3>{end.title}</h3>
                <p>{end.detail}</p>
                <div className="row gap wrap">
                  <button className="btn primary" onClick={() => void review()} disabled={!moves.length}>
                    Review this game
                  </button>
                  <button className="btn" onClick={start}>
                    Rematch
                  </button>
                  <button className="btn" onClick={newGame}>
                    Change opponent
                  </button>
                </div>
              </div>
            )}
            <MoveList startFen={START_FEN} moves={moves} ply={moves.length} onSelect={() => undefined} />
            {!over && (
              <button className="link" onClick={newGame}>
                Abandon and pick another opponent
              </button>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
