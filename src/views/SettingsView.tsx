import { useState } from 'react';
import { Segmented } from '../components/common';
import { clearGames } from '../lib/db';
import { REVIEW_PROFILES, settings, useSettings, type BoardTheme } from '../lib/store';

export function SettingsView() {
  const s = useSettings();
  const [confirm, setConfirm] = useState<'games' | 'puzzles' | null>(null);
  const [done, setDone] = useState('');
  const cores = navigator.hardwareConcurrency || 4;

  const wipeGames = async () => {
    await clearGames();
    setConfirm(null);
    setDone('Stored games and reviews were deleted.');
  };
  const wipePuzzles = () => {
    localStorage.removeItem('freechess.puzzles.v1');
    setConfirm(null);
    setDone('Puzzle rating and history were reset.');
  };

  return (
    <div className="page settings-page">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="lede">
            Your games, reviews and puzzle progress are stored in this browser on this computer. The app only goes online to read public
            games from chess.com and opening statistics from Lichess.
          </p>
        </div>
      </header>

      <section className="card">
        <h3>Game review</h3>
        <div className="setting">
          <div>
            <strong>Engine effort</strong>
            <p className="muted">How hard Stockfish looks at each position. Deeper is slower and a little more reliable.</p>
          </div>
          <Segmented
            value={s.reviewNodes}
            onChange={(v) => settings.set({ reviewNodes: v })}
            options={REVIEW_PROFILES.map((p) => ({ value: p.nodes, label: p.label, title: p.hint }))}
          />
        </div>
        <div className="setting">
          <div>
            <strong>Parallel engines: {s.workers}</strong>
            <p className="muted">More engines finish a review sooner but use more of your {cores} processor cores.</p>
          </div>
          <input
            type="range"
            min={1}
            max={Math.max(2, Math.min(12, cores))}
            value={s.workers}
            onChange={(e) => settings.set({ workers: Number(e.target.value) })}
          />
        </div>
        <div className="setting">
          <div>
            <strong>Engine lines</strong>
            <p className="muted">How many candidate lines the live engine shows.</p>
          </div>
          <Segmented
            value={s.lines}
            onChange={(v) => settings.set({ lines: v })}
            options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))}
          />
        </div>
      </section>

      <section className="card">
        <h3>Board</h3>
        <div className="setting">
          <div>
            <strong>Colours</strong>
          </div>
          <Segmented<BoardTheme>
            value={s.boardTheme}
            onChange={(v) => settings.set({ boardTheme: v })}
            options={[
              { value: 'slate', label: 'Slate' },
              { value: 'walnut', label: 'Walnut' },
              { value: 'mono', label: 'Mono' },
            ]}
          />
        </div>
        <label className="check">
          <input type="checkbox" checked={s.showCoords} onChange={(e) => settings.set({ showCoords: e.target.checked })} />
          <span>Show coordinates on the board</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.sound} onChange={(e) => settings.set({ sound: e.target.checked })} />
          <span>Move sounds</span>
        </label>
      </section>

      <section className="card">
        <h3>Your data</h3>
        <div className="setting">
          <div>
            <strong>Stored games and reviews</strong>
            <p className="muted">Removes every imported game and its review from this browser. Your games on chess.com are not touched.</p>
          </div>
          {confirm === 'games' ? (
            <div className="row gap">
              <button className="btn danger" onClick={() => void wipeGames()}>
                Yes, delete them
              </button>
              <button className="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn" onClick={() => setConfirm('games')}>
              Delete…
            </button>
          )}
        </div>
        <div className="setting">
          <div>
            <strong>Puzzle progress</strong>
            <p className="muted">Resets your puzzle rating, streaks and sprint records.</p>
          </div>
          {confirm === 'puzzles' ? (
            <div className="row gap">
              <button className="btn danger" onClick={wipePuzzles}>
                Yes, reset
              </button>
              <button className="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn" onClick={() => setConfirm('puzzles')}>
              Reset…
            </button>
          )}
        </div>
        {done && <div className="status ok">{done}</div>}
      </section>

      <section className="card">
        <h3>About</h3>
        <p className="muted">
          Free Chess is a personal training tool built from open parts: the Stockfish 19 engine (GPL-3), the chessground board and
          cburnett pieces (GPL-3), chess.js (BSD), and the Lichess puzzle and opening databases (CC0). Game imports use chess.com's
          public read-only API. It is not affiliated with chess.com or Lichess, and it does not unlock or imitate their paid features;
          it computes its own analysis on your computer.
        </p>
        <p className="muted">
          This app is free software under the GPL-3.0 licence. Source code:{' '}
          <a href="https://github.com/esmyla/free-chess" target="_blank" rel="noreferrer">
            github.com/esmyla/free-chess
          </a>
          . Engine source:{' '}
          <a href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noreferrer">
            github.com/nmrugg/stockfish.js
          </a>
          .
        </p>
      </section>
    </div>
  );
}
