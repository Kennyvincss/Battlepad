import { VersionedTransaction } from '@solana/web3.js';

/** Minimal injected-wallet interface shared by Phantom, Solflare and Backpack. */
export interface InjectedWallet {
  publicKey: { toBase58(): string } | null;
  isConnected?: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } } | void>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array, encoding?: string): Promise<{ signature: Uint8Array } | Uint8Array>;
  signAndSendTransaction(tx: VersionedTransaction): Promise<{ signature: string } | string>;
  on?(event: string, cb: (...args: unknown[]) => void): void;
}

type W = Window & {
  phantom?: { solana?: InjectedWallet & { isPhantom?: boolean } };
  solflare?: InjectedWallet & { isSolflare?: boolean };
  backpack?: InjectedWallet;
  solana?: InjectedWallet;
};

export const WALLETS = [
  { id: 'Phantom', icon: '👻', get: () => (window as W).phantom?.solana, install: 'https://phantom.app/download', deeplink: (url: string) => `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(location.origin)}` },
  { id: 'Solflare', icon: '🔆', get: () => (window as W).solflare, install: 'https://solflare.com/download', deeplink: (url: string) => `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(location.origin)}` },
  { id: 'Backpack', icon: '🎒', get: () => (window as W).backpack, install: 'https://backpack.app/download', deeplink: undefined },
] as const;

export type WalletId = (typeof WALLETS)[number]['id'];

export function getWallet(id: string): InjectedWallet | undefined {
  return WALLETS.find((w) => w.id === id)?.get();
}

/** Wraps an injected wallet in the shape Supabase's Sign in with Solana expects. */
export function siwsAdapter(w: InjectedWallet) {
  return {
    publicKey: w.publicKey,
    signMessage: async (message: Uint8Array) => {
      const r = await w.signMessage(message, 'utf8');
      return r instanceof Uint8Array ? r : r.signature;
    },
  };
}

export async function signAndSend(w: InjectedWallet, base64Tx: string): Promise<string> {
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(base64Tx), (c) => c.charCodeAt(0)));
  const r = await w.signAndSendTransaction(tx);
  return typeof r === 'string' ? r : r.signature;
}
