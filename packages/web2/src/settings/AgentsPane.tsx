/* ══════════════════════════════════════════════════════════════════════════
   SETTINGS › AGENTS
   packages/web2/src/settings/AgentsPane.tsx

   The coding agents this machine has (Codex, Claude Code, and any other
   registered one), each with its state in words (never a colour alone) and
   the one act it allows: Connect when it is ready and not yet connected,
   Disconnect once it is (DELETE /api/acp/agents/:id). 0.1.6.1: nothing here
   asks anyone to type a command. Sign in opens the in-app sign-in terminal
   (the server runs the vendor's own command) and connects when it ends; a
   missing bridge installs on a click; an agent that is not installed, or is
   too old, or whose status will not read gets "Set up in chat", which drafts a
   ready prompt into the chat composer for the agent to do. Add another agent
   does the same. Sequence installs no agent CLI itself.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useRef, useState } from 'react';

import { ProviderIcon, brandOf } from '../shell2/brandIcons';
import { agentRuns, type AgentRunStore } from '../agents/agentRuns';
import { forgetAgent, noteConnected } from '../agents/agentRegistry';
import { createAgentsClient, type AgentRow, type AgentStatus, type AgentsClient } from './agentsClient';
import { BridgeInstall } from '../onboarding/BridgeInstall';
import { InstructionsEditor } from './InstructionsEditor';
import type { InstructionsClient } from './instructionsClient';
import { createOnboardingClient, type OnboardingClient } from '../onboarding/onboardingClient';
import { agentSetupPrompt, draftIntoComposer, type SetupNeed } from '../onboarding/agentSetupPrompt';
import { useStoreIfAny } from '../state/connect';
import { focusComposerSoon } from '../onboarding/landing';
import { CopyPromptButton, nothingCanAnswer } from '../onboarding/setupFallback';
import { TerminalPane } from '../terminal/TerminalPane';
import { AgentCatalogSection } from './AgentCatalogSection';
import { SharedMemorySection } from './SharedMemorySection';
import { createCatalogClient, type CatalogClient } from './agentCatalogClient';
import { isQuiet, isSettling, settleSignIn, useSettledCount, useSignInVersion } from '../onboarding/signInState';

const STATUS_WORD: Record<AgentStatus, string> = {
  connected: 'Connected',
  ready: 'Ready',
  limited: 'Usage limit',
  'signed-out': 'Needs sign-in',
  'not-installed': 'Not installed',
  adapter: 'Needs bridge',
  attention: 'Needs attention',
  checking: 'Checking',
};

const STATUS_SUB: Record<AgentStatus, string> = {
  connected: 'Chats can hand it work.',
  ready: 'Installed and signed in. Connect it to hand it work.',
  limited: 'Signed in, but its usage limit is spent. It can take work again after the reset.',
  'signed-out': 'Installed, but signed out. Sign in, then connect.',
  'not-installed': 'Not found on this machine.',
  adapter: "Sequence talks to Claude Code through a small bridge called claude-agent-acp. It isn't installed yet.",
  attention: 'Its sign-in could not be checked.',
  checking: 'Looking at this machine…',
};

/* Signed out and no bridge: both steps on the row (UX study 2026-10-09). */
const BRIDGE_AND_SIGNIN = "Installed, but signed out, and the small bridge Sequence talks to it through (claude-agent-acp) isn't installed yet. Install the bridge, then sign in.";

/** What a row says under its name: the version or plan when known, else the catalog's own line, then what to do. Never a program path. */
export function agentSub(row: AgentRow, blurb?: string): string {
  if (row.status === 'attention' && !row.needsUpdate) return `Couldn’t check whether ${row.label} is signed in. Set it up in chat.`;
  const lead = row.detail ? `${row.detail}. ` : blurb ? `${blurb.replace(/[.\s]+$/, '')}. ` : '';
  return lead + (row.needsBridge ? BRIDGE_AND_SIGNIN : STATUS_SUB[row.status]);
}

/** The row sentence for an agent older than Sequence can drive. */
function updateSentence(row: AgentRow): string {
  if (row.version && row.minVersion) return `${row.label} ${row.version} is older than Sequence needs (${row.minVersion}). Update it in chat.`;
  return `${row.label} is older than Sequence needs. Update it in chat.`;
}

/** Round 13 (N4): the models an agent offers on its own subscription, read from the agent
 *  (GET /api/acp/capabilities). Names only: nothing here is saved, so nothing here can be
 *  tested, edited or removed. */
export type AgentModelsLoader = (agentRef: string, refresh?: boolean) => Promise<string[]>;

