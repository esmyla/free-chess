// Everything the app remembers lives in this browser's IndexedDB: games, reviews, small settings.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { GameAnalysis, GameMeta, ReviewSummary } from './types';

interface Schema extends DBSchema {
  games: { key: string; value: GameMeta; indexes: { endTime: number } };
  analyses: { key: string; value: GameAnalysis };
  kv: { key: string; value: unknown };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;

function db(): Promise<IDBPDatabase<Schema>> {
  if (!dbp) {
    dbp = openDB<Schema>('free-chess', 1, {
      upgrade(d) {
        const games = d.createObjectStore('games', { keyPath: 'id' });
        games.createIndex('endTime', 'endTime');
        d.createObjectStore('analyses', { keyPath: 'gameId' });
        d.createObjectStore('kv');
      },
    });
  }
  return dbp;
}

const listeners = new Set<() => void>();

/** Subscribe to "the stored games changed". Returns an unsubscribe function. */
export function onGamesChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const notify = () => listeners.forEach((l) => l());

/** Insert or refresh games, keeping any review summary already stored for them. Returns how many were new. */
export async function putGames(games: GameMeta[]): Promise<number> {
  if (!games.length) return 0;
  const d = await db();
  const tx = d.transaction('games', 'readwrite');
  let added = 0;
  for (const g of games) {
    const old = await tx.store.get(g.id);
    if (!old) added++;
    await tx.store.put(old?.summary && !g.summary ? { ...g, summary: old.summary } : g);
  }
  await tx.done;
  notify();
  return added;
}

export async function getGame(id: string): Promise<GameMeta | undefined> {
  return (await db()).get('games', id);
}

/** All stored games, newest first. */
export async function listGames(): Promise<GameMeta[]> {
  const all = await (await db()).getAll('games');
  return all.sort((a, b) => b.endTime - a.endTime);
}

export async function deleteGame(id: string): Promise<void> {
  const d = await db();
  await d.delete('games', id);
  await d.delete('analyses', id);
  notify();
}

export async function getAnalysis(gameId: string): Promise<GameAnalysis | undefined> {
  return (await db()).get('analyses', gameId);
}

export async function putAnalysis(a: GameAnalysis, summary: ReviewSummary): Promise<void> {
  const d = await db();
  await d.put('analyses', a);
  const g = await d.get('games', a.gameId);
  if (g) await d.put('games', { ...g, summary });
  notify();
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('kv', key)) as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await db()).put('kv', value, key);
}

/** Wipe games and reviews (settings and puzzle progress live in localStorage and are kept). */
export async function clearGames(): Promise<void> {
  const d = await db();
  await d.clear('games');
  await d.clear('analyses');
  await d.clear('kv');
  notify();
}
