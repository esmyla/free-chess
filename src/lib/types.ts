export type Color = 'w' | 'b';

/** How a move is graded in a review. */
export type Cls =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder'
  | 'forced';

export type Phase = 'opening' | 'middlegame' | 'endgame';

export type Result = '1-0' | '0-1' | '1/2-1/2' | '*';

export interface SideStats<T> {
  w: T;
  b: T;
}

/** Compact review result kept on the game record so lists and insights stay cheap. */
export interface ReviewSummary {
  acc: SideStats<number>;
  counts: SideStats<Partial<Record<Cls, number>>>;
  phaseAcc: SideStats<Partial<Record<Phase, number>>>;
  est?: SideStats<number>;
}

export interface GameMeta {
  id: string;
  source: 'chesscom' | 'pgn' | 'bot';
  url?: string;
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  result: Result;
  /** How the game ended, in chess.com's vocabulary: checkmated, resigned, timeout, agreed... */
  termination?: string;
  timeClass?: string;
  timeControl?: string;
  rated?: boolean;
  /** When the game finished, ms since epoch. */
  endTime: number;
  eco?: string;
  opening?: string;
  plies: number;
  /** Which side the app's user played, when known. */
  me?: Color | null;
  /** Lower-cased username the game was imported for. */
  owner?: string;
  pgn: string;
  summary?: ReviewSummary;
}

/** Engine verdict on one position. All scores are from White's point of view. */
export interface PosEval {
  cp?: number;
  mate?: number;
  /** Set when the position is already decided on the board. */
  over?: 'w' | 'b' | 'draw';
  /** Best move, UCI. */
  best?: string;
  pv?: string[];
  /** Second-best line. */
  alt?: { cp?: number; mate?: number; move: string };
  depth: number;
}

export interface MoveInfo {
  cls: Cls;
  /** Winning chances given up by this move, in percentage points, from the mover's side. */
  loss: number;
  acc: number;
  winBefore: number;
  winAfter: number;
  phase: Phase;
  bestSan?: string;
  /** Best continuation from the position before the move (SAN). */
  bestLine?: string[];
  /** Expected continuation after the move that was played (SAN). */
  replyLine?: string[];
  text: string;
}

export interface GameAnalysis {
  gameId: string;
  v: number;
  nodes: number;
  createdAt: number;
  evals: PosEval[];
  moves: MoveInfo[];
  accuracy: SideStats<number>;
  counts: SideStats<Partial<Record<Cls, number>>>;
  phaseAcc: SideStats<Partial<Record<Phase, number>>>;
  opening?: { eco: string; name: string; ply: number };
  bookPlies: number;
  est?: SideStats<number>;
}

/** A move with everything the UI needs to show and replay it. */
export interface XMove {
  san: string;
  uci: string;
  from: string;
  to: string;
  promotion?: string;
  color: Color;
  piece: string;
  captured?: string;
  before: string;
  after: string;
  /** Seconds left on the mover's clock after the move, when the PGN has it. */
  clk?: number;
}

export interface PGame {
  headers: Record<string, string>;
  startFen: string;
  moves: XMove[];
  /** Position before each move, plus the final position: moves.length + 1 entries. */
  fens: string[];
}

export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');
