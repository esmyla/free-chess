import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { CLS_META } from '../lib/clsMeta';
import { capturedPieces, formatClock } from '../lib/chessutil';
import { formatEval, formatEvalShort, winPct, type Ev } from '../lib/winprob';
import type { Cls, Color } from '../lib/types';
import type { WDL } from '../lib/insights';
import type { Shape } from './Board';

// ---- Icons ------------------------------------------------------------------------------------

const ICONS: Record<string, ReactNode> = {
  games: (
    <>
      <rect x="3" y="4" width="18" height="4" rx="1.5" />
      <rect x="3" y="10" width="18" height="4" rx="1.5" />
      <rect x="3" y="16" width="18" height="4" rx="1.5" />
    </>
  ),
  analysis: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
      <path d="M7.5 11.5 10 9l2 2 2-3" />
    </>
  ),
  openings: (
    <>
      <path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5v13c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z" />
      <path d="M12 6v13" />
    </>
  ),
  puzzles: (
    <path d="M9 4h4v2.2a1.8 1.8 0 1 0 3 0V4h4v5h-2.2a1.8 1.8 0 1 0 0 3H20v8h-5v-2.2a1.8 1.8 0 1 0-3 0V20H4v-5h2.2a1.8 1.8 0 1 0 0-3H4V4z" transform="translate(0 0) scale(.96) translate(.5 .5)" />
  ),
  play: (
    <>
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M12 8V4.5" />
      <circle cx="12" cy="3.5" r="1.2" />
      <circle cx="9" cy="13" r="1.3" />
      <circle cx="15" cy="13" r="1.3" />
    </>
  ),
  insights: (
    <>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8 16v-5M12 16V8M16 16v-7" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </>
  ),
  first: <path d="M6 5v14M19 6l-9 6 9 6z" />,
  prev: <path d="M16 5 7 12l9 7z" />,
  next: <path d="m8 5 9 7-9 7z" />,
  last: <path d="M18 5v14M5 6l9 6-9 6z" />,
  flip: (
    <>
      <path d="M7 4v14M7 18l-3-3M7 18l3-3" />
      <path d="M17 20V6M17 6l-3 3M17 6l3 3" />
    </>
  ),
  engine: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  back: <path d="M14 6l-6 6 6 6" />,
  retry: (
    <>
      <path d="M4 12a8 8 0 1 0 2.6-5.9" />
      <path d="M4 4v5h5" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />,
  bolt: <path d="M13 3 5 14h6l-1 7 8-11h-6z" />,
  hint: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.300 1 2.100h5c0-.8.4-1.600 1-2.100A6 6 0 0 0 12 3z" />
    </>
  ),
};

