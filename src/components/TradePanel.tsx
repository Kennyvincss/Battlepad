import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Battle, Quote, Token, TokenId, TradeSide } from '../data/types';
import { useData } from '../data/DataContext';
import { useUi } from './AppState';
import { num, pct, price as fmtPrice, short, sol, solscanTx, usd } from '../lib/format';
import { Modal, TokenLogo, sideColor, sideStyle } from './ui';

const BUY_PRESETS = [0.1, 0.5, 1, 5];
const SELL_PRESETS = [0.25, 0.5, 0.75, 1];
const SLIPPAGES = [0.005, 0.01, 0.03, 0.05];

/** Debounced live Jupiter quote. */
function useQuote(tokenId: TokenId, side: TradeSide, amount: number, slip: number) {
  const e = useData();
  const [state, setState] = useState<{ q?: Quote; loading: boolean; error?: string }>({ loading: false });
  const seq = useRef(0);
  useEffect(() => {
    if (!(amount > 0)) { setState({ loading: false }); return; }
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const t = setTimeout(() => {
      e.quote(tokenId, side, amount, slip)
        .then((q) => id === seq.current && setState({ q, loading: false }))
        .catch((err) => id === seq.current && setState({ loading: false, error: (err as Error).message }));
    }, 450);
    const refresh = setInterval(() => {
      e.quote(tokenId, side, amount, slip).then((q) => id === seq.current && setState({ q, loading: false })).catch(() => {});
    }, 15_000);
    return () => { clearTimeout(t); clearInterval(refresh); };
  }, [e, tokenId, side, amount, slip]);
  return state;
}

