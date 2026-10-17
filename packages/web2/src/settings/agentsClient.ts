/* ══════════════════════════════════════════════════════════════════════════
   THE CODING AGENTS SETTINGS LISTS, AND CONNECTS
   packages/web2/src/settings/agentsClient.ts

   One small client the Agents pane talks to, so the routes live in one place:

     GET  /api/onboarding/providers   which agent CLIs are on this machine, and
                                      whether each is installed and signed in
     GET  /api/acp/agents             the agents already registered (connected)
     POST /api/acp/agents/connect     { provider } registers a ready one; a
                                      signed-out, missing or adapter-less one
                                      is refused with its state (409)
     DELETE /api/acp/agents/:id       Disconnect: removes the registration
                                      (what `sequence agent remove` does)

   NOTHING IS RUN AND NOTHING IS DOWNLOADED from here: a sign-in command or an
   install hint is shown as text to copy.
   ══════════════════════════════════════════════════════════════════════════ */

import { resetLabel } from '../onboarding/onboardingClient';

export const PROVIDERS_ROUTE = '/api/onboarding/providers';
export const AGENTS_ROUTE = '/api/acp/agents';
export const CONNECT_ROUTE = '/api/acp/agents/connect';

export type AgentStatus = 'connected' | 'ready' | 'limited' | 'signed-out' | 'not-installed' | 'adapter' | 'attention' | 'checking';

export interface AgentRow {
  id: string;
  label: string;
  status: AgentStatus;
  /** One line under the name: the version, the plan, or what is missing. */
  detail?: string;
  /** The vendor's own sign-in command, shown to copy, never run. */
  signInCommand?: string;
  /** The official install command, shown to copy, never run. */
  installHint?: string;
  /** Signed out AND the bridge is missing: the pane offers Install bridge beside the sign-in command. */
  needsBridge?: boolean;
  /** The agent is older than Sequence can drive (the probe's `update` state). The latest version is not known here. */
  needsUpdate?: boolean;
  /** What the probe read and the oldest it can drive, for the update prompt. */
  version?: string;
  minVersion?: string;
}

export type AgentsAnswer<T> = { outcome: 'ok'; body: T } | { outcome: 'failed'; message: string };

export interface AgentsClient {
  list(): Promise<AgentsAnswer<AgentRow[]>>;
  /** Register a provider. A refusal that names a state comes back as the row
   *  in that state, so the pane shows it as a status, not an error. */
  connect(row: AgentRow): Promise<AgentsAnswer<AgentRow>>;
  /** Remove a connected agent's registration; the answer is the list as it now stands. */
  /** Only the agents already registered (one fast read, no probe): the pane shows them while the probe runs. */
  known?(): Promise<AgentsAnswer<AgentRow[]>>;
  disconnect?(row: AgentRow): Promise<AgentsAnswer<AgentRow[]>>;
}

interface ProviderStatusWire {
  id: string;
  label: string;
  installed: boolean;
  version: string | null;
  state: 'checking' | 'install' | 'signIn' | 'ready' | 'adapter' | 'limited' | 'attention' | 'preparing' | 'update';
  setupBytes?: number;
  minVersion?: string;
  limitResetsAt?: number;
  signInCommand: string;
  installHint: string;
  plan?: string;
  adapterInstall?: string;
}

const ADAPTER_NOTE = "Sequence talks to Claude Code through a small bridge called claude-agent-acp. It isn't installed yet.";

function fromProbe(p: ProviderStatusWire, registered: ReadonlySet<string>): AgentRow {
  const facts = [p.version ? `v${p.version}` : null, p.plan ?? null].filter(Boolean).join(', ');
  const base = { id: p.id, label: p.label, ...(facts ? { detail: facts } : {}) };
  if (registered.has(p.id)) return { ...base, status: 'connected' };
  switch (p.state) {
    case 'ready':
      return { ...base, status: 'ready' };
    case 'signIn':
      return { ...base, status: 'signed-out', signInCommand: p.signInCommand, ...(p.adapterInstall ? { needsBridge: true } : {}) };
    case 'install':
      return { ...base, status: 'not-installed', installHint: p.installHint };
    /* Round 7 (A4): signed in, but no bridge: not Ready, and says why. */
    case 'adapter':
      return { ...base, status: 'adapter', detail: ADAPTER_NOTE };
    /* Round 7: signed in, but its usage limit is spent until the reset the last turn reported. */
    case 'limited':
      return { ...base, status: 'limited', ...(p.limitResetsAt ? { detail: `Usage limit, resets ${resetLabel(p.limitResetsAt)}` } : {}) };
    case 'checking':
      return { ...base, status: 'checking' };
    case 'preparing':
      return { ...base, status: 'checking', detail: 'Setting up Claude' };
    case 'update':
      return { ...base, status: 'attention', detail: 'Update Claude Code', signInCommand: p.signInCommand, needsUpdate: true, ...(p.version ? { version: p.version } : {}), ...(p.minVersion ? { minVersion: p.minVersion } : {}) };
    default:
      return { ...base, status: 'attention', signInCommand: p.signInCommand };
  }
}

