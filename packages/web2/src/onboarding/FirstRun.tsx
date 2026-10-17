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
import { AsciiSpinner } from '../shell2/AsciiSpinner';
import { ProviderIcon, brandOf } from '../shell2/brandIcons';
import { S2Icon } from '../shell2/icons';
import { agentSetupPrompt, type SetupFailure, type SetupNeed } from './agentSetupPrompt';
import { CopyPromptButton } from './setupFallback';
import { BrowserSignIn } from './BrowserSignIn';
import { providerPill, providerSentence, type OnboardingClient, type ProviderStatus } from './onboardingClient';
import { connectAgent } from './loneAgent';
import { FirstRunSetup, type SetupResult } from './FirstRunSetup';
import { KeyPanel, LocalPanel } from './FirstRunModels';
import { saveLocalModel, type DetectedLocal } from './modelConnect';
import { createSettingsClient, type SettingsClient } from '../settings/settingsClient';
import { AgentCatalogSection } from '../settings/AgentCatalogSection';
import { createCatalogClient, type CatalogRow } from '../settings/agentCatalogClient';
import { ReadyInOneClick } from './ReadyInOneClick';
import { applySignIn, isQuiet, isSettling, noteReady, settleSignIn, useSignInVersion } from './signInState';

export interface FirstRunProps {
  client: OnboardingClient;
  /** Close this screen and land in the default workspace chat (an agent connected, or skipped). */
  onDone: (connected: boolean, setup?: SetupResult) => void;
  /** An agent or a model is now connected: the host remembers it, so a reload mid-setup does not bring Welcome back. */
  onConnected?: () => void;
  /** "Ask my agent" in the skills step: hand the prompt to the chat box (only offered once an agent was connected here). */
  onAskAgent?: (prompt: string) => void;
  /** False when no model is connected either (first run only shows with no agent): a drafted prompt would have nobody to answer it, so the prompt is offered to copy. Default true. */
  canAnswer?: boolean;
  /** The Settings wire the model routes save through. */
  settings?: SettingsClient;
  /**
   * P0-4: the same connect flow drawn inline (the chat's "Connect a model to run this" card), not as the
   * Welcome dialog: no welcome header, nothing behind it made inert, no setup step. Connecting an agent or
   * saving a model calls `onReady` at once, so the blocked action can run.
   */
  inline?: boolean;
  /** Inline only: an agent (its provider id) or a model (its label) is connected. */
  onReady?: (r: { agent?: string; model?: string }) => void;
  /** Inline only: close the flow without connecting. */
  onCancel?: () => void;
}

type Route = 'claude' | 'codex' | 'local' | 'key';
type Step = { at: 'pick' } | { at: 'route'; route: Route } | { at: 'setup' };

const OPTIONS: { route: Route; name: string; sub: string; provider?: 'claude' | 'codex' | 'ollama'; icon?: 'key' }[] = [
  { route: 'claude', name: 'Claude Code', sub: 'Sign in with your Claude plan', provider: 'claude' },
  { route: 'codex', name: 'Codex', sub: 'Sign in with ChatGPT', provider: 'codex' },
  { route: 'local', name: 'Local model', sub: 'Ollama or LM Studio on this computer', provider: 'ollama' },
  { route: 'key', name: 'API key', sub: 'OpenAI, Anthropic, OpenRouter', icon: 'key' },
];

/** A focus re-probe more often than this is the same answer, re-spawned. */
const REPROBE_MIN_MS = 4000;
/** How often the bridge install is asked how it is going. */
const BRIDGE_POLL_MS = 500;
const SETUP_POLL_MS = 1000;

