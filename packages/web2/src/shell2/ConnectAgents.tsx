/* ══════════════════════════════════════════════════════════════════════════
   CONNECT AN AGENT, FROM THE MODEL MENU (Decision 49; UX audit)
   packages/web2/src/shell2/ConnectAgents.tsx

   A first-time reader had no way to attach an agent from the UI: the menu said
   "No models yet" while first run had already found "Codex, Ready, ChatGPT".
   This section lists what first run detected (GET /api/onboarding/providers)
   that is not yet registered (GET /api/acp/agents), and one click on a ready
   one registers it (POST /api/acp/agents/connect, what `sequence agent add`
   writes), loads its models and makes it this chat's agent. A signed-out
   agent says how to sign in; it is a state, not an error.

   A registered agent whose models have not loaded yet asks for them here, so
   its rows appear in the menu above without a run first.

   0.1.6.1 (owner: "Have everything clickable for them. Don't make them do
   anything. If they can't click it and it's not that easy, refer them to the
   agent chat"): no row asks anyone to run a command. Sign in opens the same
   in-app sign-in terminal first run uses (the server runs the vendor's own
   command; nothing is typed); a missing bridge installs on a click; an agent
   that is not installed, or is too old, gets "Set up in chat", which drafts a
   ready prompt into the composer (agentSetupPrompt) for the agent to do.

   0.1.6 (owner: "connect an agent. Make sure it's easy to connect everything
   just from this section... You sign in when you have to"): every agent first
   run knows is listed with its state, not only the ready ones. Ready: Connect.
   Needs sign-in: a Sign in action that shows the vendor's command to copy (the
   Agents settings pane's own flow: nothing is run from here) and a Check again
   that asks the probe and connects when it now reads ready. Not installed: the
   install command to copy. Connecting keeps the menu open and tells it which
   agent connected (onConnected(id)), which opens that agent's model flyout.

   Loaded with the menu, never at boot.
   ══════════════════════════════════════════════════════════════════════════ */

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';

import { agentRuns, type AgentRunStore } from '../agents/agentRuns';
import { loadCapabilities } from '../agents/agentRunner';
import { noteAgentLabels, noteConnected, noteRegistered } from '../agents/agentRegistry';
import { BridgeInstall } from '../onboarding/BridgeInstall';
import { agentSetupPrompt, draftIntoComposer, type SetupNeed } from '../onboarding/agentSetupPrompt';
import { CopyPromptButton, nothingCanAnswer } from '../onboarding/setupFallback';
import { useStoreIfAny } from '../state/connect';
import { TerminalPane } from '../terminal/TerminalPane';
import './connectAgents.css';
import { createOnboardingClient, type OnboardingClient, type ProviderStatus } from '../onboarding/onboardingClient';
import { applySignIn, isQuiet, isSettling, settleSignIn, useSettledCount, useSignInVersion } from '../onboarding/signInState';
import { ProviderIcon, brandOf } from './brandIcons';

import { AGENTS_ROUTE, CONNECT_ROUTE } from '../onboarding/loneAgent';
import { AsciiSpinner } from './AsciiSpinner';
import { FailureNote } from '../components/FailureNote';

export { AGENTS_ROUTE, CONNECT_ROUTE };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** What a row says under the agent's name, from the probe's state. */
export function connectNote(p: ProviderStatus): string {
  if (p.state === 'checking' && p.checkingSignIn) return 'Checking sign-in...';
  switch (p.state) {
    case 'ready':
      return p.plan ? `Ready, ${p.plan}` : 'Ready';
    case 'signIn':
      /* The command is behind the row's Sign in (and in Settings); the row says what is wrong, not a command cut short. */
      return p.adapterInstall ? 'Needs sign-in and bridge' : 'Needs sign-in';
    case 'install':
      return 'Not installed';
    case 'adapter':
      return 'Needs bridge';
    case 'checking':
      return 'Checking';
    case 'preparing':
      return 'Setting up Claude';
    case 'update':
      return 'Update Claude Code';
    default:
      return 'Needs attention';
  }
}

