/** Runtime configuration (Vite env, set in Vercel → Project → Environment Variables). */
export const config = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
  /** Use a dedicated RPC (Helius, Triton, QuickNode…); the public endpoint rate-limits browsers. */
  rpcUrl: (import.meta.env.VITE_SOLANA_RPC_URL as string | undefined) || 'https://api.mainnet-beta.solana.com',
  /** BATTLE swap fee in basis points, routed to the treasury fee account (Jupiter platform fee). */
  feeBps: Number(import.meta.env.VITE_PLATFORM_FEE_BPS ?? 0),
  /** Wrapped-SOL token account that receives the platform fee. */
  feeAccount: import.meta.env.VITE_FEE_ACCOUNT as string | undefined,
  /** Displayed launch fee; the launch-token function's LAUNCH_FEE_USD is what's actually charged. */
  launchFeeUsd: Number(import.meta.env.VITE_LAUNCH_FEE_USD ?? 3),
};

export const isConfigured = () => !!(config.supabaseUrl && config.supabaseAnonKey);
export const treasuryEnabled = () => config.feeBps > 0 && !!config.feeAccount;

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
