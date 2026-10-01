// Single source of truth for rules, scoring, randomness and integrity — the same
// modules run in the Supabase battle keeper (Deno) and in the browser.
export * from '../../supabase/functions/_shared/types.ts';
export * from '../../supabase/functions/_shared/rules.ts';
export * from '../../supabase/functions/_shared/score.ts';
export * from '../../supabase/functions/_shared/randomEnd.ts';
export { sha256, hexToUnit } from '../../supabase/functions/_shared/sha256.ts';
