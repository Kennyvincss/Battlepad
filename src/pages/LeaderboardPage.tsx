import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useData } from '../data/DataContext';
import { TRADER_NAMES } from '../data/seed';
import { mulberry32 } from '../lib/rng';
import { num, quoteToUsd, short, usd } from '../lib/format';
import { userStats } from '../lib/view';
import { SimPill, StreakBadge, TokenLogo } from '../components/ui';

const TABS = [
  ['tokens', 'Top tokens', 'Ranked by battle wins, tie-broken by win rate. Market cap is shown but not ranked.'],
  ['traders', 'Top traders', 'Ranked by Battle Loyalty points: time-weighted value held in battle tokens, ×1 if held through the end. Not ranked by profit.'],
  ['creators', 'Top creators', 'Ranked by battles won by tokens they launched, tie-broken by total battle participants.'],
  ['streaks', 'Longest win streaks', 'Ranked by current consecutive battle wins, then best-ever streak.'],
  ['wins', 'Most battle wins', 'Total battles won (all time).'],
  ['participation', 'Most battle participation', 'Traders ranked by number of battles in which they held either token.'],
] as const;
type Tab = (typeof TABS)[number][0];

export function LeaderboardPage() {
  const e = useData();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'tokens';
  const meta = TABS.find((t) => t[0] === tab) ?? TABS[0];

  const tokens = Object.values(e.tokens).map((t) => ({ t, r: e.recordFor(t.id), mcap: quoteToUsd(e.markets[t.id].price * t.totalSupply) }));
  const me = userStats(e);
  const traders = useMemo(() => {
    const r = mulberry32(42);
    const list = TRADER_NAMES.map((n) => {
      const battles = 8 + Math.floor(r() * 60);
      const winning = Math.floor(battles * (0.35 + r() * 0.4));
      return { name: n, wallet: short(Math.floor(r() * 1e16).toString(36) + 'xYz' + Math.floor(r() * 1e9).toString(36)), battles, winning, points: Math.round(battles * (60 + r() * 380)), rewards: winning * (0.05 + r() * 0.6), you: false };
    });
    return list;
  }, []);
  const allTraders = [...traders, { name: 'You', wallet: short(e.wallet.address), battles: me.battles, winning: me.winningSides, points: me.loyaltyPoints, rewards: me.rewardsQuote, you: true }];
  const creators = Object.values(e.creators).map((c) => {
    const toks = Object.values(e.tokens).filter((t) => t.creatorId === c.id);
    const wins = toks.reduce((s, t) => s + e.recordFor(t.id).wins, 0);
    return { c, toks, wins, participants: c.history.totalBattleParticipants };
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">🏆 Leaderboard</h1>
          <div className="page-sub">Every ranking states exactly what it measures.</div>
        </div>
        <SimPill />
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
              {[...tokens].sort((a, b) => b.r.wins - a.r.wins || b.r.wins / (b.r.entries.length || 1) - a.r.wins / (a.r.entries.length || 1)).map((x, i) => (
                <tr key={x.t.id}>
                  <td><Rank i={i} /></td>
                  <td><Link to={`/token/${x.t.id}`} className="row" style={{ gap: 10 }}><TokenLogo token={x.t} size={28} /><b>${x.t.ticker}</b></Link></td>
                  <td className="num up">{x.r.wins}</td>
                  <td className="num down">{x.r.losses}</td>
                  <td className="num">{x.r.entries.length ? Math.round((x.r.wins / x.r.entries.length) * 100) : 0}%</td>
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
            <thead><tr><th>#</th><th>Trader</th><th className="num">{tab === 'traders' ? 'Loyalty pts' : 'Battles'}</th><th className="num">{tab === 'traders' ? 'Battles' : 'Loyalty pts'}</th><th className="num">Winning sides</th><th className="num hide-mobile">Rewards</th></tr></thead>
            <tbody>
              {[...allTraders].sort((a, b) => (tab === 'traders' ? b.points - a.points : b.battles - a.battles)).map((x, i) => (
                <tr key={x.name} className={x.you ? 'mine' : ''}>
                  <td><Rank i={i} /></td>
                  <td><span className="row" style={{ gap: 8 }}><span className="avatar">{x.you ? '🫵' : x.name[0].toUpperCase()}</span><span><b>{x.name}</b><div className="dim mono" style={{ fontSize: 11 }}>{x.wallet}</div></span></span></td>
                  <td className="num">{num(tab === 'traders' ? x.points : x.battles, false)}</td>
                  <td className="num muted">{num(tab === 'traders' ? x.battles : x.points, false)}</td>
                  <td className="num">{x.winning}</td>
                  <td className="num hide-mobile">{x.rewards.toFixed(2)} SOL</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'creators' && (
          <table className="table">
            <thead><tr><th>#</th><th>Creator</th><th className="num">Battle wins</th><th className="num">Participants</th><th className="num hide-mobile">Tokens</th><th className="hide-mobile">Projects</th></tr></thead>
            <tbody>
              {[...creators].sort((a, b) => b.wins - a.wins || b.participants - a.participants).map((x, i) => (
                <tr key={x.c.id}>
                  <td><Rank i={i} /></td>
                  <td><Link to={`/creator/${x.c.id}`} className="row" style={{ gap: 8 }}><span className="avatar">{x.c.avatar}</span><span><b>{x.c.name}</b><div className="dim" style={{ fontSize: 11 }}>@{x.c.handle}</div></span></Link></td>
                  <td className="num up">{x.wins}</td>
                  <td className="num">{num(x.participants)}</td>
                  <td className="num hide-mobile">{x.c.history.tokensLaunched}</td>
                  <td className="hide-mobile"><span className="row" style={{ gap: 4 }}>{x.toks.map((t) => <TokenLogo key={t.id} token={t} size={22} />)}</span></td>
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
