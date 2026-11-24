import { useEffect, useMemo, useRef, useState } from 'react';
import { gamesFromPgn, fetchStats, type PlayerStats } from '../lib/chesscom';
import { deleteGame, putGames } from '../lib/db';
import { useGames } from '../lib/hooks';
import { outcomeFor } from '../lib/insights';
import { go, reviewPath, settings, useSettings } from '../lib/store';
import { getSyncState, loadOlder, monthsLeft, syncLatest, type SyncState } from '../lib/sync';
import type { GameMeta } from '../lib/types';
import { Icon, Segmented, Spinner } from '../components/common';

type Filter = 'all' | 'rapid' | 'blitz' | 'bullet' | 'daily' | 'other';

const errText = (e: unknown): string => (e instanceof Error ? e.message : 'Something went wrong.');

function timeLabel(g: GameMeta): string {
  if (g.source === 'bot') return 'vs computer';
  const tc = g.timeClass ? g.timeClass[0].toUpperCase() + g.timeClass.slice(1) : '';
  const ctl = g.timeControl ?? '';
  let nice = '';
  const m = /^(\d+)(?:\+(\d+))?$/.exec(ctl);
  if (m) {
    const base = Number(m[1]);
    nice = `${base >= 60 ? base / 60 : `${base}s`}${m[2] ? `+${m[2]}` : base >= 60 ? ' min' : ''}`;
  } else if (/^1\/\d+$/.test(ctl)) {
    nice = `${Math.round(Number(ctl.split('/')[1]) / 86400)} days/move`;
  }
  return [tc, nice].filter(Boolean).join(' · ') || 'Game';
}

const dateLabel = (t: number): string =>
  new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function GameRow({ g }: { g: GameMeta }) {
  const o = outcomeFor(g);
  const mine = g.me;
  const opp = mine === 'w' ? g.black : g.white;
  const oppElo = mine === 'w' ? g.blackElo : g.whiteElo;
  const chip =
    o === 'w' ? ['Won', 'win'] : o === 'l' ? ['Lost', 'loss'] : o === 'd' ? ['Draw', 'draw'] : [g.result === '*' ? 'Unfinished' : g.result, 'none'];
  const acc = g.summary ? (mine ? g.summary.acc[mine] : undefined) : undefined;
  return (
    <div className="game-row" role="button" tabIndex={0} onClick={() => go(reviewPath(g.id))} onKeyDown={(e) => e.key === 'Enter' && go(reviewPath(g.id))}>
      <span className={`result-chip ${chip[1]}`}>{chip[0]}</span>
      <div className="game-main">
        <div className="game-title">
          {mine ? (
            <>
              <span className={`side-dot ${mine === 'w' ? 'white' : 'black'}`} title={`You played ${mine === 'w' ? 'White' : 'Black'}`} />
              <span className="opp-name">vs {opp}</span>
              {oppElo ? <span className="muted">({oppElo})</span> : null}
            </>
          ) : (
            <span>
              {g.white}
              {g.whiteElo ? <span className="muted"> ({g.whiteElo})</span> : null} vs {g.black}
              {g.blackElo ? <span className="muted"> ({g.blackElo})</span> : null}
            </span>
          )}
        </div>
        <div className="game-sub">
          <span>{timeLabel(g)}</span>
          {g.opening && <span className="game-opening">{g.opening}</span>}
          <span>
            {Math.ceil(g.plies / 2)} move{Math.ceil(g.plies / 2) === 1 ? '' : 's'}
          </span>
          <span>{dateLabel(g.endTime)}</span>
        </div>
      </div>
      <div className="game-right">
        {g.summary ? (
          <span className="acc-pill" title={mine ? 'Your accuracy in this game' : 'Accuracy: White / Black'}>
            {acc !== undefined ? acc.toFixed(1) : `${g.summary.acc.w.toFixed(0)} / ${g.summary.acc.b.toFixed(0)}`}
          </span>
        ) : (
          <span className="acc-pill pending">Review</span>
        )}
        <button
          className="icon-btn ghost"
          title="Remove this game from the app"
          onClick={(e) => {
            e.stopPropagation();
            void deleteGame(g.id);
          }}
        >
          <Icon name="trash" size={16} />
        </button>
      </div>
    </div>
  );
}

