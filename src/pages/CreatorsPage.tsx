import { Link, useParams } from 'react-router-dom';
import type { Creator } from '../data/types';
import { useData } from '../data/DataContext';
import type { SimEngine } from '../sim/engine';
import { ago, num, quoteToUsd, short, usd } from '../lib/format';
import { SimPill, StreakBadge, TokenLogo } from '../components/ui';

/**
 * Creator reputation is NOT an opaque score. It is the list of transparent,
 * historical platform facts below, each with a published threshold. The tier
 * is simply how many criteria are met.
 */
export function reputation(c: Creator, now: number) {
  const h = c.history;
  const ageDays = (now - c.joinedAt) / 86_400_000;
  const criteria = [
    { k: 'No liquidity pulls', ok: h.liquidityPulls === 0, v: `${h.liquidityPulls} pulls`, rule: '0 liquidity removals from launched tokens' },
    { k: 'Tokens still active', ok: h.tokensLaunched > 0 && h.tokensActive30d / h.tokensLaunched >= 0.75, v: `${h.tokensActive30d}/${h.tokensLaunched}`, rule: '≥ 75% of launched tokens traded in the last 30 days' },
    { k: 'Clean battles', ok: h.battlesCompleted === 0 || h.battlesWithIntegrityAlerts / h.battlesCompleted <= 0.15, v: `${h.battlesCompleted - h.battlesWithIntegrityAlerts}/${h.battlesCompleted}`, rule: '≤ 15% of battles with an integrity alert on their token' },
    { k: 'Liquidity retained (7d)', ok: h.avgLiquidityRetained7d >= 0.8, v: `${Math.round(h.avgLiquidityRetained7d * 100)}%`, rule: '≥ 80% average pool liquidity 7 days after launch' },
    { k: 'Account history', ok: ageDays >= 60, v: `${Math.floor(ageDays)} days`, rule: '≥ 60 days on the platform' },
  ];
  const met = criteria.filter((x) => x.ok).length;
  const tier = met === 5 ? 'Proven' : met >= 4 ? 'Established' : met >= 2 ? 'Building' : 'New';
  return { criteria, met, tier };
}

function creatorRecord(e: SimEngine, c: Creator) {
  const toks = Object.values(e.tokens).filter((t) => t.creatorId === c.id);
  const recs = toks.map((t) => e.recordFor(t.id));
  const wins = recs.reduce((s, r) => s + r.wins, 0);
  const losses = recs.reduce((s, r) => s + r.losses, 0);
  const all = toks.flatMap((t) => e.recordFor(t.id).entries).sort((a, b) => b.endedAt - a.endedAt);
  let streak = 0;
  for (const x of all) { if (x.won) streak++; else break; }
  return { toks, wins, losses, streak, all };
}

