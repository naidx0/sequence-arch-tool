/* The generative UI pipeline on its own page (genui.specimen.html): a chat column
   with the person's message, the agent's narration, the live surface, and the
   protocol log beside it so every op, fix and action is visible. */
import { StrictMode, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';

import '../tokens/graphite.css';
import '../styles/base.css';
import '../shell2/shell2.css';
import '../shell2/edits.css';
import '../shell2/chat2.css';

import { HttpAgent, type GenUIAgent } from './agent';
import { GenUISurface } from './GenUISurface';
import { MockAgent } from './mockAgent';
import { useGenUISession } from './useGenUISession';

const params = new URLSearchParams(location.search);
const PROMPT = params.get('q') ?? 'Upgrade the auth middleware to the new session API and make sure the tests pass.';
if (params.get('theme') === 'dark') document.documentElement.dataset.theme = 'dark';

const page: CSSProperties = { display: 'grid', gridTemplateColumns: params.get('log') === '0' ? '1fr' : 'minmax(0, 1fr) 360px', gap: 24, padding: 28, minHeight: '100vh', boxSizing: 'border-box', background: 'var(--surface-1)', fontFamily: 'var(--font-sans)' };
const column: CSSProperties = { maxWidth: 640, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 };
const bubble: CSSProperties = { alignSelf: 'flex-end', maxWidth: '80%', padding: '8px 12px', borderRadius: 14, background: 'var(--surface-3)', color: 'var(--ink-1)', fontSize: 'var(--t-13)' };
const prose: CSSProperties = { margin: 0, color: 'var(--ink-2)', fontSize: 'var(--t-13-5)', lineHeight: 1.55 };
const logBox: CSSProperties = { position: 'sticky', top: 28, alignSelf: 'start', height: 'calc(100vh - 56px)', overflow: 'auto', border: '1px solid var(--edge)', borderRadius: 12, background: 'var(--surface-2)', padding: 10, fontFamily: 'var(--font-mono)', fontSize: 'var(--t-11)', lineHeight: 1.5 };
const DIR: Record<string, string> = { agent: 'var(--ink-3)', ui: 'var(--accent)', fix: 'var(--info)', repair: 'var(--fits)' };

function App(): JSX.Element {
  const agent = useMemo<GenUIAgent>(() => (params.get('agent') === 'http' ? new HttpAgent() : new MockAgent({ speed: Number(params.get('speed') ?? 1) })), []);
  const [view, session] = useGenUISession(agent);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    session.start(PROMPT);
  }, [session]);

  /* ?auto=1: press the buttons a person would, in order, once each is live. */
  const pressed = useRef(new Set<string>());
  useEffect(() => {
    if (params.get('auto') !== '1' || view.busy) return undefined;
    const s = view.surfaces[0];
    if (!s || s.phase !== 'settled') return undefined;
    const next = ['fixbtn', 'prbtn', 'mergebtn'].find((id) => s.spec.elements[id] && !pressed.current.has(id) && !s.spec.elements[id]!.props.disabled);
    if (!next) return undefined;
    const t = setTimeout(() => {
      pressed.current.add(next);
      const btn = document.querySelector<HTMLButtonElement>(`[data-gu-id="${next}"] button`);
      btn?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      btn?.click();
    }, 1600);
    return () => clearTimeout(t);
  }, [view]);

  /* Follow the newest output, as a chat does. */
  const tail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const r = tail.current?.getBoundingClientRect();
    if (r && r.bottom > window.innerHeight - 24) window.scrollBy({ top: r.bottom - window.innerHeight + 48, behavior: 'smooth' });
  }, [view]);

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [view.log.length]);

  return (
    <div className="s2" style={page}>
      <main style={column} data-testid="genui-chat">
        <div style={bubble}>{PROMPT}</div>
        {view.narration
          ? view.narration.split(/\n\n+/).map((para, i) => (
              <p key={i} style={prose}>
                {para}
              </p>
            ))
          : null}
        {view.surfaces.map((s) => (
          <GenUISurface key={s.id} view={s} busy={view.busy} onClick={(sid, eid) => session.click(sid, eid)} />
        ))}
        <div ref={tail} style={{ color: 'var(--ink-3)', fontSize: 'var(--t-12)' }} data-testid="genui-turn">
          {view.busy ? `${view.label ?? 'Working'}…` : 'Ready'}
        </div>
      </main>
      {params.get('log') === '0' ? null : (
        <aside style={logBox} ref={logRef} data-testid="genui-log">
          <strong style={{ display: 'block', color: 'var(--ink-2)', marginBottom: 6, fontFamily: 'var(--font-sans)' }}>Protocol</strong>
          {view.log.map((l, i) => (
            <div key={i} style={{ color: DIR[l.dir] }}>
              <span style={{ color: 'var(--ink-4)' }}>{l.dir.padEnd(6)} </span>
              {l.text}
            </div>
          ))}
        </aside>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
