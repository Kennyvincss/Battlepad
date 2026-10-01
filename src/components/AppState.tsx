import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useEngine, useEngineEvent } from '../data/DataContext';
import { Modal } from './ui';

interface Toast { id: number; title: string; body?: string; tone?: 'good' | 'bad' | 'info'; icon?: string }
interface AppUi {
  toast: (t: Omit<Toast, 'id'>) => void;
  openWallet: () => void;
  requireWallet: () => boolean;
}

const Ctx = createContext<AppUi>({ toast: () => {}, openWallet: () => {}, requireWallet: () => true });
export const useUi = () => useContext(Ctx);

let tid = 0;

export function AppStateProvider({ children }: { children: ReactNode }) {
  const engine = useEngine();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [walletOpen, setWalletOpen] = useState(false);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++tid;
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 5200);
  }, []);

  useEngineEvent((e) => {
    if (e.type === 'toast') toast({ title: e.title, body: e.body, tone: e.tone });
    if (e.type === 'battle-end') {
      const b = engine.getBattle(e.battleId);
      const w = engine.tokens[e.winner];
      const mine = b && [b.a.tokenId, b.b.tokenId].some((t) => (engine.wallet.positions[t]?.amount ?? 0) > 0);
      if (b && mine && !location.hash.includes(b.id)) {
        toast({ title: `🏆 ${w.logo} $${w.ticker} wins`, body: `Battle over after ${Math.round((b.final?.durationMs ?? 0) / 60000)}m. The losing token keeps trading.`, tone: 'info' });
      }
    }
  }, [toast]);

  const requireWallet = useCallback(() => {
    if (engine.wallet.connected) return true;
    setWalletOpen(true);
    return false;
  }, [engine]);

  return (
    <Ctx.Provider value={{ toast, openWallet: () => setWalletOpen(true), requireWallet }}>
      {children}
      {walletOpen && <WalletModal onClose={() => setWalletOpen(false)} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? ''}`}>
            <div className="grow">
              <div className="toast-title">{t.title}</div>
              {t.body && <div className="toast-body">{t.body}</div>}
            </div>
            <button className="btn btn-ghost btn-sm" style={{ height: 22, padding: '0 6px' }} onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}>✕</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

const WALLETS = [
  { id: 'Phantom', icon: '👻' },
  { id: 'Solflare', icon: '🔆' },
  { id: 'Backpack', icon: '🎒' },
];

function WalletModal({ onClose }: { onClose: () => void }) {
  const engine = useEngine();
  const [busy, setBusy] = useState<string>();
  const connect = async (id: string) => {
    setBusy(id);
    await engine.connectWallet(id);
    setBusy(undefined);
    onClose();
  };
  return (
    <Modal title="Connect wallet" onClose={onClose}>
      <div className="callout callout-info" style={{ marginBottom: 16 }}>
        <span>◇</span>
        <span><b>Prototype:</b> wallets are simulated. Connecting loads a demo wallet with <b>24.6 SOL</b> of simulated balance. No real funds, signatures or transactions are involved.</span>
      </div>
      <div className="col" style={{ gap: 10 }}>
        {WALLETS.map((w) => (
          <button key={w.id} className="btn btn-lg btn-block" style={{ justifyContent: 'flex-start' }} disabled={!!busy} onClick={() => connect(w.id)}>
            <span style={{ fontSize: 22 }}>{w.icon}</span>
            <span className="grow" style={{ textAlign: 'left' }}>{w.id}</span>
            <span className="muted" style={{ fontSize: 12 }}>{busy === w.id ? 'Connecting…' : 'Simulated'}</span>
          </button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
        On BATTLE you trade real tokens through an AMM. You are never placing a bet on the battle outcome — you own the tokens you buy and can sell them at any time, during or after the battle.
      </p>
    </Modal>
  );
}
