// Opening explorer data: the Lichess public explorer (masters and online games) and a local
// tree built from the user's own imported games.
import { quickSans } from './pgn';
import { outcomeFor } from './insights';
import type { Color, GameMeta } from './types';

export interface ExplorerMove {
  san: string;
  uci?: string;
  white: number;
  draws: number;
  black: number;
  total: number;
  avgRating?: number;
}

export interface ExplorerResult {
  white: number;
  draws: number;
  black: number;
  total: number;
  moves: ExplorerMove[];
  opening?: { eco: string; name: string };
}

export type ExplorerDb = 'masters' | 'lichess';

interface RawExplorer {
  white: number;
  draws: number;
  black: number;
  moves: { uci: string; san: string; white: number; draws: number; black: number; averageRating?: number }[];
  opening?: { eco: string; name: string } | null;
}

const cache = new Map<string, Promise<ExplorerResult>>();

/** Statistics for a position from the Lichess opening explorer. Results are cached for the session. */
export function fetchExplorer(db: ExplorerDb, fen: string): Promise<ExplorerResult> {
  const key = `${db}|${fen}`;
  let p = cache.get(key);
  if (!p) {
    const q = new URLSearchParams({ fen, moves: '14', topGames: '0' });
    if (db === 'lichess') {
      q.set('variant', 'standard');
      q.set('recentGames', '0');
      q.set('speeds', 'blitz,rapid,classical');
      q.set('ratings', '1400,1600,1800,2000,2200,2500');
    }
    p = fetch(`https://explorer.lichess.ovh/${db}?${q}`)
      .then((r) => {
        if (r.status === 429) throw new Error('The explorer is rate-limiting requests. Wait a moment.');
        if (!r.ok) throw new Error(`Explorer error (HTTP ${r.status}).`);
        return r.json() as Promise<RawExplorer>;
      })
      .then((d) => ({
        white: d.white,
        draws: d.draws,
        black: d.black,
        total: d.white + d.draws + d.black,
        opening: d.opening ?? undefined,
        moves: d.moves.map((m) => ({
          san: m.san,
          uci: m.uci,
          white: m.white,
          draws: m.draws,
          black: m.black,
          total: m.white + m.draws + m.black,
          avgRating: m.averageRating,
        })),
      }));
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

// ---- The user's own games ---------------------------------------------------------------------

export interface TrieNode {
  white: number;
  draws: number;
  black: number;
  kids: Map<string, TrieNode>;
}

const node = (): TrieNode => ({ white: 0, draws: 0, black: 0, kids: new Map() });

/**
 * Move tree of the user's games as one colour. Keyed by move sequence, so it is instant to build
 * even for thousands of games (transpositions are not merged).
 */
export function buildTrie(games: GameMeta[], color: Color, maxPlies = 36): TrieNode {
  const root = node();
  for (const g of games) {
    if (g.me !== color || outcomeFor(g) === null) continue;
    const sans = quickSans(g.pgn).slice(0, maxPlies);
    let cur = root;
    const bump = (n: TrieNode) => {
      if (g.result === '1-0') n.white++;
      else if (g.result === '0-1') n.black++;
      else n.draws++;
    };
    bump(cur);
    for (const san of sans) {
      let next = cur.kids.get(san);
      if (!next) cur.kids.set(san, (next = node()));
      bump(next);
      cur = next;
    }
  }
  return root;
}

export function trieResult(root: TrieNode, sans: string[]): ExplorerResult | null {
  let cur: TrieNode | undefined = root;
  for (const san of sans) {
    cur = cur.kids.get(san);
    if (!cur) return null;
  }
  const moves: ExplorerMove[] = [...cur.kids.entries()]
    .map(([san, n]) => ({ san, white: n.white, draws: n.draws, black: n.black, total: n.white + n.draws + n.black }))
    .sort((a, b) => b.total - a.total);
  return { white: cur.white, draws: cur.draws, black: cur.black, total: cur.white + cur.draws + cur.black, moves };
}
