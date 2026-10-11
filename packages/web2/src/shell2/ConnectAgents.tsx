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
import { noteConnected, noteRegistered } from '../agents/agentRegistry';
import { createOnboardingClient, type OnboardingClient, type ProviderStatus } from '../onboarding/onboardingClient';
import { applySignIn, isQuiet, isSettling, settleSignIn, useSettledCount, useSignInVersion } from '../onboarding/signInState';
import { ProviderIcon, providerOf } from './brandIcons';

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
      return p.adapterInstall ? `Needs sign-in and bridge: set up in Settings` : 'Needs sign-in';
    case 'install':
      return 'Not installed';
    case 'adapter':
      return 'Needs bridge: install it in Settings';
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

export function ConnectAgents({ sessionId, fetchImpl = pageFetch, onboarding, store = agentRuns, onConnected, inSection = false, onRows }: ConnectAgentsProps) {
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
  const [copied, setCopied] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const client = onboarding ?? createOnboardingClient(fetchImpl as typeof fetch);
    void (async () => {
      const [list, found] = await Promise.all([
        fetchImpl(AGENTS_ROUTE)
          .then(async (r) => (r.ok ? ((await r.json()) as { agents?: { id: string }[] }).agents ?? [] : null))
          .catch(() => null),
        client.providers(),
      ]);
      if (!live) return;
      const ids = (list ?? []).map((a) => a.id);
      setRegistered(ids);
      /* The registry as read: the picker offers each of these, whatever its model list says (0.1.5 G1). An unreadable registry changes nothing. */
      if (list) noteRegistered(store, ids);
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
          setNotes((n) => ({ ...n, [p.id]: `Sign in: ${body.signInCommand ?? p.signInCommand}` }));
        } else if (body.state === 'signIn' && body.signInCommand) setNotes((n) => ({ ...n, [p.id]: `Sign in: ${body.signInCommand}` }));
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

  const copy = (id: string, command: string) => {
    void navigator.clipboard?.writeText(command).then(
      () => setCopied(id),
      () => setCopied(null),
    );
  };

  const list: ReactNode = rows.map((p) => {
    const ready = p.state === 'ready';
    const signIn = p.state === 'signIn';
    const missing = p.state === 'install';
    const note = notes[p.id] ?? (missing ? 'Not installed' : connectNote(p));
    const command = signIn ? p.signInCommand : missing ? p.installHint : '';
    const showHelp = help === p.id && !!command;
    return (
      <Fragment key={p.id}>
        <div className="s2-agent-line" data-testid={`s2-connect-line-${p.id}`}>
          <button
            type="button"
            role="menuitem"
            className="s2-mi s2-mi-model"
            data-testid={`s2-connect-${p.id}`}
            data-state={p.state}
            aria-disabled={(!ready && !command) || busy !== null}
            aria-expanded={command ? showHelp : undefined}
            title={ready ? `Connect ${p.label}` : note}
            onClick={() => {
              if (ready && busy === null) void connect(p);
              else if (command) setHelp((h) => (h === p.id ? null : p.id));
            }}
          >
            <span className="s2-slot">
              <ProviderIcon provider={providerOf(p.id)} />
            </span>
            <span className="s2-mi-name">{p.label}</span>
            <span className="s2-mi-note" data-testid={`s2-connect-note-${p.id}`}>
              {isSettling(p.id) ? 'Checking sign-in...' : busy === p.id ? <><AsciiSpinner /> Connecting</> : note}
            </span>
          </button>
          {/* Only what the agent needs: Connect when it is ready, Sign in when it is signed out, nothing otherwise. */}
          {ready ? (
            <button type="button" role="menuitem" className="s2-btn s2-btn-sm s2-blue" data-testid={`s2-connect-go-${p.id}`} aria-disabled={busy !== null} onClick={() => busy === null && void connect(p)}>
              Connect
            </button>
          ) : signIn && !isSettling(p.id) ? (
            <button type="button" role="menuitem" className="s2-btn s2-btn-sm" data-testid={`s2-signin-${p.id}`} aria-expanded={showHelp} onClick={() => setHelp((h) => (h === p.id ? null : p.id))}>
              Sign in
            </button>
          ) : null}
        </div>
        {showHelp ? (
          <div className="s2-agent-help" role="presentation" data-testid={`s2-connect-help-${p.id}`}>
            <p className="s2-agent-help-text">
              {signIn ? 'Run this in a terminal, then check:' : 'Install it from a terminal:'} <code className="s2-agent-help-cmd" data-testid={`s2-connect-command-${p.id}`}>{command}</code>
            </p>
            <div className="s2-agent-help-acts">
              <button type="button" role="menuitem" className="s2-btn s2-btn-sm" data-testid={`s2-connect-copy-${p.id}`} onClick={() => copy(p.id, command)}>
                {copied === p.id ? 'Copied' : 'Copy'}
              </button>
              {signIn ? (
                <button type="button" role="menuitem" className="s2-btn s2-btn-sm" data-testid={`s2-connect-check-${p.id}`} aria-disabled={checking !== null || busy !== null} onClick={() => checking === null && busy === null && void check(p)}>
                  {checking === p.id ? 'Checking sign-in...' : 'Check again'}
                </button>
              ) : null}
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
