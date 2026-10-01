import { Link, useParams } from 'react-router-dom';
import type { TokenId, Tournament, TournamentMatch } from '../data/types';
import { useData } from '../data/DataContext';
import { roundName } from '../live/store';
import { ago, duration } from '../lib/format';
import { BattleCard } from '../components/BattleCard';
import { SourceTag, TokenLogo, sideColor } from '../components/ui';
import type { LiveStore } from '../live/store';

function tournamentDuration(e: LiveStore, t: Tournament) {
  if (t.status === 'upcoming') return `Starts in ${duration(Math.max(0, t.scheduledStart - e.now))}`;
  const ms = (t.endedAt ?? e.now) - (t.startedAt ?? t.scheduledStart);
  return t.status === 'completed' ? `Ran ${duration(ms)}` : `Running ${duration(ms)}`;
}

function liveMatches(e: LiveStore, t: Tournament) {
  return t.rounds.flat().filter((m) => m.battleId && e.getBattle(m.battleId)?.status === 'live');
}

function StatusTag({ t }: { t: Tournament }) {
  if (t.status === 'live') return <span className="pill pill-live">Live</span>;
  if (t.status === 'upcoming') return <span className="pill pill-upcoming">Upcoming</span>;
  return <span className="pill pill-gold">Completed</span>;
}

export function TournamentCard({ t }: { t: Tournament }) {
  const e = useData();
  const r = e.currentRound(t);
  const live = liveMatches(e, t).length;
  const entrants = t.rounds[0].flatMap((m) => [m.a!, m.b!]);
  const champ = t.champion ? e.tokens[t.champion] : undefined;
  return (
    <Link to={`/tournament/${t.id}`} className="panel tcard" style={{ '--h': t.hue } as React.CSSProperties}>
      <div className="tcard-glow" />
      <div className="spread"><StatusTag t={t} /><span className="mono muted" style={{ fontSize: 11.5 }}>{tournamentDuration(e, t)}</span></div>
      <div>
        <div className="tcard-name">{t.name}</div>
        <div className="muted" style={{ fontSize: 12.5 }}>{t.tagline}</div>
      </div>
      <div className="tcard-entrants">
        {entrants.map((id) => {
          const out = t.rounds.flat().some((m) => m.winner && (m.a === id || m.b === id) && m.winner !== id);
          return <span key={id} className={out ? 'tcard-out' : ''} title={e.tokens[id].ticker}><TokenLogo token={e.tokens[id]} size={28} /></span>;
        })}
      </div>
      <div className="tcard-stats">
        <div><span className="stat-l">Tokens</span><span className="mono">{t.size}</span></div>
        <div><span className="stat-l">{t.status === 'completed' ? 'Rounds' : 'Round'}</span><span className="mono">{t.status === 'completed' ? t.rounds.length : `${roundName(t, r)}`}</span></div>
        <div><span className="stat-l">Prize</span><span className="gold truncate" style={{ fontSize: 12 }}>{t.prizeNote ?? 'Glory + treasuries'}</span></div>
      </div>
      <div className="tcard-foot">
        {champ ? <span className="row" style={{ gap: 6 }}>👑 Champion <TokenLogo token={champ} size={18} /><b style={{ color: sideColor(champ.hue, 70) }}>{champ.ticker}</b></span>
          : t.status === 'live' ? <span><span className="live-dot" />{live} live battle{live === 1 ? '' : 's'} now</span>
          : <span className="muted">Bracket locked · same battle rules for every match</span>}
        <span className="link">View tournament →</span>
      </div>
    </Link>
  );
}

