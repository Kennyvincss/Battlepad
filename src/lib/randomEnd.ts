import type { EndCheck } from '../data/types';
import { hexToUnit, sha256 } from './sha256';

/**
 * Verifiable random battle end.
 *
 * 1. Before the battle starts, its rules (min duration, epoch length, hazard,
 *    cap, score formula, rewards) are hashed into `rulesHash` and published
 *    together with the battle id. Nothing about the end can change afterwards.
 * 2. After the minimum duration, at the close of every epoch k, the system
 *    waits for the first public randomness-beacon round published *after* the
 *    epoch closed (drand in production). Nobody – creators, traders or the
 *    platform – knows that value in advance, and nobody can choose it.
 * 3. value_k = sha256(battleId | rulesHash | beaconRandomness_k) mapped to
 *    [0, 1). If value_k < hazardPerEpoch the battle ends at that epoch.
 *
 * Anyone can recompute every check with a sha256 tool and the public beacon.
 */
export function endCheckValue(battleId: string, rulesHash: string, randomness: string) {
  return hexToUnit(sha256(`${battleId}|${rulesHash}|${randomness}`));
}

export function verifyCheck(battleId: string, rulesHash: string, c: EndCheck) {
  const v = endCheckValue(battleId, rulesHash, c.beaconRandomness);
  return Math.abs(v - c.value) < 1e-12 && (v < c.threshold) === c.ended;
}

/** Simulated public beacon (drand quicknet style). Replace with a drand HTTP client in production. */
export class SimBeacon {
  constructor(
    readonly genesis: number,
    readonly periodMs: number,
    private readonly chainSeed: string,
  ) {}

  /** First round whose publication time is >= t. */
  roundAfter(t: number) {
    return Math.max(1, Math.ceil((t - this.genesis) / this.periodMs) + 1);
  }

  randomness(round: number) {
    return sha256(`sim-drand-quicknet|${this.chainSeed}|${round}`);
  }
}
