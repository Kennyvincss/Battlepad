export const SOL_USD = 152.4; // Simulated quote-asset reference price.

export function usd(v: number, opts: { compact?: boolean; decimals?: number } = {}) {
  const { compact = true, decimals } = opts;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (compact && abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (compact && abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (compact && abs >= 1e4) return `${sign}$${(abs / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}K`;
  const d = decimals ?? (abs >= 100 ? 0 : 2);
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

export const quoteToUsd = (q: number) => q * SOL_USD;

export function sol(v: number, decimals?: number) {
  const d = decimals ?? (Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 1 ? 2 : 3);
  return `${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })} SOL`;
}

export function num(v: number, compact = true) {
  const abs = Math.abs(v);
  if (compact && abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (compact && abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (compact && abs >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return Math.round(v).toLocaleString('en-US');
}

export function pct(v: number, decimals = 1, signed = true) {
  const s = (v * 100).toFixed(decimals);
  return `${signed && v > 0 ? '+' : ''}${s}%`;
}

/** Very small token prices need significant-digit formatting. */
export function price(v: number) {
  const usdV = v * SOL_USD;
  if (usdV >= 1) return `$${usdV.toFixed(4)}`;
  if (usdV <= 0) return '$0';
  const zeros = Math.floor(-Math.log10(usdV));
  if (zeros >= 4) {
    const sig = (usdV * 10 ** (zeros + 3)).toFixed(0);
    return `$0.0${subscript(zeros)}${sig}`;
  }
  return `$${usdV.toFixed(zeros + 4)}`;
}

function subscript(n: number) {
  const map = '₀₁₂₃₄₅₆₇₈₉';
  return String(n)
    .split('')
    .map((c) => map[+c])
    .join('');
}

/** Elapsed duration, e.g. "1h 47m" (never a countdown to the battle end). */
export function duration(ms: number, withSeconds = false) {
  const totalS = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  if (withSeconds) {
    return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s` : `${m}m ${String(s).padStart(2, '0')}s`;
  }
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function clock(ms: number) {
  const totalS = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function ago(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${Math.max(1, s)}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const short = (addr: string, n = 4) => `${addr.slice(0, n)}…${addr.slice(-n)}`;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
