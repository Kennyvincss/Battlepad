import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useData } from '../data/DataContext';
import { useUi } from './AppState';
import { ago, short, sol } from '../lib/format';
import { TokenLogo } from './ui';

/** `sec` items fold into the "More" menu on mid-size screens so the bar never crowds. */
const NAV = [
  { to: '/', label: 'Battles', icon: '⚔️', end: true },
  { to: '/tournaments', label: 'Tournaments', icon: '🏆' },
  { to: '/launch', label: 'Launch', icon: '🚀' },
  { to: '/discover', label: 'Discover', icon: '🧭' },
  { to: '/leaderboard', label: 'Leaderboard', icon: '📊' },
  { to: '/creators', label: 'Creators', icon: '🛠', sec: true },
  { to: '/treasury', label: 'Treasury', icon: '🏛', sec: true },
  { to: '/portfolio', label: 'My Portfolio', icon: '👤', sec: true },
];

export function Layout() {
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  return (
    <div className="app-shell">
      <TopBar />
      <SimRibbon />
      <Outlet />
      <Footer />
      <MobileTabBar />
    </div>
  );
}

function TopBar() {
  const data = useData();
  const ui = useUi();
  const live = data.liveBattles().length;
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="brand" aria-label="BATTLE home">
          <span className="brand-mark">⚔️</span>
          <span>BATTLE</span>
        </Link>
        <nav className="nav-links hide-mobile">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link ${n.sec ? 'nav-sec' : ''} ${isActive ? 'active' : ''}`}>
              {n.label === 'Battles' && live > 0 && <span className="nav-live-dot" />}
              {n.label}
              {n.label === 'Battles' && live > 0 && <span className="mono muted" style={{ fontSize: 11 }}>{live}</span>}
            </NavLink>
          ))}
          <MoreMenu />
        </nav>
        <div className="grow show-mobile" />
        <div className="nav-right">
          <Link to="/create-battle" className="btn btn-battle btn-sm hide-mobile">⚔️ Challenge</Link>
          <Notifications />
          {data.wallet.connected ? (
            <Link to="/portfolio" className="btn btn-sm wallet-btn">
              <span className="wallet-dot" />
              <span className="mono">{sol(data.wallet.quoteBalance, 2)}</span>
              <span className="muted mono hide-mobile">{short(data.wallet.address)}</span>
            </Link>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={ui.openWallet}>Connect Wallet</button>
          )}
          <Link to="/portfolio" className="btn icon-btn hide-mobile" aria-label="Profile" title="Profile">🫵</Link>
        </div>
      </div>
    </header>
  );
}

function SimRibbon() {
  const data = useData();
  return (
    <div className="sim-ribbon">
      <span>◇ <b>Prototype</b> — all markets, wallets, trades and beacon values are <b>simulated</b> in your browser. Nothing here is real on-chain data.</span>
      <span className="row" style={{ gap: 6 }}>
        <span className="muted">Sim speed</span>
        <span className="seg">
          {[1, 10, 60].map((s) => (
            <button key={s} className={data.speed === s ? 'active' : ''} onClick={() => data.setSpeed(s)}>{s}×</button>
          ))}
        </span>
      </span>
    </div>
  );
}

function Notifications() {
  const data = useData();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const unread = data.notifications.filter((n) => !n.read).length;
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn icon-btn" aria-label="Notifications" onClick={() => { setOpen(!open); if (!open) setTimeout(() => data.markNotificationsRead(), 1500); }}>
        🔔{unread > 0 && <span className="badge-count">{unread}</span>}
      </button>
      {open && (
        <div className="panel dropdown">
          <div className="panel-head"><span className="panel-title">Notifications</span><span className="pill pill-sim">◇ Simulated</span></div>
          {data.notifications.length === 0 && <div className="empty">Nothing yet.</div>}
          {data.notifications.map((n) => {
            const ch = n.challengeId ? data.challenges.find((c) => c.id === n.challengeId) : undefined;
            return (
              <div key={n.id} className={`notif ${n.read ? '' : 'unread'}`}>
                {ch ? <TokenLogo token={data.tokens[ch.fromTokenId]} size={34} /> : <span style={{ fontSize: 20, width: 34, textAlign: 'center' }}>{n.kind === 'reward' ? '🏆' : n.kind === 'battle-end' ? '🏁' : '⚔️'}</span>}
                <div className="grow">
                  <div style={{ fontWeight: 800, fontSize: 12.5, letterSpacing: '0.04em' }}>{n.title}</div>
                  <div className="muted" style={{ fontSize: 12.5 }}>{n.body}</div>
                  {ch?.message && <div style={{ fontSize: 12, marginTop: 4, fontStyle: 'italic', color: 'var(--text-2)' }}>“{ch.message}”</div>}
                  {ch && ch.status === 'pending' && (
                    <div className="row" style={{ marginTop: 8 }}>
                      <button className="btn btn-battle btn-sm" onClick={() => { setOpen(false); nav(`/challenge/${ch.id}`); }}>Review challenge</button>
                    </div>
                  )}
                  {ch && ch.status !== 'pending' && <div className="label" style={{ marginTop: 6 }}>{ch.status}</div>}
                  {n.link && !ch && <Link to={n.link} className="link" style={{ fontSize: 12 }} onClick={() => setOpen(false)}>Open →</Link>}
                  <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>{ago(data.now - n.t)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MoreMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [open]);
  const active = NAV.some((n) => n.sec && loc.pathname.startsWith(n.to));
  return (
    <div ref={ref} className="nav-more">
      <button className={`nav-link ${active ? 'active' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>More ▾</button>
      {open && (
        <div className="panel more-menu">
          {NAV.filter((n) => n.sec).map((n) => <NavLink key={n.to} to={n.to} className="more-item"><span>{n.icon}</span>{n.label}</NavLink>)}
        </div>
      )}
    </div>
  );
}

