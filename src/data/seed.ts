import type { BattleRecordEntry, Creator, Token } from './types';
import { fakeAddress, mulberry32, pick, range } from '../lib/rng';
import { HOUR, MINUTE } from '../lib/rules';

/**
 * Static seed catalogue for the simulated environment: tokens, creators and an
 * archived battle history. All of it is SIMULATED and labelled as such in the UI.
 */
const r = mulberry32(0xba771e);
const DAY = 24 * HOUR;

export const USER_CREATOR_ID = 'you';

type TokenSeed = [id: string, ticker: string, name: string, logo: string, hue: number, creator: string, desc: string];

const TOKEN_SEEDS: TokenSeed[] = [
  ['frog', 'FROG', 'Frog Nation', '🐸', 142, 'c-kermit', 'The pond never sleeps. Community-run meme with a 6-battle war record.'],
  ['cat', 'CAT', 'Catwalk', '🐱', 28, 'c-nyx', 'Nine lives, one chart. The original feline battle token.'],
  ['dog', 'DOG', 'Good Boy', '🐶', 46, 'c-rex', 'Loyal holders, wagging charts.'],
  ['pepe', 'PEPE', 'Pepe Classic', '🍀', 98, 'c-kermit', 'Lucky green energy.'],
  ['bear', 'BEAR', 'Grizzly', '🐻', 8, 'c-ursa', 'Bear markets are a state of mind.'],
  ['bull', 'BULL', 'Raging Bull', '🐂', 205, 'c-ursa', 'Horns up, always.'],
  ['wolf', 'WOLF', 'Lone Wolf', '🐺', 222, 'c-luna', 'Hunts in packs, trades alone.'],
  ['fox', 'FOX', 'Sly Fox', '🦊', 18, 'c-nyx', 'Clever community, sharper memes.'],
  ['owl', 'OWL', 'Night Owl', '🦉', 268, USER_CREATOR_ID, 'Wise money trades at 3am. Your token.'],
  ['shark', 'SHARK', 'Deep Shark', '🦈', 192, 'c-reef', 'Smells green candles from miles away.'],
  ['octo', 'OCTO', 'Octopus', '🐙', 318, 'c-reef', 'Eight arms, eight buy buttons.'],
  ['ape', 'APE', 'Ape Council', '🦍', 282, 'c-banana', 'Apes together strong.'],
  ['tiger', 'TIGER', 'Neon Tiger', '🐯', 36, 'c-banana', 'Stripes earned in battle.'],
  ['panda', 'PANDA', 'Panda Club', '🐼', 335, 'c-luna', 'Chill holders, fierce battles.'],
  ['eagle', 'EAGLE', 'Sky Eagle', '🦅', 52, 'c-rex', 'Sees the whole chart from above.'],
  ['moon', 'MOON', 'Moonshot', '🌙', 245, 'c-astro', 'Literally the moon.'],
  ['dragon', 'DRAGON', 'Jade Dragon', '🐉', 158, 'c-astro', 'Ancient power, fresh mint.'],
  ['ghost', 'GHOST', 'Ghost Protocol', '👻', 180, 'c-nyx', 'Now you see it, now you HODL.'],
];

export const TOKENS: Token[] = TOKEN_SEEDS.map(([id, ticker, name, logo, hue, creatorId, description]) => ({
  id, ticker, name, logo, hue, creatorId, description,
  mint: fakeAddress(r),
  totalSupply: 1_000_000_000,
  createdAt: Date.now() - range(r, 6, 60) * DAY,
  socials: { website: `https://${id}.battle.fun`, x: `https://x.com/${id}_battle`, telegram: `https://t.me/${id}army` },
  launchMode: 'battle',
}));

/** Starting market caps in SOL (≈ $150–$600K) for the simulated AMM pools. */
export const START_MCAP: Record<string, number> = {
  frog: 2000, cat: 2150, dog: 2400, pepe: 1500, bear: 1300, bull: 1900, wolf: 2600, fox: 2300, owl: 1150,
  shark: 3100, octo: 2800, ape: 1800, tiger: 1700, panda: 1400, eagle: 1600, moon: 2100, dragon: 2500, ghost: 1250,
};

/** Hidden "community strength" used only to make archived history varied. */
const STRENGTH: Record<string, number> = {
  frog: 0.72, cat: 0.6, dog: 0.55, pepe: 0.45, bear: 0.35, bull: 0.58, wolf: 0.66, fox: 0.5, owl: 0.5,
  shark: 0.7, octo: 0.48, ape: 0.52, tiger: 0.62, panda: 0.4, eagle: 0.44, moon: 0.57, dragon: 0.64, ghost: 0.42,
};

