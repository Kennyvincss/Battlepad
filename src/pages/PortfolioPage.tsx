import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../data/DataContext';
import { useUi } from '../components/AppState';
import { num, short, sol, solscanAccount, usd } from '../lib/format';
import { TokenLogo, sideColor, sideStyle } from '../components/ui';

type Stats = { battles: number; trades: number; volume_usd: number; winning_sides: number } | null;

export function PortfolioPage() {
  const e = useData();
  const ui = useUi();
  const w = e.wallet;
  const [stats, setStats] = useState<Stats | undefined>();
  useEffect(() => {
    if (!w.address) return;
    void e.loadTraderStats().then((rows) => setStats(rows.find((r) => r.wallet === w.address) ?? null));
  }, [e, w.address]);

  if (!w.connected || !w.address) {
    return (
      <div className="page page-narrow">
        <div className="panel empty" style={{ padding: 60 }}>
          <div style={{ fontSize: 46 }}>🫵</div>
          <h2 className="display" style={{ fontSize: 28, margin: '10px 0' }}>Your battle profile</h2>
          <p className="muted">Connect a wallet to see your positions, armies, battles and listed tokens.</p>
          <button className="btn btn-primary btn-lg" onClick={ui.openWallet}>Connect Wallet</button>
        </div>
      </div>
    );
  }

  const positions = Object.entries(w.tokens).filter(([, v]) => v.amount > 0).map(([mint, v]) => {
    const t = e.tokens[mint];
    const m = e.markets[mint];
    const b = t ? e.battleForToken(mint) : undefined;
    return { mint, t, amount: v.amount, value: m ? v.amount * m.priceUsd : null, live: b?.status === 'live' ? b : undefined };
  });
  const listed = positions.filter((p) => p.t).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const otherCount = positions.length - listed.length;
  const tokenValue = listed.reduce((s, p) => s + (p.value ?? 0), 0);
  const solValue = w.solBalance !== null && e.solUsd !== null ? w.solBalance * e.solUsd : null;
  const myTokens = e.myTokens();
  const mineSet = new Set(myTokens.map((t) => t.id));
  const challenges = e.battles.filter((b) => b.status === 'pending' && (mineSet.has(b.a.tokenId) || mineSet.has(b.b.tokenId)));
  const armies = Object.entries(e.armies).map(([bid, tid]) => ({ b: e.getBattle(bid), t: e.tokens[tid] })).filter((x) => x.b && x.t);

  return (
    <div className="page">
      <div className="panel panel-pad profile-hero">
        <span className="avatar avatar-xl mono" style={{ fontSize: 22 }}>{w.address.slice(0, 2)}</span>
        <div className="grow">
          <div className="row wrap" style={{ gap: 10 }}>
            <h1 className="page-title" style={{ fontSize: 36 }}>Your profile</h1>
            {w.signedIn ? <span className="pill pill-up">Signed in</span> : <button className="btn btn-sm" onClick={() => void ui.requireSignIn()}>Sign in to chat & challenge</button>}
          </div>
          <a className="mono muted link" href={solscanAccount(w.address)} target="_blank" rel="noopener noreferrer">{w.provider} · {short(w.address, 6)} ↗</a>
          <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
            {listed.filter((x) => x.live).map((x) => (
              <Link key={x.mint} to={`/battle/${x.live!.id}`} className="army-chip" style={sideStyle(x.t!.hue)}>{x.t!.ticker} ARMY <b className="mono">{usd(x.value)}</b> position</Link>
            ))}
          </div>
        </div>
        <div className="col" style={{ alignItems: 'flex-end', gap: 6 }}>
          <div className="label">Portfolio value (listed tokens + SOL)</div>
          <div className="stat-v" style={{ fontSize: 28 }}>{solValue !== null ? usd(tokenValue + solValue) : '…'}</div>
          <div className="muted mono" style={{ fontSize: 12 }}>{w.solBalance !== null ? sol(w.solBalance) : '…'} + {usd(tokenValue)} in battle tokens</div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm" onClick={() => void e.refreshBalances()}>Refresh</button>
            <button className="btn btn-sm" onClick={() => void e.disconnectWallet()}>Disconnect</button>
          </div>
        </div>
      </div>

      <div className="grid stats-5" style={{ marginTop: 14 }}>
        {[
          ['Battle trades', stats === undefined ? '…' : num(stats?.trades ?? 0, false)],
          ['Battles participated', stats === undefined ? '…' : String(stats?.battles ?? 0)],
          ['Winning sides', stats === undefined ? '…' : String(stats?.winning_sides ?? 0)],
          ['Battle volume', stats === undefined ? '…' : usd(stats?.volume_usd ?? 0)],
          ['Tokens listed', String(myTokens.length)],
        ].map(([l, v]) => <div key={l} className="panel panel-pad stat"><span className="stat-l">{l}</span><span className="stat-v">{v}</span></div>)}
      </div>

      <div className="battle-grid" style={{ marginTop: 14 }}>
        <div className="battle-main">
          <div className="panel table-wrap">
            <div className="panel-head"><span className="panel-title">💼 Current positions</span><span className="dim" style={{ fontSize: 11.5 }}>From your wallet on-chain</span></div>
            <table className="table">
              <thead><tr><th>Token</th><th className="num">Amount</th><th className="num">Value</th><th>Status</th></tr></thead>
              <tbody>
                {listed.map(({ mint, t, amount, value, live }) => (
                  <tr key={mint}>
                    <td><Link to={`/token/${mint}`} className="row" style={{ gap: 8 }}><TokenLogo token={t!} size={26} /><b>${t!.ticker}</b></Link></td>
                    <td className="num">{num(amount)}</td>
                    <td className="num">{usd(value, { compact: false })}</td>
                    <td>{live ? <Link to={`/battle/${live.id}`} className="army-chip sm" style={sideStyle(t!.hue)}>{t!.ticker} ARMY · live</Link> : <span className="dim">—</span>}</td>
                  </tr>
                ))}
                {listed.length === 0 && <tr><td colSpan={4} className="empty">You don't hold any battle tokens. <Link to="/" className="link">Join a battle →</Link></td></tr>}
              </tbody>
            </table>
            {otherCount > 0 && <div className="dim" style={{ fontSize: 12, padding: '0 16px 12px' }}>+ {otherCount} other token{otherCount === 1 ? '' : 's'} in this wallet that aren't listed on BATTLE.</div>}
          </div>

          <div className="panel">
            <div className="panel-head"><span className="panel-title">⚔️ Your armies</span><span className="dim" style={{ fontSize: 11.5 }}>Battles where you bought through BATTLE on this device</span></div>
            <div className="record-list" style={{ padding: '6px 16px 12px' }}>
              {armies.length === 0 && <div className="empty">Buy a side in a live battle to join its army.</div>}
              {armies.map(({ b, t }) => {
                const ended = b!.status === 'ended';
                const won = ended && b!.winner === t!.id;
                const opp = e.tokens[b!.a.tokenId === t!.id ? b!.b.tokenId : b!.a.tokenId];
                return (
                  <Link key={b!.id} to={`/battle/${b!.id}`} className="record-row">
                    <span className={`record-res ${won ? 'w' : ended ? 'l' : ''}`}>{ended ? (won ? '🏆' : '❌') : '⚔️'}</span>
                    <span className="row grow" style={{ gap: 6 }}><TokenLogo token={t!} size={20} /><b style={{ color: sideColor(t!.hue, 70) }}>{t!.ticker} ARMY</b><span className="dim">vs</span>{opp?.ticker}</span>
                    <span className="mono dim" style={{ fontSize: 12 }}>#{b!.number} · {ended ? (won ? 'Won' : 'Lost') : 'Live'}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="battle-side">
          <div className="panel">
            <div className="panel-head"><span className="panel-title">🛠 Your tokens</span><Link to="/launch" className="btn btn-sm">+ List</Link></div>
            <div className="panel-pad col" style={{ gap: 10 }}>
              {myTokens.length === 0 && <div className="muted" style={{ fontSize: 13 }}>You haven't listed a token.</div>}
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
              {challenges.length === 0 && <div className="muted" style={{ fontSize: 13 }}>No open challenges.</div>}
              {challenges.map((c) => {
                const incoming = mineSet.has(c.b.tokenId);
                const a = e.tokens[c.a.tokenId], b = e.tokens[c.b.tokenId];
                return (
                  <Link key={c.id} to={`/challenge/${c.id}`} className="spread">
                    <span className="row" style={{ gap: 6 }}>{a && <TokenLogo token={a} size={20} />}${a?.ticker}<span className="dim">→</span>{b && <TokenLogo token={b} size={20} />}${b?.ticker}</span>
                    <span className={`pill ${incoming ? 'pill-sd' : ''}`}>{incoming ? 'Respond' : 'Sent'}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