export function TradePanel({ battle, tokens, initialToken, initialSide = 'buy', compact, onDone }: {
  battle?: Battle;
  tokens: Token[];
  initialToken?: TokenId;
  initialSide?: TradeSide;
  compact?: boolean;
  onDone?: () => void;
}) {
  const e = useData();
  const ui = useUi();
  const [tokenId, setTokenId] = useState<TokenId>(initialToken ?? tokens[0].id);
  const [side, setSide] = useState<TradeSide>(initialSide);
  const [amountStr, setAmountStr] = useState('');
  const [slip, setSlip] = useState(0.01);
  const [showSlip, setShowSlip] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [army, setArmy] = useState<Token | null>(null);

  useEffect(() => { if (initialToken) setTokenId(initialToken); }, [initialToken]);
  useEffect(() => { setSide(initialSide); }, [initialSide]);

  const token = e.tokens[tokenId];
  const market = e.markets[tokenId];
  const held = e.wallet.tokens[tokenId]?.amount ?? 0;
  const amount = parseFloat(amountStr) || 0;
  const { q, loading, error } = useQuote(tokenId, side, amount, slip);
  const bal = side === 'buy' ? (e.wallet.solBalance ?? 0) : held;
  const insufficient = e.wallet.connected && amount > bal * (1 + 1e-9);
  const impact = q?.priceImpact ?? 0;
  const impactCls = impact > 0.1 ? 'down' : impact > 0.03 ? 'warn' : '';
  const hue = token?.hue ?? 200;
  const myArmy = battle ? e.armies[battle.id] : undefined;
  const valueUsd = e.solUsd ? (side === 'buy' ? amount : q?.outputAmount ?? 0) * e.solUsd : null;

  if (!token) return null;

  const setPreset = (v: number) => {
    if (side === 'buy') setAmountStr(String(v));
    else setAmountStr(held > 0 ? String(v === 1 ? held : +(held * v).toPrecision(8)) : '0');
  };

  const submit = async () => {
    if (!ui.requireWallet() || !q) return;
    setPending(true);
    const res = await e.executeTrade(q, battle?.id);
    setPending(false);
    setConfirm(false);
    if (!res.ok) {
      ui.toast({ title: 'Swap not completed', body: res.error, tone: 'bad' });
      return;
    }
    setAmountStr('');
    ui.toast({
      title: side === 'buy' ? `Bought ${num(q.outputAmount)} $${token.ticker}` : `Sold ${num(q.inputAmount)} $${token.ticker}`,
      body: `Confirmed on Solana · tx ${short(res.signature, 6)}`,
      tone: 'good',
      href: solscanTx(res.signature),
    });
    if (res.joinedArmy) setArmy(token);
    onDone?.();
  };

  return (
    <div className={`panel trade ${compact ? 'trade-compact' : ''}`} style={sideStyle(hue)}>
      {!compact && (
        <div className="panel-head">
          <span className="panel-title">Trade</span>
          <span className="pill pill-up" title="Real Solana swap routed through Jupiter. You receive and own the tokens.">Real swap · Jupiter</span>
        </div>
      )}
      <div className="panel-pad col" style={{ gap: 12 }}>
        {tokens.length > 1 && (
          <div className="trade-tokens">
            {tokens.map((t) => (
              <button key={t.id} className={`trade-token ${t.id === tokenId ? 'active' : ''}`} style={sideStyle(t.hue)} onClick={() => setTokenId(t.id)}>
                <TokenLogo token={t} size={22} /> {t.ticker}
              </button>
            ))}
          </div>
        )}
        <div className="trade-sides">
          <button className={`trade-side buy ${side === 'buy' ? 'active' : ''}`} onClick={() => { setSide('buy'); setAmountStr(''); }}>Buy {token.ticker}</button>
          <button className={`trade-side sell ${side === 'sell' ? 'active' : ''}`} onClick={() => { setSide('sell'); setAmountStr(''); }}>Sell {token.ticker}</button>
        </div>

        <div className="trade-input-wrap">
          <div className="spread" style={{ marginBottom: 6 }}>
            <label className="label" htmlFor={`amt-${tokenId}`}>{side === 'buy' ? 'You pay' : 'You sell'}</label>
            <button className="btn-text" onClick={() => setPreset(1)} disabled={!e.wallet.connected}>
              Balance: <span className="mono">{e.wallet.connected ? (side === 'buy' ? (e.wallet.solBalance !== null ? sol(e.wallet.solBalance, 4) : '…') : `${num(held)} ${token.ticker}`) : '—'}</span>
            </button>
          </div>
          <div className="trade-input">
            <input id={`amt-${tokenId}`} inputMode="decimal" placeholder="0.00" value={amountStr} onChange={(ev) => setAmountStr(ev.target.value.replace(/[^0-9.]/g, ''))} />
            <span className="trade-unit">{side === 'buy' ? <>◎ SOL</> : <><TokenLogo token={token} size={18} /> {token.ticker}</>}</span>
          </div>
          <div className="trade-presets">
            {side === 'buy'
              ? BUY_PRESETS.map((p) => <button key={p} className="chip" onClick={() => setPreset(p)}>{p} SOL</button>)
              : SELL_PRESETS.map((p) => <button key={p} className="chip" disabled={held <= 0} onClick={() => setPreset(p)}>{p === 1 ? 'MAX' : `${p * 100}%`}</button>)}
          </div>
        </div>

        <div className="trade-est">
          <div className="kv"><span>{side === 'buy' ? 'Est. tokens received' : 'Est. SOL received'}</span>
            <span style={{ color: 'var(--text)', fontWeight: 700 }}>{loading ? 'Quoting…' : q ? (side === 'buy' ? `${num(q.outputAmount)} ${token.ticker}` : sol(q.outputAmount, 4)) : '—'}</span>
          </div>
          <div className="kv"><span>Value</span><span>{valueUsd !== null ? usd(valueUsd, { compact: false }) : '—'}</span></div>
          <div className="kv"><span>Price</span><span>{fmtPrice(market?.priceUsd)}</span></div>
          <div className="kv"><span>Price impact</span><span className={impactCls}>{q ? pct(impact, 2, false) : '—'}</span></div>
          <div className="kv">
            <span>Slippage tolerance</span>
            <button className="btn-text mono" onClick={() => setShowSlip(!showSlip)}>{(slip * 100).toFixed(1)}% ⚙</button>
          </div>
          {showSlip && (
            <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
              {SLIPPAGES.map((s) => <button key={s} className={`chip ${slip === s ? 'active' : ''}`} onClick={() => setSlip(s)}>{(s * 100).toFixed(1)}%</button>)}
            </div>
          )}
          <div className="kv"><span>Min. received</span><span>{q ? (side === 'buy' ? `${num(q.minReceived)} ${token.ticker}` : sol(q.minReceived, 4)) : '—'}</span></div>
          <div className="kv"><span>Route</span><span className="truncate" style={{ maxWidth: 190 }}>{q?.route ?? '—'}</span></div>
          {q && q.feeBps > 0 && <div className="kv"><span>BATTLE fee → treasury</span><span>{(q.feeBps / 100).toFixed(2)}%</span></div>}
        </div>
        {error && <div className="callout callout-alert" style={{ fontSize: 12.5 }}><span>⚠️</span><span>Quote unavailable: {error}</span></div>}

        {!e.wallet.connected ? (
          <button className="btn btn-primary btn-lg btn-block" onClick={ui.openWallet}>Connect wallet to trade</button>
        ) : (
          <button className={`btn btn-lg btn-block ${side === 'buy' ? 'btn-side-solid' : 'btn-sell'}`} disabled={amount <= 0 || insufficient || !q || loading} onClick={() => setConfirm(true)}>
            {insufficient ? 'Insufficient balance' : side === 'buy' ? `Buy ${token.ticker}` : `Sell ${token.ticker}`}
          </button>
        )}
        {battle?.status === 'live' && side === 'buy' && (
          <div className="trade-note">
            Buying {token.ticker} joins you to the <b style={{ color: sideColor(hue, 70) }}>{token.ticker} ARMY</b> — a social badge only.
            {myArmy && myArmy !== tokenId && <> You're currently in the {e.tokens[myArmy]?.ticker} army.</>}
          </div>
        )}
        <div className="trade-disclaimer">
          Real swaps on Solana mainnet. You buy and sell the actual token — this is <b>not a prediction market</b> and not a bet on the battle outcome. Sell any time. Crypto is volatile; only trade what you can afford to lose.
        </div>
      </div>

      {confirm && q && (
        <Modal title="Confirm swap" onClose={() => !pending && setConfirm(false)}>
          <div className="confirm-hero" style={sideStyle(hue)}>
            <TokenLogo token={token} size={54} />
            <div>
              <div className="label">{side === 'buy' ? 'Buy' : 'Sell'}</div>
              <div className="display" style={{ fontSize: 28, fontWeight: 700 }}>{side === 'buy' ? `≈ ${num(q.outputAmount)} ${token.ticker}` : `${num(amount)} ${token.ticker}`}</div>
              <div className="muted mono">{side === 'buy' ? `for ${sol(amount)}` : `for ≈ ${sol(q.outputAmount, 4)}`}</div>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <div className="kv"><span>Price impact</span><span className={impactCls}>{pct(impact, 2, false)}</span></div>
            <div className="kv"><span>Slippage tolerance</span><span>{(slip * 100).toFixed(1)}%</span></div>
            <div className="kv"><span>Minimum received</span><span>{side === 'buy' ? `${num(q.minReceived)} ${token.ticker}` : sol(q.minReceived, 4)}</span></div>
            <div className="kv"><span>Route</span><span>{q.route}</span></div>
            {q.feeBps > 0 && <div className="kv"><span>BATTLE fee (to battle treasury)</span><span>{(q.feeBps / 100).toFixed(2)}%</span></div>}
            <div className="kv"><span>Token mint</span><a className="hash link" href={`https://solscan.io/token/${token.mint}`} target="_blank" rel="noopener noreferrer">{short(token.mint, 6)} ↗</a></div>
          </div>
          {impact > 0.05 && <div className="callout callout-warn" style={{ marginTop: 12 }}>⚠️ <span>High price impact. You may receive noticeably fewer tokens than the spot price suggests.</span></div>}
          <div className="callout callout-info" style={{ marginTop: 12 }}>
            <span>ℹ️</span>
            <span>Your wallet will ask you to approve a real Solana transaction. Battle outcomes never settle your position, and winning does not guarantee future price appreciation.</span>
          </div>
          <button className={`btn btn-lg btn-block ${side === 'buy' ? 'btn-side-solid' : 'btn-sell'}`} style={{ marginTop: 16, ...sideStyle(hue) }} onClick={submit} disabled={pending}>
            {pending ? <><span className="spinner" /> Approve in wallet, then confirming…</> : 'Confirm swap'}
          </button>
        </Modal>
      )}
      {army && <ArmyJoined token={army} onClose={() => setArmy(null)} />}
    </div>
  );
}

export function ArmyJoined({ token, onClose }: { token: Token; onClose: () => void }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const id = setTimeout(() => close.current(), 4200);
    return () => clearTimeout(id);
  }, []);
  return createPortal(
    <div className="army-overlay" style={sideStyle(token.hue)} onClick={onClose}>
      <div className="army-card">
        <div className="army-rays" />
        <TokenLogo token={token} size={110} className="army-logo" />
        <div className="army-title">YOU JOINED THE<br /><span style={{ color: sideColor(token.hue, 68) }}>{token.ticker} ARMY</span></div>
        <div className="army-sub">Welcome, soldier. Armies are social only — your tokens trade exactly the same and you can sell any time.</div>
      </div>
    </div>,
    document.body,
  );
}