export function Icon({ name, size = 20 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

// ---- Small pieces -----------------------------------------------------------------------------

export function ClsBadge({ cls, size = 18, title }: { cls: Cls; size?: number; title?: string }) {
  const m = CLS_META[cls];
  return (
    <span
      className="cls-badge"
      title={title ?? m.label}
      style={{ background: m.color, width: size, height: size, fontSize: size * (m.glyph.length > 1 ? 0.56 : 0.72) }}
    >
      {m.glyph}
    </span>
  );
}

/** Corner badge drawn on a board square. */
export function badgeShape(square: string, cls: Cls): Shape {
  const m = CLS_META[cls];
  return { orig: square as Shape['orig'], label: { text: m.glyph, fill: m.color } };
}

export function arrowShape(from: string, to: string, brush: 'green' | 'red' | 'blue' | 'yellow', thin = false): Shape {
  return {
    orig: from as Shape['orig'],
    dest: to as Shape['orig'],
    brush,
    modifiers: thin ? { lineWidth: 7 } : undefined,
  };
}

export function EvalBar({ ev, orientation }: { ev: Ev | null | undefined; orientation: Color }) {
  const w = ev ? winPct(ev, 'w') : 50;
  const whiteBetter = w >= 50;
  return (
    <div className={`evalbar${orientation === 'b' ? ' flip' : ''}`} title={ev ? `Evaluation ${formatEval(ev)}` : 'No evaluation yet'}>
      <div className="evalbar-white" style={{ height: `${w}%` }} />
      <div className="evalbar-mid" />
      {ev && <span className={`evalbar-label ${whiteBetter ? 'for-white' : 'for-black'}`}>{formatEvalShort(ev)}</span>}
    </div>
  );
}

const GLYPH: Record<string, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' };

export function PlayerBar(props: {
  name: string;
  rating?: number;
  color: Color;
  fen: string;
  clock?: number;
  active?: boolean;
  extra?: ReactNode;
}) {
  const cap = capturedPieces(props.fen);
  // Pieces this player has taken are the opponent's lost pieces.
  const taken = props.color === 'w' ? cap.b : cap.w;
  const lead = props.color === 'w' ? cap.diff : -cap.diff;
  return (
    <div className={`player-bar${props.active ? ' active' : ''}`}>
      <span className={`side-dot ${props.color === 'w' ? 'white' : 'black'}`} />
      <span className="player-name">{props.name}</span>
      {props.rating ? <span className="player-rating">{props.rating}</span> : null}
      <span className={`captured ${props.color === 'w' ? 'took-black' : 'took-white'}`}>
        {taken.map((p, i) => (
          <span key={i}>{GLYPH[p]}</span>
        ))}
        {lead > 0 && <span className="lead">+{lead}</span>}
      </span>
      <span className="spacer" />
      {props.extra}
      {props.clock !== undefined && <span className="clock">{formatClock(props.clock)}</span>}
    </div>
  );
}

export function WdlBar({ wdl, height = 10 }: { wdl: WDL; height?: number }) {
  if (!wdl.n) return <div className="wdl-bar none" style={{ height }} />;
  const pct = (v: number) => `${(v / wdl.n) * 100}%`;
  return (
    <div className="wdl-bar" style={{ height }} title={`${wdl.w} won, ${wdl.d} drawn, ${wdl.l} lost`}>
      <span className="wdl-w" style={{ width: pct(wdl.w) }} />
      <span className="wdl-d" style={{ width: pct(wdl.d) }} />
      <span className="wdl-l" style={{ width: pct(wdl.l) }} />
    </div>
  );
}

/** White / draw / black split, as used by the opening explorer. */
export function SplitBar({ white, draws, black }: { white: number; draws: number; black: number }) {
  const n = white + draws + black;
  if (!n) return <div className="split-bar none" />;
  const pct = (v: number) => (v / n) * 100;
  const label = (v: number) => (pct(v) >= 14 ? `${Math.round(pct(v))}%` : '');
  return (
    <div className="split-bar">
      <span className="split-w" style={{ width: `${pct(white)}%` }}>
        {label(white)}
      </span>
      <span className="split-d" style={{ width: `${pct(draws)}%` }}>
        {label(draws)}
      </span>
      <span className="split-b" style={{ width: `${pct(black)}%` }}>
        {label(black)}
      </span>
    </div>
  );
}

export function Segmented<T extends string | number>(props: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  small?: boolean;
}) {
  return (
    <div className={`segmented${props.small ? ' small' : ''}`} role="tablist">
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          role="tab"
          aria-selected={o.value === props.value}
          className={o.value === props.value ? 'on' : ''}
          title={o.title}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Working" />;
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%` }} />
    </div>
  );
}

/** Width of an element in CSS pixels, tracked across resizes. */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Scroll the element with `selector` inside `ref` into view whenever `dep` changes. */
export function useScrollTo(ref: RefObject<HTMLElement | null>, selector: string, dep: unknown): void {
  useEffect(() => {
    const target = ref.current?.querySelector(selector);
    if (target instanceof HTMLElement) target.scrollIntoView({ block: 'nearest' });
  }, [ref, selector, dep]);
}

export function useToast(): [ReactNode, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = (m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 4000);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [msg ? <div className="toast">{msg}</div> : null, show];
}
