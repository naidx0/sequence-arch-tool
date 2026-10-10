/* ══════════════════════════════════════════════════════════════════════════
   FIRST RUN (round 13): Welcome to Sequence, add an agent
   packages/web2/src/onboarding/FirstRun.tsx

   Shown when no agent is registered and the person has not skipped. Four big
   options (Claude Code, Codex, Local model, API key). A click opens that
   route: sign in or connect, then Start chatting (at once when it is already
   connected). Then a swipe-style setup (FirstRunSetup): a project, auto mode,
   done, each one tap or skip. Never launches a binary of its own: sign-in runs
   in the embedded Terminal only on a click.

   Graphite: dense type, 4px grid, colour only for focus, selection and live
   state. Plain copy.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { FailureNote } from '../components/FailureNote';
import { Icon } from '../chat/Icon';
import { AsciiSpinner } from '../shell2/AsciiSpinner';
import { ProviderIcon, providerOf } from '../shell2/brandIcons';
import { TerminalPane } from '../terminal/TerminalPane';
import { providerPill, providerSentence, type OnboardingClient, type ProviderStatus } from './onboardingClient';
import { connectAgent } from './loneAgent';
import { FirstRunSetup, type SetupResult } from './FirstRunSetup';
import { KeyPanel, LocalPanel } from './FirstRunModels';
import { createSettingsClient, type SettingsClient } from '../settings/settingsClient';
import { applySignIn, isQuiet, isSettling, noteReady, settleSignIn, useSignInVersion } from './signInState';

export interface FirstRunProps {
  client: OnboardingClient;
  /** Close this screen and land in the default workspace chat (an agent connected, or skipped). */
  onDone: (connected: boolean, setup?: SetupResult) => void;
  /** An agent or a model is now connected: the host remembers it, so a reload mid-setup does not bring Welcome back. */
  onConnected?: () => void;
  /** The Settings wire the model routes save through. */
  settings?: SettingsClient;
}

type Route = 'claude' | 'codex' | 'local' | 'key';
type Step = { at: 'pick' } | { at: 'route'; route: Route } | { at: 'setup' };

const OPTIONS: { route: Route; name: string; sub: string; provider: 'claude' | 'codex' | 'ollama' | 'openai' }[] = [
  { route: 'claude', name: 'Claude Code', sub: 'Sign in with your Claude plan', provider: 'claude' },
  { route: 'codex', name: 'Codex', sub: 'Sign in with ChatGPT', provider: 'codex' },
  { route: 'local', name: 'Local model', sub: 'Ollama or LM Studio on this computer', provider: 'ollama' },
  { route: 'key', name: 'API key', sub: 'OpenAI, Anthropic, OpenRouter', provider: 'openai' },
];

/** A focus re-probe more often than this is the same answer, re-spawned. */
const REPROBE_MIN_MS = 4000;
/** How often the bridge install is asked how it is going. */
const BRIDGE_POLL_MS = 500;
const SETUP_POLL_MS = 1000;