export function TournamentsPage() {
  const e = useData();
  const groups: [string, Tournament['status']][] = [['Active tournaments', 'live'], ['Upcoming tournaments', 'upcoming'], ['Completed tournaments', 'completed']];
  const live = e.tournaments.filter((t) => t.status === 'live');
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">🏆 Tournaments</h1>
          <div className="page-sub">Bracket competitions between token armies. Every match is a normal BATTLE: real trading, the same Battle Score, a 1-hour minimum and a verifiable random end. Winners advance until one champion is left.</div>
        </div>
        <div className="home-ticker">
          <div><span className="live-dot" /><b className="mono">{live.length}</b><span className="muted">live</span></div>
          <div><b className="mono">{e.tournaments.filter((t) => t.status === 'upcoming').length}</b><span className="muted">upcoming</span></div>
          <SourceTag text="Live · Solana" />
        </div>
      </div>
      {groups.map(([title, st]) => {
        const list = e.tournaments.filter((t) => t.status === st);
        if (!list.length) return null;
        return (
          <section key={st} className="section" style={{ marginTop: 22 }}>
            <div className="section-head"><h2 className="section-title">{st === 'live' && <span className="live-dot" />}{title} <span className="mono muted" style={{ fontSize: 14 }}>{list.length}</span></h2></div>
            <div className="tgrid">{list.map((t) => <TournamentCard key={t.id} t={t} />)}</div>
          </section>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ bracket */

function MatchBox({ t, m }: { t: Tournament; m: TournamentMatch }) {
  const e = useData();
  const b = m.battleId ? e.getBattle(m.battleId) : undefined;
  const live = b?.status === 'live';
  const scoreOf = (side: 'a' | 'b') => {
    if (m.scoreA !== undefined) return side === 'a' ? m.scoreA : m.scoreB!;
    if (b && b.status === 'live') return side === 'a' ? b.a.score?.total : b.b.score?.total;
    return undefined;
  };
  const row = (id: TokenId | undefined, side: 'a' | 'b') => {
    const tk = id ? e.tokens[id] : undefined;
    const sc = scoreOf(side);
    const won = m.winner && m.winner === id;
    const lost = m.winner && id && m.winner !== id;
    return (
      <div className={`bm-row ${won ? 'won' : ''} ${lost ? 'lost' : ''}`} style={tk ? { '--h': tk.hue } as React.CSSProperties : undefined}>
        {tk ? <><TokenLogo token={tk} size={22} /><b className="grow truncate">{tk.ticker}</b></> : <span className="grow dim">TBD · winner of previous</span>}
        {sc !== undefined && <span className="mono">{sc.toFixed(1)}</span>}
        {won && <span>🏆</span>}
      </div>
    );
  };
  const inner = (
    <>
      <div className="bm-top">
        <span className="dim">{roundName(t, m.round)} {t.rounds[m.round].length > 1 ? m.slot + 1 : ''}</span>
        {live && <span className="bm-live"><span className="live-dot" />LIVE {duration(e.elapsed(b!))}</span>}
        {b?.status === 'scheduled' && <span className="dim">starts {duration(Math.max(0, b.scheduledStart - e.now))}</span>}
        {m.winner && m.durationMs && <span className="dim mono">{duration(m.durationMs)}</span>}
      </div>
      {row(m.a, 'a')}
      {row(m.b, 'b')}
    </>
  );
  return b ? <Link to={`/battle/${b.id}`} className={`bm ${live ? 'live' : ''}`}>{inner}</Link> : <div className="bm">{inner}</div>;
}


export function Bracket({ t }: { t: Tournament }) {
  const e = useData();
  const champ = t.champion ? e.tokens[t.champion] : undefined;
  return (
    <div className="bracket-wrap">
      <div className="bracket" style={{ '--rounds': t.rounds.length } as React.CSSProperties}>
        {t.rounds.map((round, r) => (
          <div key={r} className="b-round">
            <div className="b-round-title">{roundName(t, r)}</div>
            <div className="b-matches">
              {round.map((m) => (
                <div key={m.id} className={`b-slot ${r < t.rounds.length - 1 ? (m.slot % 2 === 0 ? 'top' : 'bottom') : 'final'}`}>
                  <MatchBox t={t} m={m} />
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="b-round">
          <div className="b-round-title">Champion</div>
          <div className="b-matches">
            <div className="b-slot champ">
              <div className={`b-champ ${champ ? 'set' : ''}`} style={champ ? { '--h': champ.hue } as React.CSSProperties : undefined}>
                {champ ? <><TokenLogo token={champ} size={56} /><b style={{ color: sideColor(champ.hue, 70) }}>{champ.ticker}</b><span className="gold">👑 CHAMPION</span></> : <><span style={{ fontSize: 30 }}>👑</span><span className="dim">To be decided</span></>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TournamentPage() {
  const { id } = useParams();
  const e = useData();
  const t = id ? e.getTournament(id) : undefined;
  if (!t) return <div className="page"><div className="panel empty">Tournament not found. <Link className="link" to="/tournaments">All tournaments</Link></div></div>;
  const r = e.currentRound(t);
  const battles = t.rounds.flat().map((m) => (m.battleId ? e.getBattle(m.battleId) : undefined)).filter((b): b is NonNullable<typeof b> => !!b);
  const live = battles.filter((b) => b.status === 'live' || b.status === 'scheduled');
  const done = t.rounds.flat().filter((m) => m.winner).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  const champ = t.champion ? e.tokens[t.champion] : undefined;
    return (
    <div className="page">
      <div className="t-hero panel" style={{ '--h': t.hue } as React.CSSProperties}>
        <div className="tcard-glow" />
        <div className="grow" style={{ position: 'relative' }}>
          <div className="row" style={{ gap: 8 }}><Link to="/tournaments" className="btn btn-ghost btn-sm">← Tournaments</Link><StatusTag t={t} /><SourceTag text="Live · Solana" /></div>
          <h1 className="page-title" style={{ marginTop: 12 }}>🏆 {t.name}</h1>
          <div className="page-sub">{t.tagline} Every match uses the standard battle rules: 1-hour minimum, random verifiable end, 60/20/20 Battle Score.</div>
        </div>
        <div className="t-hero-stats">
          <div><span className="stat-l">Tokens</span><span className="stat-v">{t.size}</span></div>
          <div><span className="stat-l">Current round</span><span className="stat-v" style={{ fontSize: 18 }}>{t.status === 'upcoming' ? '—' : t.status === 'completed' ? 'Finished' : roundName(t, r)}</span></div>
          <div><span className="stat-l">Prize</span><span className="stat-v gold" style={{ fontSize: 16 }}>{t.prizeNote ?? '—'}</span></div>
          <div><span className="stat-l">Duration</span><span className="stat-v" style={{ fontSize: 16 }}>{tournamentDuration(e, t)}</span></div>
        </div>
      </div>

      {champ && (
        <div className="t-champion panel" style={{ '--h': champ.hue } as React.CSSProperties}>
          <TokenLogo token={champ} size={64} />
          <div className="grow"><div className="label gold">Champion</div><div className="display" style={{ fontSize: 32, fontWeight: 700, color: sideColor(champ.hue, 70) }}>👑 ${champ.ticker}</div><div className="muted">Won {t.rounds.length} battles in a row · {t.endedAt && ago(e.now - t.endedAt)}</div></div>
          <Link to={`/token/${champ.id}`} className="btn">Battle record →</Link>
        </div>
      )}

      <section className="section" style={{ marginTop: 18 }}>
        <div className="section-head"><h2 className="section-title">Bracket</h2><span className="dim" style={{ fontSize: 12 }}>Click a match to open its battle.</span></div>
        <div className="panel panel-pad"><Bracket t={t} /></div>
      </section>

      {live.length > 0 && (
        <section className="section">
          <div className="section-head"><h2 className="section-title"><span className="live-dot" />Battles in this tournament</h2></div>
          <div className="board">{live.map((b) => <BattleCard key={b.id} battle={b} />)}</div>
        </section>
      )}

      <div className="grid grid-2" style={{ marginTop: 24 }}>
        <div className="panel">
          <div className="panel-head"><span className="panel-title">🏁 Completed battle results</span></div>
          <div className="record-list" style={{ padding: '6px 16px 12px' }}>
            {done.length === 0 && <div className="empty">No results yet.</div>}
            {done.map((m) => {
              const w = e.tokens[m.winner!];
              const l = e.tokens[m.winner === m.a ? m.b! : m.a!];
              const ws = m.winner === m.a ? m.scoreA! : m.scoreB!;
              const ls = m.winner === m.a ? m.scoreB! : m.scoreA!;
              const row = (
                <>
                  <span className="record-res w">🏆</span>
                  <span className="row grow" style={{ gap: 6 }}><TokenLogo token={w} size={20} /><b>{w.ticker}</b><span className="dim">def.</span><TokenLogo token={l} size={20} />{l.ticker}</span>
                  <span className="dim hide-mobile" style={{ fontSize: 12 }}>{roundName(t, m.round)}</span>
                  <span className="mono" style={{ fontSize: 12 }}>{ws.toFixed(1)}–{ls.toFixed(1)}</span>
                </>
              );
              return m.battleId ? <Link key={m.id} to={`/battle/${m.battleId}`} className="record-row">{row}</Link> : <div key={m.id} className="record-row">{row}</div>;
            })}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><span className="panel-title">💰 Prizes & treasuries</span></div>
          <div className="panel-pad col" style={{ gap: 10 }}>
            <div className="muted" style={{ fontSize: 13 }}>{t.prizeNote ?? 'No extra prize was announced for this tournament.'}</div>
            <hr className="divider" />
            <div className="muted" style={{ fontSize: 12.5 }}>Every match is a normal battle with its own treasury (funded by BATTLE's swap fee during that match) and the standard {Math.round(t.rules.rewardSplit.winnerLiquidity * 100)} / {Math.round(t.rules.rewardSplit.holderRewards * 100)} / {Math.round(t.rules.rewardSplit.platform * 100)} split. Winning does not guarantee price appreciation.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

