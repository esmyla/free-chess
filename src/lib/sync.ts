// Keeps track of which monthly chess.com archives have been pulled in for a player.
import { archiveLabel, fetchArchives, fetchMonth, ImportError } from './chesscom';
import { kvGet, kvSet, listGames, putGames } from './db';

export interface SyncState {
  username: string;
  /** Every monthly archive chess.com lists for the player, oldest first. */
  archives: string[];
  /** Archives already downloaded in full. */
  loaded: string[];
}

const key = (u: string) => `sync:${u.trim().toLowerCase()}`;

export async function getSyncState(username: string): Promise<SyncState | null> {
  if (!username.trim()) return null;
  return (await kvGet<SyncState>(key(username))) ?? null;
}

export const monthsLeft = (s: SyncState | null): number => (s ? s.archives.filter((a) => !s.loaded.includes(a)).length : 0);

type Status = (msg: string) => void;

async function pull(state: SyncState, url: string, status: Status): Promise<number> {
  status(`Loading ${archiveLabel(url)}…`);
  const games = await fetchMonth(url, state.username);
  const added = await putGames(games);
  if (!state.loaded.includes(url)) state.loaded.push(url);
  await kvSet(key(state.username), state);
  return added;
}

/**
 * Refresh a player's games: always re-reads the newest month, and on a first visit keeps going
 * back until there is a decent number of games to look at.
 */
export async function syncLatest(username: string, status: Status): Promise<{ added: number; state: SyncState }> {
  const u = username.trim().toLowerCase();
  status('Looking up the player…');
  const archives = await fetchArchives(u);
  if (!archives.length) throw new ImportError('That player has no finished games on chess.com yet.');
  const prev = await getSyncState(u);
  const state: SyncState = { username: u, archives, loaded: (prev?.loaded ?? []).filter((a) => archives.includes(a)) };
  let added = await pull(state, archives[archives.length - 1], status);
  let have = (await listGames()).filter((g) => g.owner === u).length;
  let extra = 0;
  for (let i = archives.length - 2; i >= 0 && have < 40 && extra < 5; i--) {
    if (state.loaded.includes(archives[i])) continue;
    added += await pull(state, archives[i], status);
    have = (await listGames()).filter((g) => g.owner === u).length;
    extra++;
  }
  return { added, state };
}

/** Download up to `months` more archives, newest first. Pass Infinity for the full history. */
export async function loadOlder(
  username: string,
  months: number,
  status: Status,
  signal?: AbortSignal,
): Promise<{ added: number; state: SyncState }> {
  const state = await getSyncState(username);
  if (!state) throw new ImportError('Load this player first.');
  let added = 0;
  let n = 0;
  for (let i = state.archives.length - 1; i >= 0 && n < months; i--) {
    if (signal?.aborted) break;
    const url = state.archives[i];
    if (state.loaded.includes(url)) continue;
    added += await pull(state, url, status);
    n++;
  }
  return { added, state };
}
