/* The parts the live shell only shows in a state, drawn on fixtures so each can
   be looked at in both rooms (round 9, ask 32). Not part of the app build (see
   auditGallery.html). */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import '../tokens/graphite.css';
import '../styles/base.css';
import '../chat/chat.css';
import '../worktree/worktree.css';
import '../composer/promptQueue.css';
import '../onboarding/onboarding.css';
import '../review/review.css';
import '../rewind/rewind.css';
import '../v3/v3.css';
import './shell2.css';
import './chat2.css';
import './edits.css';
import './pages.css';

import { AgentApprovalCard } from '../chat/EditApprovalCardAgent';
import { EditApprovalCard } from '../chat/EditApprovalCard';
import { RecoveryCard } from '../chat/RecoveryCard';
import { createPromptQueue } from '../composer/promptQueue';
import { PromptQueueList } from '../composer/PromptQueueList';
import { AgentTurns } from '../rewind/AgentTurns';
import type { TurnsClient } from '../review/turnsClient';
import { PlanApprovalCard } from '../v3/PlanApprovalCard';
import MergePanel from '../worktree/MergePanel';
import { WorktreeChip } from '../worktree/WorktreeChip';
import WorktreeSettings from '../worktree/WorktreeSettings';
import { BridgeInstall } from '../onboarding/BridgeInstall';
import { BrowserPane } from '../browser/BrowserPane';
import { StoreProvider, createStore } from '../state';

const q = new URLSearchParams(location.search);
const theme = q.get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.setAttribute('data-theme', theme);
const only = q.get('only') ?? '';

const DIFF = [
  'diff --git a/src/server/limiter.ts b/src/server/limiter.ts',
  '--- a/src/server/limiter.ts',
  '+++ b/src/server/limiter.ts',
  '@@ -10,4 +10,5 @@ export function limit(req: Request) {',
  '   const hits = store.get(key) ?? 0;',
  "-  if (hits > 100) return deny('slow down');",
  "+  if (hits > LIMIT) return deny('rate limited');",
  '+  store.set(key, hits + 1);',
  '   return allow();',
  '',
].join('\n');

const worktree = {
  id: 'w1',
  path: 'C:/work/gateway-wt',
  branch: 'sequence/rate-limit-1a2b',
  baseCommit: 'abc1234',
  baseBranch: 'main',
  createdAt: '2026-10-07T10:00:00Z',
};

const json = (body: unknown): Promise<Response> => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
const fakeFetch = (input: string): Promise<Response> => {
  if (input.includes('/dry-run'))
    return json({ ok: true, target: 'main', targetHead: 'def5678', files: [{ path: 'src/server/limiter.ts', status: 'modified' }, { path: 'src/server/config.ts', status: 'added' }], conflicts: [], worktreeDirty: false, mainUncommitted: [], method: 'merge-tree' });
  if (input.includes('/api/worktree-settings')) return json({ cap: 8, setupCommand: null, suggestion: 'pnpm install' });
  return json({});
};

const turnsClient = {
  sessions: async () => ({ outcome: 'ok', body: { sessions: [{ sessionId: 's1', turns: 3, lastAt: Date.now(), reverted: false }] } }),
  turns: async () => ({
    outcome: 'ok',
    body: {
      sessionId: 's1',
      turns: [
        { seq: 1, label: 'Add rate limiting to the gateway', at: Date.now() - 3600_000, files: ['src/server/limiter.ts', 'src/server/config.ts'] },
        { seq: 2, label: 'Fix the retry header', at: Date.now() - 1800_000, files: ['src/server/limiter.ts'] },
        { seq: 3, label: 'Write tests for the limiter', at: Date.now() - 600_000, files: ['src/server/limiter.test.ts'] },
      ],
    },
  }),
  files: async () => ({ outcome: 'ok', body: { files: [] } }),
  diff: async () => ({ outcome: 'ok', body: { diff: '' } }),
  revert: async () => ({ outcome: 'ok', body: { seq: 1, files: [] } }),
  undo: async () => ({ outcome: 'ok', body: { restored: [] } }),
  revertHunk: async () => ({ outcome: 'ok', body: { ok: true, path: '' } }),
} as unknown as TurnsClient;

