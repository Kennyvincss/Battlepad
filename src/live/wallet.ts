import { PublicKey, VersionedTransaction } from '@solana/web3.js';

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

interface SignInInput {
  domain?: string; address?: string; statement?: string; uri?: string; version?: string; chainId?: string;
  nonce?: string; issuedAt?: string; expirationTime?: string; notBefore?: string; requestId?: string; resources?: readonly string[];
}

/** Sign-In-With-Solana message text in the Wallet Standard field order (what Phantom & co. parse). */
export function siwsMessage(i: SignInInput) {
  let m = `${i.domain} wants you to sign in with your Solana account:\n${i.address}`;
  if (i.statement) m += `\n\n${i.statement}`;
  const f: string[] = [];
  if (i.uri) f.push(`URI: ${i.uri}`);
  if (i.version) f.push(`Version: ${i.version}`);
  if (i.chainId) f.push(`Chain ID: ${i.chainId}`);
  if (i.nonce) f.push(`Nonce: ${i.nonce}`);
  if (i.issuedAt) f.push(`Issued At: ${i.issuedAt}`);
  if (i.expirationTime) f.push(`Expiration Time: ${i.expirationTime}`);
  if (i.notBefore) f.push(`Not Before: ${i.notBefore}`);
  if (i.requestId) f.push(`Request ID: ${i.requestId}`);
  if (i.resources?.length) f.push('Resources:', ...i.resources.map((r) => `- ${r}`));
  if (f.length) m += `\n\n${f.join('\n')}`;
  return m;
}

/**
 * Wraps an injected wallet in the shape Supabase's Sign in with Solana expects.
 * We provide signIn() so the message is built in the standard field order; Supabase's
 * own signMessage fallback puts Version before URI, which Phantom rejects as malformed.
 */
export function siwsAdapter(w: InjectedWallet) {
  const sign = async (message: Uint8Array) => {
    const r = await w.signMessage(message, 'utf8');
    return new Uint8Array(r instanceof Uint8Array ? r : r.signature);
  };
  return {
    publicKey: w.publicKey,
    signMessage: sign,
    signIn: async (input: SignInInput) => {
      const address = w.publicKey?.toBase58();
      if (!address) throw new Error('Wallet is not connected.');
      const signedMessage = new TextEncoder().encode(siwsMessage({ ...input, address }));
      const publicKey = new PublicKey(address).toBytes();
      return {
        account: { address, publicKey, chains: ['solana:mainnet'] as const, features: [] as const },
        signedMessage, signature: await sign(signedMessage), signatureType: 'ed25519' as const,
      };
    },
  };
}

export async function signAndSend(w: InjectedWallet, base64Tx: string): Promise<string> {
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(base64Tx), (c) => c.charCodeAt(0)));
  const r = await w.signAndSendTransaction(tx);
  return typeof r === 'string' ? r : r.signature;
}
