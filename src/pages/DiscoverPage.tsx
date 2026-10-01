import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../data/DataContext';
import { num, pct, price as fmtPrice, usd } from '../lib/format';
import { SourceTag, StreakBadge, TokenLogo } from '../components/ui';

type Filter = 'all' | 'battle' | 'streak' | 'free';
type Sort = 'mcap' | 'liquidity' | 'volume' | 'wins' | 'streak';

export function DiscoverPage() {
  const e = useData();
  const nav = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('mcap');
  const [q, setQ] = useState('');
  const rows = Object.values(e.tokens).map((t) => {
    const m = e.markets[t.id];
    const b = e.battleForToken(t.id);
    const r = e.recordFor(t.id);
    return { t, m, b, live: b?.status === 'live' ? b : undefined, r };
  })
    .filter((x) => filter === 'all' || (filter === 'battle' && x.live) || (filter === 'streak' && x.r.streak >= 2) || (filter === 'free' && !x.live && x.b?.status !== 'scheduled'))
    .filter((x) => !q || x.t.ticker.toLowerCase().includes(q.toLowerCase()) || x.t.name.toLowerCase().includes(q.toLowerCase()) || x.t.mint === q)
    .sort((a, b) => {
      if (sort === 'wins') return b.r.wins - a.r.wins;
      if (sort === 'streak') return b.r.streak - a.r.streak;
      const k = sort === 'mcap' ? 'mcapUsd' : sort === 'liquidity' ? 'liquidityUsd' : 'volume24Usd';
      return (b.m?.[k] ?? 0) - (a.m?.[k] ?? 0);
    });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">🧭 Discover</h1>
          <div className="page-sub">Every token listed on BATTLE with its live market and battle record. Find your next opponent — or your next army.</div>
        </div>
        <SourceTag text="DexScreener · live" />
      </div>
      <div className="spread wrap" style={{ marginBottom: 14 }}>
        <div className="seg">
          {([['all', 'All'], ['battle', '⚔️ In battle'], ['streak', '🔥 On a streak'], ['free', 'Open to challenge']] as const).map(([k, l]) => (
            <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" id="discover-search" style={{ width: 200, height: 34 }} placeholder="Search or paste mint…" value={q} onChange={(ev) => setQ(ev.target.value.trim())} />
          <select className="select" id="discover-sort" style={{ width: 150, height: 34 }} value={sort} onChange={(ev) => setSort(ev.target.value as Sort)} aria-label="Sort tokens">
            <option value="mcap">Market cap</option>
            <option value="liquidity">Liquidity</option>
            <option value="volume">24h volume</option>
            <option value="wins">Battle wins</option>
            <option value="streak">Win streak</option>
          </select>
        </div>
      </div>
      <div className="panel table-wrap">
        <table className="table">
          <thead><tr><th>Token</th><th className="num">Price</th><th className="num">24h</th><th className="num">Market cap</th><th className="num hide-mobile">Liquidity</th><th className="num hide-mobile">24h vol.</th><th>Record</th><th className="hide-mobile">Battle</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={9} className="empty">{Object.keys(e.tokens).length === 0 ? <>No tokens listed yet. <Link className="link" to="/launch">List the first one →</Link></> : 'No tokens match.'}</td></tr>}
            {rows.map(({ t, m, live, r, b }) => (
              <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/token/${t.id}`)}>
                <td><span className="row" style={{ gap: 10 }}><TokenLogo token={t} size={32} /><span><b>${t.ticker}</b><div className="muted" style={{ fontSize: 12 }}>{t.name}</div></span></span></td>
                <td className="num">{fmtPrice(m?.priceUsd)}</td>
                <td className={`num ${(m?.change24 ?? 0) >= 0 ? 'up' : 'down'}`}>{pct(m?.change24)}</td>
                <td className="num">{usd(m?.mcapUsd)}</td>
                <td className="num hide-mobile">{usd(m?.liquidityUsd)}</td>
                <td className="num hide-mobile">{usd(m?.volume24Usd)}</td>
                <td><span className="row" style={{ gap: 6 }}><span className="mono"><span className="up">{r.wins}</span>-<span className="down">{r.losses}</span></span><StreakBadge streak={r.streak} /></span></td>
                <td className="hide-mobile">
                  {live ? <Link to={`/battle/${live.id}`} onClick={(ev) => ev.stopPropagation()} className="pill pill-live">Live #{live.number}</Link>
                    : b?.status === 'scheduled' ? <span className="pill pill-upcoming">Upcoming</span> : <span className="dim">—</span>}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {!live && b?.status !== 'scheduled' && <Link className="btn btn-sm" to={`/create-battle?opponent=${t.id}`} onClick={(ev) => ev.stopPropagation()}>⚔️ Challenge</Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dim" style={{ fontSize: 12, marginTop: 10 }}>Holder counts appear once a token has battled (read by the battle keeper). <span className="muted">{num(Object.keys(e.tokens).length)} tokens listed.</span></p>
    </div>
  );
}