async function loadAgentModels(agentRef: string, refresh = false): Promise<string[]> {
  const r = await fetch(`/api/acp/capabilities?agentRef=${encodeURIComponent(agentRef)}${refresh ? '&refresh=1' : ''}`);
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(typeof body?.error === 'string' && body.error ? body.error : `the server answered ${r.status}`);
  }
  const j = (await r.json()) as { models?: { id?: string; name?: string }[] };
  return (Array.isArray(j.models) ? j.models : []).map((m) => m.name || m.id || '').filter(Boolean);
}

function AgentModels({ agentRef, load }: { agentRef: string; load: AgentModelsLoader }) {
  const [names, setNames] = useState<string[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    (attempt > 0 ? load(agentRef, true) : load(agentRef)).then(
      (n) => {
        if (!live) return;
        setFailed(null);
        setNames(n);
      },
      (e: unknown) => live && setFailed(e instanceof Error && e.message ? e.message : 'no reason given'),
    );
    return () => {
      live = false;
    };
  }, [agentRef, load, attempt]);
  /* 0.1.5 G1: never a dead end. It still works (chats run it on its own default model); why, and one Retry. */
  if (failed !== null)
    return (
      <span className="sb-row-sub" data-testid="settings-agent-models-none">
        Its models could not be read right now ({failed}). Chats can still use it on its default model.{' '}
        <button type="button" className="sb-pill sb-pill-sm" data-testid="settings-agent-models-retry" onClick={() => { setFailed(null); setNames(null); setAttempt((n) => n + 1); }}>
          Retry
        </button>
      </span>
    );
  if (names === null) return <span className="sb-row-sub" data-testid="settings-agent-models-loading">Reading its models…</span>;
  if (names.length === 0) return <span className="sb-row-sub" data-testid="settings-agent-models-none">It did not list any models.</span>;
  return (
    <span className="sb-agent-models" data-testid="settings-agent-models">
      <span className="sb-copy-lab">Models on your subscription</span>
      <ul className="sb-agent-model-list">
        {names.map((n) => (
          <li key={n} className="sb-agent-model" data-testid="settings-agent-model">
            {n}
          </li>
        ))}
      </ul>
    </span>
  );
}

