import { useRef } from 'react';
import { KEY_CLS } from '../lib/clsMeta';
import type { MoveInfo, XMove } from '../lib/types';
import { ClsBadge, useScrollTo } from './common';

/** Two-column move list. `ply` is the number of moves played in the position being shown. */
export function MoveList(props: {
  startFen: string;
  moves: XMove[];
  infos?: MoveInfo[];
  ply: number;
  onSelect: (ply: number) => void;
  /** Show a badge on every graded move rather than only the notable ones. */
  allBadges?: boolean;
}) {
  const { startFen, moves, infos, ply, onSelect } = props;
  const ref = useRef<HTMLDivElement>(null);
  useScrollTo(ref, '.mv.on', ply);

  const parts = startFen.split(' ');
  const blackStarts = parts[1] === 'b';
  const firstNum = Number(parts[5]) || 1;
  const rows: { num: number; w?: number; b?: number }[] = [];
  moves.forEach((_, i) => {
    const abs = i + (blackStarts ? 1 : 0);
    const r = Math.floor(abs / 2);
    rows[r] ??= { num: firstNum + r };
    if (abs % 2 === 0) rows[r].w = i;
    else rows[r].b = i;
  });

  const cell = (i: number | undefined) => {
    if (i === undefined) return <span className="mv blank" />;
    const info = infos?.[i];
    const badge = info && (props.allBadges || KEY_CLS.has(info.cls));
    return (
      <button className={`mv${ply === i + 1 ? ' on' : ''}`} onClick={() => onSelect(i + 1)}>
        <span className="mv-san">{moves[i].san}</span>
        {badge && <ClsBadge cls={info.cls} size={15} />}
      </button>
    );
  };

  if (!moves.length) return <div className="move-list empty-note">No moves yet.</div>;
  return (
    <div className="move-list" ref={ref}>
      {rows.map((r) => (
        <div className="mv-row" key={r.num}>
          <span className="mv-num">{r.num}.</span>
          {cell(r.w)}
          {cell(r.b)}
        </div>
      ))}
    </div>
  );
}