/** The probe's providers, marked connected where registered, then any other
 *  registered agent the probe does not know. */
/** A registered agent's launch command is a program path (often cmd.exe for a .cmd shim): never words for a row. */
export function isCommandPath(text: string): boolean {
  return /[\/]/.test(text) || /\.(exe|cmd|bat|ps1|sh)$/i.test(text.trim()) || /^(cmd|node|npx|powershell|pwsh|bash|sh)(\s|$)/i.test(text.trim());
}

export function agentRows(
  providers: readonly ProviderStatusWire[],
  registered: readonly { id: string; label?: string; command?: string }[],
): AgentRow[] {
  const ids = new Set(registered.map((a) => a.id));
  const rows = providers.map((p) => fromProbe(p, ids));
  for (const a of registered) {
    if (!providers.some((p) => p.id === a.id)) rows.push({ id: a.id, label: a.label ?? a.id, status: 'connected', ...(a.command && !isCommandPath(a.command) ? { detail: a.command } : {}) });
  }
  return rows;
}

async function json(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

export function createAgentsClient(fetchImpl: typeof fetch = globalThis.fetch): AgentsClient {
  return {
    async list() {
      try {
        const [probe, agents] = await Promise.all([fetchImpl(PROVIDERS_ROUTE), fetchImpl(AGENTS_ROUTE)]);
        const providers = probe.ok ? (((await json(probe)) as { providers?: ProviderStatusWire[] } | null)?.providers ?? []) : [];
        const registered = agents.ok ? (((await json(agents)) as { agents?: { id: string; label?: string; command?: string }[] } | null)?.agents ?? []) : [];
        if (!probe.ok && !agents.ok) {
          const reason = ((await json(agents)) as { error?: string } | null)?.error;
          return { outcome: 'failed', message: reason ?? 'Sequence could not read the agents on this machine.' };
        }
        return { outcome: 'ok', body: agentRows(providers, registered) };
      } catch {
        return { outcome: 'failed', message: 'The server could not be reached.' };
      }
    },
    async known() {
      try {
        const agents = await fetchImpl(AGENTS_ROUTE);
        if (!agents.ok) return { outcome: 'failed', message: 'Sequence could not read the agents on this machine.' };
        const registered = ((await json(agents)) as { agents?: { id: string; label?: string; command?: string }[] } | null)?.agents ?? [];
        return { outcome: 'ok', body: agentRows([], registered) };
      } catch {
        return { outcome: 'failed', message: 'The server could not be reached.' };
      }
    },
    async disconnect(row) {
      try {
        const res = await fetchImpl(`${AGENTS_ROUTE}/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
        if (!res.ok) {
          const body = (await json(res)) as { error?: string } | null;
          return { outcome: 'failed', message: body?.error ?? `The server answered ${res.status}.` };
        }
        return this.list();
      } catch {
        return { outcome: 'failed', message: 'The server could not be reached.' };
      }
    },
    async connect(row) {
      try {
        const res = await fetchImpl(CONNECT_ROUTE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: row.id }),
        });
        const body = (await json(res)) as {
          error?: string;
          state?: string;
          signInCommand?: string;
          installHint?: string;
        } | null;
        if (res.ok) return { outcome: 'ok', body: { ...row, status: 'connected', signInCommand: undefined, installHint: undefined } };
        if (res.status === 409 && body?.state) {
          if (body.state === 'signIn') return { outcome: 'ok', body: { ...row, status: 'signed-out', signInCommand: body.signInCommand } };
          if (body.state === 'install') return { outcome: 'ok', body: { ...row, status: 'not-installed', installHint: body.installHint } };
          if (body.state === 'adapter') return { outcome: 'ok', body: { ...row, status: 'adapter', detail: ADAPTER_NOTE } };
          return { outcome: 'ok', body: { ...row, status: 'attention', detail: body.error ?? row.detail, signInCommand: body.signInCommand } };
        }
        if (res.status === 404) return { outcome: 'failed', message: `Sequence does not know an agent called ${row.label}.` };
        return { outcome: 'failed', message: body?.error ?? `The server answered ${res.status}.` };
      } catch {
        return { outcome: 'failed', message: 'The server could not be reached.' };
      }
    },
  };
}
