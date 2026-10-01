import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../data/DataContext';
import { num, pct, price as fmtPrice, quoteToUsd, usd } from '../lib/format';
import { liquidityQuote } from '../lib/amm';
import { SimPill, Sparkline, StreakBadge, TokenLogo, sideColor } from '../components/ui';

type Filter = 'all' | 'battle' | 'streak' | 'free';
type Sort = 'mcap' | 'holders' | 'wins' | 'streak';

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
    const live = b?.status === 'live' ? b : undefined;
    const side = live ? (live.a.tokenId === t.id ? live.a : live.b) : b && b.status === 'ended' ? (b.a.tokenId === t.id ? b.a : b.b) : undefined;
    const spark = side ? side.history.filter((_, i) => i % Math.max(1, Math.floor(side.history.length / 30)) === 0).map((p) => p.price) : [];
    return { t, m, b, live, r, mcap: quoteToUsd(m.price * t.totalSupply), change: side ? m.price / side.startPrice - 1 : 0, spark };
  })
    .filter((x) => filter === 'all' || (filter === 'battle' && x.live) || (filter === 'streak' && x.r.streak >= 2) || (filter === 'free' && !x.live && x.b?.status !== 'scheduled'))
    .filter((x) => !q || x.t.ticker.toLowerCase().includes(q.toLowerCase()) || x.t.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (sort === 'mcap' ? b.mcap - a.mcap : sort === 'holders' ? b.m.holders - a.m.holders : sort === 'wins' ? b.r.wins - a.r.wins : b.r.streak - a.r.streak));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">🧭 Discover</h1>
          <div className="page-sub">Every token on BATTLE with its live market and battle record. Find your next opponent — or your next army.</div>
        </div>
        <SimPill />
      </div>
      <div className="spread wrap" style={{ marginBottom: 14 }}>
        <div className="seg">
          {([['all', 'All'], ['battle', '⚔️ In battle'], ['streak', '🔥 On a streak'], ['free', 'Open to challenge']] as const).map(([k, l]) => (
            <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" style={{ width: 200, height: 34 }} placeholder="Search…" value={q} onChange={(ev) => setQ(ev.target.value)} />
          <select className="select" style={{ width: 150, height: 34 }} value={sort} onChange={(ev) => setSort(ev.target.value as Sort)}>
            <option value="mcap">Market cap</option>
            <option value="holders">Holders</option>
            <option value="wins">Battle wins</option>
            <option value="streak">Win streak</option>
          </select>
        </div>
      </div>
      <div className="panel table-wrap">
        <table className="table">
          <thead><tr><th>Token</th><th className="num">Price</th><th className="num">Market cap</th><th className="num hide-mobile">Liquidity</th><th className="num hide-mobile">Holders</th><th>Record</th><th className="hide-mobile">Battle</th><th></th></tr></thead>
          <tbody>
            {rows.map(({ t, m, live, r, mcap, change, spark, b }) => (
              <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/token/${t.id}`)}>
                <td><span className="row" style={{ gap: 10 }}><TokenLogo token={t} size={32} /><span><b>${t.ticker}</b><div className="muted" style={{ fontSize: 12 }}>{t.name}</div></span></span></td>
                <td className="num">{fmtPrice(m.price)}</td>
                <td className="num">{usd(mcap)}</td>
                <td className="num hide-mobile">{usd(quoteToUsd(liquidityQuote(m)))}</td>
                <td className="num hide-mobile">{num(m.holders, false)}</td>
                <td><span className="row" style={{ gap: 6 }}><span className="mono"><span className="up">{r.wins}</span>-<span className="down">{r.losses}</span></span><StreakBadge streak={r.streak} /></span></td>
                <td className="hide-mobile">
                  {live ? (
                    <Link to={`/battle/${live.id}`} onClick={(ev) => ev.stopPropagation()} className="row" style={{ gap: 8 }}>
                      <span className="pill pill-live">Live</span>
                      <span className={`mono ${change >= 0 ? 'up' : 'down'}`} style={{ fontSize: 12 }}>{pct(change)}</span>
                      <Sparkline points={spark} color={sideColor(t.hue)} width={70} height={22} fill={false} />
                    </Link>
                  ) : b?.status === 'scheduled' ? <span className="pill pill-upcoming">Upcoming</span> : <span className="dim">—</span>}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {!live && b?.status !== 'scheduled' && <Link className="btn btn-sm" to={`/create-battle?opponent=${t.id}`} onClick={(ev) => ev.stopPropagation()}>⚔️ Challenge</Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
