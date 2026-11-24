import { Chess } from 'chess.js';
import { cyrb53 } from './poskey';
import { toXMove } from './chessutil';
import type { PGame, Result } from './types';

function parseClock(comment: string): number | undefined {
  const m = /\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/.exec(comment);
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Full parse of one PGN game. Throws when the PGN is not a legal game. */
export function parsePgn(pgn: string): PGame {
  const chess = new Chess();
  chess.loadPgn(pgn.trim());
  const headers = chess.getHeaders();
  const comments = new Map<string, string>();
  for (const c of chess.getComments()) comments.set(c.fen, c.comment);
  const hist = chess.history({ verbose: true });
  const moves = hist.map((m) => {
    const c = comments.get(m.after);
    return toXMove(m, c ? parseClock(c) : undefined);
  });
  const startFen = hist.length ? hist[0].before : chess.fen();
  return { headers, startFen, moves, fens: [startFen, ...moves.map((m) => m.after)] };
}

/** Split a file or paste that may hold several games. */
export function splitPgn(text: string): string[] {
  const t = text.replace(/\r\n?/g, '\n').trim();
  if (!t) return [];
  if (!/^\s*\[/m.test(t)) return [t]; // bare movetext, no tags
  const parts = t.split(/\n(?=\[Event\s)/g).map((s) => s.trim());
  return parts.filter(Boolean);
}

export function headerOf(pgn: string, tag: string): string | undefined {
  const m = new RegExp(`^\\s*\\[${tag}\\s+"([^"]*)"\\]`, 'm').exec(pgn);
  return m ? m[1] : undefined;
}

export function movetext(pgn: string): string {
  return pgn.replace(/^\s*\[[^\]\n]*\]\s*$/gm, '').trim();
}

/** Cheap SAN tokenizer: no legality checks, used for counts and opening lookups on big imports. */
export function quickSans(pgn: string): string[] {
  const t = movetext(pgn)
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\$\d+/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ');
  return t.split(/\s+/).filter((s) => s && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(s));
}

export function normalizeResult(r: string | undefined): Result {
  return r === '1-0' || r === '0-1' || r === '1/2-1/2' ? r : '*';
}

export function pgnId(pgn: string): string {
  return `pgn:${cyrb53(movetext(pgn).replace(/\s+/g, ' ')).toString(36)}`;
}

/** "2026.11.24" (+ optional "13:05:00") -> ms since epoch, UTC. */
export function pgnDate(date?: string, time?: string): number | undefined {
  if (!date) return undefined;
  const m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(date);
  if (!m) return undefined;
  const t = /^(\d{2}):(\d{2}):(\d{2})/.exec(time ?? '');
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), t ? Number(t[1]) : 12, t ? Number(t[2]) : 0, t ? Number(t[3]) : 0);
  return Number.isFinite(ms) ? ms : undefined;
}

/** Build a PGN from tags and SAN moves. */
export function buildPgn(headers: Record<string, string>, sans: string[], startFen?: string): string {
  const tags = { ...headers };
  if (startFen) {
    tags.SetUp = '1';
    tags.FEN = startFen;
  }
  const head = Object.entries(tags)
    .map(([k, v]) => `[${k} "${String(v).replace(/"/g, "'")}"]`)
    .join('\n');
  const parts = (startFen ?? 'x w').split(' ');
  let black = parts[1] === 'b';
  let num = Number(parts[5]) || 1;
  const body: string[] = [];
  sans.forEach((san, i) => {
    if (!black) body.push(`${num}. ${san}`);
    else {
      body.push(i === 0 ? `${num}... ${san}` : san);
      num++;
    }
    black = !black;
  });
  body.push(tags.Result ?? '*');
  return `${head}\n\n${body.join(' ')}\n`;
}
