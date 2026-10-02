import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../data/DataContext';
import { num, pct, price as fmtPrice, usd } from '../lib/format';
import { SourceTag, StreakBadge, TokenLogo } from '../components/ui';
import { isAutoListed } from '../lib/view';

type Filter = 'all' | 'new' | 'pump' | 'battle' | 'free';
type Sort = 'mcap' | 'liquidity' | 'volume' | 'change' | 'newest' | 'wins';
const PAGE = 50;

/** Coins: every coin on BATTLE (listed by people or auto-listed from pump.fun) with live market data. */
export function DiscoverPage() {
  const e = useData();
  const nav = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('mcap');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);
  const rows = Object.values(e.tokens).map((t) => {
    const m = e.markets[t.id];
    const b = e.battleForToken(t.id);
    const r = e.recordFor(t.id);
    return { t, m, b, live: b?.status === 'live' ? b : undefined, r };
  })
    .filter((x) => filter === 'all' || (filter === 'new' && e.now - x.t.listedAt < 86_400_000) || (filter === 'pump' && (isAutoListed(x.t) || x.t.dexId === 'pumpfun' || x.t.dexId === 'pumpswap')) || (filter === 'battle' && (x.live || x.b?.status === 'scheduled')) || (filter === 'free' && !x.live && x.b?.status !== 'scheduled'))
    .filter((x) => !q || x.t.ticker.toLowerCase().includes(q.toLowerCase()) || x.t.name.toLowerCase().includes(q.toLowerCase()) || x.t.mint === q)
    .sort((a, b) => {
      if (sort === 'wins') return b.r.wins - a.r.wins || b.r.streak - a.r.streak;
      if (sort === 'newest') return b.t.listedAt - a.t.listedAt;
      if (sort === 'change') return (b.m?.change24 ?? -Infinity) - (a.m?.change24 ?? -Infinity);
      const k = sort === 'mcap' ? 'mcapUsd' : sort === 'liquidity' ? 'liquidityUsd' : 'volume24Usd';
      return (b.m?.[k] ?? 0) - (a.m?.[k] ?? 0);
    });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">🪙 Coins</h1>
          <div className="page-sub">Every coin on BATTLE with live prices. pump.fun coins with over $10K liquidity are added automatically. Tap a coin to trade it, or start a battle with it.</div>
        </div>
        <SourceTag text="DexScreener · live" />
      </div>
      <div className="spread wrap" style={{ marginBottom: 14 }}>
        <div className="seg">
          {([['all', 'All'], ['new', '🆕 New'], ['pump', '💊 pump.fun'], ['battle', '⚔️ In battle'], ['free', 'Free to battle']] as const).map(([k, l]) => (
            <button key={k} className={filter === k ? 'active' : ''} onClick={() => { setFilter(k); setShown(PAGE); }}>{l}</button>
          ))}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" id="discover-search" style={{ width: 200, height: 34 }} placeholder="Search or paste mint…" value={q} onChange={(ev) => setQ(ev.target.value.trim())} />
          <select className="select" id="discover-sort" style={{ width: 150, height: 34 }} value={sort} onChange={(ev) => setSort(ev.target.value as Sort)} aria-label="Sort tokens">
            <option value="mcap">Market cap</option>
            <option value="liquidity">Liquidity</option>
            <option value="volume">24h volume</option>
            <option value="change">24h change</option>
            <option value="newest">Newest</option>
            <option value="wins">Battle wins</option>
          </select>
        </div>
      </div>
      <div className="panel table-wrap">
        <table className="table">
          <thead><tr><th>Coin</th><th className="num">Price</th><th className="num">24h</th><th className="num">Market cap</th><th className="num hide-mobile">Liquidity</th><th className="num hide-mobile">24h vol.</th><th>Record</th><th className="hide-mobile">Battle</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={9} className="empty">{Object.keys(e.tokens).length === 0 ? <>No coins yet. <Link className="link" to="/launch">Launch or list the first one →</Link></> : 'No coins match.'}</td></tr>}
            {rows.slice(0, shown).map(({ t, m, live, r, b }) => (
              <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/token/${t.id}`)}>
                <td><span className="row" style={{ gap: 10 }}><TokenLogo token={t} size={32} /><span><span className="row" style={{ gap: 6 }}><b>${t.ticker}</b>{isAutoListed(t) && <span className="pill" style={{ height: 18, fontSize: 9 }}>pump.fun</span>}</span><div className="muted truncate" style={{ fontSize: 12, maxWidth: 180 }}>{t.name}</div></span></span></td>
                <td className="num">{fmtPrice(m?.priceUsd)}</td>
                <td className={`num ${(m?.change24 ?? 0) >= 0 ? 'up' : 'down'}`}>{pct(m?.change24)}</td>
                <td className="num">{usd(m?.mcapUsd)}</td>
                <td className="num hide-mobile">{usd(m?.liquidityUsd)}</td>
                <td className="num hide-mobile">{usd(m?.volume24Usd)}</td>
                <td><span className="row" style={{ gap: 6 }}><span className="mono"><span className="up">{r.wins}</span>-<span className="down">{r.losses}</span></span><StreakBadge streak={r.streak} /></span></td>
                <td className="hide-mobile">
                  {live ? <Link to={`/battle/${live.id}`} onClick={(ev) => ev.stopPropagation()} className="pill pill-live">Live #{live.number}</Link>
                    : b?.status === 'scheduled' ? <Link to={`/battle/${b.id}`} onClick={(ev) => ev.stopPropagation()} className="pill pill-upcoming">Starting</Link> : <span className="dim">—</span>}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  <Link className="btn btn-sm btn-primary" to={`/token/${t.id}`} onClick={(ev) => ev.stopPropagation()}>Trade</Link>
                  {!live && b?.status !== 'scheduled' && <Link className="btn btn-sm hide-mobile" to={`/create-battle?token=${t.id}`} onClick={(ev) => ev.stopPropagation()}>⚔️ Battle</Link>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown && <div className="center" style={{ marginTop: 14 }}><button className="btn" onClick={() => setShown(shown + PAGE)}>Show more · {rows.length - shown} left</button></div>}
      <p className="dim" style={{ fontSize: 12, marginTop: 10 }}>{num(Object.keys(e.tokens).length)} coins. Prices from DexScreener, refreshed every 20 seconds to 2 minutes.</p>
    </div>
  );
}
