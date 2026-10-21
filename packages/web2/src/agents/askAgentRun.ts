/* ══════════════════════════════════════════════════════════════════════════
   ONE RUN, AWAITED WHOLE, OUTSIDE THE CHAT
   packages/web2/src/agents/askAgentRun.ts

   For scripts and the approvals specimen: ask the first registered agent
   about a board node and wait for the answer, collecting its approvals. The
   app's own path is the chat (askAgent.tsx hands the run to agentRuns.ts);
   this lives apart so the boot bundle does not carry the stream reader.
   ══════════════════════════════════════════════════════════════════════════ */

import { acpPermissionModeFor } from '../chat/accessMode';
import type { AccessMode, PermissionMode } from '../state/types';
import { DEFAULT_NODE_QUESTION } from './agentRuns';
import { firstAgent, NO_AGENT_TEXT } from './agentRunner';
import { foldApproval, streamRunNode, type AgentApproval, type Fetch } from './runNodeStream';

export { firstAgent };

export interface AskRunResult {
  ok: boolean;
  text: string;
}

export async function askAgentAboutNode(
  opts: {
    nodeId: string;
    question?: string;
    agentRef?: string;
    /** What the turn is for. Default Build. */
    intent?: PermissionMode;
    /** What it may do without asking. Default Ask. */
    access?: AccessMode;
    /** Every approval of this run, re-sent whole each time one arrives or settles. */
    onApprovals?: (approvals: AgentApproval[]) => void;
    signal?: AbortSignal;
  },
  f: Fetch = fetch,
): Promise<AskRunResult> {
  const agentRef = opts.agentRef ?? (await firstAgent(f));
  if (!agentRef) return { ok: false, text: NO_AGENT_TEXT };
  let approvals: AgentApproval[] = [];
  const out = await streamRunNode(
    {
      agentRef,
      prompt: opts.question ?? DEFAULT_NODE_QUESTION,
      contextNodeId: opts.nodeId,
      permissionMode: acpPermissionModeFor(opts.intent ?? 'build', opts.access ?? 'ask'),
      sessionKey: `ask-node::${opts.nodeId}::${agentRef}`,
    },
    {
      onEvent: (e) => {
        const next = foldApproval(approvals, e);
        if (next !== approvals) {
          approvals = next;
          opts.onApprovals?.(approvals);
        }
      },
      ...(opts.signal ? { signal: opts.signal } : {}),
    },
    f,
  );
  return { ok: out.ok, text: out.text };
}
