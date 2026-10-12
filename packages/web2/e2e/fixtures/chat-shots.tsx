/* Dev-server fixture for chat screenshots (not part of the build). Open /e2e/fixtures/chat-shots.html?theme=light&mode=tool. */
import { createRoot } from 'react-dom/client';

import '../../src/tokens/graphite.css';
import '../../src/styles/base.css';
import '../../src/chat/chat.css';
import '../../src/v3/v3.css';
import '../../src/shell2/shell2.css';
import '../../src/shell2/chat2.css';
import { foldRunEvent } from '../../src/agents/agentRunFold';
import type { AgentRun } from '../../src/agents/agentRuns';
import type { RunNodeEvent } from '../../src/agents/runNodeStream';
import { AgentRunView } from '../../src/chat/AgentRunThread';

const q = new URLSearchParams(location.search);
document.documentElement.setAttribute('data-theme', q.get('theme') === 'light' ? 'light' : 'dark');

const upd = (update: Record<string, unknown>): RunNodeEvent => ({ type: 'acp:update', update: { sessionId: 's', update } });
const T = (id: string, title: string, kind: string, done = true): RunNodeEvent[] => [
  upd({ sessionUpdate: 'tool_call', toolCallId: id, title, kind, status: 'in_progress', rawInput: {} }),
  ...(done ? [upd({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed' })] : []),
];
const ANSWER = `## What changed

I traced the stall to the **bridge holding the turn open**. Three fixes:

1. The queued send now emits a *queued* signal
2. Stop asks the server, not only the bridge
3. Every turn writes a short log

### Results

| Check | Before | After |
| --- | :---: | ---: |
| Stop frees the chat | no | yes |
| Titles saved | no | yes |

> The log has no words from the agent, only events.

\`\`\`ts
export function livePhrase(run: AgentRun, now: number) {
  return run.live ? run.live.phase : null;
}
\`\`\`

Run \`pnpm test\` to confirm.`;

const base: AgentRun = { id: 'r1', sessionId: null, agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: 'Why does Claude stall silently?', status: 'running', startedAt: 0, endedAt: null, items: [], approvals: [], error: null };
const mode = q.get('mode') ?? 'done';
let run = base;
const at0 = Date.now() - 60_000;
let t = at0;
const feed = (evs: RunNodeEvent[], gap = 900) => {
  for (const e of evs) {
    t += gap;
    run = foldRunEvent(run, e, t);
  }
};
feed([upd({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Looking at how the bridge closes a turn. The queued path never signals.' } })], 3200);
feed(T('a', 'Read packages/acp/src/bridge.ts', 'read'));
feed(T('b', 'Read packages/acp/src/turnLog.ts', 'read'));
feed(T('c', 'Search turn.*end', 'search'));
feed(T('d', 'Edit packages/acp/src/bridge.ts', 'edit'));
feed(T('e', 'Run "powershell.exe" -Command "pnpm test --filter acp"', 'execute'), 1700);
if (mode === 'done') {
  feed([upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ANSWER } })]);
  run = { ...run, status: 'done', endedAt: t + 500 };
} else if (mode === 'tool') {
  feed(T('f', 'Run pnpm --filter @sequence/acp test', 'execute', false));
  run = { ...run, live: { phase: 'tool', at: Date.now(), forMs: 41_000, tool: { kind: 'execute', title: 'pnpm --filter @sequence/acp test' }, openTools: 1 } } as AgentRun;
} else if (mode === 'thinking') {
  feed([upd({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Weighing the options.' } })]);
  run = { ...run, live: { phase: 'thinking', at: Date.now(), forMs: 12_000, openTools: 0 } } as AgentRun;
} else if (mode === 'stalled') {
  run = { ...run, live: { phase: 'quiet', at: Date.now(), forMs: 45_000, openTools: 0 } } as AgentRun;
}
run = { ...run, startedAt: at0 };

createRoot(document.getElementById('root')!).render(
  <div className="s2 s2-app" style={{ display: 'block', height: 'auto', minHeight: '100vh' }}>
    <section className="s2-chat v3-chat-col" style={{ width: 720, margin: '24px auto', height: 'auto', display: 'block' }}>
      <div className="v3-transcript chat-scope" style={{ overflow: 'visible' }}>
        <AgentRunView run={run} now={Date.now()} repoRoot="C:\\work\\shop" onAnswer={() => {}} />
      </div>
    </section>
  </div>,
);
