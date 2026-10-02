import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Battle, BattleDetail } from '../data/types';
import { useData } from '../data/DataContext';
import { useUi } from './AppState';
import { num, short } from '../lib/format';
import { TokenLogo, sideColor } from './ui';

const EMOJIS = ['🔥', '😂', '🚀', '💎', '⚔️', '🏆', '👀', '😬', '📈', '📉', '🍿', '💪', 'GG'];

const clock = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

/** Stable avatar colour from a wallet address. */
function hueOf(w: string) {
  let h = 0;
  for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function renderText(text: string, me?: string) {
  return text.split(/(@[1-9A-HJ-NP-Za-km-z]{4}…[1-9A-HJ-NP-Za-km-z]{4}|@[a-z0-9_]+)/gi).map((part, i) =>
    part.startsWith('@') ? <span key={i} className={`mention ${me && part === `@${short(me)}` ? 'me' : ''}`}>{part}</span> : <Fragment key={i}>{part}</Fragment>,
  );
}

export function BattleChat({ battle, detail, height = 460, compact }: { battle: Battle; detail?: BattleDetail; height?: number | string; compact?: boolean }) {
  const e = useData();
  const ui = useUi();
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState(false);
  const [menu, setMenu] = useState<number | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  const ta = e.token(battle.a.tokenId);
  const tb = e.token(battle.b.tokenId);
  const p = e.chatPrefs;
  const me = e.wallet.address;

  const chat = detail?.chat ?? [];
  const visible = chat.filter((m) => !p.blocked.has(m.wallet) && !p.muted.has(m.wallet));
  const last = visible.at(-1)?.id;

  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [last]);

  useEffect(() => {
    if (menu === null) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  const users = useMemo(() => [...new Set(chat.filter((m) => m.wallet !== me).map((m) => short(m.wallet)))].slice(-30), [chat.length, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const mentionQuery = /@([^\s@]*)$/.exec(text)?.[1];
  const suggestions = mentionQuery !== undefined ? users.filter((u) => u.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 5) : [];

  const send = async () => {
    if (!text.trim() || sending) return;
    if (!(await ui.requireSignIn())) return;
    setSending(true);
    try {
      await e.postChat(battle.id, text);
      setText('');
      setEmoji(false);
      stick.current = true;
    } catch (err) {
      ui.toast({ title: 'Message not sent', body: (err as Error).message, tone: 'bad' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`panel chat ${compact ? 'chat-compact' : ''}`}>
      <div className="panel-head chat-head">
        <span className="panel-title">
          <span className="row" style={{ gap: 4 }}>{ta && <TokenLogo token={ta} size={16} />}{ta?.ticker}<span className="dim">vs</span>{tb && <TokenLogo token={tb} size={16} />}{tb?.ticker}</span>
          <span className="dim">·</span> Live chat
        </span>
        <span className="row" style={{ gap: 8 }}>
          <span className="online"><span className="online-dot" />{num(detail?.watchers ?? 0, false)} watching</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowPrefs(!showPrefs)} title="Muted & blocked" aria-label="Chat settings">⚙</button>
        </span>
      </div>
      {showPrefs && (
        <div className="chat-prefs">
          <span className="label">Muted & blocked (this device)</span>
          {p.muted.size + p.blocked.size === 0 && <div className="dim" style={{ fontSize: 12 }}>Nobody yet. Use a message's ⋯ menu to mute or block.</div>}
          {[...p.muted].map((u) => <div key={`m${u}`} className="spread"><span>🔇 {short(u)}</span><button className="btn btn-sm" onClick={() => e.toggleMute(u)}>Unmute</button></div>)}
          {[...p.blocked].map((u) => <div key={`b${u}`} className="spread"><span>⛔ {short(u)}</span><button className="btn btn-sm" onClick={() => e.toggleBlock(u)}>Unblock</button></div>)}
        </div>
      )}
      <div ref={list} className="chat-list" style={{ height }} onScroll={(ev) => { const el = ev.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
        {!detail?.loaded && <div className="empty" style={{ padding: 20 }}>Loading chat…</div>}
        {detail?.loaded && visible.length === 0 && <div className="empty" style={{ padding: 20 }}>No messages yet. Say something to the armies 👋</div>}
        {visible.map((m) => {
          const mine = m.wallet === me;
          const reported = p.reported.has(m.id);
          const army = m.army ? e.tokens[m.army] : undefined;
          return (
            <div key={m.id} className={`chat-msg ${mine ? 'mine' : ''}`}>
              <span className="chat-av" style={{ background: `hsl(${hueOf(m.wallet)} 60% 35% / 0.6)` }}>{m.wallet.slice(0, 2)}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="chat-meta">
                  <b className="mono" style={{ color: army ? sideColor(army.hue, 68) : 'var(--text)' }}>{mine ? 'you' : short(m.wallet)}</b>
                  {army && <span className="chat-army" title={`${army.ticker} army`}>{army.ticker}</span>}
                  <span className="dim mono">{clock(m.t)}</span>
                </div>
                <div className="chat-text">
                  {m.deleted ? <i className="dim">Message deleted</i> : reported ? <i className="dim">Message hidden — you reported it</i> : renderText(m.text, me)}
                </div>
              </div>
              {!m.deleted && (
                <div className="chat-actions">
                  <button className="chat-more" aria-label="Message actions" onClick={(ev) => { ev.stopPropagation(); setMenu(menu === m.id ? null : m.id); }}>⋯</button>
                  {menu === m.id && (
                    <div className="chat-menu" onClick={(ev) => ev.stopPropagation()}>
                      {mine ? (
                        <button onClick={() => { void e.deleteChat(m.id); setMenu(null); }}>🗑 Delete message</button>
                      ) : (
                        <>
                          <button onClick={() => { setText((t) => `${t}@${short(m.wallet)} `); setMenu(null); input.current?.focus(); }}>@ Mention</button>
                          <button onClick={() => { void e.reportChat(m.id); setMenu(null); }}>🚩 Report message</button>
                          <button onClick={() => { e.toggleMute(m.wallet); setMenu(null); }}>🔇 Mute {short(m.wallet)}</button>
                          <button className="danger" onClick={() => { e.toggleBlock(m.wallet); setMenu(null); }}>⛔ Block {short(m.wallet)}</button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="chat-input-wrap">
        {suggestions.length > 0 && (
          <div className="chat-suggest">
            {suggestions.map((u) => <button key={u} onClick={() => { setText(text.replace(/@([^\s@]*)$/, `@${u} `)); input.current?.focus(); }}>@{u}</button>)}
          </div>
        )}
        {emoji && (
          <div className="chat-emojis">
            {EMOJIS.map((em) => <button key={em} onClick={() => { setText((t) => t + em); input.current?.focus(); }}>{em}</button>)}
          </div>
        )}
        <form className="chat-input" onSubmit={(ev) => { ev.preventDefault(); void send(); }}>
          <button type="button" className="btn btn-ghost icon-btn" onClick={() => setEmoji(!emoji)} aria-label="Emoji">😀</button>
          <input ref={input} id={`chat-${battle.id}`} value={text} maxLength={280} onChange={(ev) => setText(ev.target.value)}
            placeholder={e.wallet.signedIn ? `Message the ${ta?.ticker} & ${tb?.ticker} armies… (@ to mention)` : 'Sign in with your wallet to chat'} aria-label="Chat message" autoComplete="off" />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!text.trim() || sending}>{e.wallet.signedIn ? 'Send' : 'Sign in'}</button>
        </form>
        <div className="chat-foot dim">Be kind. No financial advice, no shilling other tokens. Messages are public and tied to your wallet.</div>
      </div>
    </div>
  );
}
