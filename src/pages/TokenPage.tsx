import { Link, useParams } from 'react-router-dom';
import { useData } from '../data/DataContext';
import { ago, duration, num, pct, price as fmtPrice, short, usd } from '../lib/format';
import { TradePanel } from '../components/TradePanel';
import { isAutoListed } from '../lib/view';
import { BattleCard } from '../components/BattleCard';
import { SourceTag, StreakBadge, TokenLogo, sideStyle } from '../components/ui';

export function BattleRecord({ tokenId }: { tokenId: string }) {
  const e = useData();
  const t = e.token(tokenId);
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
        <SourceTag text="Live" />
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
          const o = e.token(x.opponentId);
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
  if (!t) return <div className="page"><div className="panel empty">{e.ready ? 'Token not listed on BATTLE.' : 'Loading…'}</div></div>;
  const m = e.markets[t.id];
  const battle = e.battleForToken(t.id);
  const active = battle && (battle.status === 'live' || battle.status === 'scheduled' || battle.status === 'pending') ? battle : undefined;
  const held = e.wallet.tokens[t.id]?.amount ?? 0;
  const r = e.recordFor(t.id);
  const ext = (href?: string, label?: string) => href ? <a className="link" href={href} target="_blank" rel="noopener noreferrer">{label} ↗</a> : null;
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
          <div className="muted" style={{ fontSize: 15, marginTop: 4 }}>{t.name} · {isAutoListed(t) ? <>auto-listed from pump.fun</> : <>listed by <Link className="link mono" to={`/creator/${t.listedBy}`}>{short(t.listedBy)}</Link></>}</div>
          {t.description && <p style={{ color: 'var(--text-2)', maxWidth: 640, margin: '10px 0 0' }}>{t.description}</p>}
          <div className="row wrap" style={{ gap: 14, marginTop: 10, fontSize: 12 }}>
            <a className="hash link" href={`https://solscan.io/token/${t.mint}`} target="_blank" rel="noopener noreferrer">Mint {short(t.mint, 6)} ↗</a>
            {ext(m?.pairUrl, 'DexScreener')}
            {ext(t.socials.website, 'Website')}
            {ext(t.socials.x, 'X')}
            {ext(t.socials.telegram, 'Telegram')}
          </div>
        </div>
        <div className="col" style={{ gap: 8, alignItems: 'flex-end' }}>
          <Link to={`/create-battle?opponent=${t.id}`} className="btn btn-battle">⚔️ Battle ${t.ticker}</Link>
          <SourceTag text="DexScreener · live" />
        </div>
      </div>

      <div className="grid grid-4" style={{ marginTop: 14 }}>
        {[
          ['Price', fmtPrice(m?.priceUsd), m?.change24 != null ? `${pct(m.change24)} 24h` : ''],
          ['Market cap', usd(m?.mcapUsd), ''],
          ['Liquidity', usd(m?.liquidityUsd), ''],
          ['Holders', num(e.holdersOf(t.id), false), e.holdersOf(t.id) === null ? 'after first battle' : 'at last battle sample'],
        ].map(([l, v, sub]) => (
          <div key={l} className="panel panel-pad stat"><span className="stat-l">{l}</span><span className="stat-v">{v}</span>{sub && <span className="dim" style={{ fontSize: 11.5 }}>{sub}</span>}</div>
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
          {held > 0 && (
            <div className="panel panel-pad">
              <div className="label">Your position</div>
              <div className="stat-v" style={{ marginTop: 4 }}>{m ? usd(held * m.priceUsd, { compact: false }) : '—'}</div>
              <div className="muted mono" style={{ fontSize: 12 }}>{num(held)} {t.ticker}</div>
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