function MobileTabBar() {
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  useEffect(() => setMenu(false), [loc.pathname]);
  const items = [NAV[0], NAV[1], { to: '/create-battle', label: 'Challenge', icon: '⚔️' }, { to: '/portfolio', label: 'Me', icon: '👤' }];
  const secondary = [NAV[2], NAV[3], NAV[4], NAV[5], NAV[6], { to: '/rules', label: 'How battles work', icon: '📜' }];
  return (
    <>
      <nav className="mobile-tabbar">
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `mtab ${isActive ? 'active' : ''} ${n.label === 'Challenge' ? 'mtab-cta' : ''}`}>
            <span className="mtab-i">{n.icon}</span>
            <span>{n.label}</span>
          </NavLink>
        ))}
        <button className={`mtab ${menu ? 'active' : ''}`} onClick={() => setMenu(!menu)} aria-expanded={menu}>
          <span className="mtab-i">☰</span><span>Menu</span>
        </button>
      </nav>
      {menu && (
        <div className="sheet-backdrop" onClick={(ev) => ev.target === ev.currentTarget && setMenu(false)}>
          <div className="sheet menu-sheet">
            <div className="sheet-handle" />
            <div className="menu-grid">
              {secondary.map((n) => (
                <NavLink key={n.to} to={n.to} className="menu-item"><span className="menu-i">{n.icon}</span>{n.label}</NavLink>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="brand" style={{ fontSize: 16 }}><span className="brand-mark" style={{ width: 24, height: 24, fontSize: 12 }}>⚔️</span>BATTLE</div>
        <p>
          BATTLE is a token launchpad with a competitive layer. You trade real tokens; you are not betting on an outcome. Battle results do not
          guarantee future price performance, and losing tokens keep trading normally. Battle rules, random-end parameters and reward splits are
          locked before a battle starts. This prototype uses simulated data.
        </p>
        <div className="row wrap" style={{ gap: 16 }}>
          <Link to="/rules" className="link">How battles work</Link>
          <Link to="/discover" className="link">All tokens</Link>
          <Link to="/creators" className="link">Creators</Link>
        </div>
      </div>
    </footer>
  );
}
