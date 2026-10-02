import { Link, useParams } from 'react-router-dom';
import type { Token } from '../data/types';
import { useData } from '../data/DataContext';
import type { LiveStore } from '../live/store';
import { ago, num, short, solscanAccount, usd } from '../lib/format';
import { StreakBadge, TokenLogo } from '../components/ui';

/**
 * Creator reputation is not an opaque score: it's five public, historical
 * facts with published thresholds. The tier is how many are met.
 */
function creatorFacts(e: LiveStore, wallet: string) {
  const toks = Object.values(e.tokens).filter((t) => t.listedBy === wallet);
  const entries = toks.flatMap((t) => e.recordFor(t.id).entries).sort((a, b) => b.endedAt - a.endedAt);
  const wins = entries.filter((x) => x.won).length;
  let streak = 0;
  for (const x of entries) { if (x.won) streak++; else break; }
  const battles = e.battles.filter((b) => b.status === 'ended' && toks.some((t) => t.id === b.a.tokenId || t.id === b.b.tokenId));
  const flaggedBattles = battles.filter((b) => {
    const mineA = toks.some((t) => t.id === b.a.tokenId);
    return (mineA ? b.final?.integrityA : b.final?.integrityB) !== undefined && (mineA ? b.final!.integrityA : b.final!.integrityB) < 90;
  }).length;
  const liq = toks.map((t) => {
    const first = e.battles.filter((b) => b.startedAt && (b.a.tokenId === t.id || b.b.tokenId === t.id)).sort((a, b) => a.startedAt! - b.startedAt!)[0];
    const start = first ? (first.a.tokenId === t.id ? first.a.startLiquidity : first.b.startLiquidity) : null;
    const now = e.markets[t.id]?.liquidityUsd;
    return start && now !== undefined ? Math.min(1, now / start) : null;
  }).filter((x): x is number => x !== null);
  const avgLiq = liq.length ? liq.reduce((s, x) => s + x, 0) / liq.length : null;
  const active = toks.filter((t) => (e.markets[t.id]?.volume24Usd ?? 0) >= 1000).length;
  const firstListed = Math.min(...toks.map((t) => t.listedAt));
  const ageDays = toks.length ? (e.now - firstListed) / 86_400_000 : 0;
  const criteria = [
    { k: 'Liquidity kept', ok: avgLiq === null || avgLiq >= 0.8, v: avgLiq === null ? 'n/a' : `${Math.round(avgLiq * 100)}%`, rule: '≥ 80% of pool liquidity kept since each token\'s first battle' },
    { k: 'Tokens still active', ok: toks.length > 0 && active / toks.length >= 0.75, v: `${active}/${toks.length}`, rule: '≥ 75% of listed tokens traded ≥ $1K in the last 24h' },
    { k: 'Clean battles', ok: flaggedBattles === 0 || flaggedBattles / Math.max(1, battles.length) <= 0.15, v: `${battles.length - flaggedBattles}/${battles.length}`, rule: '≤ 15% of battles with integrity under 90%' },
    { k: 'Battle experience', ok: battles.length >= 3, v: `${battles.length} battles`, rule: '≥ 3 completed battles' },
    { k: 'History on BATTLE', ok: ageDays >= 30, v: `${Math.floor(ageDays)} days`, rule: '≥ 30 days since first listing' },
  ];
  const met = criteria.filter((x) => x.ok).length;
  const tier = met === 5 ? 'Proven' : met >= 4 ? 'Established' : met >= 2 ? 'Building' : 'New';
  return { toks, entries, wins, losses: entries.length - wins, streak, criteria, met, tier, firstListed, participants: battles.reduce((s, b) => s + b.traders, 0) };
}

