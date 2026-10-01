import type { EndCheck } from './types.ts';
import { DRAND_QUICKNET } from './rules.ts';
import { hexToUnit, sha256 } from './sha256.ts';

/**
 * Verifiable random battle end.
 *
 * 1. Before start, the battle id and a hash of every rule are published.
 * 2. After the minimum, at the close of each epoch k, the keeper takes the
 *    first drand quicknet round published *after* the epoch closed. Nobody can
 *    know or choose that value in advance (drand is a threshold network).
 * 3. value_k = sha256(battleId | rulesHash | randomness_k) → [0, 1).
 *    The battle ends at the first epoch with value_k < hazardPerEpoch.
 *
 * Anyone can recompute each check with sha256 and the public drand round
 * (https://api.drand.sh/<chain>/public/<round>), and verify the round's BLS
 * signature with any drand client.
 */
export function endCheckValue(battleId: string, rulesHash: string, randomness: string) {
  return hexToUnit(sha256(`${battleId}|${rulesHash}|${randomness}`));
}

export function verifyCheck(battleId: string, rulesHash: string, c: EndCheck) {
  const v = endCheckValue(battleId, rulesHash, c.beaconRandomness);
  return Math.abs(v - c.value) < 1e-12 && (v < c.threshold) === c.ended;
}

/** First drand quicknet round published at or after unix ms `t`. */
export function drandRoundAfter(tMs: number) {
  const s = tMs / 1000 - DRAND_QUICKNET.genesisTime;
  return Math.max(1, Math.ceil(s / DRAND_QUICKNET.periodSec) + 1);
}

export function drandRoundTime(round: number) {
  return (DRAND_QUICKNET.genesisTime + (round - 1) * DRAND_QUICKNET.periodSec) * 1000;
}

export function drandRoundUrl(round: number) {
  return `${DRAND_QUICKNET.url}/${DRAND_QUICKNET.chainHash}/public/${round}`;
}
