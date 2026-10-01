import { Link } from 'react-router-dom';
import { useData } from '../data/DataContext';
import { ago, duration, num, quoteToUsd, usd } from '../lib/format';
import { combinedVolumeUsd, sideView } from '../lib/view';
import { BattleCard, FeaturedBattle } from '../components/BattleCard';
import { SimPill, StreakBadge, TokenLogo, sideColor, sideStyle } from '../components/ui';

export function BattlesPage() {
  const e = useData();
  const live = e.liveBattles();
  const upcoming = e.upcomingBattles();
  const ended = e.endedBattles();
  const featured = live.find((b) => b.featured) ?? [...live].sort((a, b) => b.traders.size - a.traders.size)[0] ?? ended.find((b) => b.featured);
  const trending = [...live].sort((a, b) => b.traders.size - a.traders.size);
  const totalTraders = live.reduce((s, b) => s + b.traders.size, 0);
  const totalVol = live.reduce((s, b) => s + combinedVolumeUsd(b), 0);

  // Recent results: in-session ended battles + archived history.
  const archived = e.history
    .filter((h) => h.won && !e.battles.some((b) => b.id === h.battleId))
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, 8);

  const streaks = Object.values(e.tokens)
    .map((t) => ({ t, r: e.recordFor(t.id) }))
    .filter((x) => x.r.streak >= 2)
    .sort((a, b) => b.r.streak - a.r.streak || b.r.wins - a.r.wins)
    .slice(0, 6);

  return (
    <div className="page">
      <div className="home-head">
        <div>
          <h1 className="page-title">⚔️ Battles</h1>
          <div className="page-sub">1v1 token battles. Trade either side. Communities compete on a transparent Battle Score — and nobody knows when the battle ends.</div>
        </div>
        <div className="home-ticker">
          <div><span className="live-dot" /><b className="mono">{live.length}</b><span className="muted">live now</span></div>
          <div><b className="mono">{num(totalTraders, false)}</b><span className="muted">traders in battle</span></div>
          <div><b className="mono">{usd(totalVol)}</b><span className="muted">battle volume</span></div>
          <SimPill />
        </div>
      </div>

      {featured && <FeaturedBattle battle={featured} />}

      <div className="loop-strip">
        {['Create token', 'Challenge', 'Battle starts', 'Trade & compete', '1h minimum', 'Random end', 'Winner reveal', 'Rewards', 'Win streak'].map((s, i) => (
          <span key={s} className={`loop-step ${i === 5 ? 'hot' : ''}`}>{s}</span>
        ))}
      </div>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title"><span className="live-dot" /> Live battles <span className="mono muted" style={{ fontSize: 14 }}>{live.length}</span></h2>
          <span className="dim" style={{ fontSize: 12 }}>No countdowns. Battles end at a random, verifiable moment after 1 hour.</span>
        </div>
        <div className="cards">{live.map((b) => <BattleCard key={b.id} battle={b} />)}</div>
        {live.length === 0 && <div className="panel empty">No live battles right now — next one starts soon.</div>}
      </section>

      <div className="home-split">
        <section className="section">
          <div className="section-head"><h2 className="section-title">📈 Trending battles</h2></div>
          <div className="panel">
            {trending.map((b, i) => {
              const A = sideView(e, b, 'a');
              const B = sideView(e, b, 'b');
              const L = A.position === 1 ? A : B;
              return (
                <Link key={b.id} to={`/battle/${b.id}`} className="trend-row">
                  <span className="trend-rank mono">{i + 1}</span>
                  <span className="row" style={{ gap: 6, minWidth: 0 }}>
                    <TokenLogo token={A.token} size={26} /><b>{A.token.ticker}</b>
                    <span className="dim" style={{ fontSize: 11 }}>vs</span>
                    <TokenLogo token={B.token} size={26} /><b>{B.token.ticker}</b>
                  </span>
                  <span className="grow" />
                  <span className="mono muted hide-mobile" style={{ fontSize: 12 }}>{num(b.traders.size, false)} traders</span>
                  <span className="mono muted hide-mobile" style={{ fontSize: 12, width: 70, textAlign: 'right' }}>{usd(combinedVolumeUsd(b))}</span>
                  <span className="row trend-lead" style={{ gap: 4, ...sideStyle(L.token.hue) }}>{L.token.logo}<span style={{ color: sideColor(L.token.hue, 70) }}>{L.token.ticker}</span> leads</span>
                  <span className="mono dim" style={{ fontSize: 12, width: 56, textAlign: 'right' }}>{duration(e.elapsed(b))}</span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="section">
          <div className="section-head"><h2 className="section-title">🔥 Top win streaks</h2><Link to="/leaderboard?tab=streaks" className="link" style={{ fontSize: 12 }}>All →</Link></div>
          <div className="panel">
            {streaks.map(({ t, r }) => (
              <Link key={t.id} to={`/token/${t.id}`} className="streak-row" style={sideStyle(t.hue)}>
                <TokenLogo token={t} size={34} />
                <div className="grow">
                  <div style={{ fontWeight: 800 }}>${t.ticker}</div>
                  <div className="row" style={{ gap: 3, marginTop: 3 }}>
                    {r.entries.slice(0, 8).map((x) => <span key={x.battleId} className={`form-dot sm ${x.won ? 'w' : 'l'}`}>{x.won ? 'W' : 'L'}</span>)}
                  </div>
                </div>
                <StreakBadge streak={r.streak} size="lg" />
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section className="section">
        <div className="section-head"><h2 className="section-title">🗓 Upcoming battles</h2><Link to="/create-battle" className="btn btn-battle btn-sm">⚔️ Challenge a token</Link></div>
        <div className="cards">{upcoming.map((b) => <BattleCard key={b.id} battle={b} />)}</div>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">🏁 Recent results</h2></div>
        {ended.length > 0 && <div className="cards" style={{ marginBottom: 14 }}>{ended.slice(0, 6).map((b) => <BattleCard key={b.id} battle={b} />)}</div>}
        <div className="results-list">
          {archived.map((h) => {
            const w = e.tokens[h.tokenId];
            const l = e.tokens[h.opponentId];
            return (
              <Link key={h.battleId} to={`/token/${w.id}`} className="result-chip panel">
                <span className="row" style={{ gap: 6 }}>
                  <span>🏆</span><TokenLogo token={w} size={24} /><b style={{ color: sideColor(w.hue, 70) }}>{w.ticker}</b>
                  <span className="dim">def.</span>
                  <TokenLogo token={l} size={24} /><span className="muted">{l.ticker}</span>
                </span>
                <span className="mono" style={{ fontSize: 12 }}>{h.scoreFor.toFixed(1)}–{h.scoreAgainst.toFixed(1)}</span>
                <span className="mono dim" style={{ fontSize: 11.5 }}>{duration(h.durationMs)} · {ago(e.now - h.endedAt)}</span>
              </Link>
            );
          })}
        </div>
        <p className="dim" style={{ fontSize: 12, marginTop: 10 }}>Historical results are simulated seed data. Reward pools paid: {usd(quoteToUsd(e.history.length * 60))} (simulated).</p>
      </section>
    </div>
  );
}
