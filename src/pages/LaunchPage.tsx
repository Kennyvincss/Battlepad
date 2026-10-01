import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../data/DataContext';
import { useUi } from '../components/AppState';
import { lookupToken } from '../live/market';
import { price as fmtPrice, usd } from '../lib/format';
import { TokenLogo, sideColor, sideStyle } from '../components/ui';

type Preview = Awaited<ReturnType<typeof lookupToken>>;
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function LaunchPage() {
  const e = useData();
  const ui = useUi();
  const nav = useNavigate();
  const [mint, setMint] = useState('');
  const [desc, setDesc] = useState('');
  const [preview, setPreview] = useState<Preview | undefined>();
  const [looking, setLooking] = useState(false);
  const [lookErr, setLookErr] = useState<string>();
  const [mode, setMode] = useState<'battle' | 'normal'>('battle');
  const [listing, setListing] = useState(false);
  const valid = MINT_RE.test(mint.trim());
  const already = valid ? e.tokens[mint.trim()] : undefined;

  useEffect(() => {
    setPreview(undefined);
    setLookErr(undefined);
    if (!valid) return;
    let alive = true;
    setLooking(true);
    lookupToken(mint.trim())
      .then((p) => { if (alive) { setPreview(p); if (!p) setLookErr('No trading pool found for this mint on DexScreener.'); } })
      .catch((err) => alive && setLookErr((err as Error).message))
      .finally(() => alive && setLooking(false));
    return () => { alive = false; };
  }, [mint, valid]);

  const list = async () => {
    if (!(await ui.requireSignIn())) return;
    setListing(true);
    try {
      const t = await e.listToken(mint.trim(), desc.trim());
      ui.toast({ title: `🚀 $${t.ticker} listed`, body: mode === 'battle' ? 'Now pick an opponent.' : 'It can now be challenged.', tone: 'good' });
      nav(mode === 'battle' ? `/create-battle?token=${t.id}` : `/token/${t.id}`);
    } catch (err) {
      ui.toast({ title: 'Listing failed', body: (err as Error).message, tone: 'bad' });
    } finally {
      setListing(false);
    }
  };

  const hue = (() => { let h = 0; for (const c of mint.trim()) h = (h * 31 + c.charCodeAt(0)) % 360; return h; })();
  const pv = preview ? { ticker: preview.symbol, hue, logoUrl: preview.logoUrl } : undefined;

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">🚀 List your token</h1>
          <div className="page-sub">Bring an existing Solana token to BATTLE. Paste its mint address; name, logo and pool are read from live market data. Your wallet becomes the token's lister and can send and accept challenges.</div>
        </div>
      </div>

      <div className="launch-grid">
        <div className="panel panel-pad col" style={{ gap: 16 }}>
          <div className="field">
            <label htmlFor="mint">Token mint address</label>
            <input id="mint" className="input mono" value={mint} onChange={(ev) => setMint(ev.target.value.trim())} placeholder="e.g. DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" autoComplete="off" spellCheck={false} />
            {mint && !valid && <span className="down" style={{ fontSize: 12 }}>That doesn't look like a Solana mint address.</span>}
            {already && <span className="warn" style={{ fontSize: 12 }}>Already listed. <Link className="link" to={`/token/${already.id}`}>Open ${already.ticker} →</Link></span>}
          </div>
          {looking && <div className="muted">Looking up live market…</div>}
          {lookErr && <div className="callout callout-alert"><span>⚠️</span><span>{lookErr}</span></div>}
          {preview && (
            <div className="config-box">
              <div className="kv"><span>Token</span><span>{preview.name} (${preview.symbol})</span></div>
              <div className="kv"><span>Price</span><span>{fmtPrice(preview.priceUsd)}</span></div>
              <div className="kv"><span>Market cap</span><span>{usd(preview.mcapUsd)}</span></div>
              <div className="kv"><span>Pool liquidity</span><span className={preview.liquidityUsd < 10_000 ? 'down' : ''}>{usd(preview.liquidityUsd)}</span></div>
              <div className="kv"><span>Main pool</span><span className="hash">{preview.dexId} · {preview.pairAddress.slice(0, 6)}…</span></div>
            </div>
          )}
          {preview && preview.liquidityUsd < 10_000 && <div className="callout callout-warn"><span>⚠️</span><span>Pools under $10K liquidity can't be listed: thin pools make battle scores easy to manipulate.</span></div>}
          <div className="field">
            <label htmlFor="desc">Description (optional)</label>
            <textarea id="desc" className="textarea" value={desc} onChange={(ev) => setDesc(ev.target.value)} maxLength={280} placeholder="What's your community about?" />
          </div>
          <div className="callout callout-info"><span>ℹ️</span><span>Creating brand-new tokens from BATTLE arrives with the launch contract. For now, list a token that already trades on a Solana DEX.</span></div>
        </div>

        <div className="col" style={{ gap: 14 }}>
          <div className="panel launch-preview" style={sideStyle(hue)}>
            <div className="label">Preview</div>
            {pv ? <TokenLogo token={pv} size={96} /> : <span className="tlogo" style={{ width: 96, height: 96 }} />}
            <div className="display" style={{ fontSize: 30, fontWeight: 700, color: sideColor(hue, 70) }}>${preview?.symbol ?? 'TICKER'}</div>
            <div className="muted">{preview?.name ?? 'Paste a mint to preview'}</div>
          </div>

          <div className="label">After listing</div>
          <button className={`mode-card battle ${mode === 'battle' ? 'active' : ''}`} onClick={() => setMode('battle')}>
            <span className="pill pill-gold" style={{ position: 'absolute', top: 12, right: 12 }}>Recommended</span>
            <div className="mode-icon">⚔️</div>
            <div className="mode-title">Enter a Battle</div>
            <div className="mode-desc">Challenge another listed token right away. Battles concentrate attention: a live audience, army rallying, a treasury for the winner and a public Battle Record from day one.</div>
          </button>
          <button className={`mode-card ${mode === 'normal' ? 'active' : ''}`} onClick={() => setMode('normal')}>
            <div className="mode-title" style={{ fontSize: 16 }}>Just list it</div>
            <div className="mode-desc">Appear in Discover and accept challenges later.</div>
          </button>
          <button className={`btn btn-lg btn-block ${mode === 'battle' ? 'btn-battle' : 'btn-primary'}`} disabled={!preview || !!already || listing || preview.liquidityUsd < 10_000 || !e.configured} onClick={list}>
            {listing ? 'Listing…' : mode === 'battle' ? '⚔️ List & choose opponent' : '🚀 List token'}
          </button>
          {!e.wallet.connected && <div className="dim" style={{ fontSize: 12 }}>You'll connect and sign in with your wallet (a message signature, no funds move).</div>}
        </div>
      </div>
    </div>
  );
}
