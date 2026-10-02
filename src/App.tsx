import { HashRouter, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DataProvider } from './data/DataContext';
import { AppStateProvider } from './components/AppState';
import { Layout } from './components/Layout';
import { BattlesPage } from './pages/BattlesPage';
import { BattlePage } from './pages/BattlePage';
import { TokenPage } from './pages/TokenPage';
import { LaunchPage } from './pages/LaunchPage';
import { ChallengePage, CreateBattlePage } from './pages/CreateBattlePage';
import { DiscoverPage } from './pages/DiscoverPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { CreatorPage, CreatorsPage } from './pages/CreatorsPage';
import { PortfolioPage } from './pages/PortfolioPage';
import { RulesPage } from './pages/RulesPage';
import { SpectatorPage } from './pages/SpectatorPage';
import { TournamentPage, TournamentsPage } from './pages/TournamentsPage';
import { TreasuryPage } from './pages/TreasuryPage';

export function App() {
  return (
    <ErrorBoundary page>
    <DataProvider>
      <HashRouter>
        <AppStateProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<BattlesPage />} />
              <Route path="battle/:id" element={<BattlePage />} />
              <Route path="battle/:id/watch" element={<SpectatorPage />} />
              <Route path="tournaments" element={<TournamentsPage />} />
              <Route path="tournament/:id" element={<TournamentPage />} />
              <Route path="treasury" element={<TreasuryPage />} />
              <Route path="token/:id" element={<TokenPage />} />
              <Route path="launch" element={<LaunchPage />} />
              <Route path="create-battle" element={<CreateBattlePage />} />
              <Route path="challenge/:id" element={<ChallengePage />} />
              <Route path="coins" element={<DiscoverPage />} />
              <Route path="discover" element={<DiscoverPage />} />
              <Route path="leaderboard" element={<LeaderboardPage />} />
              <Route path="creators" element={<CreatorsPage />} />
              <Route path="creator/:id" element={<CreatorPage />} />
              <Route path="portfolio" element={<PortfolioPage />} />
              <Route path="rules" element={<RulesPage />} />
              <Route path="*" element={<BattlesPage />} />
            </Route>
          </Routes>
        </AppStateProvider>
      </HashRouter>
    </DataProvider>
    </ErrorBoundary>
  );
}