export interface ConnectAgentsProps {
  sessionId: string;
  fetchImpl?: Fetch;
  onboarding?: OnboardingClient;
  store?: AgentRunStore;
  /** Connected: the menu that holds this section is told which agent (ModelMenu opens its model flyout). */
  onConnected?: (agentId: string) => void;
  /** Closes the menu that holds this section (after "Set up in chat" drafted its prompt). */
  onClose?: () => void;
  /** The menu already draws the section's frame and heading around its connected agents: draw only the rows. */
  inSection?: boolean;
  /** How many agents it lists (not yet connected): the menu hides an empty section. */
  onRows?: (count: number) => void;
}

/**
 * ONE function for the life of the page (round 7, A1). A default written as an
 * arrow in the parameter list is a new function on every render, and it is in
 * the effect's dependencies: each answer set state, the render made a new
 * fetch, the effect ran again, for as long as the menu was open. Every round
 * asked for the agents, the providers (the server's probes start codex and
 * claude) and each agent's models (which starts the agent).
 */
const pageFetch: Fetch = (i, init) => fetch(i, init);

export function ConnectAgents({ sessionId, fetchImpl = pageFetch, onboarding, store = agentRuns, onConnected, inSection = false, onRows, onClose }: ConnectAgentsProps) {
  const appStore = useStoreIfAny();
  const [rawProviders, setProviders] = useState<ProviderStatus[] | null>(null);
  /* One sign-in state (onboarding/signInState): a signed-out read just after a sign-in is not a new prompt. */
  const signInVersion = useSignInVersion();
  const settled = useSettledCount();
  const providers = useMemo(() => (rawProviders ? applySignIn(rawProviders) : null), [rawProviders, signInVersion]);
  const [registered, setRegistered] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  /* A refusal: one sentence under the row (components/FailureNote), the server's own words behind Details. */
  const [failed, setFailed] = useState<Record<string, { say: string; detail: string }>>({});
  /* The row whose command (sign in, or install) is showing under it, and which one was copied. */
  const [help, setHelp] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const client = onboarding ?? createOnboardingClient(fetchImpl as typeof fetch);
    void (async () => {
      const [list, found] = await Promise.all([
        fetchImpl(AGENTS_ROUTE)
          .then(async (r) => (r.ok ? ((await r.json()) as { agents?: { id: string; label?: unknown }[] }).agents ?? [] : null))
          .catch(() => null),
        client.providers(),
      ]);
      if (!live) return;
      const ids = (list ?? []).map((a) => a.id);
      setRegistered(ids);
      /* The registry as read: the picker offers each of these, whatever its model list says (0.1.5 G1). An unreadable registry changes nothing. */
      if (list) {
        noteRegistered(store, ids);
        noteAgentLabels(store, list);
      }
      setProviders(found.ok ? found.body : []);
      if (found.ok) {
        for (const p of found.body) {
          /* Opening the menu is not a sign-in and starts no grace. */
          if (p.state === 'signIn' && isQuiet(p.id) && !isSettling(p.id)) void settleSignIn(p.id, client);
        }
      }
      /* A registered agent's models, so its rows show without a run first. */
      for (const id of ids) void loadCapabilities(store, id, fetchImpl);
    })();
    return () => {
      live = false;
    };
  }, [fetchImpl, onboarding, store, settled]);

  /* The menu draws the section's frame around its connected agents: it needs to know whether any row is left to show. */
  const rowCount = providers && registered ? providers.filter((p) => !registered.includes(p.id)).length : 0;
  useEffect(() => {
    onRows?.(rowCount);
  }, [rowCount, onRows]);

  if (providers === null || registered === null) return null;
  const rows = providers.filter((p) => !registered.includes(p.id));
  if (rows.length === 0) return null;

  const connect = async (p: ProviderStatus, retried = false): Promise<void> => {
    setBusy(p.id);
    setFailed(({ [p.id]: _gone, ...rest }) => rest);
    try {
      const r = await fetchImpl(CONNECT_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: p.id }),
      });
      const body = (await r.json().catch(() => ({}))) as { error?: string; state?: string; signInCommand?: string };
      if (r.ok) {
        setRegistered((prev) => [...(prev ?? []), p.id]);
        store.patch((s) => ({ ...s, agents: { ...s.agents, [sessionId]: p.id } }));
        /* Asked afresh: a failed read from before a reconnect would otherwise stand. */
        await noteConnected(store, p.id, fetchImpl);
        onConnected?.(p.id);
      } else {
        if (body.state === 'signIn' && isQuiet(p.id)) {
          /* Signed in a moment ago: the server's read lags. The row says it is checking (isSettling), then connects
             if the vendor now reads ready, else says how to sign in. No terminal is sent for in between. */
          const last = await settleSignIn(p.id, onboarding ?? createOnboardingClient(fetchImpl as typeof fetch));
          if (last?.state === 'ready' && !retried) {
            await connect(p, true);
            return;
          }
          setNotes((n) => ({ ...n, [p.id]: 'Needs sign-in' }));
          setHelp(p.id);
        } else if (body.state === 'signIn') {
          setNotes((n) => ({ ...n, [p.id]: 'Needs sign-in' }));
          setHelp(p.id);
        }
        else setFailed((d) => ({ ...d, [p.id]: { say: `Could not connect ${p.label}.`, detail: body.error ?? `the server answered ${r.status}` } }));
      }
    } catch (e) {
      setFailed((d) => ({ ...d, [p.id]: { say: `Could not connect ${p.label}.`, detail: e instanceof Error ? e.message : 'the server could not be reached' } }));
    } finally {
      setBusy(null);
    }
  };

  const client = () => onboarding ?? createOnboardingClient(fetchImpl as typeof fetch);

  /* Back from the terminal: ask the probe again (it forgives a stale signed-out read, signInState), and connect if it now reads ready. */
  const check = async (p: ProviderStatus): Promise<void> => {
    setChecking(p.id);
    try {
      const last = await settleSignIn(p.id, client(), (list) => setProviders(list), { afterSignIn: true });
      if (last?.state === 'ready') {
        setHelp(null);
        await connect(last);
      } else setNotes((n) => ({ ...n, [p.id]: 'Still signed out' }));
    } finally {
      setChecking(null);
    }
  };

  /* What the person can do from the row, in order of how little they have to do. */
  const needOf = (p: ProviderStatus): SetupNeed | null => {
    switch (p.state) {
      case 'install':
        return 'install';
      case 'update':
        return 'update';
      case 'attention':
        return 'attention';
      case 'adapter':
        return 'bridge';
      case 'signIn':
        return 'signIn';
      default:
        return null;
    }
  };

  const promptFor = (p: ProviderStatus, need: SetupNeed): string =>
    agentSetupPrompt({ need, id: p.id, label: p.label, version: p.version, installHint: p.installHint, signInCommand: p.signInCommand, ...(p.adapterInstall ? { adapterInstall: p.adapterInstall } : {}), ...(p.minVersion ? { minVersion: p.minVersion } : {}) });

  /* Drafts the whole setup into the chat composer for the agent to do, then closes the menu. Sends nothing. */
  const setUpInChat = (p: ProviderStatus, need: SetupNeed): void => {
    if (!appStore) return;
    draftIntoComposer(appStore, promptFor(p, need));
    onClose?.();
  };

  /* No agent registered and no model connected: a drafted prompt has nobody to answer it. */
  const stuck = !!appStore && nothingCanAnswer(registered.length, appStore.getState().composer.model);
  const connectModel = (): void => {
    appStore?.dispatch({ type: 'shell/overlay', overlay: { kind: 'settings', pane: 'models' } });
    onClose?.();
  };
  /* The chat action for a row: Set up in chat when something can answer, else the prompt to copy and a way to connect a model. */
  const chatActions = (p: ProviderStatus, need: SetupNeed): ReactNode =>
    stuck ? (
      <>
        <CopyPromptButton text={promptFor(p, need)} role="menuitem" className="s2-btn s2-btn-sm" testid={`s2-copy-${p.id}`} />
        <button type="button" role="menuitem" className="s2-btn s2-btn-sm" data-testid={`s2-model-${p.id}`} onClick={connectModel}>
          Connect a model
        </button>
      </>
    ) : (
      <button type="button" role="menuitem" className="s2-btn s2-btn-sm" data-testid={`s2-chat-${p.id}`} onClick={() => setUpInChat(p, need)}>
        {need === 'update' ? 'Update in chat' : 'Set up in chat'}
      </button>
    );

  const list: ReactNode = rows.map((p) => {
    const ready = p.state === 'ready';
    const signIn = p.state === 'signIn';
    const need = needOf(p);
    const bridge = p.state === 'adapter' || (signIn && !!p.adapterInstall);
    /* Sign in and the bridge open a panel under the row; the rest are one click to the chat. */
    const panel = signIn || p.state === 'adapter';
    const chat = !panel && need !== null && !!appStore;
    const note = notes[p.id] ?? connectNote(p);
    /* The row shares its width with an action button: the generic state is said short, the title keeps the full words. */
    const shownNote = note === 'Needs attention' ? 'Not ready' : note;
    const showHelp = help === p.id && panel;
    const act = (): void => {
      if (ready && busy === null) void connect(p);
      else if (panel) setHelp((h) => (h === p.id ? null : p.id));
      else if (chat && need && !stuck) setUpInChat(p, need);
    };
    return (
      <Fragment key={p.id}>
        <div className="s2-agent-line" data-testid={`s2-connect-line-${p.id}`}>
          <button
            type="button"
            role="menuitem"
            className="s2-mi s2-mi-model"
            data-testid={`s2-connect-${p.id}`}
            data-state={p.state}
            aria-disabled={(!ready && !panel && (!chat || stuck)) || busy !== null}
            aria-expanded={panel ? showHelp : undefined}
            title={ready ? `Connect ${p.label}` : note}
            onClick={act}
          >
            <span className="s2-slot">
              <ProviderIcon provider={brandOf(p.id, p.label)} />
            </span>
            <span className="s2-mi-name">{p.label}</span>
            <span className="s2-mi-note" data-testid={`s2-connect-note-${p.id}`}>
              {isSettling(p.id) ? 'Checking sign-in...' : busy === p.id ? <><AsciiSpinner /> Connecting</> : shownNote}
            </span>
          </button>
          {/* One action per state: Connect when ready, Sign in or Install bridge when that is the step, Set up in chat when the app cannot do it. */}
          {ready ? (
            <button type="button" role="menuitem" className="s2-btn s2-btn-sm s2-blue" data-testid={`s2-connect-go-${p.id}`} aria-disabled={busy !== null} onClick={() => busy === null && void connect(p)}>
              Connect
            </button>
          ) : signIn && !isSettling(p.id) ? (
            <button type="button" role="menuitem" className="s2-btn s2-btn-sm" data-testid={`s2-signin-${p.id}`} aria-expanded={showHelp} onClick={() => setHelp((h) => (h === p.id ? null : p.id))}>
              Sign in
            </button>
          ) : p.state === 'adapter' ? (
            <button type="button" role="menuitem" className="s2-btn s2-btn-sm" data-testid={`s2-bridge-${p.id}`} aria-expanded={showHelp} onClick={() => setHelp((h) => (h === p.id ? null : p.id))}>
              Install bridge
            </button>
          ) : chat && need ? (
            chatActions(p, need)
          ) : null}
        </div>
        {showHelp ? (
          <div className="s2-agent-help" role="presentation" data-testid={`s2-connect-help-${p.id}`}>
            {bridge ? (
              <BridgeInstall provider={p.id} client={client()} buttonClass="s2-btn s2-btn-sm" onInstalled={() => void client().providers(true).then((a) => a.ok && setProviders(a.body))} />
            ) : null}
            {signIn ? (
              <div className="s2-agent-term" data-testid={`s2-connect-terminal-${p.id}`}>
                <TerminalPane signIn={p.id} onExit={() => void check(p)} />
              </div>
            ) : null}
            <div className="s2-agent-help-acts">
              {signIn ? (
                <button type="button" role="menuitem" className="s2-btn s2-btn-sm" data-testid={`s2-connect-check-${p.id}`} aria-disabled={checking !== null || busy !== null} onClick={() => checking === null && busy === null && void check(p)}>
                  {checking === p.id ? 'Checking sign-in...' : 'Check again'}
                </button>
              ) : null}
              {appStore && need ? chatActions(p, need) : null}
            </div>
          </div>
        ) : null}
        {failed[p.id] ? (
          <FailureNote
            className="failure-note s2-failnote s2-connect-why"
            testid={`s2-connect-details-${p.id}`}
            message={failed[p.id]!.say}
            detail={failed[p.id]!.detail}
            onRetry={busy === null ? () => void connect(p) : undefined}
          />
        ) : null}
      </Fragment>
    );
  });

  if (inSection) return <>{list}</>;
  return (
    <div className="s2-menu-sec" data-testid="s2-connect">
      <p className="s2-gh s2-menu-gh" role="presentation">
        Connect an agent
      </p>
      {list}
    </div>
  );
}

export default ConnectAgents;
