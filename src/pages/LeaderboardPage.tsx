import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useData } from '../data/DataContext';
import { num, short, usd } from '../lib/format';
import { StreakBadge, TokenLogo } from '../components/ui';

const TABS = [
  ['tokens', 'Top tokens', 'Ranked by battle wins, tie-broken by win rate. Market cap is shown but not ranked.'],
  ['traders', 'Top traders', 'Ranked by winning sides: battles in which the wallet bought the token that went on to win. Not ranked by profit.'],
  ['creators', 'Top creators', 'Ranked by battles won by tokens they listed, tie-broken by battles played.'],
  ['streaks', 'Longest win streaks', 'Ranked by current consecutive battle wins, then best-ever streak.'],
  ['wins', 'Most battle wins', 'Total battles won.'],
  ['participation', 'Most battle participation', 'Wallets ranked by the number of battles they traded in (indexed battle trades, flagged trades excluded).'],
] as const;
type Tab = (typeof TABS)[number][0];
type TraderRow = { wallet: string; battles: number; trades: number; volume_usd: number; winning_sides: number };

export function LeaderboardPage() {
  const e = useData();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'tokens';
  const meta = TABS.find((t) => t[0] === tab) ?? TABS[0];
  const [traders, setTraders] = useState<TraderRow[] | null>(null);
  useEffect(() => { if ((tab === 'traders' || tab === 'participation') && traders === null) void e.loadTraderStats().then(setTraders); }, [tab, traders, e]);

  const tokens = Object.values(e.tokens).map((t) => ({ t, r: e.recordFor(t.id), mcap: e.markets[t.id]?.mcapUsd ?? null }));
  const creatorMap = new Map<string, { wallet: string; toks: typeof tokens; wins: number; played: number }>();
  for (const x of tokens) {
    const c = creatorMap.get(x.t.listedBy) ?? { wallet: x.t.listedBy, toks: [], wins: 0, played: 0 };
    c.toks.push(x); c.wins += x.r.wins; c.played += x.r.entries.length;
    creatorMap.set(x.t.listedBy, c);
  }
  const creators = [...creatorMap.values()];
  const rate = (x: { r: { wins: number; entries: unknown[] } }) => (x.r.entries.length ? x.r.wins / x.r.entries.length : 0);
  const me = e.wallet.address;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">🏆 Leaderboard</h1>
          <div className="page-sub">Every ranking states exactly what it measures. Built from finished battles and indexed battle trades.</div>
        </div>
      </div>
      <div className="tabs">
        {TABS.map(([k, l]) => <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setParams({ tab: k })}>{l}</button>)}
      </div>
      <div className="callout callout-info" style={{ marginBottom: 14 }}><span>📐</span><span><b>Metric:</b> {meta[2]}</span></div>
      <div className="panel table-wrap">
        {(tab === 'tokens' || tab === 'wins') && (
          <table className="table">
            <thead><tr><th>#</th><th>Token</th><th className="num">Wins</th><th className="num">Losses</th><th className="num">Win rate</th><th className="hide-mobile">Streak</th><th className="num hide-mobile">Market cap</th></tr></thead>
            <tbody>
              {tokens.length === 0 && <tr><td colSpan={7} className="empty">No tokens listed yet.</td></tr>}
              {[...tokens].sort((a, b) => b.r.wins - a.r.wins || rate(b) - rate(a)).map((x, i) => (
                <tr key={x.t.id}>
                  <td><Rank i={i} /></td>
                  <td><Link to={`/token/${x.t.id}`} className="row" style={{ gap: 10 }}><TokenLogo token={x.t} size={28} /><b>${x.t.ticker}</b></Link></td>
                  <td className="num up">{x.r.wins}</td>
                  <td className="num down">{x.r.losses}</td>
                  <td className="num">{Math.round(rate(x) * 100)}%</td>
                  <td className="hide-mobile"><StreakBadge streak={x.r.streak} /></td>
                  <td className="num hide-mobile muted">{usd(x.mcap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'streaks' && (
          <table className="table">
            <thead><tr><th>#</th><th>Token</th><th>Current streak</th><th className="num">Best ever</th><th className="hide-mobile">Recent form</th></tr></thead>
            <tbody>
              {[...tokens].sort((a, b) => b.r.streak - a.r.streak || b.r.best - a.r.best).map((x, i) => (
                <tr key={x.t.id}>
                  <td><Rank i={i} /></td>
                  <td><Link to={`/token/${x.t.id}`} className="row" style={{ gap: 10 }}><TokenLogo token={x.t} size={28} /><b>${x.t.ticker}</b></Link></td>
                  <td>{x.r.streak >= 2 ? <StreakBadge streak={x.r.streak} size="lg" /> : <span className="mono muted">{x.r.streak}</span>}</td>
                  <td className="num">{x.r.best}</td>
                  <td className="hide-mobile"><span className="row" style={{ gap: 3 }}>{x.r.entries.slice(0, 10).map((h) => <span key={h.battleId} className={`form-dot sm ${h.won ? 'w' : 'l'}`}>{h.won ? 'W' : 'L'}</span>)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {(tab === 'traders' || tab === 'participation') && (
          <table className="table">
            <thead><tr><th>#</th><th>Wallet</th><th className="num">{tab === 'traders' ? 'Winning sides' : 'Battles'}</th><th className="num">{tab === 'traders' ? 'Battles' : 'Winning sides'}</th><th className="num hide-mobile">Trades</th><th className="num hide-mobile">Battle volume</th></tr></thead>
            <tbody>
              {traders === null && <tr><td colSpan={6} className="empty">Loading…</td></tr>}
              {traders?.length === 0 && <tr><td colSpan={6} className="empty">No battle trades indexed yet.</td></tr>}
              {[...(traders ?? [])].sort((a, b) => (tab === 'traders' ? b.winning_sides - a.winning_sides || b.battles - a.battles : b.battles - a.battles)).map((x, i) => (
                <tr key={x.wallet} className={x.wallet === me ? 'mine' : ''}>
                  <td><Rank i={i} /></td>
                  <td><a className="mono link" href={`https://solscan.io/account/${x.wallet}`} target="_blank" rel="noopener noreferrer">{x.wallet === me ? 'You' : short(x.wallet, 5)}</a></td>
                  <td className="num">{tab === 'traders' ? x.winning_sides : x.battles}</td>
                  <td className="num muted">{tab === 'traders' ? x.battles : x.winning_sides}</td>
                  <td className="num hide-mobile">{num(x.trades)}</td>
                  <td className="num hide-mobile">{usd(x.volume_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'creators' && (
          <table className="table">
            <thead><tr><th>#</th><th>Creator</th><th className="num">Battle wins</th><th className="num">Battles</th><th className="hide-mobile">Tokens</th></tr></thead>
            <tbody>
              {creators.length === 0 && <tr><td colSpan={5} className="empty">No creators yet.</td></tr>}
              {[...creators].sort((a, b) => b.wins - a.wins || b.played - a.played).map((c, i) => (
                <tr key={c.wallet}>
                  <td><Rank i={i} /></td>
                  <td><Link to={`/creator/${c.wallet}`} className="mono link">{c.wallet === me ? 'You' : short(c.wallet, 5)}</Link></td>
                  <td className="num up">{c.wins}</td>
                  <td className="num">{c.played}</td>
                  <td className="hide-mobile"><span className="row" style={{ gap: 4 }}>{c.toks.map((x) => <TokenLogo key={x.t.id} token={x.t} size={22} />)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Rank({ i }: { i: number }) {
  return <span className={`rank rank-${i + 1}`}>{i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span>;
}
