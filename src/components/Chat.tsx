import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Battle, ChatMessage } from '../data/types';
import { useData } from '../data/DataContext';
import { num } from '../lib/format';
import { SimPill, TokenLogo, sideColor } from './ui';

const EMOJIS = ['🔥', '😂', '🚀', '💎', '🐸', '🐱', '⚔️', '🏆', '👀', '😬', '📈', '📉', '🍿', '💪', 'GG'];

function clock(t: number) {
  return new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Highlight @mentions; your own handle gets a stronger highlight. */
function renderText(text: string) {
  return text.split(/(@[a-z0-9_]+)/gi).map((part, i) =>
    part.startsWith('@') ? <span key={i} className={`mention ${part === '@you' ? 'me' : ''}`}>{part}</span> : <Fragment key={i}>{part}</Fragment>,
  );
}

export function BattleChat({ battle, height = 460, compact }: { battle: Battle; height?: number | string; compact?: boolean }) {
  const e = useData();
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  const ta = e.tokens[battle.a.tokenId];
  const tb = e.tokens[battle.b.tokenId];
  const p = e.chatPrefs;

  const visible = battle.chat.filter((m) => !p.blocked.has(m.user) && !p.muted.has(m.user));
  const last = visible.at(-1)?.id;

  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [last]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  const users = useMemo(() => [...new Set(battle.chat.filter((m) => !m.mine).map((m) => m.user))].slice(-30), [battle.chat.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const mentionQuery = /@([a-z0-9_]*)$/i.exec(text)?.[1];
  const suggestions = mentionQuery !== undefined ? users.filter((u) => u.toLowerCase().startsWith(mentionQuery.toLowerCase()) && !p.blocked.has(u)).slice(0, 5) : [];

  const send = () => {
    if (!text.trim()) return;
    e.postChat(battle.id, text);
    setText('');
    setEmoji(false);
    stick.current = true;
  };

  const armyColor = (m: ChatMessage) => (m.army ? sideColor(e.tokens[m.army].hue, 68) : 'var(--text)');

  return (
    <div className={`panel chat ${compact ? 'chat-compact' : ''}`}>
      <div className="panel-head chat-head">
        <span className="panel-title">
          <span className="row" style={{ gap: 4 }}><TokenLogo token={ta} size={16} />{ta.ticker}<span className="dim">vs</span><TokenLogo token={tb} size={16} />{tb.ticker}</span>
          <span className="dim">·</span> Live chat
        </span>
        <span className="row" style={{ gap: 8 }}>
          <span className="online"><span className="online-dot" />{num(battle.spectators, false)} online</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowPrefs(!showPrefs)} title="Muted & blocked users" aria-label="Chat settings">⚙</button>
        </span>
      </div>
      {showPrefs && (
        <div className="chat-prefs">
          <div className="spread"><span className="label">Muted & blocked</span><SimPill text="Simulated chat" /></div>
          {p.muted.size + p.blocked.size === 0 && <div className="dim" style={{ fontSize: 12 }}>Nobody yet. Use a message's ⋯ menu to mute or block.</div>}
          {[...p.muted].map((u) => <div key={`m${u}`} className="spread"><span>🔇 @{u}</span><button className="btn btn-sm" onClick={() => e.toggleMute(u)}>Unmute</button></div>)}
          {[...p.blocked].map((u) => <div key={`b${u}`} className="spread"><span>⛔ @{u}</span><button className="btn btn-sm" onClick={() => e.toggleBlock(u)}>Unblock</button></div>)}
        </div>
      )}
      <div ref={list} className="chat-list" style={{ height }} onScroll={(ev) => { const el = ev.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
        {visible.length === 0 && <div className="empty" style={{ padding: 20 }}>No messages yet. Say something to the armies 👋</div>}
        {visible.map((m) => {
          const reported = p.reported.has(m.id);
          return (
            <div key={m.id} className={`chat-msg ${m.mine ? 'mine' : ''}`}>
              <span className="chat-av">{m.avatar}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="chat-meta">
                  <b style={{ color: armyColor(m) }}>@{m.user}</b>
                  {m.army && <span className="chat-army" title={`${e.tokens[m.army].ticker} army`}>{e.tokens[m.army].logo}</span>}
                  <span className="dim mono">{clock(m.t)}</span>
                </div>
                <div className="chat-text">
                  {m.deleted ? <i className="dim">Message deleted</i> : reported ? <i className="dim">Message hidden — you reported it</i> : renderText(m.text)}
                </div>
              </div>
              {!m.deleted && (
                <div className="chat-actions">
                  <button className="chat-more" aria-label="Message actions" onClick={(ev) => { ev.stopPropagation(); setMenu(menu === m.id ? null : m.id); }}>⋯</button>
                  {menu === m.id && (
                    <div className="chat-menu" onClick={(ev) => ev.stopPropagation()}>
                      {m.mine ? (
                        <button onClick={() => { e.deleteChat(battle.id, m.id); setMenu(null); }}>🗑 Delete message</button>
                      ) : (
                        <>
                          <button onClick={() => { setText((t) => `${t}@${m.user} `); setMenu(null); input.current?.focus(); }}>@ Mention</button>
                          <button onClick={() => { e.reportChat(m.id); setMenu(null); }}>🚩 Report message</button>
                          <button onClick={() => { e.toggleMute(m.user); setMenu(null); }}>🔇 Mute @{m.user}</button>
                          <button className="danger" onClick={() => { e.toggleBlock(m.user); setMenu(null); }}>⛔ Block @{m.user}</button>
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
            {suggestions.map((u) => <button key={u} onClick={() => { setText(text.replace(/@([a-z0-9_]*)$/i, `@${u} `)); input.current?.focus(); }}>@{u}</button>)}
          </div>
        )}
        {emoji && (
          <div className="chat-emojis">
            {EMOJIS.map((em) => <button key={em} onClick={() => { setText((t) => t + em); input.current?.focus(); }}>{em}</button>)}
          </div>
        )}
        <form className="chat-input" onSubmit={(ev) => { ev.preventDefault(); send(); }}>
          <button type="button" className="btn btn-ghost icon-btn" onClick={() => setEmoji(!emoji)} aria-label="Emoji">😀</button>
          <input ref={input} id={`chat-${battle.id}`} value={text} maxLength={280} onChange={(ev) => setText(ev.target.value)} placeholder={`Message the ${ta.ticker} & ${tb.ticker} armies… (@ to mention)`} aria-label="Chat message" autoComplete="off" />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!text.trim()}>Send</button>
        </form>
        <div className="chat-foot dim">Be kind. No financial advice, no shilling other tokens. Chat is simulated in this prototype.</div>
      </div>
    </div>
  );
}
