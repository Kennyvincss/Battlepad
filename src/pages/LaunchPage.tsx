import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../data/DataContext';
import { useUi } from '../components/AppState';
import { SimPill, TokenLogo, sideColor, sideStyle } from '../components/ui';

const LOGOS = ['🦄', '🐲', '🦁', '🐝', '🦖', '🐧', '🦩', '🐳', '🦔', '🍄', '⚡', '💎', '🔥', '🌊', '👾', '🤖'];

export function LaunchPage() {
  const e = useData();
  const ui = useUi();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [ticker, setTicker] = useState('');
  const [logo, setLogo] = useState('🦄');
  const [hue, setHue] = useState(300);
  const [desc, setDesc] = useState('');
  const [web, setWeb] = useState('');
  const [x, setX] = useState('');
  const [tg, setTg] = useState('');
  const [initialBuy, setInitialBuy] = useState(0.5);
  const [mode, setMode] = useState<'battle' | 'normal'>('battle');
  const valid = name.trim().length >= 2 && /^[A-Za-z0-9]{2,8}$/.test(ticker);

  const launch = () => {
    if (!ui.requireWallet()) return;
    const t = e.createToken({ name: name.trim(), ticker: ticker.toUpperCase(), logo, hue, description: desc.trim() || `${name} — launched on BATTLE.`, socials: { website: web, x, telegram: tg }, initialBuyQuote: initialBuy, launchMode: mode });
    ui.toast({ title: `🚀 $${t.ticker} launched`, body: mode === 'battle' ? 'Now pick an opponent.' : 'Trading is live (simulated).', tone: 'good' });
    nav(mode === 'battle' ? `/create-battle?token=${t.id}` : `/token/${t.id}`);
  };

  const preview = { logo, hue };
  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">🚀 Launch a token</h1>
          <div className="page-sub">Create your token, then send it straight into battle — the fastest way to build a community that shows up.</div>
        </div>
        <SimPill />
      </div>

      <div className="launch-grid">
        <div className="panel panel-pad col" style={{ gap: 16 }}>
          <div className="grid grid-2">
            <div className="field"><label>Token name</label><input className="input" value={name} onChange={(ev) => setName(ev.target.value)} placeholder="e.g. Unicorn Club" maxLength={32} /></div>
            <div className="field"><label>Ticker</label><input className="input mono" value={ticker} onChange={(ev) => setTicker(ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="UNI" maxLength={8} /></div>
          </div>
          <div className="field"><label>Logo</label>
            <div className="logo-grid">
              {LOGOS.map((l) => <button key={l} className={`logo-pick ${logo === l ? 'active' : ''}`} onClick={() => setLogo(l)}>{l}</button>)}
            </div>
            <span className="dim" style={{ fontSize: 11.5 }}>Prototype uses emoji logos. Image upload would go to IPFS/Arweave in production.</span>
          </div>
          <div className="field"><label>Side colour</label>
            <input type="range" min={0} max={359} value={hue} onChange={(ev) => setHue(+ev.target.value)} className="hue-range" />
          </div>
          <div className="field"><label>Description</label><textarea className="textarea" value={desc} onChange={(ev) => setDesc(ev.target.value)} maxLength={280} placeholder="What's your community about?" /></div>
          <div className="grid grid-3">
            <div className="field"><label>Website</label><input className="input" value={web} onChange={(ev) => setWeb(ev.target.value)} placeholder="https://" /></div>
            <div className="field"><label>X / Twitter</label><input className="input" value={x} onChange={(ev) => setX(ev.target.value)} placeholder="@handle" /></div>
            <div className="field"><label>Telegram</label><input className="input" value={tg} onChange={(ev) => setTg(ev.target.value)} placeholder="t.me/…" /></div>
          </div>
          <div className="field"><label>Initial configuration</label>
            <div className="config-box">
              <div className="kv"><span>Total supply</span><span>1,000,000,000 (fixed)</span></div>
              <div className="kv"><span>Pool</span><span>Constant-product AMM · 1% fee</span></div>
              <div className="kv"><span>Mint / freeze authority</span><span>Revoked at launch</span></div>
              <div className="kv">
                <span>Your initial buy</span>
                <span className="row" style={{ gap: 6 }}>
                  {[0, 0.5, 1, 2].map((v) => <button key={v} className={`chip ${initialBuy === v ? 'active' : ''}`} onClick={() => setInitialBuy(v)}>{v} SOL</button>)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: 14 }}>
          <div className="panel launch-preview" style={sideStyle(hue)}>
            <div className="label">Preview</div>
            <TokenLogo token={preview} size={96} />
            <div className="display" style={{ fontSize: 30, fontWeight: 700, color: sideColor(hue, 70) }}>${ticker || 'TICKER'}</div>
            <div className="muted">{name || 'Token name'}</div>
          </div>

          <div className="label">How do you want to launch?</div>
          <button className={`mode-card battle ${mode === 'battle' ? 'active' : ''}`} onClick={() => setMode('battle')}>
            <span className="pill pill-gold" style={{ position: 'absolute', top: 12, right: 12 }}>Recommended</span>
            <div className="mode-icon">⚔️</div>
            <div className="mode-title">Enter a Battle</div>
            <div className="mode-desc">Launch and immediately challenge another token. Battles concentrate attention: live audience, army rallying, winner rewards and a public Battle Record from day one.</div>
            <ul className="mode-list">
              <li>Featured in live discovery</li>
              <li>Share of a locked reward pool if you win</li>
              <li>Start your win streak</li>
            </ul>
          </button>
          <button className={`mode-card ${mode === 'normal' ? 'active' : ''}`} onClick={() => setMode('normal')}>
            <div className="mode-title" style={{ fontSize: 16 }}>Launch normally</div>
            <div className="mode-desc">Standard launch. Trading goes live; you can enter battles later.</div>
          </button>
          <button className={`btn btn-lg btn-block ${mode === 'battle' ? 'btn-battle' : 'btn-primary'}`} disabled={!valid} onClick={launch}>
            {mode === 'battle' ? '⚔️ Launch & choose opponent' : '🚀 Launch token'}
          </button>
          {!valid && <div className="dim" style={{ fontSize: 12 }}>Enter a name and a 2–8 character ticker.</div>}
        </div>
      </div>
    </div>
  );
}
