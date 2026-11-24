import type { Cls } from './types';

export interface ClsMeta {
  label: string;
  /** Short symbol shown in badges. The !, ?, !! family is standard chess annotation. */
  glyph: string;
  color: string;
  /** "a blunder", "an inaccuracy", "the best move"... */
  phrase: string;
}

export const CLS_META: Record<Cls, ClsMeta> = {
  brilliant: { label: 'Brilliant', glyph: '!!', color: '#a78bfa', phrase: 'brilliant' },
  great: { label: 'Great', glyph: '!', color: '#38bdf8', phrase: 'a great move' },
  best: { label: 'Best', glyph: '✓', color: '#4ade80', phrase: 'the best move' },
  excellent: { label: 'Excellent', glyph: '≈', color: '#86d99b', phrase: 'excellent' },
  good: { label: 'Good', glyph: '•', color: '#94a3b8', phrase: 'good' },
  book: { label: 'Book', glyph: '≡', color: '#d4a373', phrase: 'a book move' },
  forced: { label: 'Forced', glyph: '→', color: '#7c8698', phrase: 'forced' },
  inaccuracy: { label: 'Inaccuracy', glyph: '?!', color: '#facc15', phrase: 'an inaccuracy' },
  mistake: { label: 'Mistake', glyph: '?', color: '#fb923c', phrase: 'a mistake' },
  miss: { label: 'Miss', glyph: '×', color: '#f472b6', phrase: 'a missed chance' },
  blunder: { label: 'Blunder', glyph: '??', color: '#ef4444', phrase: 'a blunder' },
};

/** Order used in the summary table. */
export const CLS_ORDER: Cls[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'forced',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
];

/** Moves worth stopping on when skimming a game. */
export const KEY_CLS = new Set<Cls>(['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder']);

/** Moves offered again in "retry mistakes". */
export const RETRY_CLS = new Set<Cls>(['mistake', 'miss', 'blunder']);
