import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Battle } from '../data/types';
import { useData } from '../data/DataContext';
import { num, usd } from '../lib/format';
import { roundName } from '../live/store';
import { combinedVolumeUsd } from '../lib/view';
import { BattleCard } from '../components/BattleCard';
import { SourceTag, StreakBadge, TokenLogo, sideStyle } from '../components/ui';

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
  const totalTraders = live.reduce((s, b) => s + b.traders, 0);
  const totalVol = live.reduce((s, b) => s + combinedVolumeUsd(b), 0);

  const matches = (b: Battle) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return [b.a.tokenId, b.b.tokenId].some((id) => e.tokens[id].ticker.toLowerCase().includes(s) || e.tokens[id].name.toLowerCase().includes(s));
  };
  const sorter = (x: Battle, y: Battle) => {
    if (sort === 'traders') return y.traders - x.traders;
    if (sort === 'close') return Math.abs((x.a.score?.total ?? 0) - (x.b.score?.total ?? 0)) - Math.abs((y.a.score?.total ?? 0) - (y.b.score?.total ?? 0));
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
  const total = battles.length;

  const streaks = Object.values(e.tokens)
    .map((t) => ({ t, r: e.recordFor(t.id) }))
    .filter((x) => x.r.streak >= 2)
    .sort((a, b) => b.r.streak - a.r.streak || b.r.wins - a.r.wins);

  const tabs: [Filter, string, number][] = [
    ['all', 'All', live.length + upcoming.length + ended.length],
    ['live', 'Live', live.length],
    ['sudden', '🎲 Final stretch', sudden.length],
    ['upcoming', 'Upcoming', upcoming.length],
    ['ended', 'Results', ended.length],
  ];

  return (
    <div className="page">
      <HowItWorks />

      <div className="home-head">
        <div>
          <h1 className="page-title">⚔️ Battles</h1>
          <div className="page-sub">Pick a battle, then buy the token you want to win.</div>
        </div>
        <div className="home-ticker">
          <div><span className="live-dot" /><b className="mono">{live.length}</b><span className="muted">live now</span></div>
          <div title="Past the 1-hour minimum: these can end at any minute"><b className="mono warn">{sudden.length}</b><span className="muted">in final stretch</span></div>
          <div><b className="mono">{num(totalTraders, false)}</b><span className="muted">traders</span></div>
          <div><b className="mono">{usd(totalVol)}</b><span className="muted">traded in battles</span></div>
          <SourceTag text="Live · Solana" />
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
                <span className="muted">{roundName(t, r)}s · {n} live{t.prizeNote ? ` · ${t.prizeNote}` : ''}</span>
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
          <Link to="/create-battle" className="btn btn-battle hide-mobile">⚔️ Start a battle</Link>
        </div>
      </div>

      <div className="board">
        {battles.slice(0, shown).map((b) => <BattleCard key={b.id} battle={b} />)}
      </div>
      {total === 0 && (
        <div className="panel empty" style={{ padding: 40 }}>
          {e.battles.length === 0 ? (
            <>
              <div style={{ fontSize: 36 }}>⚔️</div>
              <h3 className="display" style={{ fontSize: 22 }}>{e.ready ? 'No battles yet' : 'Loading live battles…'}</h3>
              {e.ready && <p className="muted">Launch or list a token, then challenge another token to start the first battle.</p>}
              {e.ready && <div className="row" style={{ gap: 8, justifyContent: 'center' }}><Link to="/launch" className="btn btn-primary">🚀 Launch a token</Link><Link to="/create-battle" className="btn btn-battle">⚔️ Start a battle</Link></div>}
            </>
          ) : 'No battles match. Try another filter.'}
        </div>
      )}
      {total > shown && (
        <div className="center" style={{ marginTop: 18 }}>
          <button className="btn" onClick={() => setShown(shown + PAGE)}>Show more · {total - shown} left</button>
        </div>
      )}
      <p className="dim" style={{ fontSize: 12, marginTop: 14 }}>Prices from DexScreener, trades from GeckoTerminal. Scores update every minute.</p>
    </div>
  );
}

const STEPS = [
  { icon: '🚀', color: '#4f46e5', title: 'Launch a token', body: 'Create a new Solana token for free, or list one that already trades.' },
  { icon: '⚔️', color: '#e11d48', title: 'Challenge another token', body: 'Two tokens go head to head. The other side accepts and the battle starts.' },
  { icon: '📈', color: '#059669', title: 'Buy the side you back', body: 'Your buy is a real trade in that token. Price gains, new holders and healthy trading raise its Battle Score.' },
  { icon: '🎲', color: '#d97706', title: 'Surprise ending', body: 'Battles run at least 1 hour, then can end any minute. The higher score at that moment wins.' },
];

/** Plain-language explainer for first-time visitors; can be collapsed. */
function HowItWorks() {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('battle.howto') !== 'hidden'; } catch { return true; } });
  const toggle = (v: boolean) => { setOpen(v); try { localStorage.setItem('battle.howto', v ? 'shown' : 'hidden'); } catch { /* ignore */ } };
  if (!open) return <button className="btn btn-sm howto-reopen" onClick={() => toggle(true)}>❓ How BATTLE works</button>;
  return (
    <section className="howto">
      <div className="howto-head">
        <div>
          <h2 className="howto-title">Two tokens. One battle. The market picks the winner.</h2>
          <p className="howto-sub">BATTLE is a Solana launchpad where tokens compete in live 1v1 battles. You're never betting: you buy and sell the real tokens, and you keep them after the battle ends.</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => toggle(false)} aria-label="Hide explainer">Hide ✕</button>
      </div>
      <ol className="howto-steps">
        {STEPS.map((x, i) => (
          <li key={x.title} className="howto-step" style={{ '--c': x.color } as React.CSSProperties}>
            <span className="howto-n">{i + 1}</span>
            <span className="howto-icon">{x.icon}</span>
            <b>{x.title}</b>
            <span>{x.body}</span>
          </li>
        ))}
      </ol>
      <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
        <Link to="/launch" className="btn btn-primary">🚀 Launch a token</Link>
        <Link to="/create-battle" className="btn btn-battle">⚔️ Start a battle</Link>
        <Link to="/rules" className="btn">How scores work →</Link>
      </div>
    </section>
  );
}