export function CreatorsPage() {
  const e = useData();
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">🛠 Creators</h1>
          <div className="page-sub">Reputation here is built from public, historical platform activity — liquidity behaviour, token survival and clean battles — never an arbitrary score.</div>
        </div>
        <SimPill />
      </div>
      <div className="cards">
        {Object.values(e.creators).map((c) => {
          const rep = reputation(c, e.now);
          const r = creatorRecord(e, c);
          return (
            <Link key={c.id} to={`/creator/${c.id}`} className="panel panel-pad creator-card">
              <div className="row" style={{ gap: 12 }}>
                <span className="avatar avatar-lg">{c.avatar}</span>
                <div className="grow">
                  <div className="row" style={{ gap: 8 }}><b style={{ fontSize: 16 }}>{c.name}</b><span className={`rep rep-${rep.tier.toLowerCase()}`}>{rep.tier}</span></div>
                  <div className="dim mono" style={{ fontSize: 11.5 }}>@{c.handle} · {short(c.wallet)}</div>
                </div>
              </div>
              <div className="grid grid-3" style={{ marginTop: 14, gap: 8 }}>
                <div className="stat"><span className="stat-l">Record</span><span className="mono"><span className="up">{r.wins}W</span> <span className="down">{r.losses}L</span></span></div>
                <div className="stat"><span className="stat-l">Launched</span><span className="mono">{c.history.tokensLaunched}</span></div>
                <div className="stat"><span className="stat-l">Criteria</span><span className="mono">{rep.met}/5</span></div>
              </div>
              <div className="row" style={{ gap: 6, marginTop: 12 }}>
                {r.toks.map((t) => <TokenLogo key={t.id} token={t} size={26} />)}
                <span className="grow" />
                <StreakBadge streak={r.streak} />
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
  const c = id ? e.creators[id] : undefined;
  if (!c) return <div className="page"><div className="panel empty">Creator not found.</div></div>;
  const rep = reputation(c, e.now);
  const r = creatorRecord(e, c);
  return (
    <div className="page page-narrow">
      <div className="panel panel-pad creator-hero">
        <span className="avatar avatar-xl">{c.avatar}</span>
        <div className="grow">
          <div className="row wrap" style={{ gap: 10 }}>
            <h1 className="page-title" style={{ fontSize: 36 }}>{c.name}</h1>
            <span className={`rep rep-${rep.tier.toLowerCase()}`}>{rep.tier} creator</span>
            <StreakBadge streak={r.streak} size="lg" />
          </div>
          <div className="mono muted" style={{ marginTop: 6 }}>@{c.handle} · wallet <span className="hash">{c.wallet}</span></div>
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>Joined {ago(e.now - c.joinedAt)}</div>
        </div>
        <SimPill />
      </div>

      <div className="grid grid-4" style={{ marginTop: 14 }}>
        <div className="panel panel-pad stat"><span className="stat-l">Projects launched</span><span className="stat-v">{c.history.tokensLaunched}</span></div>
        <div className="panel panel-pad stat"><span className="stat-l">Battle record</span><span className="stat-v"><span className="up">{r.wins}</span>–<span className="down">{r.losses}</span></span></div>
        <div className="panel panel-pad stat"><span className="stat-l">Win streak</span><span className="stat-v">{r.streak}</span></div>
        <div className="panel panel-pad stat"><span className="stat-l">Battle participants</span><span className="stat-v">{num(c.history.totalBattleParticipants)}</span></div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 14 }}>
        <div className="panel">
          <div className="panel-head"><span className="panel-title">🧾 Creator reputation</span><span className="mono">{rep.met}/5 criteria</span></div>
          <div className="panel-pad">
            <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>Derived only from historical platform activity. Each criterion and threshold is public; the tier is the number met (5 Proven · 4 Established · 2–3 Building · 0–1 New).</p>
            {rep.criteria.map((x) => (
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
            {r.toks.map((t) => {
              const tr = e.recordFor(t.id);
              return (
                <Link key={t.id} to={`/token/${t.id}`} className="spread project-row">
                  <span className="row" style={{ gap: 10 }}><TokenLogo token={t} size={32} /><span><b>${t.ticker}</b><div className="muted" style={{ fontSize: 12 }}>{t.name}</div></span></span>
                  <span className="col" style={{ gap: 2, alignItems: 'flex-end' }}>
                    <span className="mono" style={{ fontSize: 12 }}>{usd(quoteToUsd(e.markets[t.id].price * t.totalSupply))} MC</span>
                    <span className="mono" style={{ fontSize: 12 }}><span className="up">{tr.wins}W</span> <span className="down">{tr.losses}L</span></span>
                  </span>
                </Link>
              );
            })}
            {c.history.tokensLaunched > r.toks.length && <div className="dim" style={{ fontSize: 12 }}>+ {c.history.tokensLaunched - r.toks.length} earlier projects (not listed in this prototype)</div>}
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-head"><span className="panel-title">⚔️ Battle history</span></div>
        <div className="record-list" style={{ padding: '6px 16px 12px' }}>
          {r.all.slice(0, 20).map((x) => {
            const t = e.tokens[x.tokenId];
            const o = e.tokens[x.opponentId];
            return (
              <div key={x.battleId + x.tokenId} className="record-row">
                <span className={`record-res ${x.won ? 'w' : 'l'}`}>{x.won ? '🏆' : '❌'}</span>
                <span className="row grow" style={{ gap: 6 }}><TokenLogo token={t} size={20} /><b>{t.ticker}</b><span className="dim">vs</span><TokenLogo token={o} size={20} />{o.ticker}</span>
                <span className="mono" style={{ fontSize: 12 }}>{x.scoreFor.toFixed(1)}–{x.scoreAgainst.toFixed(1)}</span>
                <span className="mono dim" style={{ fontSize: 11.5, width: 64, textAlign: 'right' }}>{ago(e.now - x.endedAt)}</span>
              </div>
            );
          })}
          {r.all.length === 0 && <div className="empty">No battles yet.</div>}
        </div>
      </div>
    </div>
  );
}
