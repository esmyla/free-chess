// Builds the offline puzzle pack in public/puzzles from the Lichess puzzle database (CC0).
// Source: https://database.lichess.org/#puzzles
//
// The full file is ~310 MB compressed. Puzzle ids are random, so the start of the file is a fair
// sample; this script streams only as many rows as it needs and then stops the download.
//
// Run with: npm run build:puzzles
// Tune with env vars: ROWS (rows to scan, default 450000), PER_BAND (puzzles kept per 100-point
// rating band, default 2000). Needs `curl` and `zstd` on the PATH.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'puzzles');
const URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';
const MAX_ROWS = Number(process.env.ROWS ?? 450000);
const PER_BAND = Number(process.env.PER_BAND ?? 2000);
const MIN_BAND = 400;
const MAX_BAND = 2800;

const bandOf = (rating) => Math.min(MAX_BAND, Math.max(MIN_BAND, Math.floor(rating / 100) * 100));

const curl = spawn('curl', ['-sL', '--fail', '-A', 'free-chess-build', URL], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
const zstd = spawn('zstd', ['-dc'], { stdio: ['pipe', 'pipe', 'inherit'] });
curl.on('error', (e) => {
  console.error('Could not run curl:', e.message);
  process.exit(1);
});
zstd.on('error', (e) => {
  console.error('Could not run zstd (install it, e.g. `brew install zstd`):', e.message);
  process.exit(1);
});
// Killing the pipeline early produces EPIPE noise; ignore it.
curl.stdout.on('error', () => {});
zstd.stdin.on('error', () => {});
zstd.stdout.on('error', () => {});
curl.stdout.pipe(zstd.stdin);

const bands = new Map();
let rows = 0;
let kept = 0;
let fullBands = 0;
const totalBands = (MAX_BAND - MIN_BAND) / 100 + 1;

const rl = readline.createInterface({ input: zstd.stdout, crlfDelay: Infinity });
for await (const line of rl) {
  rows++;
  if (rows === 1) continue; // header: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
  if (rows > MAX_ROWS + 1 || fullBands === totalBands) break;
  if (rows % 50000 === 0) console.log(`  scanned ${rows} rows, kept ${kept}`);
  const c = line.split(',');
  if (c.length < 8) continue;
  const [id, fen, moves, ratingS, rdS, popS, playsS, themes] = c;
  const rating = Number(ratingS);
  const rd = Number(rdS);
  const pop = Number(popS);
  const plays = Number(playsS);
  if (!Number.isFinite(rating)) continue;
  // Keep well-tested, well-liked puzzles only.
  if (rd > 90 || pop < 80 || plays < 150) continue;
  const b = bandOf(rating);
  let list = bands.get(b);
  if (!list) bands.set(b, (list = []));
  if (list.length >= PER_BAND) continue;
  list.push([id, fen, moves, rating, themes]);
  kept++;
  if (list.length === PER_BAND) fullBands++;
}
rl.close();
curl.kill();
zstd.kill();

if (kept === 0) {
  console.error('No puzzles were read. Check your connection and that zstd is installed.');
  process.exit(1);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
const index = { source: 'database.lichess.org puzzles (CC0)', built: new Date().toISOString(), total: kept, bands: {} };
let bytes = 0;
for (const b of [...bands.keys()].sort((x, y) => x - y)) {
  const list = bands.get(b);
  const json = JSON.stringify(list);
  bytes += json.length;
  await writeFile(join(outDir, `b${b}.json`), json);
  index.bands[b] = list.length;
}
await writeFile(join(outDir, 'index.json'), JSON.stringify(index));
console.log(`puzzles: kept ${kept} of ${rows - 1} scanned, ${(bytes / 1048576).toFixed(1)} MB`);
console.log(Object.entries(index.bands).map(([b, n]) => `${b}:${n}`).join('  '));
process.exit(0);