export function CreatorsPage() {
  const e = useData();
  const wallets = [...new Set(Object.values(e.tokens).map((t) => t.listedBy))];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">🛠 Creators</h1>
          <div className="page-sub">Everyone who listed a token. Reputation is built from public, historical platform activity — liquidity kept, active tokens and clean battles — never an arbitrary score.</div>
        </div>
      </div>
      {wallets.length === 0 && <div className="panel empty">No creators yet. <Link className="link" to="/launch">List the first token →</Link></div>}
      <div className="cards">
        {wallets.map((w) => {
          const f = creatorFacts(e, w);
          return (
            <Link key={w} to={`/creator/${w}`} className="panel panel-pad creator-card">
              <div className="row" style={{ gap: 12 }}>
                <span className="avatar avatar-lg mono" style={{ fontSize: 14 }}>{w.slice(0, 2)}</span>
                <div className="grow">
                  <div className="row" style={{ gap: 8 }}><b className="mono" style={{ fontSize: 15 }}>{w === e.wallet.address ? 'You' : short(w, 5)}</b><span className={`rep rep-${f.tier.toLowerCase()}`}>{f.tier}</span></div>
                  <div className="dim" style={{ fontSize: 11.5 }}>Listing since {new Date(f.firstListed).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                </div>
              </div>
              <div className="grid grid-3" style={{ marginTop: 14, gap: 8 }}>
                <div className="stat"><span className="stat-l">Record</span><span className="mono"><span className="up">{f.wins}W</span> <span className="down">{f.losses}L</span></span></div>
                <div className="stat"><span className="stat-l">Tokens</span><span className="mono">{f.toks.length}</span></div>
                <div className="stat"><span className="stat-l">Criteria</span><span className="mono">{f.met}/5</span></div>
              </div>
              <div className="row" style={{ gap: 6, marginTop: 12 }}>
                {f.toks.map((t) => <TokenLogo key={t.id} token={t} size={26} />)}
                <span className="grow" />
                <StreakBadge streak={f.streak} />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function CreatorPage() {
  const { id } = useParams();
  const e = useData();
  if (!id) return null;
  const f = creatorFacts(e, id);
  if (!f.toks.length) return <div className="page"><div className="panel empty">{e.ready ? 'This wallet has not listed any tokens.' : 'Loading…'}</div></div>;
  return (
    <div className="page page-narrow">
      <div className="panel panel-pad creator-hero">
        <span className="avatar avatar-xl mono" style={{ fontSize: 22 }}>{id.slice(0, 2)}</span>
        <div className="grow">
          <div className="row wrap" style={{ gap: 10 }}>
            <h1 className="page-title mono" style={{ fontSize: 28 }}>{id === e.wallet.address ? 'You' : short(id, 6)}</h1>
            <span className={`rep rep-${f.tier.toLowerCase()}`}>{f.tier} creator</span>
            <StreakBadge streak={f.streak} size="lg" />
          </div>
          <a className="hash link" href={solscanAccount(id)} target="_blank" rel="noopener noreferrer">{id} ↗</a>
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>First listing {ago(e.now - f.firstListed)}</div>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginTop: 14 }}>
        <div className="panel panel-pad stat"><span className="stat-l">Projects listed</span><span className="stat-v">{f.toks.length}</span></div>
        <div className="panel panel-pad stat"><span className="stat-l">Battle record</span><span className="stat-v"><span className="up">{f.wins}</span>–<span className="down">{f.losses}</span></span></div>
        <div className="panel panel-pad stat"><span className="stat-l">Win streak</span><span className="stat-v">{f.streak}</span></div>
        <div className="panel panel-pad stat"><span className="stat-l">Battle participants</span><span className="stat-v">{num(f.participants)}</span></div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 14 }}>
        <div className="panel">
          <div className="panel-head"><span className="panel-title">🧾 Creator reputation</span><span className="mono">{f.met}/5 criteria</span></div>
          <div className="panel-pad">
            <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>Derived only from public platform activity. Each threshold is published; the tier is the number met (5 Proven · 4 Established · 2–3 Building · 0–1 New).</p>
            {f.criteria.map((x) => (
              <div key={x.k} className="rep-row">
                <span className={x.ok ? 'up' : 'down'} style={{ fontSize: 16 }}>{x.ok ? '✓' : '✕'}</span>
                <div className="grow"><b>{x.k}</b><div className="dim" style={{ fontSize: 11.5 }}>{x.rule}</div></div>
                <span className="mono">{x.v}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><span className="panel-title">🚀 Projects</span></div>
          <div className="panel-pad col" style={{ gap: 10 }}>
            {f.toks.map((t: Token) => {
              const tr = e.recordFor(t.id);
              return (
                <Link key={t.id} to={`/token/${t.id}`} className="spread project-row">
                  <span className="row" style={{ gap: 10 }}><TokenLogo token={t} size={32} /><span><b>${t.ticker}</b><div className="muted" style={{ fontSize: 12 }}>{t.name}</div></span></span>
                  <span className="col" style={{ gap: 2, alignItems: 'flex-end' }}>
                    <span className="mono" style={{ fontSize: 12 }}>{usd(e.markets[t.id]?.mcapUsd)} MC</span>
                    <span className="mono" style={{ fontSize: 12 }}><span className="up">{tr.wins}W</span> <span className="down">{tr.losses}L</span></span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-head"><span className="panel-title">⚔️ Battle history</span></div>
        <div className="record-list" style={{ padding: '6px 16px 12px' }}>
          {f.entries.length === 0 && <div className="empty">No battles yet.</div>}
          {f.entries.slice(0, 30).map((x) => {
            const t = e.token(x.tokenId);
            const o = e.token(x.opponentId);
            return (
              <Link key={x.battleId + x.tokenId} to={`/battle/${x.battleId}`} className="record-row">
                <span className={`record-res ${x.won ? 'w' : 'l'}`}>{x.won ? '🏆' : '❌'}</span>
                <span className="row grow" style={{ gap: 6 }}>{t && <TokenLogo token={t} size={20} />}<b>{t?.ticker}</b><span className="dim">vs</span>{o && <TokenLogo token={o} size={20} />}{o?.ticker}</span>
                <span className="mono" style={{ fontSize: 12 }}>{x.scoreFor.toFixed(1)}–{x.scoreAgainst.toFixed(1)}</span>
                <span className="mono dim" style={{ fontSize: 11.5, width: 64, textAlign: 'right' }}>{ago(e.now - x.endedAt)}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
