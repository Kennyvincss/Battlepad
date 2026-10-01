import type { Battle, Token } from '../data/types';

/** Simulated chat participants (prototype only). */
export const CHATTERS = [
  { user: 'trader42', avatar: '🧑‍🚀' }, { user: 'frogcommunity', avatar: '🐸' }, { user: 'whiskers', avatar: '😼' },
  { user: 'degen_dan', avatar: '🦍' }, { user: 'mooncat', avatar: '🌙' }, { user: 'jadehands', avatar: '💚' },
  { user: 'sharkbait', avatar: '🦈' }, { user: 'lilypad', avatar: '🪷' }, { user: 'diamondpaws', avatar: '💎' },
  { user: 'chartwizard', avatar: '🧙' }, { user: 'nightowl', avatar: '🦉' }, { user: 'apestrong', avatar: '🍌' },
  { user: 'solsurfer', avatar: '🏄' }, { user: 'paperhands_pat', avatar: '🧻' }, { user: 'gm_gm', avatar: '☀️' },
  { user: 'battlefan', avatar: '⚔️' }, { user: 'holdooor', avatar: '🧱' }, { user: 'quietmoney', avatar: '🤫' },
  { user: 'pixelpunk', avatar: '👾' }, { user: 'oracle', avatar: '🔮' },
] as const;

type Ctx = { battle: Battle; a: Token; b: Token; leader: Token; trailer: Token; elapsed: number; sudden: boolean; mention: string };

const T = {
  hype: [
    (c: Ctx) => `${c.leader.ticker} army is taking this one 😂`,
    (c: Ctx) => `LET'S GO ${c.leader.ticker} 🔥🔥`,
    (c: Ctx) => `${c.trailer.ticker} not done yet, time-weighted score is still close`,
    (c: Ctx) => `${c.a.logo} ${c.a.ticker} vs ${c.b.logo} ${c.b.ticker} best battle today`,
    (c: Ctx) => `just joined the ${c.trailer.ticker} army, underdogs only 🐺`,
    (c: Ctx) => `${c.leader.ticker} holders are diamond pawed 💎`,
    (c: Ctx) => `who's still holding ${c.trailer.ticker}? 🙋`,
    (c: Ctx) => `gm ${c.leader.ticker} soldiers ☀️`,
  ],
  info: [
    (c: Ctx) => `${c.b.ticker} holders just passed ${Math.floor(c.battle.b.startHolders / 500 + 1) * 500}`,
    () => `remember volume isn't scored, holder growth is 📈`,
    (c: Ctx) => `integrity at ${Math.round((c.battle.integrity[c.a.id].score + c.battle.integrity[c.b.id].score) / 2)}%, clean battle so far`,
    (c: Ctx) => `score gap is only ${Math.abs(c.battle.a.score.total - c.battle.b.score.total).toFixed(1)} pts`,
    () => `the last minute pump won't save you, it's time weighted 😅`,
  ],
  sudden: [
    () => `past the hour, this can end ANY second 😬`,
    (c: Ctx) => `every minute ${c.leader.ticker} holds the lead is a minute closer to the W`,
    () => `checked the proof log, still "continue" 🎲`,
    (c: Ctx) => `${c.trailer.ticker} needs a comeback NOW`,
  ],
  early: [
    () => `still in the protected hour, plenty of time`,
    (c: Ctx) => `early lead for ${c.leader.ticker} but it's a long way`,
  ],
  social: [
    (c: Ctx) => `@${c.mention} you were right about this one`,
    (c: Ctx) => `@${c.mention} what's your entry?`,
    () => `chat moving faster than the chart lol`,
    () => `🍿🍿🍿`,
    () => `this is better than sports`,
  ],
};

export function makeChatLine(battle: Battle, a: Token, b: Token, elapsed: number, rnd: () => number) {
  const leader = battle.a.score.total >= battle.b.score.total ? a : b;
  const trailer = leader === a ? b : a;
  const sudden = elapsed >= battle.rules.randomEnd.minDurationMs;
  const who = CHATTERS[Math.floor(rnd() * CHATTERS.length)];
  const mention = CHATTERS[Math.floor(rnd() * CHATTERS.length)].user;
  const ctx: Ctx = { battle, a, b, leader, trailer, elapsed, sudden, mention };
  const pools = [T.hype, T.hype, T.info, T.social, sudden ? T.sudden : T.early];
  const pool = pools[Math.floor(rnd() * pools.length)];
  const text = pool[Math.floor(rnd() * pool.length)](ctx);
  const army = rnd() < 0.5 ? leader.id : trailer.id;
  return { user: who.user, avatar: who.avatar, text, army };
}

export const POST_BATTLE_LINES = [
  (w: Token) => `GG ${w.ticker} 🏆`,
  (w: Token) => `${w.ticker} streak continues 🔥`,
  () => `gg both armies, rematch when?`,
  () => `still holding mine, the token keeps trading 💪`,
  () => `verified the end check myself, legit 🎲`,
];
