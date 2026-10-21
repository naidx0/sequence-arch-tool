/* ══════════════════════════════════════════════════════════════════════════
   THE AGENT ACTIONS BESIDE "EXPLAIN"
   packages/web2/src/askInPlace/agentActions.ts

   Right-click a node or a mark: Explain, Find callers, Write a test, Refactor
   (owner, 0.1.8 audit). Each row goes the way Explain goes (a run handed to
   chat for a node, `askAbout` for a mark); only the words differ. The words
   name the thing asked about: its label, its id, and its file when the scan
   recorded one. Nothing here sends; it only builds the question.
   ══════════════════════════════════════════════════════════════════════════ */

export type AgentActionId = 'callers' | 'test' | 'refactor';

export interface AgentActionSubject {
  id: string;
  label: string;
  /** The file the scan recorded for it, when it has one. */
  path?: string | undefined;
}

/** The rows, in menu order, after Explain. */
export const AGENT_ACTIONS: readonly { id: AgentActionId; label: string }[] = [
  { id: 'callers', label: 'Find callers' },
  { id: 'test', label: 'Write a test' },
  { id: 'refactor', label: 'Refactor' },
];

/** `orders (svc:orders, src/orders.ts)`: the name the agent can find it by. */
export function subjectName(s: AgentActionSubject): string {
  const label = s.label.trim();
  const where = s.path ? `${s.id}, ${s.path}` : s.id;
  return label && label !== s.id ? `${label} (${where})` : s.path ? `${s.id} (${s.path})` : s.id;
}

export function agentActionQuestion(action: AgentActionId, s: AgentActionSubject | readonly AgentActionSubject[]): string {
  const list = Array.isArray(s) ? (s as readonly AgentActionSubject[]) : [s as AgentActionSubject];
  const name = list.map(subjectName).join(', ');
  switch (action) {
    case 'callers':
      return `Find callers of ${name}: list every place that calls or imports it, with file:line, and say which are tests.`;
    case 'test':
      return `Write a test for ${name}. Cover its normal behaviour and its edge cases, follow the test style already in this repo, and run it.`;
    case 'refactor':
      return `Refactor ${name} to make it simpler without changing what it does. Say what you would change first, and keep the diff small.`;
  }
}
