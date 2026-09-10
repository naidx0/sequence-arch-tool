/* ══════════════════════════════════════════════════════════════════════════
   TERMINAL PANE — C1.3
   packages/web2/src/terminal/TerminalPane.tsx

   Owner quote: real terminal, not a fake pill.
   User-seat Done when: with a repo attached, Terminal workspace pane connects
   `/api/terminal`, shows output, accepts keystrokes, sends resize.
   Inverted-fix ban: do not re-disable composer Terminal or re-add UNSHIPPED
   to paper over a flaky e2e — fix the pane/protocol instead.

   No xterm dependency in this slice: a mono scroll surface + key capture.
   PTY backends echo; pipe backends need local echo (honest note in chrome).
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import {
  connectTerminal,
  estimateTerminalSize,
  stripTerminalControlSequences,
  type TerminalBackend,
  type TerminalClient,
} from './terminalClient';

export function TerminalPane() {
  const surfaceRef = useRef<HTMLPreElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<TerminalClient | null>(null);
  const [text, setText] = useState('');
  const [backend, setBackend] = useState<TerminalBackend | null>(null);
  const [status, setStatus] = useState<'connecting' | 'live' | 'closed' | 'error'>('connecting');
  const [detail, setDetail] = useState('Connecting…');

  useEffect(() => {
    let cancelled = false;
    let client: TerminalClient | null = null;

    void (async () => {
      try {
        client = await connectTerminal({
          onOutput(bytes) {
            const chunk = stripTerminalControlSequences(new TextDecoder().decode(bytes));
            if (chunk) setText((prev) => prev + chunk);
          },
          onBackend(b) {
            if (!cancelled) setBackend(b);
          },
          onClose({ code, reason }) {
            if (cancelled) return;
            setStatus('closed');
            setDetail(reason || `Disconnected (${code})`);
          },
          onError(message) {
            if (cancelled) return;
            setStatus('error');
            setDetail(message);
          },
        });
        if (cancelled) {
          client.close();
          return;
        }
        clientRef.current = client;
        setStatus('live');
        setDetail('Connected');
        const box = wrapRef.current?.getBoundingClientRect();
        if (box) {
          const { cols, rows } = estimateTerminalSize(box.width, box.height);
          client.resize(cols, rows);
        }
      } catch (e) {
        if (cancelled) return;
        setStatus('error');
        setDetail(e instanceof Error ? e.message : 'Failed to connect');
      }
    })();

    return () => {
      cancelled = true;
      client?.close();
      clientRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = surfaceRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    const ro = new ResizeObserver(() => {
      const box = wrap.getBoundingClientRect();
      const { cols, rows } = estimateTerminalSize(box.width, box.height);
      clientRef.current?.resize(cols, rows);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLPreElement>) => {
    if (status !== 'live') return;
    const client = clientRef.current;
    if (!client) return;

    let payload: string | null = null;
    if (event.key === 'Enter') payload = '\n';
    else if (event.key === 'Backspace') payload = '\x7f';
    else if (event.key === 'Tab') payload = '\t';
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      payload = event.key;
    } else if (event.ctrlKey && event.key.length === 1) {
      const code = event.key.toLowerCase().charCodeAt(0) - 96;
      if (code >= 1 && code <= 26) payload = String.fromCharCode(code);
    }
    if (payload === null) return;
    event.preventDefault();
    client.sendInput(payload);
    /* Pipe shells do not echo — local echo so typing is not a void. */
    if (backend === 'pipe') setText((prev) => prev + payload);
  };

  return (
    <div className="terminal-pane" data-testid="terminal-pane" ref={wrapRef}>
      <div className="terminal-pane-chrome" data-testid="terminal-pane-chrome">
        <span className="terminal-pane-title">Terminal</span>
        <span className="terminal-pane-meta" data-testid="terminal-pane-status">
          {status === 'live' && backend ? `${backend} · ${detail}` : detail}
        </span>
      </div>
      <pre
        ref={surfaceRef}
        className="terminal-pane-surface"
        data-testid="terminal-pane-surface"
        tabIndex={0}
        role="log"
        aria-label="Terminal output"
        onKeyDown={onKeyDown}
      >
        {text || (status === 'connecting' ? '' : '')}
      </pre>
    </div>
  );
}