export function AgentsPane({ client, onboardingClient, instructionsClient, loadModels, runStore = agentRuns, catalog }: { client?: AgentsClient; onboardingClient?: OnboardingClient; instructionsClient?: InstructionsClient; loadModels?: AgentModelsLoader; runStore?: AgentRunStore; /** More agents (AgentCatalogSection): a client, or false for none. */ catalog?: CatalogClient | false }) {
  const readModels = useRef(loadModels ?? loadAgentModels).current;
  const api = useRef(client ?? createAgentsClient()).current;
  const onboarding = useRef(onboardingClient ?? createOnboardingClient()).current;
  const [rawRows, setRows] = useState<AgentRow[] | null>(null);
  /* One sign-in state (onboarding/signInState): a signed-out row just after a sign-in reads "Checking sign-in...", not a new prompt. */
  const signInVersion = useSignInVersion();
  const settled = useSettledCount();
  const rows = useMemo(
    () => (rawRows ? rawRows.map((r) => (r.status === 'signed-out' && isQuiet(r.id) ? { ...r, status: 'checking' as const, detail: undefined, signInCommand: undefined, checkingSignIn: true } : r)) : null),
    [rawRows, signInVersion],
  );
  /* What was read from the server tells the shared state which agents are signed in, and re-asks about a stale signed-out one. */
  const noteRows = (list: AgentRow[]) => {
    for (const r of list) {
      /* 'connected' only means registered, whatever the vendor says: it is no evidence of a sign-in. */
      if (r.status === 'signed-out' && isQuiet(r.id) && !isSettling(r.id)) void settleSignIn(r.id, onboarding);
    }
  };
  const [failure, setFailure] = useState<string | null>(null);
  /* True until the probe (slow: it asks each agent's own status command) has answered; the registered agents show meanwhile. */
  const [probing, setProbing] = useState(true);
  /* What the catalog says each agent is, by id: the row's one line when the agent has no version or plan to show. */
  const [blurbs, setBlurbs] = useState<Record<string, string>>({});
  const appStore = useStoreIfAny();
  /* The row whose in-app sign-in terminal is open. */
  const [signing, setSigning] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /* After a bridge install the server's probe has forgotten its answer: list again. */
  const reload = async () => {
    const answer = await api.list();
    if (answer.outcome === 'ok') {
      setRows(answer.body);
      noteRows(answer.body);
    } else setFailure(answer.message);
  };

  useEffect(() => {
    let live = true;
    let listed = false;
    /* The agents already registered answer at once; the probe fills in the rest as it returns. */
    void api.known?.().then((answer) => {
      if (live && !listed && answer.outcome === 'ok' && answer.body.length > 0) setRows(answer.body);
    });
    void api.list().then((answer) => {
      if (!live) return;
      listed = true;
      setProbing(false);
      if (answer.outcome === 'ok') {
        setRows(answer.body);
        noteRows(answer.body);
      } else setFailure(answer.message);
    });
    return () => {
      live = false;
    };
  }, [api, settled]);

  const catalogApi = useRef(catalog === false ? null : (catalog ?? createCatalogClient())).current;
  useEffect(() => {
    let live = true;
    void catalogApi?.list().then((a) => {
      if (!live || !a.ok) return;
      setBlurbs(Object.fromEntries((a.body?.agents ?? []).filter((r) => r.description).map((r) => [r.id, r.description as string])));
    }, () => undefined);
    return () => {
      live = false;
    };
  }, [catalogApi]);

  const disconnect = async (row: AgentRow) => {
    if (!api.disconnect) return;
    setBusy(row.id);
    setFailure(null);
    const answer = await api.disconnect(row);
    setBusy(null);
    if (answer.outcome === 'ok') {
      setRows(answer.body);
      /* 0.1.5 G1: the picker drops it at once, and a chat on it goes back to a model. */
      forgetAgent(runStore, row.id);
    } else setFailure(answer.message);
  };

  const connect = async (row: AgentRow) => {
    setBusy(row.id);
    setFailure(null);
    const answer = await api.connect(row);
    setBusy(null);
    if (answer.outcome === 'ok') {
      setRows((prev) => (prev ?? []).map((r) => (r.id === row.id ? answer.body : r)));
      /* Offered in the picker at once, its models asked for afresh (an old failed read does not stand). */
      if (answer.body.status === 'connected') void noteConnected(runStore, row.id, (i, init) => fetch(i, init));
    } else setFailure(answer.message);
  };

  /* The sign-in command ended: ask the probe again (it forgives a stale signed-out read), and connect if it now reads ready. */
  const signInEnded = async (row: AgentRow) => {
    const last = await settleSignIn(row.id, onboarding, undefined, { afterSignIn: true });
    if (last?.state === 'ready') {
      setSigning(null);
      await connect({ ...row, status: 'ready' });
    } else await reload();
  };

  const promptFor = (need: SetupNeed, row?: AgentRow): string =>
    agentSetupPrompt({
      need,
      ...(row ? { id: row.id, label: row.label, version: row.version ?? null, ...(row.minVersion ? { minVersion: row.minVersion } : {}), ...(row.installHint ? { installHint: row.installHint } : {}), ...(row.signInCommand ? { signInCommand: row.signInCommand } : {}) } : {}),
    });

  /* Drafts the whole setup into the chat composer, closes Settings so it can be seen, and puts the caret in the composer. It sends nothing and runs nothing. */
  const setUpInChat = (need: SetupNeed, row?: AgentRow) => {
    if (!appStore) return;
    draftIntoComposer(appStore, promptFor(need, row));
    appStore.dispatch({ type: 'shell/overlay', overlay: null });
    focusComposerSoon();
  };

  /* No agent connected and no model connected: a drafted prompt has nobody to answer it. */
  const stuck = !!appStore && rows !== null && nothingCanAnswer(rows.filter((r) => r.status === 'connected').length, appStore.getState().composer.model);
  const connectModel = () => appStore?.dispatch({ type: 'shell/overlay', overlay: { kind: 'settings', pane: 'models' } });
  /* Set up in chat when something can answer; else the prompt to copy and a way to connect a model. */
  const chatActions = (need: SetupNeed, row: AgentRow | undefined, testid: string, label: string) =>
    stuck ? (
      <>
        <CopyPromptButton text={promptFor(need, row)} className="sb-pill" testid={`${testid}-copy`} />
        <button type="button" className="sb-pill" data-testid={`${testid}-model`} onClick={connectModel}>
          Connect a model
        </button>
      </>
    ) : (
      <button type="button" className="sb-pill" data-testid={testid} {...(row ? { 'data-agent': row.id } : {})} onClick={() => setUpInChat(need, row)}>
        {label}
      </button>
    );

  /* One primary per section: only the first agent that is ready to connect gets the filled pill. */
  const firstReadyId = rows?.find((r) => r.status === 'ready')?.id ?? null;

  return (
    <>
    <section className="sb-group" data-testid="settings-agents">
      <h3 className="sb-lab">Coding agents</h3>
      <div className="sb-card">
        <p className="sb-hint">The agents on this machine a chat can hand work to.</p>
        {rows === null && failure === null && probing ? (
          <p className="sb-note" data-testid="settings-agents-loading">
            Looking for agents…
          </p>
        ) : null}
        {rows !== null && rows.length === 0 ? (
          <p className="sb-note" data-testid="settings-agents-none">
            No coding agent was found on this machine.
          </p>
        ) : null}
        {rows !== null && rows.length > 0 ? (
          <ul className="sb-list" data-testid="settings-agents-list">
            {rows.map((row) => (
              <li key={row.id} className="sb-row sb-agent" data-testid="settings-agent" data-agent={row.id} data-status={row.status}>
                <span className="sb-agent-ic" aria-hidden="true">
                  <ProviderIcon provider={brandOf(row.id, row.label)} />
                </span>
                <span className="sb-row-txt">
                  <span className="sb-row-t">{row.label}</span>
                  <span className="sb-row-sub">
                    {row.status === 'checking' && (row as { checkingSignIn?: boolean }).checkingSignIn ? 'Checking sign-in...' : row.needsUpdate ? updateSentence(row) : row.status === 'adapter' ? STATUS_SUB.adapter : agentSub(row, blurbs[row.id])}
                  </span>
                  {row.status === 'signed-out' ? (
                    <span className="sb-agent-acts">
                      <button type="button" className="sb-pill sb-pill-solid" data-testid="settings-agent-signin" aria-expanded={signing === row.id} onClick={() => setSigning((cur) => (cur === row.id ? null : row.id))}>
                        {signing === row.id ? 'Hide sign-in' : 'Sign in'}
                      </button>
                    </span>
                  ) : null}
                  {signing === row.id && row.status === 'signed-out' ? (
                    <span className="sb-agent-term" data-testid="settings-agent-terminal">
                      <TerminalPane signIn={row.id} onExit={() => void signInEnded(row)} />
                    </span>
                  ) : null}
                  {appStore && row.status === 'signed-out' && signing === row.id ? (
                    <span className="sb-agent-acts">{chatActions('signIn', row, 'settings-agent-chat', 'Set up in chat')}</span>
                  ) : null}
                  {row.status === 'connected' ? <AgentModels agentRef={row.id} load={readModels} /> : null}
                  {row.status === 'adapter' || row.needsBridge ? (
                    <BridgeInstall provider={row.id} client={onboarding} buttonClass="sb-pill sb-pill-solid" onInstalled={() => void reload()} />
                  ) : null}
                </span>
                <span className="sb-badge" data-state={row.status} data-testid="settings-agent-status">
                  {STATUS_WORD[row.status]}
                </span>
                {/* One primary action per row, in the fixed action column: an agent that is not here or will not read gets the chat route. */}
                {appStore && (row.status === 'not-installed' || row.status === 'attention') ? (
                  <span className="sb-catalog-acts sb-agent-acts">
                    {chatActions(row.status === 'not-installed' ? 'install' : row.needsUpdate ? 'update' : 'attention', row, 'settings-agent-chat', row.needsUpdate ? 'Update in chat' : 'Set up in chat')}
                  </span>
                ) : null}
                {row.status === 'ready' || row.status === 'signed-out' || (row.status === 'attention' && !appStore) ? (
                  <button
                    type="button"
                    className={row.status === 'ready' && row.id === firstReadyId ? 'sb-pill sb-pill-solid' : 'sb-pill'}
                    data-testid="settings-agent-connect"
                    data-agent={row.id}
                    disabled={busy !== null}
                    title={row.status === 'ready' ? undefined : 'Try again once it is signed in'}
                    onClick={() => void connect(row)}
                  >
                    {busy === row.id ? 'Connecting…' : 'Connect'}
                  </button>
                ) : null}
                {row.status === 'connected' && api.disconnect ? (
                  <button
                    type="button"
                    className="sb-pill"
                    data-testid="settings-agent-disconnect"
                    data-agent={row.id}
                    disabled={busy !== null}
                    title="Chats stop handing it work; Connect brings it back"
                    onClick={() => void disconnect(row)}
                  >
                    {busy === row.id ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {rows !== null && probing ? (
          <p className="sb-note" data-testid="settings-agents-probing">
            Checking for more agents…
          </p>
        ) : null}
        {appStore ? (
          <p className="sb-note">
            {chatActions(
              rows !== null && rows.length === 0 ? 'none' : 'another',
              undefined,
              'settings-agents-add',
              rows !== null && rows.length === 0 ? 'Set up in chat' : 'Add another agent in chat',
            )}
          </p>
        ) : null}
        {failure !== null ? (
          <p className="sb-fail" role="alert" data-testid="settings-agents-failure">
            {failure}
          </p>
        ) : null}
      </div>
    </section>
    {catalog === false ? null : <AgentCatalogSection {...(catalog ? { client: catalog } : {})} />}
    <section className="sb-group" data-testid="settings-instructions-group">
      <h3 className="sb-lab">Instructions</h3>
      {catalog === false ? null : <SharedMemorySection nested />}
      <InstructionsEditor nested client={instructionsClient} />
    </section>
    </>
  );
}

export default AgentsPane;
