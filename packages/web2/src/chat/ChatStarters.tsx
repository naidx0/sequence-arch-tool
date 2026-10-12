/* ══════════════════════════════════════════════════════════════════════════
   EMPTY CHAT: THREE THINGS TO DO WITH THE BOARD THAT IS OPEN
   packages/web2/src/chat/ChatStarters.tsx

   An empty thread offers three one-click starts, each about the board on the
   right rather than a generic prompt:

     Explain this architecture      sends at once
     What touches <node>?           the selected node, else the top service;
                                    sends at once
     Plan a change                  switches to Plan and puts the start of the
                                    request in the box, since only the person
                                    knows what change

   With no graph there is nothing to tie a starter to, and none is offered.
   ══════════════════════════════════════════════════════════════════════════ */

import { Icon, type IconName } from './Icon';

import './agentRun.css';

export interface StarterNode {
  id: string;
  kind: string;
  label: string;
  meta?: { pageRank?: number } | undefined;
}

export interface StarterEdge {
  srcId: string;
  dstId: string;
}

export type StarterAction =
  | { id: 'explain'; label: string; prompt: string; send: true }
  | { id: 'touches'; label: string; prompt: string; send: true; nodeId: string }
  | { id: 'plan'; label: string; prompt: string; send: false };

/** The service most of the board leans on: highest page rank, then most edges, then first. */
export function topService(nodes: readonly StarterNode[], edges: readonly StarterEdge[] = []): StarterNode | null {
  const services = nodes.filter((n) => n.kind === 'service');
  if (services.length === 0) return null;
  const degree = new Map<string, number>();
  for (const e of edges) {
    for (const end of [e.srcId, e.dstId]) degree.set(end, (degree.get(end) ?? 0) + 1);
  }
  let best = services[0];
  for (const s of services.slice(1)) {
    const rank = (s.meta?.pageRank ?? 0) - (best.meta?.pageRank ?? 0);
    if (rank > 0 || (rank === 0 && (degree.get(s.id) ?? 0) > (degree.get(best.id) ?? 0))) best = s;
  }
  return best;
}

export const PLAN_DRAFT = 'Plan a change: ';

export function starterActions(
  nodes: readonly StarterNode[],
  edges: readonly StarterEdge[],
  selectedIds: readonly string[],
): StarterAction[] {
  if (nodes.length === 0) return [];
  const selected = selectedIds.map((id) => nodes.find((n) => n.id === id)).find((n): n is StarterNode => Boolean(n)) ?? null;
  const subject = selected ?? topService(nodes, edges);
  const out: StarterAction[] = [
    {
      id: 'explain',
      label: 'Explain this architecture',
      prompt: 'Explain this architecture: the main services, how they talk to each other, and where the data lives. Cite file:line.',
      send: true,
    },
  ];
  if (subject) {
    out.push({
      id: 'touches',
      label: `What touches ${subject.label}?`,
      prompt: `What touches ${subject.label}? List what calls it, what it calls, and the data it reads or writes, with file:line.`,
      send: true,
      nodeId: subject.id,
    });
  }
  out.push({ id: 'plan', label: 'Plan a change', prompt: PLAN_DRAFT, send: false });
  return out;
}

const GLYPH: Record<StarterAction['id'], IconName> = { explain: 'board', touches: 'flow', plan: 'target' };

export function ChatStarters({ actions, onPick }: { actions: readonly StarterAction[]; onPick: (a: StarterAction) => void }) {
  if (actions.length === 0) return null;
  return (
    <div className="agstarters" data-testid="chat-starters" role="group" aria-label="Start with">
      {actions.map((a) => (
        <button key={a.id} type="button" className="agstarter" data-testid={`chat-starter-${a.id}`} title={a.label} onClick={() => onPick(a)}>
          <Icon name={GLYPH[a.id]} size={12} />
          <span className="agstarter-label">{a.label}</span>
        </button>
      ))}
    </div>
  );
}
