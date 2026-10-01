import { Link } from 'react-router-dom';
import { useData } from '../data/DataContext';
import { useUi } from '../components/AppState';
import { ago, num, pct, quoteToUsd, short, sol, usd } from '../lib/format';
import { userStats } from '../lib/view';
import { SimPill, TokenLogo, sideColor, sideStyle } from '../components/ui';
import { USER_CREATOR_ID } from '../data/seed';

export function PortfolioPage() {
  const e = useData();
  const ui = useUi();
  const w = e.wallet;
  if (!w.connected) {
    return (
      <div className="page page-narrow">
        <div className="panel empty" style={{ padding: 60 }}>
          <div style={{ fontSize: 46 }}>🫵</div>
          <h2 className="display" style={{ fontSize: 28, margin: '10px 0' }}>Your battle profile</h2>
          <p className="muted">Connect a wallet to see your positions, armies, battle loyalty and history.</p>
          <button className="btn btn-primary btn-lg" onClick={ui.openWallet}>Connect Wallet</button>
        </div>
      </div>
    );
  }
  const s = userStats(e);
  const positions = Object.values(w.positions).filter((p) => p.amount > 0).map((p) => {
    const t = e.tokens[p.tokenId];
    const m = e.markets[p.tokenId];
    const value = p.amount * m.price;
    const b = e.battleForToken(p.tokenId);
    const live = b?.status === 'live' ? b : undefined;
    return { p, t, value, pnl: p.costQuote > 0 ? value / p.costQuote - 1 : 0, live };
  }).sort((a, b) => b.value - a.value);
  const total = positions.reduce((x, y) => x + y.value, 0);
  const myTokens = Object.values(e.tokens).filter((t) => t.creatorId === USER_CREATOR_ID);
  const fav = [...positions].slice(0, 4);
  const armyBattles = Object.entries(w.armies).map(([bid, tid]) => ({ b: e.getBattle(bid)!, t: e.tokens[tid] })).filter((x) => x.b);
  const pastSeed = e.history.filter((h) => h.won).slice(-6).reverse();

  return (
    <div className="page">
      <div className="panel panel-pad profile-hero">
        <span className="avatar avatar-xl">🫵</span>
        <div className="grow">
          <div className="row wrap" style={{ gap: 10 }}>
            <h1 className="page-title" style={{ fontSize: 36 }}>Your profile</h1>
            <SimPill text="Demo wallet" />
          </div>
          <div className="mono muted" style={{ marginTop: 6 }}>{w.provider} · {short(w.address, 6)}</div>
          <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
            {positions.filter((x) => x.live).map((x) => (
              <span key={x.t.id} className="army-chip" style={sideStyle(x.t.hue)}>{x.t.logo} {x.t.ticker} ARMY <b className="mono">{usd(quoteToUsd(x.value))}</b> position</span>
            ))}
          </div>
        </div>
        <div className="col" style={{ alignItems: 'flex-end', gap: 6 }}>
          <div className="label">Portfolio value</div>
          <div className="stat-v" style={{ fontSize: 28 }}>{usd(quoteToUsd(total + w.quoteBalance))}</div>
          <div className="muted mono" style={{ fontSize: 12 }}>{sol(w.quoteBalance)} + {sol(total)} in tokens</div>
          <button className="btn btn-sm" onClick={() => e.disconnectWallet()}>Disconnect</button>
        </div>
      </div>

      <div className="grid stats-5" style={{ marginTop: 14 }}>
        {[
          ['Total trades', num(s.totalTrades, false)],
          ['Battles participated', String(s.battles)],
          ['Winning sides', `${s.winningSides} (${Math.round((s.winningSides / s.battles) * 100)}%)`],
          ['Battle rewards', sol(s.rewardsQuote, 3)],
          ['Loyalty points', num(s.loyaltyPoints, false)],
        ].map(([l, v]) => <div key={l} className="panel panel-pad stat"><span className="stat-l">{l}</span><span className="stat-v">{v}</span></div>)}
      </div>

      <div className="battle-grid" style={{ marginTop: 14 }}>
        <div className="battle-main">
          <div className="panel table-wrap">
            <div className="panel-head"><span className="panel-title">💼 Current positions</span></div>
            <table className="table">
              <thead><tr><th>Token</th><th className="num">Amount</th><th className="num">Value</th><th className="num">P/L</th><th>Status</th></tr></thead>
              <tbody>
                {positions.map(({ p, t, value, pnl, live }) => (
                  <tr key={t.id}>
                    <td><Link to={`/token/${t.id}`} className="row" style={{ gap: 8 }}><TokenLogo token={t} size={26} /><b>${t.ticker}</b></Link></td>
                    <td className="num">{num(p.amount)}</td>
                    <td className="num">{usd(quoteToUsd(value), { compact: false })}</td>
                    <td className={`num ${pnl >= 0 ? 'up' : 'down'}`}>{pct(pnl)}</td>
                    <td>{live ? <Link to={`/battle/${live.id}`} className="army-chip sm" style={sideStyle(t.hue)}>{t.logo} {t.ticker} ARMY · live</Link> : <span className="dim">—</span>}</td>
                  </tr>
                ))}
                {positions.length === 0 && <tr><td colSpan={5} className="empty">No positions. <Link to="/" className="link">Join a battle →</Link></td></tr>}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <div className="panel-head"><span className="panel-title">⚔️ Battle history</span><SimPill /></div>
            <div className="record-list" style={{ padding: '6px 16px 12px' }}>
              {armyBattles.map(({ b, t }) => {
                const ended = b.status === 'ended';
                const won = ended && b.winner === t.id;
                const opp = e.tokens[b.a.tokenId === t.id ? b.b.tokenId : b.a.tokenId];
                return (
                  <Link key={b.id} to={`/battle/${b.id}`} className="record-row">
                    <span className={`record-res ${won ? 'w' : ended ? 'l' : ''}`}>{ended ? (won ? '🏆' : '❌') : '⚔️'}</span>
                    <span className="row grow" style={{ gap: 6 }}><TokenLogo token={t} size={20} /><b style={{ color: sideColor(t.hue, 70) }}>{t.ticker} ARMY</b><span className="dim">vs</span>{opp.ticker}</span>
                    <span className="mono dim" style={{ fontSize: 12 }}>{ended ? (won ? 'Won' : 'Lost') : 'Live'}</span>
                  </Link>
                );
              })}
              {pastSeed.map((h) => (
                <div key={h.battleId} className="record-row">
                  <span className="record-res w">🏆</span>
                  <span className="row grow" style={{ gap: 6 }}><TokenLogo token={e.tokens[h.tokenId]} size={20} /><b>{e.tokens[h.tokenId].ticker} ARMY</b><span className="dim">vs</span>{e.tokens[h.opponentId].ticker}</span>
                  <span className="mono dim" style={{ fontSize: 12 }}>{ago(e.now - h.endedAt)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel table-wrap">
            <div className="panel-head"><span className="panel-title">🧾 Recent trades</span></div>
            <table className="table">
              <thead><tr><th>Time</th><th>Token</th><th>Side</th><th className="num">SOL</th><th className="num">Tokens</th></tr></thead>
              <tbody>
                {w.trades.slice(0, 20).map((t) => (
                  <tr key={t.id}>
                    <td className="mono dim">{ago(e.now - t.t)}</td>
                    <td>{e.tokens[t.tokenId].logo} {e.tokens[t.tokenId].ticker}</td>
                    <td className={t.side === 'buy' ? 'up' : 'down'} style={{ fontWeight: 700 }}>{t.side.toUpperCase()}</td>
                    <td className="num">{t.quoteAmount.toFixed(3)}</td>
                    <td className="num">{num(t.tokenAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="battle-side">
          <div className="panel">
            <div className="panel-head"><span className="panel-title">⭐ Favorite tokens</span></div>
            <div className="panel-pad col" style={{ gap: 10 }}>
              {fav.map(({ t }) => <Link key={t.id} to={`/token/${t.id}`} className="row" style={{ gap: 8 }}><TokenLogo token={t} size={26} /><b>${t.ticker}</b><span className="muted">{t.name}</span></Link>)}
            </div>
          </div>
          <div className="panel">
            <div className="panel-head"><span className="panel-title">🛠 Your tokens</span><Link to="/launch" className="btn btn-sm">+ Launch</Link></div>
            <div className="panel-pad col" style={{ gap: 10 }}>
              {myTokens.map((t) => (
                <div key={t.id} className="spread">
                  <Link to={`/token/${t.id}`} className="row" style={{ gap: 8 }}><TokenLogo token={t} size={26} /><b>${t.ticker}</b></Link>
                  <Link to={`/create-battle?token=${t.id}`} className="btn btn-battle btn-sm">⚔️ Challenge</Link>
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="panel-head"><span className="panel-title">📨 Challenges</span></div>
            <div className="panel-pad col" style={{ gap: 10 }}>
              {e.challenges.map((c) => (
                <Link key={c.id} to={c.incoming ? `/challenge/${c.id}` : '#'} className="spread">
                  <span className="row" style={{ gap: 6 }}><TokenLogo token={e.tokens[c.fromTokenId]} size={20} />${e.tokens[c.fromTokenId].ticker}<span className="dim">→</span><TokenLogo token={e.tokens[c.toTokenId]} size={20} />${e.tokens[c.toTokenId].ticker}</span>
                  <span className={`pill ${c.status === 'pending' ? 'pill-sd' : c.status === 'accepted' ? 'pill-up' : ''}`}>{c.incoming && c.status === 'pending' ? 'Respond' : c.status}</span>
                </Link>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
