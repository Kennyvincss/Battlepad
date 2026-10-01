import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import type { Battle, Token } from '../data/types';

export function TokenLogo({ token, size = 36, className = '' }: { token: Pick<Token, 'ticker' | 'hue'> & { logoUrl?: string }; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const style = { '--h': token.hue, width: size, height: size, fontSize: size * 0.4 } as CSSProperties;
  return (
    <span className={`tlogo ${className}`} style={style}>
      {token.logoUrl && !broken
        ? <img src={token.logoUrl} alt="" loading="lazy" onError={() => setBroken(true)} />
        : <b className="tlogo-txt">{token.ticker.slice(0, 2)}</b>}
    </span>
  );
}

export const sideStyle = (hue: number) => ({ '--h': hue } as CSSProperties);
export const sideColor = (hue: number, l = 62) => `hsl(${hue} 90% ${l}%)`;

/** Names where a figure comes from (transparency rule). */
export function SourceTag({ text }: { text: string }) {
  return <span className="pill pill-src" title={`Data source: ${text}`}>◉ {text}</span>;
}

export function StatusPill({ battle, elapsed, compact }: { battle: Battle; elapsed: number; compact?: boolean }) {
  if (battle.status === 'ended') return <span className="pill pill-ended">Ended</span>;
  if (battle.status === 'scheduled') return <span className="pill pill-upcoming">Upcoming</span>;
  if (battle.status === 'pending') return <span className="pill pill-upcoming">Awaiting accept</span>;
  if (battle.status === 'declined' || battle.status === 'cancelled') return <span className="pill pill-ended">{battle.status}</span>;
  return (
    <span className="row" style={{ gap: 6 }}>
      <span className="pill pill-live">Live</span>
      {elapsed >= battle.rules.randomEnd.minDurationMs && <span className="pill pill-sd" title="Past the 1-hour minimum: the battle can end at any time">{compact ? '⚠ Any time' : '⚠ Can end any time'}</span>}
    </span>
  );
}

export function Modal({ title, onClose, children, wide, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, []);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3 className="modal-title">{title}</h3>
          <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-head" style={{ borderTop: '1px solid var(--line)', borderBottom: 0, position: 'sticky', bottom: 0 }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Animates text colour when a numeric value moves up or down. */
export function Flash({ value, children, className = '' }: { value: number; children: ReactNode; className?: string }) {
  const prev = useRef(value);
  const [cls, setCls] = useState('');
  const [k, setK] = useState(0);
  useEffect(() => {
    if (value > prev.current * (1 + 1e-9)) { setCls('flash-up'); setK((x) => x + 1); }
    else if (value < prev.current * (1 - 1e-9)) { setCls('flash-down'); setK((x) => x + 1); }
    prev.current = value;
  }, [value]);
  return <span key={k} className={`${cls} ${className}`}>{children}</span>;
}

export function Sparkline({ points, color, width = 120, height = 34, fill = true }: { points: number[]; color: string; width?: number; height?: number; fill?: boolean }) {
  if (points.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const xs = (i: number) => (i / (points.length - 1)) * width;
  const ys = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join('');
  const id = `sg${color.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block', maxWidth: '100%' }}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={`${d}L${width},${height}L0,${height}Z`} fill={`url(#${id})`} />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function InfoButton({ onClick, label = 'More info' }: { onClick: () => void; label?: string }) {
  return <button className="info-btn" onClick={onClick} aria-label={label} title={label}>i</button>;
}

export function TokenLink({ token, size = 22, showName = false }: { token: Token; size?: number; showName?: boolean }) {
  return (
    <Link to={`/token/${token.id}`} className="row" style={{ gap: 8 }}>
      <TokenLogo token={token} size={size} />
      <span style={{ fontWeight: 800 }}>${token.ticker}</span>
      {showName && <span className="muted">{token.name}</span>}
    </Link>
  );
}

export function StreakBadge({ streak, size = 'sm', compact }: { streak: number; size?: 'sm' | 'lg'; compact?: boolean }) {
  if (streak < 2) return null;
  return (
    <span className={`streak streak-${size}`} title={`${streak} battle win streak`}>
      <span className="streak-flame">🔥</span>
      <span className="mono">{streak}</span>
      {!compact && <span className="streak-w">W STREAK</span>}
    </span>
  );
}

export function useInterval(cb: () => void, ms: number) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}
