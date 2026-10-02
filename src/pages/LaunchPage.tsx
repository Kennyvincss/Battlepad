import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../data/DataContext';
import { useUi } from '../components/AppState';
import { lookupToken } from '../live/market';
import { price as fmtPrice, short, usd } from '../lib/format';
import { config } from '../live/config';
import { TokenLogo, sideColor, sideStyle } from '../components/ui';

type Preview = Awaited<ReturnType<typeof lookupToken>>;
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function ListTokenTab() {
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
          <div className="callout callout-info"><span>ℹ️</span><span>Listing an existing token is free. Name, logo and pool are read from live market data; your wallet becomes the token's lister and can send and accept challenges.</span></div>
        </div>

        <div className="col" style={{ gap: 14 }}>
          <div className="panel launch-preview" style={sideStyle(hue)}>
            <div className="label">Preview</div>
            {pv ? <TokenLogo token={pv} size={96} /> : <span className="tlogo" style={{ width: 96, height: 96 }} />}
            <div className="display" style={{ fontSize: 30, fontWeight: 700, color: sideColor(hue, 70) }}>${preview?.symbol ?? 'TICKER'}</div>
            <div className="muted">{preview?.name ?? 'Paste a mint to preview'}</div>
          </div>

          <AfterMode mode={mode} setMode={setMode} what="listing" />
          <button className={`btn btn-lg btn-block ${mode === 'battle' ? 'btn-battle' : 'btn-primary'}`} disabled={!preview || !!already || listing || preview.liquidityUsd < 10_000 || !e.configured} onClick={list}>
            {listing ? 'Listing…' : mode === 'battle' ? '⚔️ List & choose opponent' : '🚀 List token'}
          </button>
          {!e.wallet.connected && <div className="dim" style={{ fontSize: 12 }}>You'll connect and sign in with your wallet (a message signature, no funds move).</div>}
        </div>
      </div>
  );
}

type Mode = 'battle' | 'normal';

function AfterMode({ mode, setMode, what }: { mode: Mode; setMode: (m: Mode) => void; what: string }) {
  return (
    <>
      <div className="label">After {what}</div>
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
    </>
  );
}

/** pump.fun create costs (mint + bonding-curve rent, priority fee), approximate. */
const NETWORK_COST_SOL = 0.025;