const emptyClient = {
  ...(turnsClient as object),
  sessions: async () => ({ outcome: 'ok', body: { sessions: [] } }),
} as unknown as TurnsClient;

const queue = createPromptQueue();
queue.add('k', 'Then run the full test suite and report what fails');
queue.add('k', 'Open a PR with a short description');

const agentApproval = {
  id: 'a1',
  runId: 'r1',
  title: 'Run pnpm test --filter gateway',
  decision: null,
  sending: null,
  always: 'pnpm',
  proposal: { id: 'p1', title: 'Run pnpm test --filter gateway', rationale: null, files: [], status: 'pending' },
} as never;

const failedRun = {
  id: 'r1',
  status: 'failed',
  error: 'claude stopped before it answered',
  agentRef: 'claude',
  recovery: { kind: 'retry' },
  retry: { text: 'again' },
} as never;

function Section({ id, title, children, wide }: { id: string; title: string; children: React.ReactNode; wide?: boolean }) {
  if (only && only !== id) return null;
  return (
    <section style={{ width: wide ? 760 : 460 }} data-gallery={id}>
      <h4 style={{ margin: '0 0 8px', font: 'inherit', color: 'var(--ink-3)' }}>{title}</h4>
      {children}
    </section>
  );
}

function Gallery() {
  const [, force] = useState(0);
  void force;
  return (
    <div className="s2 s2-gallery v3-scaffold" style={{ minHeight: '100vh', padding: 24, display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start', overflow: 'auto', background: 'var(--bg-base)' }}>
      <Section id="plan" title="Plan approval">
        <PlanApprovalCard
          goalName="Rate limiting for the gateway"
          steps={[
            { id: 's1', text: 'Add a limiter module with a sliding window', status: 'open' },
            { id: 's2', text: 'Wire it into the request handler', status: 'open' },
            { id: 's3', text: 'Cover it with tests', status: 'open' },
          ] as never}
          hasDocument={false}
          onBuild={() => undefined}
          onKeepPlanning={() => undefined}
        />
      </Section>
      <Section id="edit" title="Edit approval (proposal card)">
        <EditApprovalCard
          proposalId="p1"
          title="Rate limit the gateway"
          rationale="Requests over the window are denied with a retry hint."
          files={[{ path: 'src/server/limiter.ts', diff: DIFF, decision: 'pending' }]}
          onDecideFile={() => undefined}
        />
      </Section>
      <Section id="agent-approval" title="Agent approval">
        <StoreProvider store={createStore({})}>
          <AgentApprovalCard approval={agentApproval} onAnswer={() => undefined} />
        </StoreProvider>
      </Section>
      <Section id="recovery" title="Recovery card">
        <RecoveryCard run={failedRun} onRetry={() => undefined} />
      </Section>
      <Section id="queue" title="Prompt queue">
        <PromptQueueList queueKey="k" queue={queue} />
      </Section>
      <Section id="worktree" title="Worktree chip, merge panel">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <WorktreeChip worktree={worktree} />
          <MergePanel sessionId="s1" worktree={worktree} onClose={() => undefined} onChanged={() => undefined} fetchImpl={fakeFetch} />
        </div>
      </Section>
      <Section id="worktree-settings" title="Worktree settings">
        <WorktreeSettings fetchImpl={fakeFetch} />
      </Section>
      <Section id="rewind" title="Rewind: agent turns">
        <div className="rewind-scope">
          <AgentTurns client={turnsClient} chatId={null} fetchImpl={fakeFetch} />
        </div>
      </Section>
      <Section id="rewind-empty" title="Rewind: empty state">
        <div className="rewind-scope">
          <AgentTurns client={emptyClient} chatId={null} fetchImpl={fakeFetch} />
        </div>
      </Section>
      <Section id="browser" title="Browser pane (surface is hidden until it ships)">
        <div style={{ height: 220, display: "flex", flexDirection: "column", border: "1px solid var(--edge)", borderRadius: 16, overflow: "hidden" }}>
          <BrowserPane />
        </div>
      </Section>
      <Section id="bridge" title="Bridge install">
        <BridgeInstall provider="codex" client={{ installBridge: async () => ({ ok: true, body: { state: 'idle' } }), bridgeStatus: async () => ({ ok: true, body: { state: 'idle' } }) }} onInstalled={() => undefined} />
      </Section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
