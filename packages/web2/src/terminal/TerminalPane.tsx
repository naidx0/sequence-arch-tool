/* ══════════════════════════════════════════════════════════════════════════
   TERMINAL PANE — C1.3
   packages/web2/src/terminal/TerminalPane.tsx

   Owner quote: real terminal, not a fake pill.
   User-seat Done when: with a repo attached, Terminal workspace pane connects
   `/api/terminal`, shows output, accepts keystrokes, sends resize.
   Inverted-fix ban: do not re-disable composer Terminal or re-add UNSHIPPED
   to paste over a flaky e2e — fix the pane/protocol instead.

   No xterm dependency: a small character grid (terminalScreen.ts) so Backspace,
   history recall, Ctrl+C and `clear` behave, drawn in a mono scroll surface
   with a key capture. The prompt is drawn on one line (promptLine.ts).
   PTY backends echo; pipe backends need local echo (honest note in chrome).
   ══════════════════════════════════════════════════════════════════════════ */

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

import { Icon } from '../chat/Icon';
import { draftIntoComposer } from '../onboarding/agentSetupPrompt';
import { useStoreIfAny } from '../state/connect';
import '../askInPlace/askInPlace.css';
import { askAboutOutputDraft, commandAbove, findSelection } from './askAboutOutput';
import { condensePrompt } from './promptLine';
import { takeTerminalInput } from './terminalInput';
import { createFitScheduler, type FitScheduler } from './terminalFit';
import { createScreen, resizeScreen, viewScreen, writeScreen, type TerminalScreen } from './terminalScreen';
import './terminalFallback.css';

import {
  connectTerminal,
  estimateTerminalSize,
  type TerminalBackend,
  type TerminalClient,
  type TerminalClientHandlers,
} from './terminalClient';

export interface TerminalPaneProps {
  /** When null/undefined, show a calm needs-project state instead of a raw disconnect. */
  repoRoot?: string | null;
  /**
   * A provider id. The pane runs that vendor's own sign-in command (the server
   * picks the command) instead of a shell, needs no project, and calls
   * `onExit` when the pane closes: `ended` true when the command itself ended
   * (the server's 1000 "shell exited"), false for a dropped socket or error.
   */
  signIn?: string;
  /** Round 7: a launch id the server recorded; runs that command like `signIn`, needing no project. */
  launch?: string;
  onExit?: (info: { ended: boolean }) => void;
}

/* The toolbar's glyphs, drawn like the shell's own icons (24 grid, 1.7 stroke). */
const TOOL_ICONS = {
  clear: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h8" />
    </>
  ),
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" />,
  restart: <path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4h4" />,
} as const;

function ToolIcon({ name }: { name: keyof typeof TOOL_ICONS }) {
  return (
    <svg className="s2-i" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {TOOL_ICONS[name]}
    </svg>
  );
}

/** Keys that send an escape sequence to the shell (history, line editing). */
const KEY_SEQUENCES: Record<string, string> = {
  ArrowUp: '\x1b[A',
  ArrowDown: '\x1b[B',
  ArrowRight: '\x1b[C',
  ArrowLeft: '\x1b[D',
  Home: '\x1b[H',
  End: '\x1b[F',
  Delete: '\x1b[3~',
};

/** The cell size of the surface's mono text, measured with a probe; null when the DOM has no layout (jsdom). */
function measureCells(surface: HTMLElement): { cols: number; rows: number } | null {
  const style = getComputedStyle(surface);
  const probe = document.createElement('span');
  probe.textContent = 'M'.repeat(40);
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;pointer-events:none;';
  surface.appendChild(probe);
  const charW = probe.getBoundingClientRect().width / 40;
  const lineH = probe.getBoundingClientRect().height;
  surface.removeChild(probe);
  if (!(charW > 0) || !(lineH > 0)) return null;
  const w = surface.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
  const h = surface.clientHeight - parseFloat(style.paddingTop || '0') - parseFloat(style.paddingBottom || '0');
  if (!(w > 0) || !(h > 0)) return null;
  return { cols: Math.max(20, Math.floor(w / charW)), rows: Math.max(4, Math.floor(h / lineH)) };
}

/** How long a connected terminal may stay blank before the fallback shows, in ms. */
export const BLANK_MS = 4000;

/** The grid the pane's box can hold, or null while the box has no size (hidden tab, not laid out yet):
    a 0x0 box must never be reported to the shell as a (tiny) terminal. */
