/* ══════════════════════════════════════════════════════════════════════════
   SIGN IN IN THE BROWSER (P0-2)
   packages/web2/src/onboarding/BrowserSignIn.tsx

   The vendor's own sign-in command still runs on the server (the Terminal
   route, `?signin=<id>`), but nobody has to read it. This reads its output:

     · the first https link it prints is the sign-in page. Unless the command
       says it opened the browser itself, the page opens in the system browser
       (window.open; the desktop shell hands it to shell.openExternal). A CLI
       with a localhost callback (Codex) finishes by itself from there.
     · one state on screen: "Waiting for you to finish in the browser…",
       with Cancel. The provider probe is asked every few seconds; the moment
       it reads Ready, `onSignedIn` fires and the caller moves on.
     · a CLI that wants the code from the browser pasted back (Claude Code's
       manual flow) gets one field for it, not a terminal.
     · the terminal output is behind "Show details".
     · Cancel, a command that ends without a sign-in, or coming back to the
       window while the probe still says signed out: a clear Retry.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react';

import { AsciiSpinner } from '../shell2/AsciiSpinner';
import { connectTerminal, stripTerminalControlSequences, type TerminalClient } from '../terminal/terminalClient';
import type { OnboardingClient, ProviderStatus } from './onboardingClient';

/** How often the provider probe is asked while the browser is open. */
export const SIGNIN_POLL_MS = 2000;
/** Wide enough that a long OAuth link arrives on one line. */
const WIDE_COLS = 2000;

/** The sign-in page the command printed: the first https link, whole. */
export function signInUrl(output: string): string | null {
  const m = /https:\/\/[^\s"'<>`]+/.exec(output);
  return m ? m[0].replace(/[).,;]+$/, '') : null;
}

