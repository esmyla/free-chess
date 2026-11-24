// Reads a player's finished games from chess.com's public, read-only "Published Data" API.
// No login or key is involved: these are the same public archives anyone can open.
import { Chess } from 'chess.js';
import { loadBook } from './openings';
import { headerOf, normalizeResult, pgnDate, pgnId, quickSans, splitPgn } from './pgn';
import type { Color, GameMeta, Result } from './types';

const API = 'https://api.chess.com/pub';

interface CcSide {
  username: string;
  rating: number;
  result: string;
}

interface CcGame {
  url: string;
  uuid?: string;
  pgn?: string;
  time_control?: string;
  time_class?: string;
  end_time: number;
  rated?: boolean;
  rules?: string;
  white: CcSide;
  black: CcSide;
}

export class ImportError extends Error {}

async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new ImportError('Could not reach chess.com. Check your internet connection.');
  }
  if (res.status === 404) throw new ImportError('chess.com has no player with that username.');
  if (res.status === 429) throw new ImportError('chess.com is rate-limiting requests. Wait a minute and try again.');
  if (!res.ok) throw new ImportError(`chess.com answered with an error (HTTP ${res.status}).`);
  return res.json() as Promise<T>;
}

const clean = (u: string): string => u.trim().toLowerCase();

/** Monthly archive URLs for a player, oldest first. */
export async function fetchArchives(username: string): Promise<string[]> {
  const data = await getJson<{ archives?: string[] }>(`${API}/player/${encodeURIComponent(clean(username))}/games/archives`);
  return data.archives ?? [];
}

export interface PlayerStats {
  rapid?: number;
  blitz?: number;
  bullet?: number;
  daily?: number;
}

export async function fetchStats(username: string): Promise<PlayerStats> {
  const d = await getJson<Record<string, { last?: { rating?: number } }>>(
    `${API}/player/${encodeURIComponent(clean(username))}/stats`,
  );
  return {
    rapid: d.chess_rapid?.last?.rating,
    blitz: d.chess_blitz?.last?.rating,
    bullet: d.chess_bullet?.last?.rating,
    daily: d.chess_daily?.last?.rating,
  };
}

/** Games of one monthly archive, converted to the app's format. Variants are skipped. */
export async function fetchMonth(url: string, username: string): Promise<GameMeta[]> {
  const me = clean(username);
  const [data, book] = await Promise.all([getJson<{ games?: CcGame[] }>(url), loadBook()]);
  const out: GameMeta[] = [];
  for (const g of data.games ?? []) {
    if (!g.pgn || (g.rules && g.rules !== 'chess')) continue;
    if (headerOf(g.pgn, 'SetUp') === '1') continue; // odd starting positions
    const result: Result = g.white.result === 'win' ? '1-0' : g.black.result === 'win' ? '0-1' : '1/2-1/2';
    const termination = result === '1-0' ? g.black.result : g.white.result;
    const sans = quickSans(g.pgn);
    const det = book?.detectFromSans(sans);
    const mine: Color | null = clean(g.white.username) === me ? 'w' : clean(g.black.username) === me ? 'b' : null;
    out.push({
      id: `cc:${g.uuid ?? g.url}`,
      source: 'chesscom',
      url: g.url,
      white: g.white.username,
      black: g.black.username,
      whiteElo: g.white.rating,
      blackElo: g.black.rating,
      result,
      termination,
      timeClass: g.time_class,
      timeControl: g.time_control,
      rated: g.rated,
      endTime: g.end_time * 1000,
      eco: det?.opening?.eco ?? headerOf(g.pgn, 'ECO'),
      opening: det?.opening?.name,
      plies: sans.length,
      me: mine,
      owner: me,
      pgn: g.pgn,
    });
  }
  return out;
}

/** Turn pasted or uploaded PGN text into game records. Returns the games plus how many could not be read. */
export async function gamesFromPgn(text: string, username: string): Promise<{ games: GameMeta[]; failed: number }> {
  const me = clean(username);
  const book = await loadBook();
  const games: GameMeta[] = [];
  let failed = 0;
  for (const pgn of splitPgn(text)) {
    try {
      const chess = new Chess();
      chess.loadPgn(pgn);
      const h = chess.getHeaders();
      const sans = chess.history();
      if (!sans.length) {
        failed++;
        continue;
      }
      const standard = !h.FEN;
      const det = standard ? book?.detectFromSans(sans) : undefined;
      const white = h.White && h.White !== '?' ? h.White : 'White';
      const black = h.Black && h.Black !== '?' ? h.Black : 'Black';
      const mine: Color | null = me && clean(white) === me ? 'w' : me && clean(black) === me ? 'b' : null;
      const num = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
      games.push({
        id: pgnId(pgn),
        source: 'pgn',
        url: h.Link || (h.Site?.startsWith('http') ? h.Site : undefined),
        white,
        black,
        whiteElo: num(h.WhiteElo),
        blackElo: num(h.BlackElo),
        result: normalizeResult(h.Result),
        termination: h.Termination,
        timeControl: h.TimeControl,
        endTime: pgnDate(h.UTCDate ?? h.Date, h.UTCTime ?? h.EndTime) ?? Date.now(),
        eco: det?.opening?.eco ?? h.ECO,
        opening: det?.opening?.name ?? h.Opening,
        plies: sans.length,
        me: mine,
        pgn,
      });
    } catch {
      failed++;
    }
  }
  return { games, failed };
}

/** "2026/11" from an archive URL. */
export const archiveLabel = (url: string): string => url.split('/').slice(-2).join('/');
