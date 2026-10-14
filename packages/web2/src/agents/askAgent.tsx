/* ══════════════════════════════════════════════════════════════════════════
   "ASK AN AGENT ABOUT THIS" — a sub-agent launched from a board node
   packages/web2/src/agents/askAgent.tsx

   POST /api/acp/run-node with `contextNodeId`: the SERVER cuts the node's map
   slice from the graph it holds and puts it in the prompt (agentMap.ts
   nodeContextPrompt), so the agent starts grounded in that node's edges at
   file:line. The run uses the first registered local agent unless one is
   named.

   THE RUN LIVES IN CHAT. The menu row hands the run to the page's run store
   (`agentRuns.ts`) and answers `onDone` at once, so the node menu closes the
   way every other row closes it. The chat pane pins the node as a context
   chip and streams the run into the open thread: the agent's text, its tool
   calls, diffs and approvals as collapsed cards, and each approval also as a
   persistent bottom-right toast.

   Mount: `<AskAgentMenuItem nodeId={target.nodeId} onDone={…} />` as one row in
   the board's node menu (canvas/BoardMenu.tsx, another lane's file).
   ══════════════════════════════════════════════════════════════════════════ */

import type { AccessMode } from '../state/types';
import { DEFAULT_NODE_QUESTION, agentRuns, type AgentRunStore } from './agentRuns';
import type { Fetch } from './runNodeStream';

export { DEFAULT_NODE_QUESTION };

export interface AskResult {
  ok: boolean;
  text: string;
  /** The run was handed to the chat pane; `text` says so, it is not the answer. */
  handedOff?: boolean;
}

/** What the board is told when the run moves to chat. */
export const HANDED_OFF_NOTE = 'The agent is working in chat.';

/* A run awaited whole, outside the chat, is askAgentRun.ts (not in the boot bundle). */

export function AskAgentMenuItem({
  nodeId,
  nodeLabel,
  onDone,
  fetchImpl,
  access,
  question,
  label = 'Ask an agent about this',
  runs = agentRuns,
}: {
  nodeId: string;
  /** The node's label, for the chat's context chip. */
  nodeLabel?: string;
  /** Default {@link DEFAULT_NODE_QUESTION}. */
  question?: string;
  /** Called as soon as the run is handed to chat, so the menu can close. */
  onDone?: (r: AskResult) => void;
  fetchImpl?: Fetch;
  access?: AccessMode;
  /** The row's words; the board's node menu calls it "Explain" beside its one ask row (0.1.8.1 C7). */
  label?: string;
  runs?: AgentRunStore;
}): JSX.Element {
  const f = fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  return (
    <button
      type="button"
      role="menuitem"
      className="menuitem"
      data-testid="board-menu-ask-agent"
      onClick={() => {
        void runs.start(
          {
            nodeId,
            ...(nodeLabel ? { nodeLabel } : {}),
            ...(access ? { access } : {}),
            ...(question ? { question } : {}),
          },
          f,
        );
        onDone?.({ ok: true, text: HANDED_OFF_NOTE, handedOff: true });
      }}
    >
      {label}
    </button>
  );
}
