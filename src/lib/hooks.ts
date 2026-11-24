import { useEffect, useRef, useState } from 'react';
import { getLiveEngine, type PvLine } from './engine';
import { listGames, onGamesChanged } from './db';
import { terminalEval } from './reviewCore';
import { toWhitePov, type Ev } from './winprob';
import { getBook, loadBook, type Book } from './openings';
import type { Color, GameMeta } from './types';

export interface LiveEval {
  fen: string;
  lines: PvLine[];
  /** Best line's score from White's point of view. */
  ev: Ev | null;
  depth: number;
  nps: number;
  done: boolean;
}

/**
 * Keeps the live engine analysing `fen` and reports its lines a few times a second.
 * Pass a null fen or enabled=false to switch it off.
 */
export function useLiveEval(fen: string | null, enabled: boolean, multipv: number, maxNodes = 8_000_000): LiveEval | null {
  const [state, setState] = useState<LiveEval | null>(null);

  useEffect(() => {
    if (!fen || !enabled) {
      setState(null);
      return;
    }
    const over = terminalEval(fen);
    if (over) {
      setState({ fen, lines: [], ev: over, depth: 0, nps: 0, done: true });
      return;
    }
    const turn = fen.split(' ')[1] as Color;
    const engine = getLiveEngine();
    let cancelled = false;
    let last = 0;
    let pending: number | undefined;
    const publish = (lines: PvLine[], done: boolean) => {
      if (cancelled || !lines.length) return;
      const top = lines.find((l) => l.multipv === 1) ?? lines[0];
      setState({ fen, lines, ev: toWhitePov(top.score, turn), depth: top.depth, nps: top.nps ?? 0, done });
    };
    setState((s) => (s && s.fen === fen ? s : null));
    engine
      .search(
        fen,
        { nodes: maxNodes, multipv },
        (lines) => {
          const copy = lines.slice();
          const now = performance.now();
          window.clearTimeout(pending);
          if (now - last > 140) {
            last = now;
            publish(copy, false);
          } else {
            pending = window.setTimeout(() => publish(copy, false), 150);
          }
        },
        { supersede: true },
      )
      .then((res) => {
        window.clearTimeout(pending);
        if (res) publish(res.lines, true);
      })
      .catch((err) => console.error('Live analysis failed:', err));
    return () => {
      cancelled = true;
      window.clearTimeout(pending);
      engine.stop();
    };
  }, [fen, enabled, multipv, maxNodes]);

  return state && state.fen === fen ? state : null;
}

/** All stored games, newest first, kept in sync with the database. */
export function useGames(): { games: GameMeta[]; loaded: boolean } {
  const [games, setGames] = useState<GameMeta[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      listGames()
        .then((g) => {
          if (alive) {
            setGames(g);
            setLoaded(true);
          }
        })
        .catch((e) => {
          console.error('Could not read stored games:', e);
          if (alive) setLoaded(true);
        });
    void refresh();
    const off = onGamesChanged(() => void refresh());
    return () => {
      alive = false;
      off();
    };
  }, []);
  return { games, loaded };
}

/** The opening book once it has loaded (null before that). */
export function useBook(): Book | null {
  const [book, setBook] = useState<Book | null>(getBook());
  useEffect(() => {
    let alive = true;
    void loadBook().then((b) => alive && setBook(b));
    return () => {
      alive = false;
    };
  }, []);
  return book;
}

/** Window-level key handler that ignores typing in form fields. */
export function useKeys(handler: (e: KeyboardEvent) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      ref.current(e);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
}