export function GamesView() {
  const s = useSettings();
  const { games, loaded } = useGames();
  const [name, setName] = useState(s.username);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(60);
  const [pgnOpen, setPgnOpen] = useState(false);
  const [pgnText, setPgnText] = useState('');
  const [sync, setSync] = useState<SyncState | null>(null);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const abort = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const user = s.username.trim().toLowerCase();

  useEffect(() => {
    let alive = true;
    setStats(null);
    void getSyncState(user).then((st) => alive && setSync(st));
    if (user) {
      fetchStats(user)
        .then((st) => alive && setStats(st))
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [user]);

  const run = async (fn: (status: (m: string) => void) => Promise<string>) => {
    setError(null);
    setNote(null);
    setBusy('Working…');
    try {
      setNote(await fn(setBusy));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const load = () => {
    const u = name.trim();
    if (!u) {
      setError('Type a chess.com username first.');
      return;
    }
    void run(async (status) => {
      const { added, state } = await syncLatest(u, status);
      settings.set({ username: u });
      setSync(state);
      return added ? `Added ${added} new game${added === 1 ? '' : 's'}.` : 'Already up to date.';
    });
  };

  const older = (months: number) => {
    abort.current = new AbortController();
    void run(async (status) => {
      const { added, state } = await loadOlder(user, months, status, abort.current!.signal);
      setSync({ ...state });
      return `Added ${added} older game${added === 1 ? '' : 's'}.`;
    });
  };

  const importPgn = (text: string) => {
    void run(async () => {
      const { games: list, failed } = await gamesFromPgn(text, s.username);
      if (!list.length) throw new Error('No readable games in that PGN.');
      await putGames(list);
      setPgnOpen(false);
      setPgnText('');
      if (list.length === 1) go(reviewPath(list[0].id));
      return `Imported ${list.length} game${list.length === 1 ? '' : 's'}${failed ? `, ${failed} could not be read` : ''}.`;
    });
  };

  const mine = useMemo(
    () => games.filter((g) => g.source !== 'chesscom' || !user || g.owner === user),
    [games, user],
  );
  const shown = useMemo(() => {
    if (filter === 'all') return mine;
    if (filter === 'other') return mine.filter((g) => g.source !== 'chesscom');
    return mine.filter((g) => g.source === 'chesscom' && g.timeClass === filter);
  }, [mine, filter]);
  const left = monthsLeft(sync);
  const reviewed = mine.filter((g) => g.summary).length;

  return (
    <div className="page games-page">
      <header className="page-head">
        <div>
          <h1>Your games</h1>
          <p className="lede">
            Pull in your chess.com games and review any of them with Stockfish: accuracy, graded moves, and the mistakes worth another look.
          </p>
        </div>
      </header>

      <section className="card import-card">
        <form
          className="import-row"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <label className="field grow">
            <span>chess.com username</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. your username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <button className="btn primary" type="submit" disabled={!!busy}>
            {user && name.trim().toLowerCase() === user ? 'Refresh games' : 'Load games'}
          </button>
          <button className="btn" type="button" onClick={() => setPgnOpen((v) => !v)}>
            Import PGN
          </button>
        </form>
        <p className="fine">Reads chess.com's public game archive. No login, no password.</p>
        {stats && (stats.rapid || stats.blitz || stats.bullet || stats.daily) ? (
          <div className="rating-strip">
            {(['rapid', 'blitz', 'bullet', 'daily'] as const).map((k) =>
              stats[k] ? (
                <span key={k}>
                  <em>{k}</em> {stats[k]}
                </span>
              ) : null,
            )}
          </div>
        ) : null}
        {pgnOpen && (
          <div className="pgn-box">
            <textarea
              value={pgnText}
              onChange={(e) => setPgnText(e.target.value)}
              placeholder="Paste one or more games in PGN format…"
              rows={7}
              spellCheck={false}
            />
            <div className="row gap">
              <button className="btn primary" disabled={!pgnText.trim() || !!busy} onClick={() => importPgn(pgnText)}>
                Import
              </button>
              <button className="btn" onClick={() => fileRef.current?.click()}>
                Choose a .pgn file
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".pgn,text/plain"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) importPgn(await f.text());
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        )}
        {busy && (
          <div className="status">
            <Spinner /> {busy}
            {abort.current && !abort.current.signal.aborted && busy.startsWith('Loading') ? (
              <button className="link" onClick={() => abort.current?.abort()}>
                Stop
              </button>
            ) : null}
          </div>
        )}
        {error && <div className="status error">{error}</div>}
        {note && !busy && !error && <div className="status ok">{note}</div>}
      </section>

      {mine.length > 0 && (
        <div className="list-head">
          <Segmented<Filter>
            value={filter}
            onChange={(v) => {
              setFilter(v);
              setLimit(60);
            }}
            options={[
              { value: 'all', label: 'All' },
              { value: 'rapid', label: 'Rapid' },
              { value: 'blitz', label: 'Blitz' },
              { value: 'bullet', label: 'Bullet' },
              { value: 'daily', label: 'Daily' },
              { value: 'other', label: 'Imports & bots' },
            ]}
          />
          <span className="muted">
            {shown.length} game{shown.length === 1 ? '' : 's'} · {reviewed} reviewed
          </span>
        </div>
      )}

      <section className="game-list">
        {shown.slice(0, limit).map((g) => (
          <GameRow key={g.id} g={g} />
        ))}
        {loaded && !mine.length && (
          <div className="empty">
            <h3>No games here yet</h3>
            <p>Enter your chess.com username above to load your recent games, or import a PGN from anywhere.</p>
          </div>
        )}
        {loaded && mine.length > 0 && !shown.length && <div className="empty">No games match this filter.</div>}
      </section>

      <div className="row gap center list-foot">
        {shown.length > limit && (
          <button className="btn" onClick={() => setLimit((l) => l + 100)}>
            Show more
          </button>
        )}
        {user && left > 0 && (
          <>
            <button className="btn" disabled={!!busy} onClick={() => older(3)}>
              Load 3 older months
            </button>
            <button className="btn" disabled={!!busy} onClick={() => older(Infinity)} title="Useful for Insights">
              Load full history ({left} months)
            </button>
          </>
        )}
      </div>
    </div>
  );
}
