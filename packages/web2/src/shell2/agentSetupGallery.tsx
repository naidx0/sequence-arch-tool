/* The agent setup places, drawn on fixtures so each can be looked at in both rooms (0.1.6.1 S3). Not part of the app build. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../tokens/graphite.css';
import '../styles/base.css';
import '../chat/chat.css';
import '../onboarding/onboarding.css';
import '../settings/settings.css';
import '../v3/v3.css';
import './shell2.css';
import './chat2.css';
import './modelMenu.css';

import { ActivityPane } from '../activity/ActivityPane';
import { acpReadinessActions, acpReadinessNote } from '../activity/acpReadiness';
import { createAgentRunStore } from '../agents/agentRuns';
import { FirstRun } from '../onboarding/FirstRun';
import type { OnboardingClient, ProviderStatus } from '../onboarding/onboardingClient';
import { AgentsPane } from '../settings/AgentsPane';
import type { AgentRow, AgentsClient } from '../settings/agentsClient';
import { StoreProvider, createStore } from '../state';
import { ConnectAgents } from './ConnectAgents';

const q = new URLSearchParams(location.search);
document.documentElement.setAttribute('data-theme', q.get('theme') === 'light' ? 'light' : 'dark');
const only = q.get('only') ?? '';

const P = (id: string, label: string, state: ProviderStatus['state'], extra: Partial<ProviderStatus> = {}): ProviderStatus => ({
  id,
  label,
  installed: state !== 'install',
  version: state === 'install' ? null : '2.0.5',
  state,
  signInCommand: `${id} login`,
  installHint: `npm install -g ${id}`,
  ...extra,
});
const mix = [P('claude', 'Claude Code', 'update', { minVersion: '2.1.0' }), P('codex', 'Codex', 'signIn'), P('gemini', 'Gemini CLI', 'install'), P('hermes', 'Hermes', 'ready', { plan: 'Pro' })];
const onboarding = (list: ProviderStatus[]): OnboardingClient => ({ providers: async () => ({ ok: true, body: list }), repos: async () => ({ ok: true, body: { repos: [], truncated: false } }) });
const emptyAgents = ((): Promise<Response> => Promise.resolve(new Response(JSON.stringify({ agents: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))) as unknown as typeof fetch;

const rows: AgentRow[] = [
  { id: 'hermes', label: 'Hermes', status: 'connected', detail: 'v0.45.0, Pro' },
  { id: 'codex', label: 'Codex', status: 'signed-out', signInCommand: 'codex login' },
  { id: 'claude', label: 'Claude Code', status: 'attention', detail: 'Update Claude Code', needsUpdate: true, version: '2.0.5', minVersion: '2.1.0' },
  { id: 'gemini', label: 'Gemini CLI', status: 'not-installed', installHint: 'npm install -g gemini' },
];
const agentsClient: AgentsClient = {
  list: async () => ({ outcome: 'ok', body: rows }),
  connect: async (row) => ({ outcome: 'ok', body: { ...row, status: 'connected' } }),
  disconnect: async () => ({ outcome: 'ok', body: rows }),
};

function Section({ id, title, children, wide }: { id: string; title: string; children: React.ReactNode; wide?: boolean }) {
  if (only && only !== id) return null;
  return (
    <section style={{ width: wide ? 900 : 440 }} data-gallery={id}>
      <h4 style={{ margin: '0 0 8px', font: 'inherit', color: 'var(--ink-3)' }}>{title}</h4>
      {children}
    </section>
  );
}

const app = createStore({});
const stubFetch = (async (i: string) => new Response(JSON.stringify(i.includes('providers') ? { providers: mix } : {}), { status: 200 })) as unknown as typeof fetch;
void stubFetch;

function Gallery() {
  const note = acpReadinessNote({ kind: 'no-agents' });
  return (
    <StoreProvider store={app}>
      <div className="s2 s2-gallery v3-scaffold" style={{ minHeight: '100vh', padding: 24, display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start', background: 'var(--bg-base)' }}>
        <Section id="menu" title="Model picker: Connect an agent">
          <div className="s2-menu" style={{ position: 'static', width: 420 }}>
            <div className="s2-menu-sec">
              <p className="s2-gh s2-menu-gh">Connect an agent</p>
              <ConnectAgents inSection sessionId="s1" fetchImpl={emptyAgents} store={createAgentRunStore()} onboarding={onboarding(mix)} />
            </div>
          </div>
        </Section>
        <Section id="settings" title="Settings: Coding agents" wide>
          <div className="settings-scope" style={{ width: 640 }}>
            <AgentsPane client={agentsClient} onboardingClient={onboarding(mix)} loadModels={async () => ['gpt-5.6']} />
          </div>
        </Section>
        <Section id="firstrun" title="First run" wide>
          <div style={{ position: 'relative', width: 760, height: 520, overflow: 'auto' }}>
            <FirstRun client={onboarding([P('claude', 'Claude Code', 'install'), P('codex', 'Codex', 'update', { minVersion: '0.200.0' })])} onDone={() => undefined} onAskAgent={() => undefined} />
          </div>
        </Section>
        <Section id="workflows" title="Workflows: no agent" wide>
          <div style={{ width: 760, height: 460, position: 'relative' }}>
            <ActivityPane runs={[]} now={Date.now()} filter="all" onFilter={() => undefined} onOpen={() => undefined} onCloseRun={() => undefined} authoring onStart={() => undefined} onAuthorCancel={() => undefined} acpNotice={note} acpActions={acpReadinessActions({ kind: 'no-agents' }, app)} startBlockedReason="Connect an agent first" />
          </div>
        </Section>
      </div>
    </StoreProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
