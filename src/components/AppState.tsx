import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useEngine, useEngineEvent } from '../data/DataContext';
import { WALLETS } from '../live/wallet';
import { Modal } from './ui';

interface Toast { id: number; title: string; body?: string; tone?: 'good' | 'bad' | 'info'; href?: string }
interface AppUi {
  toast: (t: Omit<Toast, 'id'>) => void;
  openWallet: () => void;
  requireWallet: () => boolean;
  /** Wallet connected AND signed in (needed for chat, listing, challenges). */
  requireSignIn: () => Promise<boolean>;
}

const Ctx = createContext<AppUi>({ toast: () => {}, openWallet: () => {}, requireWallet: () => true, requireSignIn: async () => true });
export const useUi = () => useContext(Ctx);

let tid = 0;

export function AppStateProvider({ children }: { children: ReactNode }) {
  const store = useEngine();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [walletOpen, setWalletOpen] = useState(false);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++tid;
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 6500);
  }, []);

  useEngineEvent((e) => {
    if (e.type === 'toast') toast({ title: e.title, body: e.body, tone: e.tone });
    if (e.type === 'battle-end') {
      const b = store.getBattle(e.battleId);
      const w = store.tokens[e.winner];
      const mine = b && [b.a.tokenId, b.b.tokenId].some((t) => (store.wallet.tokens[t]?.amount ?? 0) > 0);
      if (b && w && mine && !location.hash.includes(b.id)) toast({ title: `🏆 $${w.ticker} won battle #${b.number}`, body: 'The losing token keeps trading normally.', tone: 'info' });
    }
  }, [toast]);

  const requireWallet = useCallback(() => {
    if (store.wallet.connected) return true;
    setWalletOpen(true);
    return false;
  }, [store]);

  const requireSignIn = useCallback(async () => {
    if (!requireWallet()) return false;
    if (store.wallet.signedIn) return true;
    try {
      await store.signIn();
      toast({ title: 'Signed in', body: 'Your wallet signed a message. No funds moved.', tone: 'good' });
      return true;
    } catch (e) {
      toast({ title: 'Sign-in cancelled', body: (e as Error).message, tone: 'bad' });
      return false;
    }
  }, [store, requireWallet, toast]);

  return (
    <Ctx.Provider value={{ toast, openWallet: () => setWalletOpen(true), requireWallet, requireSignIn }}>
      {children}
      {walletOpen && <WalletModal onClose={() => setWalletOpen(false)} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? ''}`}>
            <div className="grow">
              <div className="toast-title">{t.title}</div>
              {t.body && <div className="toast-body">{t.body}</div>}
              {t.href && <a className="link" href={t.href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>View on Solscan ↗</a>}
            </div>
            <button className="btn btn-ghost btn-sm" style={{ height: 22, padding: '0 6px' }} onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))} aria-label="Dismiss">✕</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

function WalletModal({ onClose }: { onClose: () => void }) {
  const store = useEngine();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  const connect = async (id: string) => {
    setBusy(id);
    setError(undefined);
    try {
      const ok = await store.connectWallet(id);
      if (!ok) {
        const w = WALLETS.find((x) => x.id === id)!;
        if (isMobile && w.deeplink) location.href = w.deeplink(location.href);
        else window.open(w.install, '_blank', 'noopener');
        return;
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <Modal title="Connect wallet" onClose={onClose}>
      <div className="col" style={{ gap: 10 }}>
        {WALLETS.map((w) => {
          const installed = !!w.get();
          return (
            <button key={w.id} className="btn btn-lg btn-block" style={{ justifyContent: 'flex-start' }} disabled={!!busy} onClick={() => connect(w.id)}>
              <span style={{ fontSize: 22 }}>{w.icon}</span>
              <span className="grow" style={{ textAlign: 'left' }}>{w.id}</span>
              <span className="muted" style={{ fontSize: 12 }}>{busy === w.id ? 'Approve in wallet…' : installed ? 'Detected' : isMobile && w.deeplink ? 'Open in app' : 'Install ↗'}</span>
            </button>
          );
        })}
      </div>
      {error && <div className="callout callout-alert" style={{ marginTop: 12 }}><span>⚠️</span><span>{error}</span></div>}
      <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
        Connecting shares your public address only. Trades are real Solana swaps routed through Jupiter; your wallet asks you to approve every transaction. You are never placing a bet on a battle outcome — you own the tokens you buy and can sell them at any time.
      </p>
    </Modal>
  );
}