export function FirstRun({ client, onDone, settings, onConnected }: FirstRunProps) {
  const wire = useRef(settings ?? createSettingsClient()).current;
  const [step, setStep] = useState<Step>({ at: 'pick' });
  /* A local model or API key saved here: the label it goes by. */
  const [modelReady, setModelReady] = useState<string | null>(null);
  const [rawProviders, setProviders] = useState<ProviderStatus[] | null>(null);
  /* One sign-in state for every surface (signInState): a signed-out read right after a sign-in is "Checking sign-in...". */
  const signInVersion = useSignInVersion();
  const providers = useMemo(() => (rawProviders ? applySignIn(rawProviders) : null), [rawProviders, signInVersion]);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [install, setInstall] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /* The provider whose sign-in is running in the embedded Terminal. */
  const [signing, setSigning] = useState<ProviderStatus | null>(null);
  /* How the sign-in pane closed: null while it runs. A dropped socket is not 'Finished'. */
  const signingId = useRef<string | null>(null);
  const [signDone, setSignDone] = useState<null | 'finished' | 'disconnected'>(null);
  /* The one setup button: the bridge install in flight (its latest npm line) or its failure, for one agent. */
  const [bridge, setBridge] = useState<{ for: string; state: 'running' | 'failed'; line?: string; error?: string } | null>(null);
  const lastProbe = useRef(0);
  signingId.current = signing?.id ?? null;
  const rawProvidersRef = useRef<ProviderStatus[] | null>(null);
  rawProvidersRef.current = rawProviders;
  const rootRef = useRef<HTMLDivElement>(null);
  const autoFocused = useRef<HTMLElement | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  /* A modal dialog: the shell behind it is inert while it is up (restored on leave). */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const marked: Element[] = [];
    for (let el: Element | null = root; el && el !== document.body; el = el.parentElement) {
      for (const sib of Array.from(el.parentElement?.children ?? [])) {
        if (sib === el || sib.hasAttribute('inert')) continue;
        sib.setAttribute('inert', '');
        marked.push(sib);
      }
    }
    return () => marked.forEach((m) => m.removeAttribute('inert'));
  }, []);

  /* Initial focus: the primary action (Start chatting), else the first actionable control, once the list is drawn. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const at = document.activeElement;
    /* Leave it where the person put it; move it only from the root or from our own earlier pick. */
    if (at && at !== document.body && at !== root && at !== autoFocused.current && root.contains(at)) return;
    const target = root.querySelector<HTMLElement>('[data-testid="first-run-start"]:not(:disabled)') ?? root.querySelector<HTMLElement>('button:not(:disabled)');
    autoFocused.current = target;
    (target ?? root).focus();
  }, [providers, step, modelReady]);

  /* Tab cycles inside the dialog. */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const root = rootRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'));
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === root)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  };

  /* A reading goes to the shared sign-in state: ready is remembered, and a signed-out read inside the grace is asked again. */
  const noteProbe = useCallback(
    (list: ProviderStatus[]) => {
      for (const p of list) {
        if (p.state === 'ready') noteReady(p.id);
        else if (p.state === 'signIn' && isQuiet(p.id) && !isSettling(p.id)) void settleSignIn(p.id, client, (l) => live.current && setProviders(l));
      }
    },
    [client],
  );

  const probe = useCallback(
    async (refresh: boolean) => {
      lastProbe.current = Date.now();
      const a = await client.providers(refresh);
      if (!live.current) return;
      if (a.ok) {
        setProviders(a.body);
        setProviderError(null);
        noteProbe(a.body);
      } else {
        setProviderError(a.message);
      }
    },
    [client],
  );

  useEffect(() => {
    void probe(false);
  }, [probe]);

  /* The bridge is being fetched on first use: look again every moment so the size counts up and Start chatting appears the second it is done. */
  const preparing = providers?.some((p) => p.state === 'preparing' || (p.setupBytes !== undefined && p.state === 'signIn')) ?? false;
  useEffect(() => {
    if (!preparing) return;
    const t = setInterval(() => void probe(true), SETUP_POLL_MS);
    return () => clearInterval(t);
  }, [preparing, probe]);

  /* A sign-in finished in another window (or the terminal below): ask again. */
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastProbe.current < REPROBE_MIN_MS) return;
      /* A sign-in is being checked right now: the answer is already on its way. */
      if ((rawProvidersRef.current ?? []).some((p) => isSettling(p.id))) return;
      void probe(true);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [probe]);

  /* The sign-in command ended: ask the vendor again whether it worked. */
  const onSignInExit = useCallback(
    ({ ended }: { ended: boolean }) => {
      setSignDone(ended ? 'finished' : 'disconnected');
      const id = signingId.current;
      if (!ended || !id) {
        void probe(true);
        return;
      }
      /* The vendor's status can lag its own sign-in by seconds: ask with backoff before saying signed-out again. */
      lastProbe.current = Date.now();
      void settleSignIn(
        id,
        client,
        (l) => {
          if (!live.current) return;
          setProviders(l);
          setProviderError(null);
        },
        { afterSignIn: true },
      ).then((last) => {
        if (live.current && last?.state === 'ready') setSigning(null);
      });
    },
    [probe, client],
  );

  /* Connect the ready agent, then leave for the workspace chat. A refused connect says so and stays. */
  const start = async (p: ProviderStatus) => {
    if (busy) return;
    setBusy(p.id);
    setStartError(null);
    const id = await connectAgent(p);
    if (!live.current) return;
    if (id === null) {
      setStartError(`Could not connect ${p.label}. Try again.`);
      setBusy(null);
      return;
    }
    setBusy(null);
    onConnected?.();
    setStep({ at: 'setup' });
  };

  /*
   * ONE BUTTON FOR WHAT IS MISSING (round 13). The bridge and the sign-in are checked together up front;
   * this does the missing steps in order, looking at the machine again after each: install the bridge
   * (npm's own progress), then open the vendor's sign-in in the Terminal. When the sign-in command ends,
   * the re-probe turns the card Ready and Start chatting appears.
   */
  const setUp = async (p: ProviderStatus) => {
    let cur = p;
    if ((p.bridgeMissing || p.state === 'adapter') && client.installBridge) {
      setBridge({ for: p.id, state: 'running' });
      const started = await client.installBridge(p.id);
      let st = started.ok ? started.body : null;
      if (!started.ok) {
        if (live.current) setBridge({ for: p.id, state: 'failed', error: started.message });
        return;
      }
      while (st && st.state === 'running' && live.current) {
        setBridge({ for: p.id, state: 'running', line: st.output?.length ? st.output[st.output.length - 1] : undefined });
        await new Promise((r) => setTimeout(r, BRIDGE_POLL_MS));
        const polled = client.bridgeStatus ? await client.bridgeStatus(p.id) : null;
        if (!polled) break;
        if (!polled.ok) {
          st = { state: 'failed', error: polled.message };
          break;
        }
        st = polled.body;
      }
      if (!live.current) return;
      if (!st || st.state !== 'done') {
        setBridge({ for: p.id, state: 'failed', error: st?.error ?? 'The install did not finish.', line: st?.output?.[st.output.length - 1] });
        return;
      }
      setBridge(null);
      const again = await client.providers(true);
      if (!live.current) return;
      if (again.ok) {
        setProviders(again.body);
        cur = again.body.find((x) => x.id === p.id) ?? cur;
      }
    }
    if (cur.state === 'signIn') {
      setSignDone(null);
      /* Not over another agent's sign-in the person started meanwhile. */
      setSigning((s) => s ?? cur);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const route = step.at === 'route' ? step.route : null;
  const provider = route === 'claude' || route === 'codex' ? (providers ?? []).find((p) => p.id === route) : undefined;
  const opt = OPTIONS.find((o) => o.route === route);
  const myBridge = bridge && provider && bridge.for === provider.id ? bridge : null;

  const back = () => {
    setStep({ at: 'pick' });
    setModelReady(null);
    setSigning(null);
    setInstall(null);
    setStartError(null);
  };

  return (
    <div ref={rootRef} className="fr-root" data-testid="first-run" data-step={step.at} role="dialog" aria-modal="true" aria-label="Add an agent" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="fr-col">
        <div className="fr-brand" aria-hidden="true">
          <SequenceMark />
        </div>
        <header className="fr-head">
          <h1 className="fr-title">{step.at === 'setup' ? 'Quick setup' : 'Welcome to Sequence'}</h1>
          <p className="fr-sub fr-lede">
            {step.at === 'setup' ? 'Three taps, each one optional.' : step.at === 'pick' ? 'Add an agent to start chatting.' : 'Connect it, then start chatting.'}
          </p>
        </header>

        {step.at === 'pick' ? (
          <section className="fr-section" aria-labelledby="fr-agents-h">
            <h2 className="fr-h" id="fr-agents-h">
              Add an agent
            </h2>
            {providerError ? (
              <FailureNote testid="first-run-providers-error" message="Could not check your agents." detail={providerError} onRetry={() => void probe(true)} />
            ) : null}
            <ul className="fr-options" data-testid="first-run-options" aria-busy={providers === null}>
              {OPTIONS.map((o) => {
                const p = (providers ?? []).find((x) => x.id === o.route);
                const pill = p ? providerPill(p) : null;
                return (
                  <li key={o.route} className="fr-opt-li">
                    <button type="button" className="fr-option" data-testid="first-run-option" data-option={o.route} data-state={p?.state} onClick={() => setStep({ at: 'route', route: o.route })}>
                      <span className="fr-option-ic" aria-hidden="true">
                        <ProviderIcon provider={providerOf(o.provider, o.name)} />
                      </span>
                      <span className="fr-option-name">{o.name}</span>
                      <span className="fr-option-sub">{o.sub}</span>
                      {pill ? (
                        <span className="fr-pill" data-tone={pill.tone}>
                          {pill.text}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {step.at === 'route' && opt ? (
          <section className="fr-section fr-route" data-testid="first-run-route" data-route={step.route} aria-label={opt.name}>
            <div className="fr-route-head">
              <span className="fr-option-ic" aria-hidden="true">
                <ProviderIcon provider={providerOf(opt.provider, opt.name)} />
              </span>
              <h2 className="fr-route-name">{opt.name}</h2>
              {provider ? (
                <>
                  {provider.version ? <span className="fr-agent-ver">{provider.version}</span> : null}
                  <span className="fr-pill" data-tone={providerPill(provider).tone} data-testid="first-run-provider-pill">
                    {providerPill(provider).text}
                  </span>
                </>
              ) : null}
            </div>

            {route === 'claude' || route === 'codex' ? (
              provider ? (
                <div className="fr-agent-body" data-testid="first-run-provider" data-provider={provider.id} data-state={provider.state}>
                  <p className="fr-agent-say" data-testid="first-run-provider-say">
                    {providerSentence({ ...provider, minVersion: provider.minVersion })}
                  </p>
                  <div className="fr-route-acts">
                    {provider.state === 'ready' ? (
                      <button type="button" className="fr-btn fr-primary" data-testid="first-run-start" disabled={busy !== null} aria-busy={busy === provider.id} onClick={() => void start(provider)}>
                        {busy === provider.id ? <><AsciiSpinner /> Connecting</> : 'Start chatting'}
                      </button>
                    ) : null}
                    {provider.state === 'signIn' || provider.state === 'adapter' ? (
                      <button
                        type="button"
                        className="fr-btn fr-primary"
                        data-testid="first-run-setup-agent"
                        data-needs={[provider.bridgeMissing || provider.state === 'adapter' ? 'bridge' : null, provider.state === 'signIn' ? 'signin' : null].filter(Boolean).join('+')}
                        disabled={bridge?.state === 'running' || signing !== null}
                        onClick={() => void setUp(provider)}
                      >
                        {provider.state === 'adapter' ? 'Install bridge' : provider.bridgeMissing ? 'Install bridge and sign in' : 'Sign in'}
                      </button>
                    ) : null}
                    {/* The combined install failed (often: no npm on the machine). Signing in still works, so it is offered on its own. */}
                    {provider.state === 'signIn' && provider.bridgeMissing && myBridge?.state === 'failed' ? (
                      <button
                        type="button"
                        className="fr-btn"
                        data-testid="first-run-signin"
                        disabled={signing !== null}
                        onClick={() => {
                          setSignDone(null);
                          setSigning(provider);
                        }}
                      >
                        Sign in
                      </button>
                    ) : null}
                    {provider.state === 'install' ? (
                      <button
                        type="button"
                        className="fr-btn fr-primary"
                        data-testid="first-run-install"
                        aria-expanded={install === provider.id}
                        onClick={() => {
                          setCopied(false);
                          setInstall((cur) => (cur === provider.id ? null : provider.id));
                        }}
                      >
                        Install
                      </button>
                    ) : null}
                    {provider.state === 'attention' || provider.state === 'limited' ? (
                      <button type="button" className="fr-btn" data-testid="first-run-recheck" onClick={() => void probe(true)}>
                        Check again
                      </button>
                    ) : null}
                  </div>
                  {myBridge?.state === 'running' ? (
                    <p className="fr-agent-say" role="status" data-testid="first-run-bridge-progress">
                      <AsciiSpinner /> Installing the bridge{myBridge.line ? `: ${myBridge.line}` : '...'}
                    </p>
                  ) : null}
                  {myBridge?.state === 'failed' ? (
                    <p className="fr-note fr-row-error" role="alert" data-testid="first-run-bridge-failed">
                      The bridge did not install. {myBridge.error}
                    </p>
                  ) : null}
                  {install === provider.id ? (
                    <div className="fr-install" data-testid="first-run-install-hint">
                      <code className="fr-code">{provider.installHint}</code>
                      <button type="button" className="fr-btn" data-testid="first-run-install-copy" onClick={() => void copy(provider.installHint)}>
                        <Icon name="copy" size={12} />
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                      <span className="fr-sub">Run it in a terminal, then come back to this window.</span>
                    </div>
                  ) : null}
                  {signing ? (
                    <div className="fr-term" data-testid="first-run-signin-terminal">
                      <div className="fr-term-head">
                        <Icon name="terminal" size={14} />
                        <code className="fr-code" data-testid="first-run-signin-command">
                          {signing.signInCommand}
                        </code>
                        <span className="fr-sub">{signDone === 'finished' ? 'Finished' : signDone === 'disconnected' ? 'Disconnected' : 'Running'}</span>
                        <button type="button" className="fr-ghost" data-testid="first-run-signin-close" onClick={() => setSigning(null)}>
                          Close
                        </button>
                      </div>
                      <div className="fr-term-body">
                        <TerminalPane key={signing.id} signIn={signing.id} onExit={onSignInExit} />
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="fr-agent-say" data-testid="first-run-providers-checking">
                  {providerError ? 'Could not check this agent.' : <span className="fr-loading"><AsciiSpinner /> Checking this computer...</span>}
                </p>
              )
            ) : null}

            {route === 'local' || route === 'key' ? (
              <>
                {modelReady === null ? (
                  route === 'local' ? (
                    <LocalPanel settings={wire} onReady={(label) => {
                      onConnected?.();
                      setModelReady(label);
                    }} />
                  ) : (
                    <KeyPanel settings={wire} onReady={(label) => {
                      onConnected?.();
                      setModelReady(label);
                    }} />
                  )
                ) : (
                  <div className="fr-agent-body" data-testid="first-run-model-ready">
                    <p className="fr-agent-say">{modelReady} is saved and selected.</p>
                    <div className="fr-route-acts">
                      <button type="button" className="fr-btn fr-primary" data-testid="first-run-start" onClick={() => setStep({ at: 'setup' })}>
                        Start chatting
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : null}

            {startError ? (
              <p className="fr-note fr-row-error" role="alert" data-testid="first-run-start-error">
                {startError}
              </p>
            ) : null}
          </section>
        ) : null}

        {step.at === 'setup' ? <FirstRunSetup onFinish={(r) => onDone(true, r)} /> : null}

        <footer className="fr-foot">
          {step.at === 'route' ? (
            <button type="button" className="fr-ghost" data-testid="first-run-back" onClick={back}>
              Back
            </button>
          ) : null}
          {step.at === 'setup' ? (
            <button type="button" className="fr-ghost" data-testid="first-run-setup-skipall" onClick={() => onDone(true)}>
              Skip setup
            </button>
          ) : (
            <button type="button" className="fr-ghost" data-testid="first-run-skip" onClick={() => onDone(false)}>
              Skip for now
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

/** The Sequence mark, the same drawing the title bar uses. */
function SequenceMark() {
  return (
    <svg className="fr-mark" viewBox="0 0 64 64" width="40" height="40" shapeRendering="geometricPrecision">
      <g fill="currentColor">
        <rect x="10" y="10" width="26" height="8" rx="4" />
        <rect x="28" y="10" width="8" height="26" rx="4" />
        <rect x="28" y="28" width="26" height="8" rx="4" />
        <rect x="46" y="28" width="8" height="26" rx="4" />
        <rect x="5" y="5" width="18" height="18" rx="5" />
        <rect x="23" y="23" width="18" height="18" rx="5" />
        <rect x="41" y="41" width="18" height="18" rx="5" />
      </g>
    </svg>
  );
}
