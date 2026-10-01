import { HashRouter, Route, Routes } from 'react-router-dom';
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

export function App() {
  return (
    <DataProvider>
      <HashRouter>
        <AppStateProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<BattlesPage />} />
              <Route path="battle/:id" element={<BattlePage />} />
              <Route path="token/:id" element={<TokenPage />} />
              <Route path="launch" element={<LaunchPage />} />
              <Route path="create-battle" element={<CreateBattlePage />} />
              <Route path="challenge/:id" element={<ChallengePage />} />
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
  );
}
