// Copies the Stockfish WASM engine out of node_modules into public/engine so the
// browser can load it as a Web Worker. Run with: npm run setup:engine
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'node_modules', 'stockfish');
const src = join(pkg, 'bin');
const dest = join(root, 'public', 'engine');

// The lite single-threaded build: ~1.8 MB, needs no special server headers.
const files = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm'];

await mkdir(dest, { recursive: true });
for (const f of files) {
  await copyFile(join(src, f), join(dest, f));
  const { size } = await stat(join(dest, f));
  console.log(`engine: ${f} (${(size / 1024).toFixed(0)} KB)`);
}

// The engine is GPL-3: ship its licence and say where the source is, next to the binary.
await copyFile(join(pkg, 'Copying.txt'), join(dest, 'COPYING.txt'));
await writeFile(
  join(dest, 'SOURCE.txt'),
  [
    'stockfish-19-lite-single.js and stockfish-19-lite-single.wasm in this folder are the Stockfish 19',
    'chess engine compiled to WebAssembly by the Stockfish.js project. They are redistributed unmodified',
    'from the npm package stockfish@19.0.1 under the GNU General Public License v3 (see COPYING.txt).',
    '',
    'Corresponding source code:',
    '  https://github.com/nmrugg/stockfish.js (release v19.0.1)',
    '  which builds on https://github.com/official-stockfish/Stockfish',
    '',
  ].join('\n'),
);
console.log('engine: COPYING.txt, SOURCE.txt');
