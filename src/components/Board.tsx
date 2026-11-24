import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import type { Color, XMove } from '../lib/types';
import { toXMove } from '../lib/chessutil';
import { useSettings } from '../lib/store';

export type Shape = DrawShape;

export interface BoardProps {
  fen: string;
  orientation?: Color;
  /** Squares of the move that led to this position, for highlighting. */
  lastMove?: [string, string] | null;
  /** Who may move pieces: true = whoever is to move, a colour = only that side, false = nobody. */
  interactive?: boolean | Color;
  /** Called with a legal move the user made. The board then shows whatever `fen` it is given next. */
  onMove?: (move: XMove) => void;
  shapes?: Shape[];
}

const cgColor = (c: Color) => (c === 'w' ? 'white' : 'black');
const PROMO: [string, string][] = [
  ['q', 'queen'],
  ['r', 'rook'],
  ['b', 'bishop'],
  ['n', 'knight'],
];

/** Chessboard: renders a position, lets the user make legal moves, and draws arrows and badges. */
export function Board({ fen, orientation = 'w', lastMove, interactive = false, onMove, shapes }: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string; color: Color } | null>(null);
  const [tick, setTick] = useState(0);
  const { showCoords } = useSettings();
  const latest = useRef({ fen, onMove });
  latest.current = { fen, onMove };
  const layoutKey = `${orientation}${showCoords}`;
  const prevLayout = useRef(layoutKey);

  useEffect(() => {
    const cg = Chessground(el.current!, {
      animation: { enabled: true, duration: 160 },
      movable: { free: false, showDests: true, rookCastle: false },
      premovable: { enabled: false },
      draggable: { showGhost: true },
      highlight: { lastMove: true, check: true },
      drawable: { enabled: true, eraseOnClick: true },
      coordinates: true,
    });
    api.current = cg;
    const ro = new ResizeObserver(() => cg.redrawAll());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      cg.destroy();
      api.current = null;
    };
  }, []);

  const info = useMemo(() => {
    try {
      const chess = new Chess(fen);
      const dests = new Map<Key, Key[]>();
      for (const m of chess.moves({ verbose: true })) {
        const list = dests.get(m.from as Key);
        if (list) {
          if (!list.includes(m.to as Key)) list.push(m.to as Key);
        } else dests.set(m.from as Key, [m.to as Key]);
      }
      return { turn: chess.turn() as Color, check: chess.isCheck(), dests };
    } catch {
      return { turn: 'w' as Color, check: false, dests: new Map<Key, Key[]>() };
    }
  }, [fen]);

  const commit = (from: string, to: string, promotion?: string) => {
    const cur = latest.current;
    try {
      const chess = new Chess(cur.fen);
      const m = chess.move({ from, to, promotion });
      cur.onMove?.(toXMove(m));
    } catch {
      /* illegal: fall through and let the board snap back */
    }
    setTick((t) => t + 1);
  };

  const lm0 = lastMove?.[0];
  const lm1 = lastMove?.[1];

  useEffect(() => {
    const cg = api.current;
    if (!cg) return;
    const turnColor = cgColor(info.turn);
    const who = interactive === true ? info.turn : interactive || null;
    const canMove = !!who && who === info.turn && !promo;
    cg.set({
      fen,
      orientation: cgColor(orientation),
      turnColor,
      check: info.check ? turnColor : false,
      lastMove: lm0 && lm1 ? [lm0 as Key, lm1 as Key] : undefined,
      coordinates: showCoords,
      movable: {
        color: canMove ? turnColor : undefined,
        dests: canMove ? info.dests : new Map(),
        events: {
          after: (orig, dest) => {
            const piece = new Chess(latest.current.fen).get(orig as Square);
            if (piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1')) {
              setPromo({ from: orig, to: dest, color: piece.color });
              return;
            }
            commit(orig, dest);
          },
        },
      },
    });
    if (prevLayout.current !== layoutKey) {
      // Coordinates are only re-rendered on a full redraw.
      prevLayout.current = layoutKey;
      cg.redrawAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, orientation, lm0, lm1, interactive, info, tick, promo, showCoords]);

  useEffect(() => {
    api.current?.setAutoShapes(shapes ?? []);
  }, [shapes, fen, tick]);

  return (
    <div className="board-box">
      <div ref={el} className="cg-host" />
      {promo && (
        <div
          className="promo-backdrop"
          onClick={() => {
            setPromo(null);
            setTick((t) => t + 1);
          }}
        >
          <div className="promo-picker cg-wrap" onClick={(e) => e.stopPropagation()}>
            {PROMO.map(([p, role]) => (
              <button
                key={p}
                className="promo-btn"
                title={`Promote to ${role}`}
                onClick={() => {
                  const pr = promo;
                  setPromo(null);
                  commit(pr.from, pr.to, p);
                }}
                dangerouslySetInnerHTML={{ __html: `<piece class="${role} ${cgColor(promo.color)}"></piece>` }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