/** The command says it opened (or tried to open) the browser itself: opening it again would be a second tab. */
export function cliOpensBrowser(output: string): boolean {
  return /opening (?:your |the )?browser|browser (?:did ?n['’]?t|did not|didn't) open|opened (?:in )?(?:your |the )?browser/i.test(output);
}

/** The command is asking for the code the browser shows. */
export function wantsCode(output: string): boolean {
  return /paste (?:the |your )?(?:authori[sz]ation )?code/i.test(output);
}

export interface BrowserSignInProps {
  provider: ProviderStatus;
  client: OnboardingClient;
  /** The probe reads this provider Ready. */
  onSignedIn: (p: ProviderStatus) => void;
  /** Open a link outside the app. Default: window.open (the desktop routes it to the system browser). */
  openExternal?: (url: string) => void;
  /** Injected in tests; the real one opens the Terminal route with `?signin=<id>`. */
  connect?: typeof connectTerminal;
  /**
   * The command ended (`ended`: it exited on its own). The caller asks the vendor, with the grace a fresh
   * sign-in needs (signInState.settleSignIn), and answers with the last reading.
   */
  onExit?: (info: { ended: boolean }) => Promise<ProviderStatus | null>;
}

type Phase = 'starting' | 'waiting' | 'checking' | 'retry';

export function BrowserSignIn({ provider, client, onSignedIn, openExternal, connect = connectTerminal, onExit }: BrowserSignInProps) {
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>('starting');
  const [why, setWhy] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const [url, setUrl] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const term = useRef<TerminalClient | null>(null);
  const opened = useRef(false);
  const done = useRef(false);
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const open = useCallback((u: string) => {
    if (openExternal) openExternal(u);
    else window.open(u, '_blank', 'noopener,noreferrer');
  }, [openExternal]);

  /* Mounted, and this attempt not cancelled: a probe answer that lands after either is dropped, never acted on. */
  const live = useRef(true);
  const stopped = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  /* One probe at a time: a slow vendor status must not pile up a request every poll and every focus. */
  const asking = useRef(false);

  /* Ask the vendor whether it worked. True when it did (and the caller has been told). */
  const check = useCallback(async (): Promise<boolean> => {
    if (done.current) return true;
    if (asking.current) return false;
    asking.current = true;
    let a: Awaited<ReturnType<OnboardingClient['providers']>>;
    try {
      a = await client.providers(true);
    } finally {
      asking.current = false;
    }
    if (!live.current || stopped.current) return false;
    const p = a.ok ? a.body.find((x) => x.id === provider.id) : undefined;
    if (p?.state === 'ready' && !done.current) {
      done.current = true;
      term.current?.close();
      onSignedInRef.current(p);
      return true;
    }
    return false;
  }, [client, provider.id]);

  /* One run of the vendor's sign-in command. */
  useEffect(() => {
    let cancelled = false;
    stopped.current = false;
    let text = '';
    const decoder = new TextDecoder();
    opened.current = false;
    setPhase('starting');
    setWhy(null);
    setOutput('');
    setUrl(null);
    setCode('');
    setCodeSent(false);
    void connect(
      {
        onOutput(bytes) {
          if (cancelled) return;
          text += stripTerminalControlSequences(decoder.decode(bytes, { stream: true }));
          setOutput(text);
          const u = signInUrl(text);
          if (u) {
            setUrl(u);
            setPhase('waiting');
            if (!opened.current && !cliOpensBrowser(text)) {
              opened.current = true;
              open(u);
            }
          }
        },
        onClose({ code: closeCode, reason }) {
          /* Cancel closed it: that is not the command ending, and must not run the command-ended path. */
          if (cancelled || done.current || stopped.current) return;
          /* The command ended: either it signed in (the vendor says so, perhaps a moment later) or it did not, and Retry is the way on. */
          const ended = closeCode === 1000 || /^shell exited/.test(reason ?? '');
          setPhase('checking');
          const ask = onExitRef.current ? onExitRef.current({ ended }) : check().then(() => null);
          void ask.then((last) => {
            if (cancelled || done.current || stopped.current || !live.current) return;
            if (last?.state === 'ready') {
              done.current = true;
              onSignedInRef.current(last);
              return;
            }
            setPhase('retry');
            setWhy(ended ? 'The sign-in ended before it finished.' : 'The sign-in stopped.');
          });
        },
      },
      provider.id,
    )
      .then((c) => {
        if (cancelled) {
          c.close();
          return;
        }
        term.current = c;
        c.resize(WIDE_COLS, 40);
        setPhase((ph) => (ph === 'starting' ? 'waiting' : ph));
      })
      .catch(() => {
        if (cancelled) return;
        setPhase('retry');
        setWhy('The sign-in could not start.');
      });
    return () => {
      cancelled = true;
      term.current?.close();
      term.current = null;
    };
  }, [attempt, provider.id, connect, open, check]);

  /* While the browser is open: ask the probe every few seconds. */
  useEffect(() => {
    if (phase !== 'waiting') return undefined;
    const t = setInterval(() => void check(), SIGNIN_POLL_MS);
    return () => clearInterval(t);
  }, [phase, check]);

  /* Back from the browser without finishing (the tab was closed): say so, with Retry, instead of waiting for ever. */
  const [back, setBack] = useState(false);
  useEffect(() => {
    if (phase !== 'waiting' || !url) return undefined;
    const onFocus = () => {
      void check().then((ok) => {
        if (!ok) setBack(true);
      });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [phase, url, check]);

  const cancel = () => {
    stopped.current = true;
    term.current?.close();
    term.current = null;
    setPhase('retry');
    setWhy('Sign-in cancelled.');
  };
  const retry = () => {
    setBack(false);
    setAttempt((n) => n + 1);
  };

  return (
    <div className="fr-term fr-browser-signin" data-testid="first-run-signin-terminal" data-phase={phase}>
      <div className="fr-term-head">
        <span className="fr-agent-say" data-testid="first-run-signin-command">
          Signing in to {provider.label}
        </span>
      </div>
      {phase === 'retry' ? (
        <div className="fr-signin-state" role="alert" data-testid="first-run-signin-retry-state">
          <p className="fr-agent-say">{why ?? 'The sign-in did not finish.'}</p>
          <div className="fr-route-acts">
            <button type="button" className="fr-btn fr-primary" data-testid="first-run-signin-retry" onClick={retry}>
              Retry
            </button>
          </div>
        </div>
      ) : (
        <div className="fr-signin-state" role="status" data-testid="first-run-signin-waiting">
          <p className="fr-agent-say">
            <AsciiSpinner /> {phase === 'starting' ? 'Opening the sign-in page…' : phase === 'checking' ? 'Checking sign-in…' : 'Waiting for you to finish in the browser…'}
          </p>
          {wantsCode(output) && !codeSent ? (
            <form
              className="fr-route-acts"
              onSubmit={(e) => {
                e.preventDefault();
                if (!code.trim()) return;
                term.current?.sendInput(`${code.trim()}\r`);
                setCodeSent(true);
              }}
            >
              <input
                className="fr-input"
                data-testid="first-run-signin-code"
                aria-label="Code from the browser"
                placeholder="Code from the browser"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button type="submit" className="fr-btn" data-testid="first-run-signin-code-send" disabled={!code.trim()}>
                Continue
              </button>
            </form>
          ) : null}
          <div className="fr-route-acts">
            <button type="button" className="fr-ghost" data-testid="first-run-signin-cancel" onClick={cancel}>
              Cancel
            </button>
            {url ? (
              <button type="button" className="fr-ghost" data-testid="first-run-signin-open" onClick={() => open(url)}>
                Open the page again
              </button>
            ) : null}
          </div>
          {back ? (
            <div className="fr-route-acts" data-testid="first-run-signin-back">
              <span className="fr-sub">Not signed in yet. Closed the browser tab?</span>
              <button type="button" className="fr-btn" data-testid="first-run-signin-retry" onClick={retry}>
                Retry
              </button>
            </div>
          ) : null}
        </div>
      )}
      <button type="button" className="fr-ghost" data-testid="first-run-signin-details" aria-expanded={details} onClick={() => setDetails((d) => !d)}>
        {details ? 'Hide details' : 'Show details'}
      </button>
      {details ? (
        <pre className="fr-signin-log" data-testid="first-run-signin-log">
          {output || 'No output yet.'}
        </pre>
      ) : null}
    </div>
  );
}
