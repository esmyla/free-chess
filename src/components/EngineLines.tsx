import { numberLine, sanLine } from '../lib/chessutil';
import type { LiveEval } from '../lib/hooks';
import { formatEval, toWhitePov } from '../lib/winprob';
import type { Color } from '../lib/types';
import { Spinner } from './common';

/** The engine's current best lines for a position. Clicking a line plays its first move. */
export function EngineLines(props: { live: LiveEval | null; fen: string; onPick?: (uci: string) => void }) {
  const { live, fen } = props;
  const turn = fen.split(' ')[1] as Color;
  if (!live) {
    return (
      <div className="engine-lines">
        <div className="engine-head">
          <Spinner size={12} /> <span>Stockfish is thinking…</span>
        </div>
      </div>
    );
  }
  if (live.ev?.over) {
    return (
      <div className="engine-lines">
        <div className="engine-head">
          <span>{live.ev.over === 'draw' ? 'Game over: draw.' : `Checkmate. ${live.ev.over === 'w' ? 'White' : 'Black'} wins.`}</span>
        </div>
      </div>
    );
  }
  const speed = live.nps ? `${Math.round(live.nps / 1000)}k positions/s` : '';
  return (
    <div className="engine-lines">
      <div className="engine-head">
        {!live.done && <Spinner size={12} />}
        <span>
          Stockfish 19 · depth {live.depth}
          {speed ? ` · ${speed}` : ''}
        </span>
      </div>
      {live.lines.map((l) => {
        const ev = toWhitePov(l.score, turn);
        const sans = sanLine(fen, l.pv, 10);
        const white = (ev.mate ?? ev.cp ?? 0) >= 0;
        return (
          <button className="engine-line" key={l.multipv} onClick={() => props.onPick?.(l.pv[0])} title="Play the first move of this line">
            <span className={`ev-chip ${white ? 'white' : 'black'}`}>{formatEval(ev)}</span>
            <span className="line-moves">{numberLine(fen, sans)}</span>
          </button>
        );
      })}
    </div>
  );
}