const mkCreator = (
  id: string, name: string, handle: string, avatar: string, joinedDaysAgo: number,
  h: Partial<Creator['history']>,
): Creator => ({
  id, name, handle, avatar,
  wallet: fakeAddress(r),
  joinedAt: Date.now() - joinedDaysAgo * DAY,
  history: {
    tokensLaunched: 0, tokensActive30d: 0, liquidityPulls: 0, battlesCompleted: 0, battlesWithIntegrityAlerts: 0,
    avgLiquidityRetained7d: 0.8, totalBattleParticipants: 0, ...h,
  },
});

export const CREATORS: Creator[] = [
  mkCreator('c-kermit', 'Kermit Labs', 'kermitlabs', '🧪', 212, { tokensLaunched: 4, tokensActive30d: 4, avgLiquidityRetained7d: 0.91 }),
  mkCreator('c-nyx', 'Nyx', 'nyx_sol', '🌘', 167, { tokensLaunched: 6, tokensActive30d: 5, avgLiquidityRetained7d: 0.84 }),
  mkCreator('c-rex', 'Rex Studio', 'rexstudio', '🦖', 98, { tokensLaunched: 3, tokensActive30d: 2, avgLiquidityRetained7d: 0.73 }),
  mkCreator('c-ursa', 'Ursa Major', 'ursa', '✴️', 140, { tokensLaunched: 5, tokensActive30d: 3, liquidityPulls: 1, avgLiquidityRetained7d: 0.62 }),
  mkCreator('c-luna', 'Luna Collective', 'lunacollective', '🌕', 260, { tokensLaunched: 7, tokensActive30d: 7, avgLiquidityRetained7d: 0.94 }),
  mkCreator('c-reef', 'Reef DAO', 'reefdao', '🪸', 75, { tokensLaunched: 2, tokensActive30d: 2, avgLiquidityRetained7d: 0.88 }),
  mkCreator('c-banana', 'Banana Republic', 'bananarep', '🍌', 54, { tokensLaunched: 3, tokensActive30d: 2, avgLiquidityRetained7d: 0.7 }),
  mkCreator('c-astro', 'Astro', 'astro_dev', '🚀', 31, { tokensLaunched: 2, tokensActive30d: 2, avgLiquidityRetained7d: 0.81 }),
  mkCreator(USER_CREATOR_ID, 'You', 'you', '🫵', 12, { tokensLaunched: 1, tokensActive30d: 1, avgLiquidityRetained7d: 1 }),
];

/* ------------------------------------------------------------------ history */

/** FROG's record is hand-written to match the product brief; everything else is generated. */
const FROG_SCRIPT: [opp: string, won: boolean][] = [
  ['wolf', true], ['owl', false], ['tiger', true], ['bear', true], ['pepe', false], ['bear', true], ['dog', true], ['cat', true],
];

export function generateHistory(): BattleRecordEntry[] {
  const out: BattleRecordEntry[] = [];
  const now = Date.now();
  let idn = 0;
  const push = (a: string, b: string, aWon: boolean, endedAt: number) => {
    const id = `h${++idn}`;
    const durationMs = HOUR + Math.floor(-Math.log(Math.max(r(), 0.02)) * 45 * MINUTE);
    const win = range(r, 62, 82);
    const lose = win - range(r, 1.2, 14);
    out.push({ battleId: id, tokenId: a, opponentId: b, won: aWon, scoreFor: aWon ? win : lose, scoreAgainst: aWon ? lose : win, durationMs, endedAt });
    out.push({ battleId: id, tokenId: b, opponentId: a, won: !aWon, scoreFor: aWon ? lose : win, scoreAgainst: aWon ? win : lose, durationMs, endedAt });
  };

  // FROG – oldest first, most recent (vs CAT) last ~ 9h ago.
  FROG_SCRIPT.forEach(([opp, won], i) => push('frog', opp, won, now - (FROG_SCRIPT.length - i) * 2.6 * DAY + 9 * 60 * MINUTE));

  const ids = TOKENS.map((t) => t.id).filter((id) => id !== 'frog');
  for (let i = 0; i < 70; i++) {
    const a = pick(r, ids);
    let b = pick(r, ids);
    while (b === a) b = pick(r, ids);
    const pa = STRENGTH[a] / (STRENGTH[a] + STRENGTH[b]);
    push(a, b, r() < pa, now - range(r, 0.15, 28) * DAY);
  }
  return out.sort((x, y) => x.endedAt - y.endedAt);
}

export const TRADER_NAMES = [
  'pondlord', 'whiskers.sol', 'degen_dan', 'mooncat', 'apestrong', 'jadehands', 'sharkbait', 'owlnight', 'tigerblood',
  'pandaexp', 'wolfpack', 'foxy', 'grizzly', 'bullrun', 'octopi', 'eaglesight', 'kermit', 'pepefan', 'diamondpaws', 'lilypad',
];
