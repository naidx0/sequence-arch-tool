/* The agent approval cards, on their own page. Not part of the app build (see
   approvals.specimen.html).

   ?view=real    a real run: the first node of the attached repository's graph,
                 the first registered agent, Ask access, and the question in
                 ?q= (default: create hello.txt). The run renders under the
                 row as it does in chat, with its toasts.
   ?view=file | command | folded   one scripted card, for screenshots. */
import { StrictMode, useEffect, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';

import '../tokens/graphite.css';
import '../styles/base.css';

import { AgentRunsList, useAgentRuns } from '../chat/AgentRunThread';
import { AgentToasts } from '../chat/AgentToasts';
import { AgentApprovals } from '../chat/EditApprovalCardAgent';
import { agentRuns } from './agentRuns';
import { AskAgentMenuItem, type AskResult } from './askAgent';
import type { AgentApproval } from './runNodeStream';

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'real';
const QUESTION =
  params.get('q') ?? 'Create a file named hello.txt in the current directory containing the word hello. Do nothing else.';

const COMMAND = `"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "Set-Content -LiteralPath 'hello.txt' -Value 'hello' -NoNewline"`;
const SCRIPTED: Record<string, AgentApproval> = {
  file: {
    requestId: 'spec-file',
    title: 'Edit src/payments/refund.ts',
    toolKind: 'edit',
    proposal: {
      proposalId: 'spec-file',
      title: 'Edit src/payments/refund.ts',
      rationale: 'The refund path must reject a negative amount before it reaches the ledger.',
      files: [
        {
          path: 'src/payments/refund.ts',
          diff: [
            '--- a/src/payments/refund.ts',
            '+++ b/src/payments/refund.ts',
            '@@ -12,6 +12,9 @@ export async function refund(order: Order, amount: number) {',
            '   const ledger = await openLedger(order.accountId);',
            '-  const entry = ledger.credit(amount);',
            '+  if (amount <= 0) {',
            "+    throw new RangeError('refund amount must be positive');",
            '+  }',
            '+  const entry = ledger.credit(amount);',
            '   await ledger.commit(entry);',
            '   return entry.id;',
            ' }',
          ].join('\n'),
        },
      ],
    },
    decision: null,
    answeredBy: null,
    sending: null,
  },
  command: {
    requestId: 'spec-cmd',
    title: `Run ${COMMAND}`,
    toolKind: 'execute',
    proposal: { proposalId: 'spec-cmd', title: `Run ${COMMAND}`, rationale: null, files: [] },
    decision: null,
    answeredBy: null,
    sending: null,
  },
};
SCRIPTED.folded = { ...SCRIPTED.command, requestId: 'spec-folded', decision: 'deny', answeredBy: 'person' };

const column: CSSProperties = {
  width: 'var(--pane-w, 392px)',
  margin: '48px auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

function Real() {
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const runs = useAgentRuns(agentRuns);
  useEffect(() => {
    void fetch('/archgraph.json')
      .then((r) => r.json())
      .then((g: { nodes?: { id: string }[] }) => setNodeId(g.nodes?.[0]?.id ?? null))
      .catch(() => setNodeId(null));
  }, []);
  if (!nodeId) return <p data-testid="spec-waiting">Waiting for the attached repository's graph…</p>;
  return (
    <>
      <p style={{ color: 'var(--ink-3)', fontSize: 'var(--t-12)' }} data-testid="spec-node">
        node {nodeId}, access Ask
      </p>
      <AskAgentMenuItem nodeId={nodeId} question={QUESTION} access="ask" onDone={setResult} />
      <AgentRunsList runs={runs.runs} repoRoot={null} onAnswer={(r, q, d) => void agentRuns.answer(r, q, d)} />
      <AgentToasts store={agentRuns} repoRoot={null} />
      {result ? (
        <p data-testid="spec-result" data-ok={result.ok ? 'yes' : 'no'} style={{ color: 'var(--ink-2)', fontSize: 'var(--t-12)' }}>
          {result.text || '(no reply text)'}
        </p>
      ) : null}
    </>
  );
}

function App() {
  return (
    <div style={column}>
      {view === 'real' ? <Real /> : <AgentApprovals approvals={[SCRIPTED[view]]} onAnswer={() => {}} />}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
