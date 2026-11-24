// Builds public/data/openings.json from the Lichess opening-name list (CC0).
// Source: https://github.com/lichess-org/chess-openings
// Run with: npm run build:openings
import { Chess } from 'chess.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master/';

// Must match src/lib/poskey.ts
function cyrb53(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
const posKey = (fen) => cyrb53(fen.split(' ').slice(0, 3).join(' ')).toString(36);

const names = {};
const book = new Set();
let lines = 0;
let bad = 0;

for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const res = await fetch(`${BASE}${f}.tsv`, { headers: { 'User-Agent': 'free-chess-build' } });
  if (!res.ok) throw new Error(`Could not fetch ${f}.tsv: HTTP ${res.status}`);
  const text = await res.text();
  for (const line of text.split('\n').slice(1)) {
    if (!line.trim()) continue;
    const [eco, name, pgn] = line.split('\t');
    if (!eco || !name || !pgn) continue;
    const sans = pgn
      .replace(/\d+\.(\.\.)?/g, ' ')
      .trim()
      .split(/\s+/);
    const chess = new Chess();
    try {
      for (const san of sans) {
        chess.move(san);
        book.add(posKey(chess.fen()));
      }
    } catch {
      bad++;
      continue;
    }
    const k = posKey(chess.fen());
    // Keep the first name seen for a position; the list goes from general to specific.
    if (!names[k]) names[k] = [eco, name, sans.length];
    lines++;
  }
}

const bookOnly = [...book].filter((k) => !names[k]);
const out = { source: 'lichess-org/chess-openings (CC0)', names, book: bookOnly };
await mkdir(join(root, 'public', 'data'), { recursive: true });
const json = JSON.stringify(out);
await writeFile(join(root, 'public', 'data', 'openings.json'), json);
console.log(
  `openings: ${lines} named lines, ${book.size} book positions, ${bad} skipped, ${(json.length / 1024).toFixed(0)} KB`,
);
