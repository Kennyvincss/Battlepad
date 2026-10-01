import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Battle, Token, TokenId, TradeSide } from '../data/types';
import { useData } from '../data/DataContext';
import { useUi } from './AppState';
import { num, pct, price as fmtPrice, quoteToUsd, short, sol, usd } from '../lib/format';
import { Modal, TokenLogo, sideColor, sideStyle } from './ui';

const BUY_PRESETS = [0.1, 0.5, 1, 5];
const SELL_PRESETS = [0.25, 0.5, 0.75, 1];
const SLIPPAGES = [0.005, 0.01, 0.03, 0.05];

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
  const pos = e.wallet.positions[tokenId];
  const held = pos?.amount ?? 0;
  const amount = parseFloat(amountStr) || 0;
  const q = useMemo(() => e.quote(tokenId, side, amount, slip), [e, e.version, tokenId, side, amount, slip]); // eslint-disable-line react-hooks/exhaustive-deps
  const bal = side === 'buy' ? e.wallet.quoteBalance : held;
  const insufficient = e.wallet.connected && amount > bal * (1 + 1e-9);
  const impactCls = q.priceImpact > 0.1 ? 'down' : q.priceImpact > 0.03 ? 'warn' : '';
  const hue = token.hue;
  const otherArmy = battle ? e.wallet.armies[battle.id] : undefined;

  const setPreset = (v: number) => {
    if (side === 'buy') setAmountStr(String(v));
    else setAmountStr(held > 0 ? String(v === 1 ? held : Math.floor(held * v)) : '0');
  };

  const submit = async () => {
    if (!ui.requireWallet()) return;
    setPending(true);
    const res = await e.executeTrade({ tokenId, side, amount, slippage: slip, minOut: q.minReceived, battleId: battle?.id });
    setPending(false);
    setConfirm(false);
    if (!res.ok) {
      ui.toast({ title: 'Transaction not executed', body: res.error, tone: 'bad' });
      return;
    }
    setAmountStr('');
    const t = res.trade;
    ui.toast({
      title: side === 'buy' ? `Bought ${num(t.tokenAmount)} $${token.ticker}` : `Sold ${num(t.tokenAmount)} $${token.ticker}`,
      body: `${side === 'buy' ? 'Paid' : 'Received'} ${sol(t.quoteAmount)} · tx ${short(res.signature, 6)} (simulated)`,
      tone: 'good',
    });
    if (res.joinedArmy) setArmy(token);
    onDone?.();
  };

  return (
    <div className={`panel trade ${compact ? 'trade-compact' : ''}`} style={sideStyle(hue)}>
      {!compact && (
        <div className="panel-head">
          <span className="panel-title">Trade</span>
          <span className="pill pill-up" title="You receive and own the tokens.">Real token trading</span>
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
            <span className="label">{side === 'buy' ? 'You pay' : 'You sell'}</span>
            <button className="btn-text" onClick={() => setPreset(1)} disabled={!e.wallet.connected}>
              Balance: <span className="mono">{e.wallet.connected ? (side === 'buy' ? sol(e.wallet.quoteBalance, 3) : `${num(held)} ${token.ticker}`) : '—'}</span>
            </button>
          </div>
          <div className="trade-input">
            <input inputMode="decimal" placeholder="0.00" value={amountStr} onChange={(ev) => setAmountStr(ev.target.value.replace(/[^0-9.]/g, ''))} aria-label="Amount" />
            <span className="trade-unit">{side === 'buy' ? <>◎ SOL</> : <><TokenLogo token={token} size={18} /> {token.ticker}</>}</span>
          </div>
          <div className="trade-presets">
            {side === 'buy'
              ? BUY_PRESETS.map((p) => <button key={p} className="chip" onClick={() => setPreset(p)}>{p} SOL</button>)
              : SELL_PRESETS.map((p) => <button key={p} className="chip" disabled={held <= 0} onClick={() => setPreset(p)}>{p === 1 ? 'MAX' : `${p * 100}%`}</button>)}
          </div>
        </div>

        <div className="trade-est">
          <div className="kv"><span>{side === 'buy' ? 'Est. tokens received' : 'Est. SOL received'}</span><span style={{ color: 'var(--text)', fontWeight: 700 }}>{side === 'buy' ? `${num(q.outputAmount)} ${token.ticker}` : sol(q.outputAmount, 4)}</span></div>
          <div className="kv"><span>Value</span><span>{usd(quoteToUsd(side === 'buy' ? amount : q.outputAmount), { compact: false })}</span></div>
          <div className="kv"><span>Price</span><span>{fmtPrice(market.price)}</span></div>
          <div className="kv"><span>Price impact</span><span className={impactCls}>{pct(q.priceImpact, 2, false)}</span></div>
          <div className="kv">
            <span>Slippage tolerance</span>
            <button className="btn-text mono" onClick={() => setShowSlip(!showSlip)}>{(slip * 100).toFixed(1)}% ⚙</button>
          </div>
          {showSlip && (
            <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
              {SLIPPAGES.map((s) => <button key={s} className={`chip ${slip === s ? 'active' : ''}`} onClick={() => setSlip(s)}>{(s * 100).toFixed(1)}%</button>)}
            </div>
          )}
          <div className="kv"><span>Min. received</span><span>{side === 'buy' ? `${num(q.minReceived)} ${token.ticker}` : sol(q.minReceived, 4)}</span></div>
          <div className="kv"><span>Pool fee (1%)</span><span>{sol(side === 'buy' ? q.fee : q.fee, 4)}</span></div>
        </div>

        {!e.wallet.connected ? (
          <button className="btn btn-primary btn-lg btn-block" onClick={ui.openWallet}>Connect wallet to trade</button>
        ) : (
          <button
            className={`btn btn-lg btn-block ${side === 'buy' ? 'btn-side-solid' : 'btn-sell'}`}
            disabled={amount <= 0 || insufficient}
            onClick={() => setConfirm(true)}
          >
            {insufficient ? 'Insufficient balance' : side === 'buy' ? `Buy ${token.logo} ${token.ticker}` : `Sell ${token.ticker}`}
          </button>
        )}
        {battle && battle.status === 'live' && side === 'buy' && (
          <div className="trade-note">
            Buying {token.ticker} joins you to the <b style={{ color: sideColor(hue, 70) }}>{token.ticker} ARMY</b> — a social badge only.
            {otherArmy && otherArmy !== tokenId && <> You're currently in the {e.tokens[otherArmy].ticker} army.</>}
          </div>
        )}
        <div className="trade-disclaimer">
          You are buying and selling real tokens via an AMM pool — this is <b>not a prediction market</b> and not a bet on the battle outcome. You can sell at any time, during or after the battle.
        </div>
      </div>

      {confirm && (
        <Modal title="Confirm transaction" onClose={() => !pending && setConfirm(false)}>
          <div className="confirm-hero" style={sideStyle(hue)}>
            <TokenLogo token={token} size={54} />
            <div>
              <div className="label">{side === 'buy' ? 'Buy' : 'Sell'}</div>
              <div className="display" style={{ fontSize: 28, fontWeight: 700 }}>{side === 'buy' ? `${num(q.outputAmount)} ${token.ticker}` : `${num(amount)} ${token.ticker}`}</div>
              <div className="muted mono">{side === 'buy' ? `for ${sol(amount)}` : `for ≈ ${sol(q.outputAmount, 4)}`}</div>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <div className="kv"><span>Avg. execution price</span><span>{fmtPrice(q.avgPrice)}</span></div>
            <div className="kv"><span>Price impact</span><span className={impactCls}>{pct(q.priceImpact, 2, false)}</span></div>
            <div className="kv"><span>Slippage tolerance</span><span>{(slip * 100).toFixed(1)}%</span></div>
            <div className="kv"><span>Minimum received</span><span>{side === 'buy' ? `${num(q.minReceived)} ${token.ticker}` : sol(q.minReceived, 4)}</span></div>
            <div className="kv"><span>Network</span><span>Solana · simulated</span></div>
            <div className="kv"><span>Token mint</span><span className="hash">{short(token.mint, 6)}</span></div>
          </div>
          {q.priceImpact > 0.05 && <div className="callout callout-warn" style={{ marginTop: 12 }}>⚠️ <span>High price impact. You may receive noticeably fewer tokens than the spot price suggests.</span></div>}
          <div className="callout callout-info" style={{ marginTop: 12 }}>
            <span>ℹ️</span>
            <span>This is a <b>real swap</b> of SOL ↔ {token.ticker} (simulated in this prototype). Battle outcomes do not settle your position and winning does not guarantee future price appreciation.</span>
          </div>
          <button className={`btn btn-lg btn-block ${side === 'buy' ? 'btn-side-solid' : 'btn-sell'}`} style={{ marginTop: 16, ...sideStyle(hue) }} onClick={submit} disabled={pending}>
            {pending ? <><span className="spinner" /> Confirming…</> : 'Confirm transaction'}
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
        <div className="army-sub">{token.logo} Welcome, soldier. Armies are social only — your tokens trade exactly the same and you can sell any time.</div>
      </div>
    </div>,
    document.body,
  );
}
