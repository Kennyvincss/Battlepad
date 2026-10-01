import { Link, useParams } from 'react-router-dom';
import { useData } from '../data/DataContext';
import { ago, duration, num, price as fmtPrice, quoteToUsd, short, usd } from '../lib/format';
import { liquidityQuote } from '../lib/amm';
import { TradePanel } from '../components/TradePanel';
import { BattleCard } from '../components/BattleCard';
import { SimPill, StreakBadge, TokenLogo, sideStyle } from '../components/ui';

export function BattleRecord({ tokenId }: { tokenId: string }) {
  const e = useData();
  const t = e.tokens[tokenId];
  const r = e.recordFor(tokenId);
  const rate = r.entries.length ? r.wins / r.entries.length : 0;
  return (
    <div className="panel record" style={sideStyle(t.hue)}>
      <div className="record-glow" />
      <div className="record-head">
        <div className="row" style={{ gap: 12 }}>
          <TokenLogo token={t} size={48} />
          <div>
            <div className="label">Battle record</div>
            <div className="display" style={{ fontSize: 26, fontWeight: 700 }}>${t.ticker}</div>
          </div>
        </div>
        <SimPill />
      </div>
      <div className="record-big">
        <div><span className="record-n up">{r.wins}</span><span className="record-l">Wins</span></div>
        <div className="record-sep" />
        <div><span className="record-n down">{r.losses}</span><span className="record-l">Losses</span></div>
        <div className="record-sep" />
        <div><span className="record-n">{Math.round(rate * 100)}%</span><span className="record-l">Win rate</span></div>
        <div className="record-sep" />
        <div><span className="record-n gold">{r.best}</span><span className="record-l">Best streak</span></div>
      </div>
      {r.streak >= 1 && (
        <div className="record-streak">
          <div className="row" style={{ gap: 6 }}>
            {r.entries.slice(0, r.streak).reverse().map((x) => <span key={x.battleId} className="streak-trophy">🏆</span>)}
          </div>
          <div className="display" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '0.08em' }}>🔥 {r.streak} BATTLE WIN STREAK</div>
        </div>
      )}
      <div className="record-list">
        {r.entries.map((x) => {
          const o = e.tokens[x.opponentId];
          const sim = e.getBattle(x.battleId);
          const row = (
            <>
              <span className={`record-res ${x.won ? 'w' : 'l'}`}>{x.won ? '🏆' : '❌'}</span>
              <span className="row grow" style={{ gap: 6 }}>
                <b>{t.ticker}</b><span className="dim">vs</span><TokenLogo token={o} size={20} /><span>{o.ticker}</span>
              </span>
              <span className="mono" style={{ fontSize: 12 }}>{x.scoreFor.toFixed(1)}–{x.scoreAgainst.toFixed(1)}</span>
              <span className="mono dim hide-mobile" style={{ fontSize: 11.5, width: 64, textAlign: 'right' }}>{duration(x.durationMs)}</span>
              <span className="mono dim" style={{ fontSize: 11.5, width: 64, textAlign: 'right' }}>{ago(e.now - x.endedAt)}</span>
            </>
          );
          return sim ? <Link key={x.battleId} to={`/battle/${sim.id}`} className="record-row">{row}</Link> : <div key={x.battleId} className="record-row">{row}</div>;
        })}
        {r.entries.length === 0 && <div className="empty">No battles yet.</div>}
      </div>
    </div>
  );
}

export function TokenPage() {
  const { id } = useParams();
  const e = useData();
  const t = id ? e.tokens[id] : undefined;
  if (!t) return <div className="page"><div className="panel empty">Token not found.</div></div>;
  const m = e.markets[t.id];
  const creator = e.creators[t.creatorId];
  const battle = e.battleForToken(t.id);
  const active = battle && (battle.status === 'live' || battle.status === 'scheduled' || battle.status === 'pending') ? battle : undefined;
  const pos = e.wallet.positions[t.id];
  const r = e.recordFor(t.id);
  return (
    <div className="page">
      <div className="token-hero panel" style={sideStyle(t.hue)}>
        <div className="token-hero-glow" />
        <TokenLogo token={t} size={88} />
        <div className="grow">
          <div className="row wrap" style={{ gap: 8 }}>
            <h1 className="page-title" style={{ fontSize: 44 }}>${t.ticker}</h1>
            <StreakBadge streak={r.streak} size="lg" />
            {active?.status === 'live' && <Link to={`/battle/${active.id}`} className="pill pill-live">In battle</Link>}
          </div>
          <div className="muted" style={{ fontSize: 15, marginTop: 4 }}>{t.name} · by <Link className="link" to={`/creator/${creator.id}`}>{creator.name}</Link></div>
          <p style={{ color: 'var(--text-2)', maxWidth: 640, margin: '10px 0 0' }}>{t.description}</p>
          <div className="row wrap" style={{ gap: 14, marginTop: 10, fontSize: 12 }}>
            <span className="hash">Mint {short(t.mint, 6)}</span>
            {t.socials.website && <a className="link" href={t.socials.website} onClick={(ev) => ev.preventDefault()}>Website</a>}
            {t.socials.x && <a className="link" href={t.socials.x} onClick={(ev) => ev.preventDefault()}>X</a>}
            {t.socials.telegram && <a className="link" href={t.socials.telegram} onClick={(ev) => ev.preventDefault()}>Telegram</a>}
          </div>
        </div>
        <div className="col" style={{ gap: 8, alignItems: 'flex-end' }}>
          <Link to={`/create-battle?opponent=${t.id}`} className="btn btn-battle">⚔️ Challenge ${t.ticker}</Link>
          <SimPill />
        </div>
      </div>

      <div className="grid grid-4" style={{ marginTop: 14 }}>
        {[
          ['Price', fmtPrice(m.price)],
          ['Market cap', usd(quoteToUsd(m.price * t.totalSupply))],
          ['Liquidity', usd(quoteToUsd(liquidityQuote(m)))],
          ['Holders', num(m.holders, false)],
        ].map(([l, v]) => (
          <div key={l} className="panel panel-pad stat"><span className="stat-l">{l}</span><span className="stat-v">{v}</span></div>
        ))}
      </div>

      <div className="battle-grid" style={{ marginTop: 14 }}>
        <div className="battle-main">
          {active && (
            <div>
              <div className="section-head"><h2 className="section-title">{active.status === 'live' ? '⚔️ Current battle' : '🗓 Next battle'}</h2></div>
              <BattleCard battle={active} />
            </div>
          )}
          <BattleRecord tokenId={t.id} />
        </div>
        <aside className="battle-side">
          <TradePanel tokens={[t]} battle={active?.status === 'live' ? active : undefined} />
          {pos && pos.amount > 0 && e.wallet.connected && (
            <div className="panel panel-pad">
              <div className="label">Your position</div>
              <div className="stat-v" style={{ marginTop: 4 }}>{usd(quoteToUsd(pos.amount * m.price), { compact: false })}</div>
              <div className="muted mono" style={{ fontSize: 12 }}>{num(pos.amount)} {t.ticker} · cost {usd(quoteToUsd(pos.costQuote), { compact: false })}</div>
            </div>
          )}
          <div className="callout callout-info" style={{ fontSize: 12.5 }}>
            <span>ℹ️</span><span>Battle results don't change how ${t.ticker} trades. Losing tokens keep trading; winning doesn't guarantee future price appreciation.</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
