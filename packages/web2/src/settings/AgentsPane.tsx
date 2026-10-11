/* ══════════════════════════════════════════════════════════════════════════
   SETTINGS › AGENTS
   packages/web2/src/settings/AgentsPane.tsx

   The coding agents this machine has (Codex, Claude Code, and any other
   registered one), each with its state in words (never a colour alone) and
   the one act it allows: Connect when it is ready and not yet connected,
   Disconnect once it is (DELETE /api/acp/agents/:id). A signed-out or missing
   agent shows its own sign-in or install command as text to copy; Sequence
   runs nothing and downloads nothing from here.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useRef, useState } from 'react';

import { ProviderIcon, providerOf } from '../shell2/brandIcons';
import { agentRuns, type AgentRunStore } from '../agents/agentRuns';
import { forgetAgent, noteConnected } from '../agents/agentRegistry';
import { createAgentsClient, type AgentRow, type AgentStatus, type AgentsClient } from './agentsClient';
import { BridgeInstall } from '../onboarding/BridgeInstall';
import { InstructionsEditor } from './InstructionsEditor';
import type { InstructionsClient } from './instructionsClient';
import { createOnboardingClient, type OnboardingClient } from '../onboarding/onboardingClient';
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
  'signed-out': 'Installed, but signed out. Sign in from a terminal, then connect.',
  'not-installed': 'Not found on this machine.',
  adapter: "Sequence talks to Claude Code through a small bridge called claude-agent-acp. It isn't installed yet.",
  attention: 'Its own status command did not answer cleanly.',
  checking: 'Looking at this machine…',
};

/* Signed out and no bridge: both steps on the row (UX study 2026-10-09). */
const BRIDGE_AND_SIGNIN = "Installed, but signed out, and the small bridge Sequence talks to it through (claude-agent-acp) isn't installed yet. Install the bridge, then sign in from a terminal.";

function Copyable({ label, command, testid }: { label: string; command: string; testid: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="sb-copy" data-testid={testid}>
      <span className="sb-copy-lab">{label}</span>
      <code className="sb-copy-cmd">{command}</code>
      <button
        type="button"
        className="sb-pill sb-pill-sm"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
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

export function AgentsPane({ client, onboardingClient, instructionsClient, loadModels, runStore = agentRuns }: { client?: AgentsClient; onboardingClient?: OnboardingClient; instructionsClient?: InstructionsClient; loadModels?: AgentModelsLoader; runStore?: AgentRunStore }) {
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
    void api.list().then((answer) => {
      if (!live) return;
      if (answer.outcome === 'ok') {
        setRows(answer.body);
        noteRows(answer.body);
      } else setFailure(answer.message);
    });
    return () => {
      live = false;
    };
  }, [api, settled]);

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

  /* One primary per section: only the first agent that is ready to connect gets the filled pill. */
  const firstReadyId = rows?.find((r) => r.status === 'ready')?.id ?? null;

  return (
    <>
    <section className="sb-group" data-testid="settings-agents">
      <h3 className="sb-lab">Coding agents</h3>
      <div className="sb-card">
        <p className="sb-hint">The agents on this machine a chat can hand work to.</p>
        {rows === null && failure === null ? (
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
                  <ProviderIcon provider={providerOf(row.id, row.label)} />
                </span>
                <span className="sb-row-txt">
                  <span className="sb-row-t">{row.label}</span>
                  <span className="sb-row-sub">
                    {row.status === 'checking' && (row as { checkingSignIn?: boolean }).checkingSignIn ? 'Checking sign-in...' : row.status === 'adapter' ? STATUS_SUB.adapter : (row.detail ? `${row.detail}. ` : '') + (row.needsBridge ? BRIDGE_AND_SIGNIN : STATUS_SUB[row.status])}
                  </span>
                  {row.status === 'signed-out' && row.signInCommand ? (
                    <Copyable label="Sign in with" command={row.signInCommand} testid="settings-agent-signin" />
                  ) : null}
                  {row.status === 'not-installed' && row.installHint ? (
                    <Copyable label="Install with" command={row.installHint} testid="settings-agent-install" />
                  ) : null}
                  {row.status === 'connected' ? <AgentModels agentRef={row.id} load={readModels} /> : null}
                  {row.status === 'adapter' || row.needsBridge ? (
                    <BridgeInstall provider={row.id} client={onboarding} buttonClass="sb-pill sb-pill-solid" onInstalled={() => void reload()} />
                  ) : null}
                </span>
                <span className="sb-badge" data-state={row.status} data-testid="settings-agent-status">
                  {STATUS_WORD[row.status]}
                </span>
                {row.status === 'ready' || row.status === 'signed-out' || row.status === 'attention' ? (
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
        {failure !== null ? (
          <p className="sb-fail" role="alert" data-testid="settings-agents-failure">
            {failure}
          </p>
        ) : null}
      </div>
    </section>
    <InstructionsEditor client={instructionsClient} />
    </>
  );
}

export default AgentsPane;