export function FirstRun({ client, onDone, settings, onConnected, onAskAgent, canAnswer = true, inline = false, onReady, onCancel }: FirstRunProps) {
  const wire = useRef(settings ?? createSettingsClient()).current;
  const [step, setStep] = useState<Step>({ at: 'pick' });
  /* A local model or API key saved here: the label it goes by. */
  const [modelReady, setModelReady] = useState<string | null>(null);
  /* An agent (not just a model) was connected on this screen: the skills step can then ask it. */
  const [agentHere, setAgentHere] = useState(false);
  const [rawProviders, setProviders] = useState<ProviderStatus[] | null>(null);
  /* One sign-in state for every surface (signInState): a signed-out read right after a sign-in is "Checking sign-in...". */
  const signInVersion = useSignInVersion();
  const providers = useMemo(() => (rawProviders ? applySignIn(rawProviders) : null), [rawProviders, signInVersion]);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /* More agents (the ACP catalog): null until the person opens or closes it. */
  const [moreOpen, setMoreOpen] = useState<boolean | null>(null);
  /* How many catalog agents can start now (the section reports it once read). */
  const [moreCount, setMoreCount] = useState(0);
  /* The catalog agents the Found card lists: left out of the More list so none shows twice. */
  const [listedIds, setListedIds] = useState<string[]>([]);
  /* How many things "Set up everything" would do; 2 or more replaces the single "Use ..." button. */
  const [readyCount, setReadyCount] = useState(0);
  /* While Set up everything runs, the other ways in wait (so two setups never write at once). */
  const [readyRunning, setReadyRunning] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  /* The provider whose sign-in is open in the browser (BrowserSignIn). */
  const [signing, setSigning] = useState<ProviderStatus | null>(null);
  const signingId = useRef<string | null>(null);
  /* The one setup button: the bridge install in flight (its latest npm line) or its failure, for one agent. */
  const [bridge, setBridge] = useState<{ for: string; state: 'running' | 'failed'; line?: string; error?: string; output?: string[] } | null>(null);
  /* The agent's own CLI install (claims-audit 4.2): the vendor installer's latest line, or its failure verbatim. */
  const [cli, setCli] = useState<{ for: string; state: 'running' | 'failed'; line?: string; error?: string; output?: string[] } | null>(null);
  /* A model already on this machine that fits it (GET /api/local/setup says `ready`): offered first, saved only on Use it. */
  const [fit, setFit] = useState<string | null>(null);
  /* Ollama and LM Studio as the server found them running (GET /api/ai-config localProviders), asked beside the agents. */
  const [locals, setLocals] = useState<DetectedLocal[] | null>(null);
  /* Whether a model is set up, from the same /api/ai-config read as `locals`: null until read, true when unknown. Passed to Ready in one click so it does not read it again. */
  const [modelSetUp, setModelSetUp] = useState<boolean | null>(null);
  /* The agent catalog, read once here and handed to both More agents and Ready in one click. null = under way. */
  const [catalogRead, setCatalogRead] = useState<{ ok: true; rows: CatalogRow[] } | { ok: false; message: string } | null>(null);
  const touched = useRef(false);
  const lastProbe = useRef(0);
  const rawProvidersRef = useRef<ProviderStatus[] | null>(null);
  rawProvidersRef.current = rawProviders;
  signingId.current = signing?.id ?? null;
  const rootRef = useRef<HTMLDivElement>(null);
  const autoFocused = useRef<HTMLElement | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    if (typeof wire.read !== 'function') {
      setModelSetUp(true);
      return;
    }
    void wire.read().then((a) => {
      if (!live.current) return;
      const list = a.outcome === 'ok' ? (a.body as { localProviders?: DetectedLocal[] }).localProviders : null;
      setLocals(Array.isArray(list) ? list : []);
      /* Only an explicit "configured: false" from a good answer means no model is set up (a failed read is not "none"). */
      setModelSetUp(a.outcome === 'ok' && (a.body as { configured?: unknown }).configured === false ? false : true);
    }).catch(() => {
      if (live.current) setModelSetUp(true);
    });
  }, [wire]);

  useEffect(() => {
    void createCatalogClient().list().then((a) => {
      if (!live.current) return;
      setCatalogRead(a.ok && Array.isArray(a.body.agents) ? { ok: true, rows: a.body.agents } : { ok: false, message: a.ok ? 'the server sent no agent list' : a.message });
    });
  }, []);

  useEffect(() => {
    if (typeof wire.localPlan !== 'function') return;
    void wire.localPlan().then((r) => {
      if (live.current && r.outcome === 'ok' && r.body.outcome === 'ready') setFit(r.body.model);
    }).catch(() => undefined);
  }, [wire]);

  /* With a fitting local model here and no agent ready, open the Local route with that model chosen. Nothing is saved
     until Use it, and Back returns to the list. Once, and never after the person has clicked something. */
  useEffect(() => {
    if (!fit || touched.current || step.at !== 'pick' || providers === null) return;
    if (providers.some((p) => p.state === 'ready')) return;
    touched.current = true;
    setStep({ at: 'route', route: 'local' });
  }, [fit, providers, step.at]);

  /* A modal dialog: the shell behind it is inert while it is up (restored on leave). Inline, it is part of the chat. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root || inline) return undefined;
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

  /* Initial focus: the primary action (Start chatting), else the first actionable control, once the list is drawn.
     Inline (the chat's connect card) it is part of the page: focus stays where the person puts it, re-probes included. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root || inline) return;
    const at = document.activeElement;
    /* Leave it where the person put it; move it only from the root or from our own earlier pick. */
    if (at && at !== document.body && at !== root && at !== autoFocused.current && root.contains(at)) return;
    /* Never the first button: that is "Set up everything", and one stray Enter would connect all of it. The dialog itself takes focus. */
    const target = root.querySelector<HTMLElement>('[data-testid="first-run-start"]:not(:disabled), [data-testid="first-run-use-ready"]:not(:disabled)');
    autoFocused.current = target;
    (target ?? root).focus();
  }, [providers, step, modelReady, inline, readyCount]);

  /* Tab cycles inside the dialog. */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || inline) return;
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

  /* The sign-in command ended: ask the vendor again, with backoff, since its status can lag its own sign-in by seconds. */
  const onSignInExit = useCallback(
    async ({ ended }: { ended: boolean }): Promise<ProviderStatus | null> => {
      const id = signingId.current;
      if (!ended || !id) {
        void probe(true);
        return null;
      }
      lastProbe.current = Date.now();
      const last = await settleSignIn(
        id,
        client,
        (l) => {
          if (!live.current) return;
          setProviders(l);
          setProviderError(null);
        },
        { afterSignIn: true },
      );
      return last ?? null;
    },
    [probe, client],
  );

  /* P0-2: the browser sign-in finished (the probe reads Ready): onboarding moves on by itself. */
  const onSignedIn = (p: ProviderStatus) => {
    noteReady(p.id);
    setSigning(null);
    setProviders((cur) => (cur ? cur.map((x) => (x.id === p.id ? p : x)) : cur));
    void start(p);
  };

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
    if (inline && onReady) {
      onReady({ agent: p.id });
      return;
    }
    setAgentHere(true);
    setStep({ at: 'setup' });
  };

  /* A catalog agent (Gemini, Copilot, Hermes...) connected from More agents: the same exit as a ready Claude or Codex. */
  const catalogConnected = (id: string) => {
    touched.current = true;
    onConnected?.();
    if (inline && onReady) {
      onReady({ agent: id });
      return;
    }
    setAgentHere(true);
    setStep({ at: 'setup' });
  };

  /* A model saved on the Local or API key route. Inline, that is the end of the flow. */
  const modelSaved = (label: string) => {
    onConnected?.();
    if (inline && onReady) {
      onReady({ model: label });
      return;
    }
    setModelReady(label);
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
        setBridge({ for: p.id, state: 'failed', error: st?.error ?? 'The install did not finish.', line: st?.output?.[st.output.length - 1], output: st?.output });
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
      /* Not over another agent's sign-in the person started meanwhile. */
      setSigning((s) => s ?? cur);
    }
  };

  /* Install button: the vendor's native installer on the server, polled like the bridge; then look at the machine again. */
  const installCli = async (p: ProviderStatus) => {
    if (!client.installCli) return;
    setCli({ for: p.id, state: 'running' });
    const started = await client.installCli(p.id);
    if (!started.ok) {
      if (live.current) setCli({ for: p.id, state: 'failed', error: started.message });
      return;
    }
    let st = started.body;
    while (st && st.state === 'running' && live.current) {
      setCli({ for: p.id, state: 'running', line: st.output?.length ? st.output[st.output.length - 1] : undefined });
      await new Promise((r) => setTimeout(r, BRIDGE_POLL_MS));
      const polled = client.cliStatus ? await client.cliStatus(p.id) : null;
      if (!polled) break;
      if (!polled.ok) {
        st = { state: 'failed', error: polled.message };
        break;
      }
      st = polled.body;
    }
    if (!live.current) return;
    if (!st || st.state !== 'done') {
      setCli({ for: p.id, state: 'failed', error: st?.error ?? 'The install did not finish.', line: st?.output?.[st.output.length - 1], output: st?.output });
      return;
    }
    setCli(null);
    const again = await client.providers(true);
    if (live.current && again.ok) setProviders(again.body);
  };

  /* The app cannot install or update an agent's CLI itself: the setup goes to the chat as a ready prompt, and first run ends there. */
  const promptFor = (p: ProviderStatus, need: SetupNeed, failure?: SetupFailure): string =>
    agentSetupPrompt({ need, id: p.id, label: p.label, version: p.version, installHint: p.installHint, signInCommand: p.signInCommand, ...(p.adapterInstall ? { adapterInstall: p.adapterInstall } : {}), ...(p.minVersion ? { minVersion: p.minVersion } : {}), ...(failure ? { failure } : {}) });
  /* The failed install this person is looking at, so the drafted prompt carries what it printed. */
  const failureFor = (p: ProviderStatus, need: SetupNeed): SetupFailure | undefined => {
    if ((need === 'install' || need === 'update') && cli?.for === p.id && cli.state === 'failed') return { command: p.installHint, error: cli.error, output: cli.output };
    if (need === 'bridge' && bridge?.for === p.id && bridge.state === 'failed') return { command: p.adapterInstall, error: bridge.error, output: bridge.output };
    return undefined;
  };
  const setUpInChat = (p: ProviderStatus, need: SetupNeed): void => {
    if (!onAskAgent) return;
    onAskAgent(promptFor(p, need, failureFor(p, need)));
    onDone(false);
  };

  const route = step.at === 'route' ? step.route : null;
  const provider = route === 'claude' || route === 'codex' ? (providers ?? []).find((p) => p.id === route) : undefined;
  const opt = OPTIONS.find((o) => o.route === route);
  const myBridge = bridge && provider && bridge.for === provider.id ? bridge : null;
  const myCli = cli && provider && cli.for === provider.id ? cli : null;
  const cliInstallable = Boolean(client.installCli) && provider?.state === 'install';

  const back = () => {
    setStep({ at: 'pick' });
    setModelReady(null);
    setSigning(null);
    setStartError(null);
  };

  /* "Connect a model" leaves the agent for the Local model route (API key one click on), never back to the four. */
  const toModel = () => {
    touched.current = true;
    setModelReady(null);
    setSigning(null);
    setStartError(null);
    setStep({ at: 'route', route: 'local' });
  };

  /* P0-3: what is ready on this machine, asked in parallel on open. Ready options come first. */
  const runningLocal = (locals ?? []).find((d) => d.models.length > 0) ?? null;
  const localModel = runningLocal ? (fit && runningLocal.models.includes(fit) ? fit : runningLocal.models[0]!) : null;
  const readyOf = (r: Route): boolean =>
    r === 'claude' || r === 'codex' ? (providers ?? []).some((p) => p.id === r && p.state === 'ready') : r === 'local' ? runningLocal !== null : false;
  const ordered = [...OPTIONS].sort((a, b) => Number(readyOf(b.route)) - Number(readyOf(a.route)));
  const readyRoutes = ordered.filter((o) => readyOf(o.route));
  const primary = readyRoutes[0] ?? null;
  /* More agents: the person's choice once made; until then open only when nothing above is ready to use. */
  const moreShown = moreOpen ?? (providers !== null && primary === null && readyCount < 2);
  /* The catalog less what Found on this machine lists; the toggle's label is built from the agents that remain. */
  const moreRead = useMemo(() => (catalogRead !== null && catalogRead.ok ? { ok: true as const, rows: catalogRead.rows.filter((r) => !listedIds.includes(r.id)) } : catalogRead), [catalogRead, listedIds]);
  const moreNames = moreRead !== null && moreRead.ok ? moreRead.rows.filter((r) => r.state === 'ready' || r.state === 'npx' || r.state === 'uvx').slice(0, 6).map((r) => r.name) : [];
  const moreLabel = `More agents: ${moreNames.length > 3 ? `${moreNames.slice(0, 3).join(', ')} and ${moreNames.length - 3} more` : moreNames.join(', ')}`;
  const primaryLabel = primary ? `Use ${primary.route === 'local' ? localModel : primary.name}` : '';

  /* One click from a ready option to the setup: connect the agent, or save the running local model. */
  const useReady = async () => {
    if (!primary || busy) return;
    touched.current = true;
    if (primary.route === 'claude' || primary.route === 'codex') {
      const p = (providers ?? []).find((x) => x.id === primary.route);
      if (p) await start(p);
      return;
    }
    if (primary.route === 'local' && runningLocal && localModel) {
      setBusy('local');
      setStartError(null);
      const err = await saveLocalModel(wire, runningLocal.baseUrl, localModel);
      if (!live.current) return;
      setBusy(null);
      if (err) {
        setStartError(err);
        return;
      }
      modelSaved(localModel);
      if (!inline) setStep({ at: 'setup' });
    }
  };

  return (
    <div
      ref={rootRef}
      className={inline ? 'fr-root fr-inline' : 'fr-root'}
      data-testid={inline ? 'connect-in-place' : 'first-run'}
      data-step={step.at}
      role={inline ? 'group' : 'dialog'}
      aria-modal={inline ? undefined : true}
      aria-label={inline ? 'Connect a model' : 'Add an agent'}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="fr-col">
        {inline ? null : (
          <>
            <div className="fr-brand" aria-hidden="true">
              <SequenceMark />
            </div>
            <header className="fr-head">
              <h1 className="fr-title">{step.at === 'setup' ? 'Quick setup' : 'Welcome to Sequence'}</h1>
              <p className="fr-sub fr-lede">
                {step.at === 'setup' ? 'A few taps, each one optional.' : step.at === 'pick' ? 'Add an agent to start chatting.' : 'Connect it, then start chatting.'}
              </p>
            </header>
          </>
        )}

        {step.at === 'pick' ? (
          <section className="fr-section" aria-labelledby="fr-agents-h">
            {inline ? null : (
              <h2 className="fr-h" id="fr-agents-h">
                Add an agent
              </h2>
            )}
            {providerError ? (
              <FailureNote testid="first-run-providers-error" message="Could not check your agents." detail={providerError} onRetry={() => void probe(true)} />
            ) : null}
            {/* Several things ready on this machine: one click sets them all up (ReadyInOneClick), and it replaces the single "Use ..." button. */}
            {inline ? null : (
              <ReadyInOneClick
                providers={providers}
                catalogRows={catalogRead === null ? null : catalogRead.ok ? catalogRead.rows : []}
                modelSetUp={modelSetUp}
                onCount={setReadyCount}
                onRunning={setReadyRunning}
                onListed={setListedIds}
                onDone={(connected) => {
                  touched.current = true;
                  onConnected?.();
                  if (connected.length > 0) setAgentHere(true);
                  setStep({ at: 'setup' });
                }}
              />
            )}
            {primary && readyCount < 2 ? (
              <div className="fr-route-acts" data-testid="first-run-ready">
                <button type="button" className="fr-btn fr-primary" data-testid="first-run-use-ready" data-option={primary.route} disabled={busy !== null} aria-busy={busy !== null} onClick={() => void useReady()}>
                  {busy !== null ? <><AsciiSpinner /> Connecting</> : primaryLabel}
                </button>
              </div>
            ) : null}
            {startError ? (
              <p className="fr-note fr-row-error" role="alert" data-testid="first-run-start-error">
                {startError}
              </p>
            ) : null}
            <ul className="fr-options" data-testid="first-run-options" aria-busy={providers === null}>
              {ordered.map((o) => {
                const p = (providers ?? []).find((x) => x.id === o.route);
                const pill = p ? providerPill(p) : o.route === 'local' && runningLocal ? { text: 'Running', tone: 'done' as const } : o.route === 'local' && fit ? { text: `${fit} fits`, tone: 'done' as const } : null;
                return (
                  <li key={o.route} className="fr-opt-li">
                    <button type="button" className="fr-option" data-testid="first-run-option" disabled={readyRunning} data-option={o.route} data-state={p?.state} data-recommended={o.route === 'local' && fit ? 'true' : undefined} data-ready={readyOf(o.route) ? 'true' : undefined} data-preselected={readyRoutes.length === 1 && readyRoutes[0] === o ? 'true' : undefined} onClick={() => {
                      touched.current = true;
                      setStep({ at: 'route', route: o.route });
                    }}>
                      <span className="fr-option-ic" aria-hidden="true">
                        {o.icon ? <S2Icon name={o.icon} /> : <ProviderIcon provider={brandOf(o.provider, o.name)} />}
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
            {/* Every other ACP agent that can start now. Open by itself when neither Claude Code nor Codex is ready. */}
            {/* Offered only once the catalog has something that can start: a toggle that opens to nothing is a lie. */}
            {moreCount > 0 ? (
              <button type="button" className="fr-ghost fr-more-toggle" data-testid="first-run-more" disabled={readyRunning} aria-expanded={moreShown} onClick={() => setMoreOpen(!moreShown)}>
                {moreShown ? 'Fewer agents' : moreLabel}
              </button>
            ) : null}
            <AgentCatalogSection compact hidden={!moreShown} preloaded={moreRead} onRows={setMoreCount} onConnected={catalogConnected} />
          </section>
        ) : null}

        {step.at === 'route' && opt ? (
          <section className="fr-section fr-route" data-testid="first-run-route" data-route={step.route} aria-label={opt.name}>
            <div className="fr-route-head">
              <span className="fr-option-ic" aria-hidden="true">
                {opt.icon ? <S2Icon name={opt.icon} /> : <ProviderIcon provider={brandOf(opt.provider, opt.name)} />}
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
                        onClick={() => setSigning(provider)}
                      >
                        Sign in
                      </button>
                    ) : null}
                    {cliInstallable ? (
                      <button type="button" className="fr-btn fr-primary" data-testid="first-run-install" disabled={myCli?.state === 'running'} onClick={() => void installCli(provider)}>
                        {myCli?.state === 'failed' ? 'Try again' : `Install ${provider.label}`}
                      </button>
                    ) : null}
                    {onAskAgent && canAnswer && (provider.state === 'signIn' || provider.state === 'adapter') && myBridge?.state === 'failed' ? (
                      <button type="button" className="fr-btn" data-testid="first-run-bridge-chat" onClick={() => setUpInChat(provider, 'bridge')}>
                        Set up in chat
                      </button>
                    ) : null}
                    {onAskAgent && canAnswer && (provider.state === 'install' || provider.state === 'update') ? (
                      <button
                        type="button"
                        className={cliInstallable ? 'fr-btn' : 'fr-btn fr-primary'}
                        data-testid={cliInstallable ? 'first-run-install-chat' : 'first-run-install'}
                        onClick={() => setUpInChat(provider, provider.state === 'update' ? 'update' : 'install')}
                      >
                        {provider.state === 'update' ? 'Update in chat' : 'Set up in chat'}
                      </button>
                    ) : null}
                    {onAskAgent && !canAnswer && (provider.state === 'install' || provider.state === 'update' || provider.state === 'attention') ? (
                      <>
                        <CopyPromptButton text={promptFor(provider, provider.state === 'update' ? 'update' : provider.state === 'attention' ? 'attention' : 'install')} className="fr-btn fr-primary" testid="first-run-copy" />
                        <button type="button" className="fr-btn" data-testid="first-run-model" onClick={toModel}>
                          Connect a model
                        </button>
                      </>
                    ) : null}
                    {provider.state === 'attention' || provider.state === 'limited' ? (
                      <button type="button" className="fr-btn" data-testid="first-run-recheck" onClick={() => void probe(true)}>
                        Check again
                      </button>
                    ) : null}
                    {onAskAgent && canAnswer && provider.state === 'attention' ? (
                      <button type="button" className="fr-btn" data-testid="first-run-chat" onClick={() => setUpInChat(provider, 'attention')}>
                        Set up in chat
                      </button>
                    ) : null}
                  </div>
                  {myCli?.state === 'running' ? (
                    <p className="fr-agent-say" role="status" data-testid="first-run-cli-progress">
                      <AsciiSpinner /> Installing {provider.label}{myCli.line ? `: ${myCli.line}` : '...'}
                    </p>
                  ) : null}
                  {myCli?.state === 'failed' ? (
                    <p className="fr-note fr-row-error" role="alert" data-testid="first-run-cli-failed">
                      {provider.label} did not install. {myCli.error} You can also run <code>{provider.installHint}</code> yourself.
                    </p>
                  ) : null}
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
                  {signing ? <BrowserSignIn key={signing.id} provider={signing} client={client} onSignedIn={onSignedIn} onExit={onSignInExit} /> : null}
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
                    <>
                      <LocalPanel settings={wire} {...(fit ? { preferred: fit } : {})} onReady={modelSaved} />
                      <div className="fr-route-acts">
                        <button type="button" className="fr-ghost" data-testid="first-run-to-key" onClick={() => setStep({ at: 'route', route: 'key' })}>
                          Use an API key instead
                        </button>
                      </div>
                    </>
                  ) : (
                    <KeyPanel settings={wire} onReady={modelSaved} />
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

        {step.at === 'setup' ? <FirstRunSetup client={client} agentConnected={agentHere} {...(onAskAgent ? { onAskAgent } : {})} onFinish={(r) => onDone(true, r)} /> : null}

        <footer className="fr-foot">
          {step.at === 'route' ? (
            <button type="button" className="fr-ghost" data-testid="first-run-back" onClick={back}>
              Back
            </button>
          ) : null}
          {inline ? (
            <button type="button" className="fr-ghost" data-testid="connect-in-place-cancel" onClick={() => onCancel?.()}>
              Cancel
            </button>
          ) : step.at === 'setup' ? (
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
