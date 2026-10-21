/* The agents panel on a scripted Claude Code session: a main agent that
   edits across two services, an Explore sub-agent that reads and runs a
   failing command, and a running edit at the end. `?view=timeline` opens the
   timeline. Not part of the app build (see specimen.html). */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../tokens/graphite.css';
import '../styles/base.css';
import './agents.css';

import { AgentsPanel } from './AgentsPanel.js';
import { createAgentStore } from './agentStream.js';
import type { AgentEvent } from './agentTypes.js';

const T0 = Date.now() - 95_000;
let seq = 0;
const ev = (dt: number, e: Partial<AgentEvent> & Pick<AgentEvent, 'kind'>): AgentEvent => ({
  id: `e${++seq}`,
  at: T0 + dt,
  source: 'claude-hook',
  sessionId: 'b7c1e2f0',
  paths: [],
  status: 'done',
  ...e,
});
const hit = (path: string, svc: string) => [{ path, fileNodeId: `file:${path}`, moduleId: null, serviceId: `svc:${svc}`, serviceLabel: svc, touchedEdgeIds: [], liftedEdges: [] }];
const call = (t: number, d: number, id: string, tool: string, kind: AgentEvent['toolKind'], title: string, extra: Partial<AgentEvent> = {}, end = true): AgentEvent[] => [
  ev(t, { kind: 'tool_start', tool, toolKind: kind, toolUseId: id, status: 'running', title, ...extra }),
  ...(end ? [ev(t + d, { kind: 'tool_end', tool, toolKind: kind, toolUseId: id, title, ...extra })] : []),
];

const store = createAgentStore(() => null);
[
  ev(0, { kind: 'session_start', status: 'running' }),
  ...call(1_000, 1_200, 'r1', 'Read', 'read', 'Read orders/app/db.py', { paths: ['orders/app/db.py'], board: hit('orders/app/db.py', 'orders') }),
  ...call(3_000, 2_400, 'e1', 'Edit', 'edit', 'Edit orders/app/db.py', { paths: ['orders/app/db.py'], board: hit('orders/app/db.py', 'orders'), tokens: 1_840 }),
  ev(6_000, { kind: 'subagent_start', agentId: 'x1', title: 'Explore', status: 'running' }),
  ...call(7_000, 3_000, 's1', 'Grep', 'search', 'Grep: payments_client', { agentId: 'x1' }),
  ...call(11_000, 4_000, 'r2', 'Read', 'read', 'Read payments/src/db.js', { agentId: 'x1', paths: ['payments/src/db.js'], board: hit('payments/src/db.js', 'payments') }),
  ...call(16_000, 9_000, 'b1', 'Bash', 'execute', 'Bash: npm test', { agentId: 'x1' }),
  ev(25_100, { kind: 'subagent_stop', agentId: 'x1', title: 'Explore' }),
  ...call(27_000, 5_000, 'e2', 'Edit', 'edit', 'Edit payments/src/db.js', { paths: ['payments/src/db.js'], board: hit('payments/src/db.js', 'payments'), tokens: 2_310 }),
  ...call(33_000, 21_000, 'b2', 'Bash', 'execute', 'Bash: pytest orders', { status: 'done' }),
  ...call(56_000, 0, 'w1', 'Write', 'edit', 'Write orders/app/models.py', { paths: ['orders/app/models.py'], board: hit('orders/app/models.py', 'orders') }, false),
]
  .map((e) => (e.toolUseId === 'b1' && e.kind === 'tool_end' ? { ...e, status: 'failed' as const } : e))
  .forEach((e) => store.apply(e));
store.focus('tool:b7c1e2f0:e2');

const view = new URLSearchParams(location.search).get('view') === 'timeline' ? 'timeline' : 'tree';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div style={{ width: 480, height: '100vh' }}>
      <AgentsPanel store={store} initialView={view} />
    </div>
  </StrictMode>,
);
