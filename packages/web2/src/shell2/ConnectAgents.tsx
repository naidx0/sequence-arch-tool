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

   Loaded with the menu, never at boot.
   ══════════════════════════════════════════════════════════════════════════ */

import { Fragment, useEffect, useMemo, useState } from 'react';

import { agentRuns, type AgentRunStore } from '../agents/agentRuns';
import { loadCapabilities } from '../agents/agentRunner';
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
      return p.adapterInstall ? `Needs sign-in and bridge: set up in Settings` : `Sign in: ${p.signInCommand}`;
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
  /** Connected: the menu that holds this section closes (ModelMenu passes its onClose). */
  onConnected?: () => void;
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

export function ConnectAgents({ sessionId, fetchImpl = pageFetch, onboarding, store = agentRuns, onConnected }: ConnectAgentsProps) {
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

  useEffect(() => {
    let live = true;
    const client = onboarding ?? createOnboardingClient(fetchImpl as typeof fetch);
    void (async () => {
      const [list, found] = await Promise.all([
        fetchImpl(AGENTS_ROUTE)
          .then(async (r) => (r.ok ? ((await r.json()) as { agents?: { id: string }[] }).agents ?? [] : []))
          .catch(() => []),
        client.providers(),
      ]);
      if (!live) return;
      const ids = list.map((a) => a.id);
      setRegistered(ids);
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

  if (providers === null || registered === null) return null;
  const rows = providers.filter((p) => !registered.includes(p.id) && p.state !== 'install');
  if (rows.length === 0) return null;

  /**
   * Connected: the menu has done its job. The menu closes (its owner's
   * onConnected) and focus goes to the composer, so the next key typed is the
   * message.
   */
  const finish = () => {
    onConnected?.();
    window.setTimeout(() => document.querySelector<HTMLElement>('[data-testid="composer-field"]')?.focus(), 0);
  };

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
        await loadCapabilities(store, p.id, fetchImpl);
        finish();
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

  return (
    <div className="s2-menu-sec" data-testid="s2-connect">
      <p className="s2-gh s2-menu-gh" role="presentation">
        Connect an agent
      </p>
      {rows.map((p) => {
        const ready = p.state === 'ready';
        const note = notes[p.id] ?? connectNote(p);
        return (
          <Fragment key={p.id}>
          <button
            type="button"
            role="menuitem"
            className="s2-mi s2-mi-model"
            data-testid={`s2-connect-${p.id}`}
            data-state={p.state}
            aria-disabled={!ready || busy !== null}
            title={ready ? `Connect ${p.label}` : note}
            onClick={() => {
              if (ready && busy === null) void connect(p);
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
      })}
    </div>
  );
}

export default ConnectAgents;
