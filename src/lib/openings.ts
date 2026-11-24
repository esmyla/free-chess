import { Chess } from 'chess.js';
import { posKey } from './poskey';

export interface OpeningName {
  eco: string;
  name: string;
}

export interface OpeningHit extends OpeningName {
  /** Number of moves (plies) into the game where the name applies. */
  ply: number;
}

interface RawBook {
  names: Record<string, [string, string, number]>;
  book: string[];
}

/** Opening names and known theory positions, built from the Lichess opening list (CC0). */
export class Book {
  private names: Map<string, [string, string, number]>;
  private known: Set<string>;

  constructor(raw: RawBook) {
    this.names = new Map(Object.entries(raw.names));
    this.known = new Set(raw.book);
  }

  lookup(fen: string): OpeningName | undefined {
    const hit = this.names.get(posKey(fen));
    return hit ? { eco: hit[0], name: hit[1] } : undefined;
  }

  isBook(fen: string): boolean {
    const k = posKey(fen);
    return this.names.has(k) || this.known.has(k);
  }

  /**
   * Walk a game's positions (fens[0] is the start). Returns how many leading moves are theory and
   * the most specific opening name reached.
   */
  detect(fens: string[]): { bookPlies: number; opening?: OpeningHit } {
    let bookPlies = 0;
    let opening: OpeningHit | undefined;
    for (let i = 1; i < fens.length; i++) {
      const k = posKey(fens[i]);
      const named = this.names.get(k);
      if (!named && !this.known.has(k)) break;
      bookPlies = i;
      if (named) opening = { eco: named[0], name: named[1], ply: i };
    }
    return { bookPlies, opening };
  }

  /** Same as detect, but from SAN moves played from the normal starting position. */
  detectFromSans(sans: string[], maxPlies = 40): { bookPlies: number; opening?: OpeningHit } {
    const chess = new Chess();
    let bookPlies = 0;
    let opening: OpeningHit | undefined;
    for (let i = 0; i < Math.min(sans.length, maxPlies); i++) {
      try {
        chess.move(sans[i]);
      } catch {
        break;
      }
      const k = posKey(chess.fen());
      const named = this.names.get(k);
      if (!named && !this.known.has(k)) break;
      bookPlies = i + 1;
      if (named) opening = { eco: named[0], name: named[1], ply: i + 1 };
    }
    return { bookPlies, opening };
  }
}

let book: Book | null = null;
let loading: Promise<Book | null> | null = null;

/** Loads the opening book once. Resolves to null if the data file is missing. */
export function loadBook(): Promise<Book | null> {
  if (book) return Promise.resolve(book);
  if (!loading) {
    loading = fetch(`${import.meta.env.BASE_URL}data/openings.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((raw: RawBook) => (book = new Book(raw)))
      .catch((err) => {
        console.warn('Opening book unavailable:', err);
        return null;
      });
  }
  return loading;
}

/** The book if it has finished loading, otherwise null. */
export const getBook = (): Book | null => book;

/** "Sicilian Defense: Najdorf Variation" -> "Sicilian Defense" */
export const openingFamily = (name: string): string => name.split(':')[0].trim();
