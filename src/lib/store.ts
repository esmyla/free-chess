// Small app-wide state: user settings (saved in localStorage) and the hash-based route.
import { useSyncExternalStore } from 'react';
import { defaultWorkers } from './engine';

export type BoardTheme = 'slate' | 'walnut' | 'mono';

export interface Settings {
  /** chess.com username whose games are shown. */
  username: string;
  /** Engine effort per position in a review, in searched positions. */
  reviewNodes: number;
  /** Parallel engine workers used for reviews. */
  workers: number;
  boardTheme: BoardTheme;
  showCoords: boolean;
  /** Number of engine lines shown on the analysis board. */
  lines: number;
  /** Jump to the next puzzle automatically after solving one. */
  puzzleAutoNext: boolean;
  sound: boolean;
}

export const REVIEW_PROFILES: { label: string; nodes: number; hint: string }[] = [
  { label: 'Fast', nodes: 150_000, hint: 'about 5 seconds a game' },
  { label: 'Standard', nodes: 400_000, hint: 'about 15 seconds a game' },
  { label: 'Deep', nodes: 1_200_000, hint: 'about 45 seconds a game' },
];

const KEY = 'freechess.settings.v1';

const defaults = (): Settings => ({
  username: '',
  reviewNodes: 400_000,
  workers: defaultWorkers(),
  boardTheme: 'slate',
  showCoords: true,
  lines: 3,
  puzzleAutoNext: false,
  sound: true,
});

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults(), ...JSON.parse(raw) };
  } catch {
    /* fall through to defaults */
  }
  return defaults();
}

let state = load();
const subs = new Set<() => void>();

export const settings = {
  get: (): Settings => state,
  set(patch: Partial<Settings>): void {
    state = { ...state, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage may be unavailable; settings then last for this session only */
    }
    subs.forEach((s) => s());
  },
  subscribe(cb: () => void): () => void {
    subs.add(cb);
    return () => subs.delete(cb);
  },
};

export function useSettings(): Settings {
  return useSyncExternalStore(settings.subscribe, settings.get);
}

// ---- Routing ----------------------------------------------------------------------------------

export interface Route {
  /** First path segment: games, review, analysis, openings, puzzles, play, insights, settings. */
  view: string;
  /** Remaining path segments, URI-decoded. */
  args: string[];
  query: URLSearchParams;
}

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [path, q] = h.split('?');
  const segs = path.split('/').filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  return { view: segs[0] || 'games', args: segs.slice(1), query: new URLSearchParams(q ?? '') };
}

let route = parseHash();
const routeSubs = new Set<() => void>();
window.addEventListener('hashchange', () => {
  route = parseHash();
  routeSubs.forEach((s) => s());
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      routeSubs.add(cb);
      return () => routeSubs.delete(cb);
    },
    () => route,
  );
}

export function go(path: string): void {
  window.location.hash = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`;
}

export const reviewPath = (id: string): string => `review/${encodeURIComponent(id)}`;

// ---- Small persisted values -------------------------------------------------------------------

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
