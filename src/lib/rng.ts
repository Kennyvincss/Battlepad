/** Deterministic PRNG (mulberry32) so generated seed data is stable between reloads. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export const pick = <T,>(r: Rng, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
export const range = (r: Rng, lo: number, hi: number) => lo + r() * (hi - lo);
/** Standard normal via Box–Muller. */
export function gauss(r: Rng) {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

const HEX = '0123456789abcdef';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function fakeAddress(r: Rng, len = 44) {
  let s = '';
  for (let i = 0; i < len; i++) s += B58[Math.floor(r() * B58.length)];
  return s;
}
export function fakeHex(r: Rng, len = 64) {
  let s = '';
  for (let i = 0; i < len; i++) s += HEX[Math.floor(r() * 16)];
  return s;
}
