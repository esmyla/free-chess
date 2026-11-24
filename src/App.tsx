import { Component, useEffect, type ReactNode } from 'react';
import { Icon } from './components/common';
import { loadBook } from './lib/openings';
import { useRoute, useSettings } from './lib/store';
import { AnalysisView } from './views/AnalysisView';
import { GamesView } from './views/GamesView';
import { InsightsView } from './views/InsightsView';
import { PlayView } from './views/PlayView';
import { PuzzlesView } from './views/PuzzlesView';
import { ReviewView } from './views/ReviewView';
import { SettingsView } from './views/SettingsView';

const NAV: [string, string][] = [
  ['games', 'Games'],
  ['analysis', 'Analysis'],
  ['openings', 'Openings'],
  ['puzzles', 'Puzzles'],
  ['play', 'Play'],
  ['insights', 'Insights'],
];

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Screen crashed:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page center-note">
          <h2>This screen hit an error</h2>
          <p className="muted">{this.state.error.message}</p>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const route = useRoute();
  const s = useSettings();

  useEffect(() => {
    void loadBook();
  }, []);

  let view: ReactNode;
  switch (route.view) {
    case 'review':
      view = route.args[0] ? <ReviewView key={route.args[0]} id={route.args[0]} /> : <GamesView />;
      break;
    case 'analysis':
      view = <AnalysisView initialTab="engine" />;
      break;
    case 'openings':
      view = <AnalysisView initialTab="explorer" />;
      break;
    case 'puzzles':
      view = <PuzzlesView />;
      break;
    case 'play':
      view = <PlayView />;
      break;
    case 'insights':
      view = <InsightsView />;
      break;
    case 'settings':
      view = <SettingsView />;
      break;
    default:
      view = <GamesView />;
  }
  const active = route.view === 'review' ? 'games' : route.view;
  // Analysis and Openings share one board, so they share a boundary and keep their position.
  const boundaryKey = route.view === 'openings' ? 'analysis' : route.view;

  return (
    <div className="app" data-board={s.boardTheme}>
      <nav className="rail" aria-label="Main">
        <a className="brand" href="#/games" title="Free Chess">
          <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="#1d2129" />
            <rect x="6" y="6" width="10" height="10" fill="var(--accent)" />
            <rect x="16" y="16" width="10" height="10" fill="var(--accent)" />
            <rect x="16" y="6" width="10" height="10" fill="#343a46" />
            <rect x="6" y="16" width="10" height="10" fill="#343a46" />
          </svg>
        </a>
        {NAV.map(([id, label]) => (
          <a key={id} className={`nav-item${active === id ? ' on' : ''}`} href={`#/${id}`} aria-current={active === id ? 'page' : undefined}>
            <Icon name={id} size={22} />
            <span>{label}</span>
          </a>
        ))}
        <span className="spacer" />
        <a className={`nav-item${active === 'settings' ? ' on' : ''}`} href="#/settings">
          <Icon name="settings" size={22} />
          <span>Settings</span>
        </a>
      </nav>
      <main className="main">
        <ErrorBoundary key={boundaryKey}>{view}</ErrorBoundary>
      </main>
    </div>
  );
}
