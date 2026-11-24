import { useRef } from 'react';
import { useWidth } from './common';
import { scoreOf, type WDL } from '../lib/insights';

/** Simple line chart for a value over time (or over an index when `t` is just a counter). */
export function LineChart(props: {
  points: { t: number; v: number }[];
  height?: number;
  color?: string;
  /** Use the point index for x instead of its time, so busy days do not bunch up. */
  byIndex?: boolean;
  format?: (v: number) => string;
  smooth?: number;
}) {
  const { points, height = 150, color = 'var(--accent)', format = (v) => String(Math.round(v)) } = props;
  const ref = useRef<HTMLDivElement>(null);
  const W = useWidth(ref);
  const H = height;
  const padL = 40;
  const padR = 10;
  const padT = 10;
  const padB = 20;

  let pts = points;
  const k = props.smooth ?? 0;
  if (k > 1 && pts.length > k) {
    // Trailing moving average to show the trend through noisy game-by-game values.
    pts = pts.map((p, i) => {
      const from = Math.max(0, i - k + 1);
      const win = points.slice(from, i + 1);
      return { t: p.t, v: win.reduce((a, b) => a + b.v, 0) / win.length };
    });
  }
  if (pts.length < 2) {
    return (
      <div ref={ref} className="chart empty-note" style={{ height: H }}>
        Not enough games yet.
      </div>
    );
  }
  const vs = pts.map((p) => p.v);
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (hi - lo < 1) {
    hi += 1;
    lo -= 1;
  }
  const span = hi - lo;
  lo -= span * 0.08;
  hi += span * 0.08;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const x = (p: { t: number }, i: number) =>
    padL + (props.byIndex || t1 === t0 ? i / (pts.length - 1) : (p.t - t0) / (t1 - t0)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p, i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const ticks = [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1];
  const date = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
  const last = pts[pts.length - 1];

  return (
    <div ref={ref} className="chart" style={{ height: H }}>
      {W > 0 && (
        <svg width={W} height={H}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="chart-label">
                {format(t)}
              </text>
            </g>
          ))}
          <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
          <circle cx={x(last, pts.length - 1)} cy={y(last.v)} r={3.5} fill={color} />
          <text x={padL} y={H - 4} className="chart-label">
            {date(t0)}
          </text>
          <text x={W - padR} y={H - 4} textAnchor="end" className="chart-label">
            {date(t1)}
          </text>
        </svg>
      )}
    </div>
  );
}

/** Score (wins plus half of draws) per bucket as vertical bars; bar opacity fades for tiny samples. */
export function ScoreBars(props: { data: { label: string; wdl: WDL }[]; height?: number }) {
  const { data, height = 120 } = props;
  const max = Math.max(1, ...data.map((d) => d.wdl.n));
  return (
    <div className="score-bars" style={{ height }}>
      {data.map((d, i) => {
        const s = scoreOf(d.wdl);
        return (
          <div className="score-bar" key={i} title={d.wdl.n ? `${d.label}: ${Math.round(s * 100)}% score over ${d.wdl.n} games` : `${d.label}: no games`}>
            <div className="score-bar-track">
              {d.wdl.n > 0 && (
                <div
                  className={`score-bar-fill ${s >= 0.5 ? 'good' : 'bad'}`}
                  style={{ height: `${Math.max(4, s * 100)}%`, opacity: 0.35 + 0.65 * Math.min(1, d.wdl.n / (max * 0.5)) }}
                />
              )}
              <div className="score-bar-half" />
            </div>
            <span className="score-bar-label">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}
