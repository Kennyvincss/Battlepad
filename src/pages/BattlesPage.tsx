import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Battle } from '../data/types';
import { useData } from '../data/DataContext';
import { num, quoteToUsd, usd } from '../lib/format';
import { roundName } from '../sim/engine';
import { combinedVolumeUsd } from '../lib/view';
import { BattleCard, ResultCard } from '../components/BattleCard';
import { SimPill, StreakBadge, TokenLogo, sideStyle } from '../components/ui';

type Filter = 'all' | 'live' | 'sudden' | 'upcoming' | 'ended';
type Sort = 'traders' | 'close' | 'longest' | 'newest';

const PAGE = 24;

export function BattlesPage() {
  const e = useData();
  const [params, setParams] = useSearchParams();
  const filter = (params.get('f') as Filter) ?? 'all';
  const [sort, setSort] = useState<Sort>('traders');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);

  const live = e.liveBattles();
  const liveTournaments = e.tournaments.filter((t) => t.status === 'live');
  const sudden = live.filter((b) => e.elapsed(b) >= b.rules.randomEnd.minDurationMs);
  const upcoming = e.upcomingBattles();
  const ended = e.endedBattles();
  const archived = e.history
    .filter((h) => h.won && !e.battles.some((b) => b.id === h.battleId))
    .sort((a, b) => b.endedAt - a.endedAt);
  const totalTraders = live.reduce((s, b) => s + b.traders.size, 0);
  const totalVol = live.reduce((s, b) => s + combinedVolumeUsd(b), 0);

  const matches = (b: Battle) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return [b.a.tokenId, b.b.tokenId].some((id) => e.tokens[id].ticker.toLowerCase().includes(s) || e.tokens[id].name.toLowerCase().includes(s));
  };
  const sorter = (x: Battle, y: Battle) => {
    if (sort === 'traders') return y.traders.size - x.traders.size;
    if (sort === 'close') return Math.abs(x.a.score.total - x.b.score.total) - Math.abs(y.a.score.total - y.b.score.total);
    if (sort === 'longest') return e.elapsed(y) - e.elapsed(x);
    return (y.startedAt ?? y.scheduledStart) - (x.startedAt ?? x.scheduledStart);
  };

  // Live first (sorted), then upcoming (soonest first), then finished.
  let battles: Battle[] = [];
  if (filter === 'all') battles = [...[...live].sort(sorter), ...upcoming, ...ended];
  if (filter === 'live') battles = [...live].sort(sorter);
  if (filter === 'sudden') battles = [...sudden].sort(sorter);
  if (filter === 'upcoming') battles = upcoming;
  if (filter === 'ended') battles = ended;
  battles = battles.filter(matches);
  const showArchived = (filter === 'ended' || filter === 'all') && !q;
  const total = battles.length + (showArchived ? archived.length : 0);

  const streaks = Object.values(e.tokens)
    .map((t) => ({ t, r: e.recordFor(t.id) }))
    .filter((x) => x.r.streak >= 2)
    .sort((a, b) => b.r.streak - a.r.streak || b.r.wins - a.r.wins);

  const tabs: [Filter, string, number][] = [
    ['all', 'All', live.length + upcoming.length + ended.length + archived.length],
    ['live', 'Live', live.length],
    ['sudden', '⚠ Can end any time', sudden.length],
    ['upcoming', 'Upcoming', upcoming.length],
    ['ended', 'Results', ended.length + archived.length],
  ];

  return (
    <div className="page">
      <div className="home-head">
        <div>
          <h1 className="page-title">⚔️ Battles</h1>
          <div className="page-sub">Trade either side of a 1v1. Battles run at least an hour, then end at a random, verifiable moment — no countdowns.</div>
        </div>
        <div className="home-ticker">
          <div><span className="live-dot" /><b className="mono">{live.length}</b><span className="muted">live</span></div>
          <div><b className="mono warn">{sudden.length}</b><span className="muted">can end any time</span></div>
          <div><b className="mono">{num(totalTraders, false)}</b><span className="muted">traders</span></div>
          <div><b className="mono">{usd(totalVol)}</b><span className="muted">battle volume</span></div>
          <SimPill />
        </div>
      </div>

      {liveTournaments.length > 0 && (
        <div className="tourney-strip">
          {liveTournaments.map((t) => {
            const r = e.currentRound(t);
            const n = t.rounds[r].filter((m) => m.battleId && e.getBattle(m.battleId)?.status === 'live').length;
            return (
              <Link key={t.id} to={`/tournament/${t.id}`} className="tourney-chip" style={{ '--h': t.hue } as React.CSSProperties}>
                <span className="pill pill-live">Live</span>
                <b>🏆 {t.name}</b>
                <span className="muted">{roundName(t, r)}s · {n} live · {usd(quoteToUsd(t.prizePoolQuote))} prize pool</span>
                <span className="link">View bracket →</span>
              </Link>
            );
          })}
        </div>
      )}

      {streaks.length > 0 && (
        <div className="streak-strip">
          <span className="label nowrap">🔥 Win streaks</span>
          {streaks.map(({ t, r }) => (
            <Link key={t.id} to={`/token/${t.id}`} className="streak-chip" style={sideStyle(t.hue)}>
              <TokenLogo token={t} size={22} /><b>{t.ticker}</b><StreakBadge streak={r.streak} compact />
            </Link>
          ))}
        </div>
      )}

      <div className="board-bar">
        <div className="seg board-tabs">
          {tabs.map(([k, l, n]) => (
            <button key={k} className={filter === k ? 'active' : ''} onClick={() => { setParams(k === 'all' ? {} : { f: k }); setShown(PAGE); }}>
              {l} <span className="mono dim">{n}</span>
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input className="input board-search" placeholder="Search token…" value={q} onChange={(ev) => setQ(ev.target.value)} aria-label="Search battles" />
          <select className="select board-sort" value={sort} onChange={(ev) => setSort(ev.target.value as Sort)} aria-label="Sort battles">
            <option value="traders">Most traders</option>
            <option value="close">Closest fight</option>
            <option value="longest">Longest running</option>
            <option value="newest">Newest</option>
          </select>
          <Link to="/create-battle" className="btn btn-battle hide-mobile">⚔️ Challenge</Link>
        </div>
      </div>

      <div className="board">
        {battles.slice(0, shown).map((b) => <BattleCard key={b.id} battle={b} />)}
        {showArchived && archived.slice(0, Math.max(0, shown - battles.length)).map((h) => <ResultCard key={h.battleId} entry={h} />)}
      </div>
      {total === 0 && <div className="panel empty">No battles match. Try another filter.</div>}
      {total > shown && (
        <div className="center" style={{ marginTop: 18 }}>
          <button className="btn" onClick={() => setShown(shown + PAGE)}>Show more · {total - shown} left</button>
        </div>
      )}
      <p className="dim" style={{ fontSize: 12, marginTop: 14 }}>Archived results are simulated seed data. Market caps on archived cards are current values.</p>
    </div>
  );
}
