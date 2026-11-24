// Thin UCI wrapper around the Stockfish WASM worker, plus the shared engine instances the app uses.

export interface Score {
  cp?: number;
  mate?: number;
}

/** One principal variation as reported by the engine. Scores are from the side to move. */
export interface PvLine {
  multipv: number;
  depth: number;
  seldepth?: number;
  score: Score;
  pv: string[];
  nodes?: number;
  nps?: number;
}

export interface SearchResult {
  lines: PvLine[];
  bestmove: string | null;
  depth: number;
  nodes: number;
  nps: number;
}

export interface GoOptions {
  nodes?: number;
  depth?: number;
  movetime?: number;
  multipv?: number;
}

const ENGINE_FILE = 'engine/stockfish-19-lite-single.js';

function parseInfo(line: string): PvLine | null {
  // Bound lines are provisional; wait for the exact score at that depth.
  if (!line.includes(' pv ') || line.includes('lowerbound') || line.includes('upperbound')) return null;
  const t = line.split(' ');
  let depth = 0;
  let seldepth: number | undefined;
  let multipv = 1;
  let score: Score | null = null;
  let nodes: number | undefined;
  let nps: number | undefined;
  let pv: string[] = [];
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth':
        depth = Number(t[++i]);
        break;
      case 'seldepth':
        seldepth = Number(t[++i]);
        break;
      case 'multipv':
        multipv = Number(t[++i]);
        break;
      case 'score': {
        const kind = t[++i];
        const v = Number(t[++i]);
        score = kind === 'mate' ? { mate: v } : { cp: v };
        break;
      }
      case 'nodes':
        nodes = Number(t[++i]);
        break;
      case 'nps':
        nps = Number(t[++i]);
        break;
      case 'pv':
        pv = t.slice(i + 1);
        i = t.length;
        break;
      default:
        break;
    }
  }
  if (!score || !pv.length) return null;
  return { multipv, depth, seldepth, score, pv, nodes, nps };
}

export class Engine {
  private worker: Worker;
  private listeners = new Set<(line: string) => void>();
  private readyPromise: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private options = new Map<string, string>();
  private searching = false;
  private seq = 0;
  private latest = 0;
  failed: Error | null = null;

  constructor() {
    const url = new URL(`${import.meta.env.BASE_URL}${ENGINE_FILE}`, document.baseURI).href;
    this.worker = new Worker(url);
    this.worker.onmessage = (e: MessageEvent) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      for (const l of [...this.listeners]) l(line);
    };
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.worker.onerror = (e) => {
        this.failed = new Error(e.message || 'The chess engine failed to load.');
        console.error('Engine error:', e.message);
        reject(this.failed);
      };
      this.handshake().then(resolve, reject);
    });
    // Callers attach their own handlers; this keeps a failed load from surfacing as an unhandled rejection.
    this.readyPromise.catch(() => undefined);
  }

  private send(cmd: string): void {
    this.worker.postMessage(cmd);
  }

  private waitFor(pred: (line: string) => boolean): Promise<string> {
    return new Promise((resolve) => {
      const l = (line: string) => {
        if (pred(line)) {
          this.listeners.delete(l);
          resolve(line);
        }
      };
      this.listeners.add(l);
    });
  }

  private async handshake(): Promise<void> {
    const ok = this.waitFor((l) => l === 'uciok');
    this.send('uci');
    await ok;
    const ready = this.waitFor((l) => l === 'readyok');
    this.send('isready');
    await ready;
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private applyOption(name: string, value: string | number | boolean): void {
    const v = String(value);
    if (this.options.get(name) === v) return;
    this.options.set(name, v);
    this.send(`setoption name ${name} value ${v}`);
  }

  /** Queue option changes; they apply between searches. */
  setOptions(opts: Record<string, string | number | boolean>): Promise<void> {
    return this.run(async () => {
      await this.readyPromise;
      for (const [k, v] of Object.entries(opts)) this.applyOption(k, v);
    });
  }

  /** Forget the previous game: clears the hash table. */
  newGame(): Promise<void> {
    return this.run(async () => {
      await this.readyPromise;
      const ready = this.waitFor((l) => l === 'readyok');
      this.send('ucinewgame');
      this.send('isready');
      await ready;
    });
  }

  /**
   * Search a position. With `supersede`, any search still running or queued on this engine is
   * abandoned in favour of this one, and an abandoned call resolves to null.
   */
  search(
    fen: string,
    go: GoOptions,
    onInfo?: (lines: PvLine[]) => void,
    opts?: { supersede?: boolean },
  ): Promise<SearchResult | null> {
    const id = ++this.seq;
    if (opts?.supersede) {
      this.latest = id;
      this.stop();
    }
    return this.run(async () => {
      await this.readyPromise;
      if (opts?.supersede && this.latest !== id) return null;
      this.applyOption('MultiPV', go.multipv ?? 1);
      const lines: PvLine[] = [];
      let nodes = 0;
      let nps = 0;
      const done = new Promise<string>((resolve) => {
        const l = (line: string) => {
          if (line.startsWith('info ')) {
            const p = parseInfo(line);
            if (!p) return;
            lines[p.multipv - 1] = p;
            if (p.nodes) nodes = p.nodes;
            if (p.nps) nps = p.nps;
            onInfo?.(lines.filter(Boolean));
          } else if (line.startsWith('bestmove')) {
            this.listeners.delete(l);
            resolve(line);
          }
        };
        this.listeners.add(l);
      });
      const parts = ['go'];
      if (go.nodes) parts.push('nodes', String(Math.round(go.nodes)));
      if (go.depth) parts.push('depth', String(go.depth));
      if (go.movetime) parts.push('movetime', String(Math.round(go.movetime)));
      if (parts.length === 1) parts.push('depth', '14');
      this.send(`position fen ${fen}`);
      this.searching = true;
      this.send(parts.join(' '));
      const bm = await done;
      this.searching = false;
      const mv = bm.split(' ')[1];
      const out = lines.filter(Boolean);
      return {
        lines: out,
        bestmove: mv && mv !== '(none)' ? mv : null,
        depth: out[0]?.depth ?? 0,
        nodes,
        nps,
      };
    });
  }

  /** Ask a running search to finish now. */
  stop(): void {
    if (this.searching) this.send('stop');
  }

  terminate(): void {
    this.worker.terminate();
    this.listeners.clear();
  }
}

// ---- Shared instances -------------------------------------------------------------------------

let pool: Engine[] = [];

/** Engines used for full-game reviews, one worker each. Grows or shrinks to `size`. */
export async function getPool(size: number): Promise<Engine[]> {
  const n = Math.max(1, Math.min(12, Math.round(size)));
  while (pool.length > n) pool.pop()!.terminate();
  while (pool.length < n) {
    const e = new Engine();
    void e.setOptions({ Hash: 32 });
    pool.push(e);
  }
  await Promise.all(pool.map((e) => e.ready()));
  return pool;
}

let live: Engine | null = null;

/** Engine behind the live evaluation panel. */
export function getLiveEngine(): Engine {
  if (!live) {
    live = new Engine();
    void live.setOptions({ Hash: 64 });
  }
  return live;
}

let play: Engine | null = null;

/** Engine the bots think with; kept separate because bots change its strength settings. */
export function getPlayEngine(): Engine {
  if (!play) {
    play = new Engine();
    void play.setOptions({ Hash: 32 });
  }
  return play;
}

export const defaultWorkers = (): number => {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(1, Math.min(6, Math.floor(cores / 2)));
};
