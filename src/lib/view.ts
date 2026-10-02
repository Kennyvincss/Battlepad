import type { Battle, BattleDetail, IntegrityEvent, Token } from '../data/types';
import type { LiveStore } from '../live/store';

export interface SideView {
  token: Token;
  price: number | null;
  mcapUsd: number | null;
  change: number | null;
  liquidityUsd: number | null;
  holders: number | null;
  holdersDelta: number | null;
  volumeUsd: number;
  buyers: number;
  sellers: number;
  score: number | null;
  position: 1 | 2;
  integrity: number;
}

/**
 * View model for one side. Prices/market caps come from the freshest source
 * (DexScreener poll, ~20s); scores and battle stats come from the keeper.
 */
export function sideView(e: LiveStore, b: Battle, which: 'a' | 'b'): SideView {
  const s = b[which];
  const o = which === 'a' ? b.b : b.a;
  const token = e.tokens[s.tokenId] ?? { id: s.tokenId, mint: s.tokenId, ticker: '???', name: 'Unknown', hue: 200, pairAddress: '', socials: {}, listedBy: '', listedAt: 0 };
  const m = e.markets[s.tokenId];
  const ended = b.status === 'ended' && b.final;
  const score = ended ? (which === 'a' ? b.final!.scoreA.total : b.final!.scoreB.total) : s.score?.total ?? null;
  const other = ended ? (which === 'a' ? b.final!.scoreB.total : b.final!.scoreA.total) : o.score?.total ?? null;
  const price = m?.priceUsd ?? s.priceUsd;
  const started = b.status === 'live' || b.status === 'ended';
  const holders = s.holders;
  const position = b.winner ? (b.winner === s.tokenId ? 1 : 2) : score !== null && other !== null ? (score >= other ? 1 : 2) : which === 'a' ? 1 : 2;
  return {
    token, price,
    mcapUsd: m?.mcapUsd ?? s.mcapUsd,
    change: started && price && s.startPrice ? price / s.startPrice - 1 : m?.change24 ?? null,
    liquidityUsd: m?.liquidityUsd ?? s.liquidityUsd,
    holders,
    holdersDelta: started && holders !== null && s.startHolders !== null ? holders - s.startHolders : null,
    volumeUsd: s.volumeUsd,
    buyers: s.buyers,
    sellers: s.sellers,
    score,
    position: position as 1 | 2,
    integrity: s.volumeUsd > 0 ? Math.round(100 * (1 - s.flaggedUsd / s.volumeUsd)) : 100,
  };
}

/** Coins the keeper listed automatically from pump.fun (no human lister). */
export const isAutoListed = (t: { listedBy: string }) => t.listedBy.startsWith('auto:');

export function battleIntegrity(b: Battle) {
  if (b.final) return Math.round((b.final.integrityA + b.final.integrityB) / 2);
  const vol = b.a.volumeUsd + b.b.volumeUsd;
  const flagged = b.a.flaggedUsd + b.b.flaggedUsd;
  return vol > 0 ? Math.round(100 * (1 - flagged / vol)) : 100;
}

export function recentAlert(e: LiveStore, d: BattleDetail | undefined, windowMs = 12 * 60_000): IntegrityEvent | undefined {
  return d?.integrity.filter((x) => x.severity === 'alert' && e.now - x.t < windowMs).sort((x, y) => y.t - x.t)[0];
}

export const combinedVolumeUsd = (b: Battle) => b.a.volumeUsd + b.b.volumeUsd;

export function isRematch(e: LiveStore, b: Battle) {
  const start = b.startedAt ?? b.scheduledStart;
  return e.history.some((h) => h.battleId !== b.id && h.tokenId === b.a.tokenId && h.opponentId === b.b.tokenId && h.endedAt < start);
}

export function headToHead(e: LiveStore, aId: string, bId: string) {
  const games = e.history.filter((h) => h.tokenId === aId && h.opponentId === bId);
  return { a: games.filter((g) => g.won).length, b: games.filter((g) => !g.won).length };
}

export type CardVariant = 'tournament' | 'streak' | 'close' | 'dominant' | 'rematch' | 'standard';

export function cardVariants(e: LiveStore, b: Battle): CardVariant[] {
  if (!b.final || !b.winner) return ['standard'];
  const margin = Math.abs(b.final.scoreA.total - b.final.scoreB.total);
  const out: CardVariant[] = [];
  if (b.tournamentId) out.push('tournament');
  if (e.recordFor(b.winner).streak >= 3) out.push('streak');
  if (margin < 3) out.push('close');
  if (margin >= 15) out.push('dominant');
  if (isRematch(e, b)) out.push('rematch');
  out.push('standard');
  return out;
}

/** Trader profile stats for the connected wallet, from battle trades indexed by the keeper. */
export function walletBattles(e: LiveStore, wallet: string | undefined) {
  if (!wallet) return [];
  return Object.entries(e.armies).map(([battleId, tokenId]) => ({ battle: e.getBattle(battleId), tokenId })).filter((x) => x.battle);
}
