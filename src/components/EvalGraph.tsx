import { useRef } from 'react';
import { CLS_META, KEY_CLS } from '../lib/clsMeta';
import { clamp } from '../lib/chessutil';
import { winPct } from '../lib/winprob';
import type { MoveInfo, PosEval } from '../lib/types';
import { useWidth } from './common';

/** Winning chances across the game: White's share is the light area. Click or drag to jump to a move. */
export function EvalGraph(props: {
  evals: (PosEval | undefined)[];
  moves?: MoveInfo[];
  ply: number;
  onSelect: (ply: number) => void;
  height?: number;
}) {
  const { evals, moves, ply, onSelect, height = 88 } = props;
  const ref = useRef<HTMLDivElement>(null);
  const W = useWidth(ref);
  const H = height;
  const n = evals.length;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : 0);
  const y = (win: number) => H - (win / 100) * H;

  const pts: [number, number][] = [];
  evals.forEach((e, i) => {
    if (e) pts.push([x(i), y(winPct(e, 'w'))]);
  });
  let area = '';
  let line = '';
  if (pts.length > 1) {
    line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
    area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;
  }

  const pick = (clientX: number) => {
    const el = ref.current;
    if (!el || n < 2) return;
    const r = el.getBoundingClientRect();
    onSelect(clamp(Math.round(((clientX - r.left) / r.width) * (n - 1)), 0, n - 1));
  };

  const cur = evals[ply];
  return (
    <div
      ref={ref}
      className="eval-graph"
      style={{ height: H }}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        pick(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) pick(e.clientX);
      }}
    >
      {W > 0 && (
        <svg width={W} height={H} role="img" aria-label="Evaluation across the game">
          {area && <path d={area} className="eg-area" />}
          <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="eg-mid" />
          {line && <path d={line} className="eg-line" />}
          {moves?.map((m, i) => {
            const e = evals[i + 1];
            if (!e || !KEY_CLS.has(m.cls)) return null;
            return (
              <circle
                key={i}
                cx={x(i + 1)}
                cy={clamp(y(winPct(e, 'w')), 4, H - 4)}
                r={3.4}
                fill={CLS_META[m.cls].color}
                className="eg-dot"
              />
            );
          })}
          <line x1={x(ply)} x2={x(ply)} y1={0} y2={H} className="eg-cursor" />
          {cur && <circle cx={x(ply)} cy={clamp(y(winPct(cur, 'w')), 4, H - 4)} r={4.2} className="eg-cursor-dot" />}
        </svg>
      )}
    </div>
  );
}