function CreateTokenTab() {
  const e = useData();
  const ui = useUi();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [desc, setDesc] = useState('');
  const [image, setImage] = useState<File>();
  const [website, setWebsite] = useState('');
  const [x, setX] = useState('');
  const [telegram, setTelegram] = useState('');
  const [devBuy, setDevBuy] = useState('0.05');
  const [mode, setMode] = useState<Mode>('battle');
  const [step, setStep] = useState<string>();
  const imgUrl = useMemo(() => (image ? URL.createObjectURL(image) : undefined), [image]);
  useEffect(() => () => { if (imgUrl) URL.revokeObjectURL(imgUrl); }, [imgUrl]);

  const ticker = symbol.replace(/^\$/, '').toUpperCase();
  const buy = Number(devBuy || 0);
  const hasFee = config.launchFeeUsd > 0;
  const feeSol = !hasFee ? 0 : e.solUsd ? config.launchFeeUsd / e.solUsd : null;
  const total = feeSol !== null ? feeSol + buy + NETWORK_COST_SOL : null;
  const short_ = e.wallet.solBalance !== null && total !== null && e.wallet.solBalance < total;
  const errors = [
    !image && 'Add an image',
    image && image.size > 4 * 1024 * 1024 && 'Image must be 4 MB or smaller',
    (!name.trim() || name.trim().length > 32) && 'Name must be 1–32 characters',
    !/^[A-Z0-9]{1,10}$/.test(ticker) && 'Ticker must be 1–10 letters or numbers',
    !(buy >= 0 && buy <= 50) && 'Dev buy must be 0–50 SOL',
  ].filter(Boolean) as string[];
  const hue = (() => { let h = 0; for (const c of ticker || 'BATTLE') h = (h * 31 + c.charCodeAt(0)) % 360; return h; })();

  const launch = async () => {
    if (!(await ui.requireSignIn())) return;
    try {
      const { token, signature } = await e.launchToken({
        name: name.trim(), symbol: ticker, description: desc.trim(), image: image!, devBuySol: buy,
        socials: { website: website.trim(), x: x.trim(), telegram: telegram.trim() },
      }, setStep);
      ui.toast({ title: `🚀 $${token.ticker} is live`, body: `Launched on pump.fun · ${short(signature, 6)}`, tone: 'good' });
      nav(mode === 'battle' ? `/create-battle?token=${token.id}` : `/token/${token.id}`);
    } catch (err) {
      ui.toast({ title: 'Launch failed', body: (err as Error).message, tone: 'bad' });
    } finally {
      setStep(undefined);
    }
  };

  return (
    <div className="launch-grid">
      <div className="panel panel-pad col" style={{ gap: 16 }}>
        <div className="field">
          <label htmlFor="img">Image</label>
          <input id="img" className="input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(ev) => setImage(ev.target.files?.[0])} />
          <span className="dim" style={{ fontSize: 12 }}>PNG, JPG, GIF or WebP, up to 4 MB. Square works best.</span>
        </div>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" className="input" value={name} onChange={(ev) => setName(ev.target.value)} maxLength={32} placeholder="Battle Cat" />
          </div>
          <div className="field">
            <label htmlFor="ticker">Ticker</label>
            <input id="ticker" className="input mono" value={symbol} onChange={(ev) => setSymbol(ev.target.value.replace(/[^a-zA-Z0-9$]/g, ''))} maxLength={11} placeholder="BCAT" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="cdesc">Description</label>
          <textarea id="cdesc" className="textarea" value={desc} onChange={(ev) => setDesc(ev.target.value)} maxLength={280} placeholder="What's your community about?" />
        </div>
        <div className="grid grid-3" style={{ gap: 12 }}>
          <div className="field"><label htmlFor="web">Website</label><input id="web" className="input" value={website} onChange={(ev) => setWebsite(ev.target.value)} placeholder="https://" /></div>
          <div className="field"><label htmlFor="xx">X</label><input id="xx" className="input" value={x} onChange={(ev) => setX(ev.target.value)} placeholder="https://x.com/…" /></div>
          <div className="field"><label htmlFor="tg">Telegram</label><input id="tg" className="input" value={telegram} onChange={(ev) => setTelegram(ev.target.value)} placeholder="https://t.me/…" /></div>
        </div>
        <div className="field">
          <label htmlFor="dev">Dev buy (SOL, optional)</label>
          <input id="dev" className="input mono" inputMode="decimal" value={devBuy} onChange={(ev) => setDevBuy(ev.target.value.replace(/[^0-9.]/g, ''))} />
          <span className="dim" style={{ fontSize: 12 }}>Buy your own token in the launch transaction, before anyone else can.</span>
        </div>
        <div className="config-box">
          <div className="kv"><span>BATTLE launch fee</span><span className={hasFee ? '' : 'up'}>{hasFee ? <>${config.launchFeeUsd.toFixed(2)}{feeSol !== null && ` ≈ ${feeSol.toFixed(4)} SOL`}</> : 'Free'}</span></div>
          <div className="kv"><span>Dev buy</span><span>{buy.toFixed(3)} SOL</span></div>
          <div className="kv"><span>Network & pump.fun creation</span><span>≈ {NETWORK_COST_SOL} SOL</span></div>
          <div className="kv"><span><b>Total</b></span><span><b>{total !== null ? `≈ ${total.toFixed(4)} SOL` : '—'}</b></span></div>
          {e.wallet.solBalance !== null && <div className="kv"><span>Your balance</span><span className={short_ ? 'down' : ''}>{e.wallet.solBalance.toFixed(4)} SOL</span></div>}
        </div>
        <div className="callout callout-info"><span>ℹ️</span><span>Your token launches on pump.fun's bonding curve and trades immediately, then graduates to PumpSwap at pump.fun's threshold.{hasFee ? ' The launch fee is paid in SOL inside the same transaction: if the launch fails, nothing is charged.' : ' BATTLE charges nothing to launch; you only pay Solana network and pump.fun creation costs.'}</span></div>
      </div>

      <div className="col" style={{ gap: 14 }}>
        <div className="panel launch-preview" style={sideStyle(hue)}>
          <div className="label">Preview</div>
          {imgUrl ? <img src={imgUrl} alt="" width={96} height={96} style={{ borderRadius: '50%', objectFit: 'cover' }} /> : <span className="tlogo" style={{ width: 96, height: 96 }} />}
          <div className="display" style={{ fontSize: 30, fontWeight: 700, color: sideColor(hue, 70) }}>${ticker || 'TICKER'}</div>
          <div className="muted">{name.trim() || 'Your token name'}</div>
        </div>
        <AfterMode mode={mode} setMode={setMode} what="launch" />
        {errors.length > 0 && (name || symbol || image) && <div className="dim" style={{ fontSize: 12 }}>{errors.join(' · ')}</div>}
        {short_ && <div className="callout callout-warn"><span>⚠️</span><span>Not enough SOL for this launch.</span></div>}
        <button className={`btn btn-lg btn-block ${mode === 'battle' ? 'btn-battle' : 'btn-primary'}`} disabled={errors.length > 0 || !!step || short_ || !e.configured} onClick={launch}>
          {step ?? `🚀 Launch $${ticker || 'TOKEN'}${hasFee ? ` · $${config.launchFeeUsd}` : ''}`}
        </button>
        {!e.wallet.connected && <div className="dim" style={{ fontSize: 12 }}>You'll connect and sign in with your wallet, then approve one launch transaction.</div>}
      </div>
    </div>
  );
}

function PendingLaunch() {
  const e = useData();
  const ui = useUi();
  const nav = useNavigate();
  const [p, setP] = useState(() => e.pendingLaunch());
  const [busy, setBusy] = useState(false);
  if (!p) return null;
  const finish = async () => {
    if (!(await ui.requireSignIn())) return;
    setBusy(true);
    try {
      const t = await e.finishLaunch(p);
      setP(null);
      nav(`/token/${t.id}`);
    } catch (err) {
      ui.toast({ title: 'Could not finish listing', body: (err as Error).message, tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="callout callout-warn" style={{ marginBottom: 14 }}>
      <span>⏳</span>
      <span className="grow">Your launch of <b>${p.symbol}</b> was sent but not listed on BATTLE yet.</span>
      <button className="btn btn-sm" disabled={busy} onClick={finish}>{busy ? 'Checking…' : 'Finish listing'}</button>
    </div>
  );
}

export function LaunchPage() {
  const [tab, setTab] = useState<'create' | 'list'>('create');
  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">🚀 Launch</h1>
          <div className="page-sub">Create a brand-new token that trades instantly and can battle right away, or bring a token that already trades on Solana.</div>
        </div>
      </div>
      <PendingLaunch />
      <div className="tabs">
        <button className={`tab ${tab === 'create' ? 'active' : ''}`} onClick={() => setTab('create')}>Create new token</button>
        <button className={`tab ${tab === 'list' ? 'active' : ''}`} onClick={() => setTab('list')}>List existing token</button>
      </div>
      {tab === 'create' ? <CreateTokenTab /> : <ListTokenTab />}
    </div>
  );
}