function measureGrid(wrap: HTMLElement, surface: HTMLElement): { cols: number; rows: number } | null {
  const box = wrap.getBoundingClientRect();
  if (!(box.width > 0) || !(box.height > 0)) return null;
  const m = measureCells(surface) ?? estimateTerminalSize(box.width, box.height);
  if (!(m.cols > 0) || !(m.rows > 0)) return null;
  return m;
}

/** How many times a refused connect (the server has no root yet: 409) is retried before the pane gives up. */
const CONNECT_RETRIES = 8;
const CONNECT_RETRY_MS = 750;

export function TerminalPane({ repoRoot = null, signIn, launch, onExit }: TerminalPaneProps) {
  const store = useStoreIfAny();
  /* "Ask about this output": the selection is captured when the menu opens, because pressing the row can clear it. */
  const [outputMenu, setOutputMenu] = useState<{ left: number; top: number; text: string } | null>(null);
  const surfaceRef = useRef<HTMLPreElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<TerminalClient | null>(null);
  /* The one fitter (terminalFit.ts): the observer and a new socket both fit through it. */
  const fitRef = useRef<FitScheduler | null>(null);
  /* Set by Escape: the next Tab leaves the terminal instead of reaching the shell. */
  const releaseRef = useRef(false);
  const hintId = useId();
  /* What the shell has drawn: a cell grid, redrawn at most once a frame while output streams. */
  const screenRef = useRef<TerminalScreen>(createScreen());
  /* Prompt lines the shell is known to have drawn: the line the cursor was on when Enter was pressed (and the header
     above Git Bash's `$` line). Output that merely looks like a prompt is not in here, so it is not coloured. */
  const knownPrompts = useRef<Set<string>>(new Set());
  const [frame, setFrame] = useState(0);
  const frameQueued = useRef(false);
  const repaint = useCallback(() => {
    if (frameQueued.current) return;
    frameQueued.current = true;
    const run = () => {
      frameQueued.current = false;
      setFrame((n) => n + 1);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else run();
  }, []);
  const [backend, setBackend] = useState<TerminalBackend | null>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'closed' | 'error'>('idle');
  const [detail, setDetail] = useState('Open a project to start a terminal');
  /* The raw close code is kept for the tooltip only (UX audit R11 #15). */
  const [closeCode, setCloseCode] = useState<number | null>(null);
  /* Bumped by Reconnect so the connect effect runs again. */
  const [attempt, setAttempt] = useState(0);
  /* G4: the shell connected but has drawn nothing for BLANK_MS. A calm fallback names the folder and offers Start again. */
  const gotOutput = useRef(false);
  const [blank, setBlank] = useState(false);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const resetScreen = useCallback(() => {
    const old = screenRef.current;
    screenRef.current = createScreen(old.cols, old.rows);
    repaint();
  }, [repaint]);

  useEffect(() => {
    if (!repoRoot && !signIn && !launch) {
      clientRef.current?.close();
      clientRef.current = null;
      resetScreen();
      setBackend(null);
      setStatus('idle');
      setDetail('Open a project to start a terminal');
      return undefined;
    }

    let cancelled = false;
    let client: TerminalClient | null = null;
    let releaseInput: (() => void) | null = null;
    const decoder = new TextDecoder();
    setStatus('connecting');
    setDetail('Connecting…');
    setCloseCode(null);
    gotOutput.current = false;
    setBlank(false);
    resetScreen();

    const handlers: TerminalClientHandlers = {
      onOutput(bytes) {
        const chunk = decoder.decode(bytes, { stream: true });
        if (!chunk) return;
        gotOutput.current = true;
        setBlank(false);
        writeScreen(screenRef.current, chunk);
        repaint();
      },
      onBackend(b) {
        if (!cancelled) setBackend(b);
      },
      onClose({ code, reason }) {
        if (cancelled) return;
        setBlank(false);
        setStatus('closed');
        setCloseCode(code);
        setDetail(reason || 'Terminal disconnected.');
        onExitRef.current?.({ ended: code === 1000 || /^shell exited/.test(reason ?? '') });
      },
      onError(message) {
        if (cancelled) return;
        setBlank(false);
        setStatus('error');
        setDetail(message);
      },
    };

    /* The retry wait is cancellable: unmounting (or Reconnect) must not leave a timer that opens a socket later. */
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let wake: (() => void) | null = null;
    const sleep = (ms: number) =>
      new Promise<void>((r) => {
        wake = r;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          r();
        }, ms);
      });
    void (async () => {
      try {
        /* The server answers 409 until it has a root; a browser cannot see the status, only a failed open.
           Retry a few times instead of leaving a dead pane the user has to notice and reconnect by hand. */
        for (let tryNo = 0; ; tryNo++) {
          try {
            client = await connectTerminal(handlers, signIn, launch);
            break;
          } catch (e) {
            /* 403 (terminal disabled) and 429 (too many terminals) will not change by waiting: say so at once. */
            const status = (e as { status?: number } | null)?.status;
            if (cancelled || tryNo >= CONNECT_RETRIES || status === 403 || status === 429) throw e;
            setDetail('Waiting for the project…');
            await sleep(CONNECT_RETRY_MS);
            if (cancelled) return;
          }
        }
        if (cancelled) {
          client.close();
          return;
        }
        clientRef.current = client;
        setStatus('live');
        setDetail('Connected');
        /* A shell (not a sign-in) takes lines queued elsewhere in the page (terminalInput.ts). */
        const live = client;
        if (!signIn && !launch) releaseInput = takeTerminalInput((line) => live.sendInput(new TextEncoder().encode(`${line}\r`)));
        /* The new socket has been told nothing: fit now, through the same scheduler the observer uses, so the shell
           hears ONE resize for this size (review N3: the open and the observer's first fit each sent one). A pane
           with no layout yet (jsdom, a hidden tab) tells the grid the screen has. */
        const fitter = fitRef.current;
        fitter?.reset();
        fitter?.flush();
        if (!fitter?.last()) {
          const s = screenRef.current;
          if (s.cols > 0 && s.rows > 0) client.resize(s.cols, s.rows);
        }
      } catch (e) {
        if (cancelled) return;
        setBlank(false);
        setStatus('error');
        setDetail(e instanceof Error ? e.message : 'Failed to connect');
      }
    })();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      wake?.();
      releaseInput?.();
      client?.close();
      clientRef.current = null;
    };
  }, [repoRoot, signIn, launch, attempt, repaint, resetScreen]);

  /* Live with no output after BLANK_MS: the fallback shows (output arriving later hides it again). */
  useEffect(() => {
    if (status !== 'live') return undefined;
    const id = setTimeout(() => {
      if (!gotOutput.current) setBlank(true);
    }, BLANK_MS);
    return () => clearTimeout(id);
  }, [status, attempt]);

  /* Follow new output to the bottom only while the reader is already at the bottom (or the content does
     not overflow yet, so there is nothing to follow): scrolling up to read must not be yanked back. */
  const stickRef = useRef(true);
  const onSurfaceScroll = () => {
    const el = surfaceRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 4;
  };
  useEffect(() => {
    const el = surfaceRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [frame]);

  /* The grid follows the surface: cols and rows from the measured cell, told to the shell ONCE the box has held
     still (0.1.8.1 C2, terminalFit.ts): a window drag used to send the pty a resize per frame. The page coming back
     into view measures again and redraws, because a hidden page measured nothing while it was away. */
  useEffect(() => {
    const wrap = wrapRef.current;
    const surface = surfaceRef.current;
    if (!wrap || !surface) return undefined;
    const fit = createFitScheduler({
      measure: () => measureGrid(wrap, surface),
      apply: (grid) => {
        const s = screenRef.current;
        if (grid.cols !== s.cols || grid.rows !== s.rows) resizeScreen(s, grid.cols, grid.rows);
        repaint();
        const client = clientRef.current;
        if (!client) return false;
        client.resize(grid.cols, grid.rows);
        return true;
      },
    });
    fitRef.current = fit;
    const ro = new ResizeObserver(() => fit.schedule());
    ro.observe(wrap);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      fit.flush();
      repaint();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      ro.disconnect();
      fit.cancel();
      if (fitRef.current === fit) fitRef.current = null;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [repaint]);

  const send = (payload: string) => {
    const client = clientRef.current;
    if (!client || status !== 'live') return;
    client.sendInput(payload);
    /* Pipe shells do not echo: local echo so typing is not a void. */
    if (backend === 'pipe') {
      /* The shell gets CRLF for a CR (analyzer pipeLineEndings); the echo moves to a new line the same way. */
      writeScreen(screenRef.current, payload === '\x7f' ? '\b \b' : payload.replace(/\r(?!\n)/g, '\r\n'));
      repaint();
    }
  };

  const selectedText = (): string => {
    const sel = window.getSelection();
    const el = surfaceRef.current;
    if (!sel || sel.isCollapsed || !el || !sel.anchorNode || !el.contains(sel.anchorNode)) return '';
    return sel.toString();
  };
  const askAboutOutput = (text: string) => {
    if (!store) return;
    const { lines, cursor } = viewScreen(screenRef.current);
    const at = findSelection(lines, text);
    const ran = at >= 0 ? commandAbove(lines, at, cursor ? cursor.line : null) : null;
    draftIntoComposer(store, askAboutOutputDraft({ selection: text, command: ran?.command ?? null, folder: ran?.folder ?? null, startedIn: repoRoot }));
  };
  const onContextMenu = (event: MouseEvent<HTMLPreElement>) => {
    const picked = selectedText();
    if (!store || !picked.trim()) return;
    event.preventDefault();
    const box = wrapRef.current?.getBoundingClientRect();
    const w = box?.width ?? 0;
    const h = box?.height ?? 0;
    setOutputMenu({
      left: Math.max(8, Math.min(event.clientX - (box?.left ?? 0), w - 196)),
      top: Math.max(8, Math.min(event.clientY - (box?.top ?? 0), h - 48)),
      text: picked,
    });
  };
  useEffect(() => {
    if (!outputMenu) return undefined;
    const close = () => setOutputMenu(null);
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        surfaceRef.current?.focus();
      }
    };
    const down = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('.ask-menu')) close();
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', down, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', down, true);
    };
  }, [outputMenu]);
  const allText = (): string => viewScreen(screenRef.current).lines.join('\n');
  const copy = (text: string) => {
    try {
      void navigator.clipboard?.writeText(text);
    } catch {
      /* the clipboard is a nicety; the selection stays */
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLPreElement>) => {
    /* NO KEYBOARD TRAP (WCAG 2.1.2). Tab goes to the shell for completion, so a
       keyboard user needs another way out, or once focus lands here the rest of
       the app is unreachable without a mouse. Shift+Tab always moves focus back;
       Esc then Tab moves it forward. Both are left to the browser (no
       preventDefault) and both are announced through the hint below. Decided
       before the live check so the way out does not depend on the connection. */
    if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') return;
    if (event.key === 'Escape') {
      releaseRef.current = true;
      return;
    }
    if (event.key === 'Tab' && (event.shiftKey || releaseRef.current)) {
      releaseRef.current = false;
      return;
    }
    releaseRef.current = false;
    /* Paste is the browser's: Ctrl/Cmd+V fires a paste event (below), never a ^V to the shell. */
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return;
    /* Copy: Ctrl+Shift+C and Cmd+C always copy the selection (and keep the browser's own handling, the inspector's
       Ctrl+Shift+C included, out of it); Ctrl+C copies when something is selected and is the shell's interrupt when not. */
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && (event.shiftKey || event.metaKey || selectedText())) {
      event.preventDefault();
      const picked = selectedText();
      if (picked) copy(picked);
      return;
    }
    if (status !== 'live') return;

    let payload: string | null = null;
    /* CR, like paste and queued lines: cmd and PowerShell on ConPTY leave a line unrun on LF. */
    if (event.key === 'Enter') payload = '\r';
    else if (event.key === 'Backspace') payload = '\x7f';
    else if (event.key === 'Tab') payload = '\t';
    else if (KEY_SEQUENCES[event.key] && !event.ctrlKey && !event.metaKey) payload = KEY_SEQUENCES[event.key]!;
    else if (event.ctrlKey && event.altKey && !event.metaKey && event.key.length === 1 && (event.getModifierState?.('AltGraph') || !/[a-z]/i.test(event.key))) {
      /* AltGr on a non-US layout reports Ctrl+Alt with the composed character (@, {, euro ...): type the character. */
      payload = event.key;
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      payload = event.key;
    } else if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.length === 1) {
      payload = '\x1b' + event.key;
    } else if (event.ctrlKey && event.key.length === 1) {
      const code = event.key.toLowerCase().charCodeAt(0) - 96;
      if (code >= 1 && code <= 26) payload = String.fromCharCode(code);
    }
    if (payload === null) return;
    event.preventDefault();
    if (payload === '\r') rememberPrompt();
    send(payload);
  };

  const rememberPrompt = () => {
    const { lines, cursor } = viewScreen(screenRef.current);
    if (!cursor) return;
    const here = lines[cursor.line];
    if (here === undefined) return;
    const known = knownPrompts.current;
    const own = condensePrompt(here, undefined);
    const above = cursor.line > 0 ? condensePrompt(lines[cursor.line - 1]!, here) : null;
    if (own) known.add(here.trimEnd());
    else if (above) known.add(lines[cursor.line - 1]!.trimEnd());
    if (known.size > 500) known.delete(known.values().next().value as string);
  };

  const onPaste = (event: ClipboardEvent<HTMLPreElement>) => {
    const text = event.clipboardData.getData('text');
    event.preventDefault();
    if (!text || status !== 'live') return;
    send(text.replace(/\r?\n/g, '\r'));
  };

  /* The shell's prompt pair becomes one line ("<short path> $ typed"); other output is plain text, a run at a time. */
  const shown = useMemo<ReactNode>(() => {
    void frame;
    const { lines, cursor } = viewScreen(screenRef.current);
    const out: ReactNode[] = [];
    let run: string[] = [];
    const flush = (key: string) => {
      if (run.length) out.push(<Fragment key={key}>{run.join('\n') + '\n'}</Fragment>);
      run = [];
    };
    /* `markEnd`: how much of the line is the prompt (path and marker), drawn in the accent; what was typed stays ink. */
    const withCaret = (text: string, col: number | null, markEnd = 0): ReactNode => {
      const at = col === null ? -1 : Math.min(col, text.length);
      /* The character under the caret by code point, so an emoji is not cut in half. */
      const under = at >= 0 && at < text.length ? String.fromCodePoint(text.codePointAt(at)!) : '';
      const seg = (from: number, to: number, key: string): ReactNode => {
        if (from >= to) return null;
        const cut = Math.min(Math.max(markEnd, from), to);
        return (
          <Fragment key={key}>
            {cut > from ? <span className="terminal-prompt-mark" data-testid="terminal-prompt-mark">{text.slice(from, cut)}</span> : null}
            {text.slice(cut, to)}
          </Fragment>
        );
      };
      if (col === null) return seg(0, text.length, 'a');
      return (
        <>
          {seg(0, at, 'a')}
          <span className="terminal-caret" data-testid="terminal-caret">{under || ' '}</span>
          {seg(at + under.length, text.length, 'b')}
        </>
      );
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const p = condensePrompt(line, lines[i + 1]);
      if (p) {
        flush(`r${i}`);
        const curLine = cursor?.line;
        const live = curLine === i || (p.consumed === 2 && curLine === i + 1);
        const known = live || knownPrompts.current.has(line.trimEnd());
        const col = curLine === i || (p.consumed === 2 && curLine === i + 1) ? p.cursorCol(cursor!.col) : null;
        out.push(
          <span key={`p${i}`} className="terminal-prompt-line" data-testid="terminal-prompt-line" title={p.full}>
            {withCaret(p.text, col, known ? p.markEnd : 0)}
          </span>,
        );
        i += p.consumed - 1;
        continue;
      }
      if (cursor && cursor.line === i) {
        flush(`r${i}`);
        out.push(
          <Fragment key={`c${i}`}>
            {withCaret(line, cursor.col)}
            {'\n'}
          </Fragment>,
        );
        continue;
      }
      run.push(line);
    }
    flush('end');
    return out;
  }, [frame]);

  const commandEnded = Boolean(signIn || launch) && (closeCode === 1000 || /^shell exited/.test(detail));
  const live = status === 'live';
  const tools = !signIn && !launch;

  return (
    <div className="terminal-pane" data-testid="terminal-pane" ref={wrapRef}>
      <pre
        ref={surfaceRef}
        className="terminal-pane-surface"
        data-testid="terminal-pane-surface"
        tabIndex={0}
        role="log"
        aria-label="Terminal output"
        aria-describedby={hintId}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onContextMenu={onContextMenu}
        onScroll={onSurfaceScroll}
        onBlur={() => {
          releaseRef.current = false;
        }}
      >
        {/* The text wraps at the GRID's width, not the pane's (review S6): the shell drew it for `cols` columns, so a
            pane narrower than the grid (MIN_COLS) scrolls sideways instead of wrapping words the shell did not wrap. */}
        <span className="terminal-grid" data-testid="terminal-grid" style={{ '--term-cols': screenRef.current.cols } as CSSProperties}>
          {shown}
        </span>
      </pre>
      {outputMenu ? (
        <div
          className="ask-menu"
          data-testid="terminal-output-menu"
          role="menu"
          aria-label="Selected output"
          style={{ left: outputMenu.left, top: outputMenu.top }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            className="ask-menuitem"
            data-testid="terminal-ask-output"
            ref={(el) => el?.focus()}
            onClick={() => {
              askAboutOutput(outputMenu.text);
              setOutputMenu(null);
            }}
          >
            <Icon name="chatbox" size={14} />
            <span>Ask about this output</span>
          </button>
        </div>
      ) : null}
      {(blank && status === 'live') || status === 'error' ? (
        <div className="terminal-pane-fallback" data-testid="terminal-fallback" role="status">
          <span className="terminal-pane-fallback-t">{status === 'error' ? 'The terminal could not start.' : 'The terminal is open but has shown nothing yet.'}</span>
          {repoRoot ? (
            <span className="terminal-pane-fallback-s" data-testid="terminal-fallback-folder">
              Folder it tried: <span className="mono">{repoRoot}</span>
            </span>
          ) : null}
          <button type="button" className="terminal-pane-reconnect" data-testid="terminal-fallback-restart" onClick={() => setAttempt((n) => n + 1)}>
            Start again
          </button>
        </div>
      ) : null}
      <span id={hintId} hidden>
        Tab completes in the shell. Shift+Tab, or Esc then Tab, moves focus out of the terminal.
      </span>
      <div className="terminal-pane-chrome" data-testid="terminal-pane-chrome">
        {/* The status and the shell's tools are one transparent strip at the very bottom of the pane (owner 2026-10-10). */}
        {status === 'closed' ? (
          <span className="terminal-pane-meta" data-testid="terminal-pane-status" title={closeCode !== null ? `Closed with code ${closeCode}` : undefined}>
            {/* A one-command pane (sign-in, launch) whose shell exited (the server closes with 1000, "shell exited ...") is the
                command ending; any other close (1006 dropped socket, server restart, 1011) is a lost connection (UX study 2026-10-09). */}
            {commandEnded ? 'Command ended.' : 'Terminal disconnected.'}{' '}
            <button type="button" className="terminal-pane-reconnect" data-testid="terminal-pane-reconnect" onClick={() => setAttempt((n) => n + 1)}>
              {commandEnded ? 'Run again' : 'Reconnect'}
            </button>
          </span>
        ) : (
          <span className="terminal-pane-meta" data-testid="terminal-pane-status">
            {status === 'live' ? <span className="terminal-pane-dot" aria-hidden="true" /> : null}
            {detail}
          </span>
        )}
        {tools ? (
          <span className="terminal-tools" role="toolbar" aria-label="Terminal tools" data-testid="terminal-tools">
            <button
              type="button"
              className="terminal-tool"
              title="Clear the screen"
              aria-label="Clear"
              data-testid="terminal-clear"
              onClick={() => {
                resetScreen();
                if (live) clientRef.current?.sendInput('\x0c');
                surfaceRef.current?.focus();
              }}
            >
              <ToolIcon name="clear" />
            </button>
            <button
              type="button"
              className="terminal-tool"
              title="Copy the selection, or all output when nothing is selected"
              aria-label="Copy"
              data-testid="terminal-copy"
              onClick={() => copy(selectedText() || allText())}
            >
              <ToolIcon name="copy" />
            </button>
            <button
              type="button"
              className="terminal-tool"
              title="Stop the running command (Ctrl+C)"
              aria-label="Stop"
              disabled={!live}
              data-testid="terminal-stop"
              onClick={() => {
                clientRef.current?.sendInput('\x03');
                surfaceRef.current?.focus();
              }}
            >
              <ToolIcon name="stop" />
            </button>
            <button
              type="button"
              className="terminal-tool"
              title="Restart: close this shell and start a new one"
              aria-label="Restart"
              disabled={!repoRoot}
              data-testid="terminal-restart"
              onClick={() => setAttempt((n) => n + 1)}
            >
              <ToolIcon name="restart" />
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}
