import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useData } from '../data/DataContext';
import { ErrorBoundary } from './ErrorBoundary';
import { useUi } from './AppState';
import { ago, short, sol } from '../lib/format';

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
      <StatusBanner />
      <ErrorBoundary key={loc.pathname} page><Outlet /></ErrorBoundary>
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
          <Link to="/create-battle" className="btn btn-battle btn-sm hide-mobile">⚔️ Start a battle</Link>
          <Notifications />
          {data.wallet.connected ? (
            <Link to="/portfolio" className="btn btn-sm wallet-btn">
              <span className="wallet-dot" />
              <span className="mono">{data.wallet.solBalance !== null ? sol(data.wallet.solBalance, 2) : '…'}</span>
              <span className="muted mono hide-mobile">{short(data.wallet.address ?? '')}</span>
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

function StatusBanner() {
  const data = useData();
  if (!data.configured) {
    return <div className="status-banner warn">⚠️ The battle backend isn't connected yet. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to go live — see README.</div>;
  }
  if (data.error) return <div className="status-banner bad">⚠️ {data.error}</div>;
  if (data.marketError) return <div className="status-banner warn">⚠️ {data.marketError}. Retrying every 20 seconds.</div>;
  return null;
}

function Notifications() {
  const data = useData();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => { try { return Number(localStorage.getItem('battle.notifSeen') ?? 0); } catch { return 0; } });
  const ref = useRef<HTMLDivElement>(null);
  const list = data.notifications;
  const unread = list.filter((n) => n.t > seen).length;
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [open]);
  const toggle = () => {
    setOpen(!open);
    if (!open) { const t = Date.now(); setSeen(t); try { localStorage.setItem('battle.notifSeen', String(t)); } catch { /* ignore */ } }
  };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn icon-btn" aria-label="Notifications" onClick={toggle}>
        🔔{unread > 0 && <span className="badge-count">{unread}</span>}
      </button>
      {open && (
        <div className="panel dropdown">
          <div className="panel-head"><span className="panel-title">Notifications</span></div>
          {!data.wallet.connected && <div className="empty">Connect a wallet to get challenges and updates for tokens you listed.</div>}
          {data.wallet.connected && list.length === 0 && <div className="empty">Nothing yet. Challenges to your tokens and your battle results show up here.</div>}
          {list.map((n) => (
            <Link key={n.id} to={n.link ?? '/'} className="notif" onClick={() => setOpen(false)}>
              <span style={{ fontSize: 20, width: 34, textAlign: 'center' }}>{n.kind === 'challenge' ? '⚔️' : n.kind === 'battle-end' ? '🏁' : '🔴'}</span>
              <div className="grow">
                <div style={{ fontWeight: 800, fontSize: 12.5, letterSpacing: '0.04em' }}>{n.title}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>{n.body}</div>
                {n.kind === 'challenge' && <span className="btn btn-battle btn-sm" style={{ marginTop: 8 }}>Review challenge</span>}
                <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>{ago(data.now - n.t)}</div>
              </div>
            </Link>
          ))}
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
  const items = [NAV[0], NAV[1], { to: '/create-battle', label: 'Start', icon: '⚔️' }, { to: '/portfolio', label: 'Me', icon: '👤' }];
  const secondary = [NAV[2], NAV[3], NAV[4], NAV[5], NAV[6], { to: '/rules', label: 'How battles work', icon: '📜' }];
  return (
    <>
      <nav className="mobile-tabbar">
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `mtab ${isActive ? 'active' : ''} ${n.label === 'Start' ? 'mtab-cta' : ''}`}>
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
          locked before a battle starts. Market data: DexScreener and GeckoTerminal. Swaps: Jupiter. Randomness: drand.
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
