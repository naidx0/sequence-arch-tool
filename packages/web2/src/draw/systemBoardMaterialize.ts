/**
 * Materialize SystemBoard IR v0 → SeqDraw wire items (BoardWireItem[]).
 */
import type { BoardWireItem } from '@sequence/api-types';
import type { SystemBoardNode, SystemBoardV0 } from '@sequence/schema';

import {
  layoutSystemBoard,
  nodeEdgeAnchor,
  type SystemBoardLayout,
} from './systemBoardLayout';

const ROLE_LABELS: Record<SystemBoardNode['role'], string> = {
  component: 'component',
  action: 'action',
  state: 'state',
  store: 'store',
  runtime: 'runtime',
  note: 'note (sketch)',
};

function nodeBodyText(node: SystemBoardNode): string {
  const lines = [node.label];
  if (node.bullets?.length) {
    for (const b of node.bullets) lines.push(`• ${b}`);
  }
  return lines.join('\n');
}

function legendItems(layout: SystemBoardLayout): BoardWireItem[] {
  const items: BoardWireItem[] = [
    {
      kind: 'shape',
      id: 'sb-legend-frame',
      shape: 'rect',
      from: { x: layout.legendFrame.x, y: layout.legendFrame.y },
      to: {
        x: layout.legendFrame.x + layout.legendFrame.w,
        y: layout.legendFrame.y + layout.legendFrame.h,
      },
    },
    {
      kind: 'text',
      id: 'sb-legend-title',
      at: { x: layout.legendFrame.x + 8, y: layout.legendFrame.y + 8 },
      text: 'Roles',
    },
  ];

  let y = layout.legendFrame.y + 28;
  const roles = Object.entries(ROLE_LABELS) as [SystemBoardNode['role'], string][];
  for (const [role, label] of roles) {
    items.push({
      kind: 'text',
      id: `sb-legend-${role}`,
      at: { x: layout.legendFrame.x + 8, y },
      text: label,
    });
    y += 14;
  }
  return items;
}

/**
 * Turn a validated SystemBoard IR document into agent wire items ready for SeqDraw.
 */
export function materializeSystemBoard(board: SystemBoardV0): BoardWireItem[] {
  const layout = layoutSystemBoard(board);
  const items: BoardWireItem[] = [];

  if (board.title?.trim()) {
    items.push({
      kind: 'text',
      id: 'sb-title',
      at: { ...layout.titleAt },
      text: board.title.trim(),
    });
  }

  items.push(...legendItems(layout));

  for (const [trackKey, frame] of Object.entries(layout.trackFrames).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const label = trackKey === '__untracked__' ? 'Untracked' : trackKey;
    items.push({
      kind: 'shape',
      id: `sb-track-${trackKey}`,
      shape: 'rect',
      from: { x: frame.x, y: frame.y },
      to: { x: frame.x + frame.w, y: frame.y + frame.h },
    });
    items.push({
      kind: 'text',
      id: `sb-track-label-${trackKey}`,
      at: { x: frame.x + 6, y: frame.y - 14 },
      text: label,
    });
  }

  for (const node of board.nodes) {
    const geom = layout.nodes[node.id];
    if (!geom) continue;

    if (node.evidence?.nodeId) {
      items.push({
        kind: 'noderef',
        id: `sb-node-${node.id}`,
        at: { ...geom.at },
        nodeId: node.evidence.nodeId,
        label: node.label,
        ...(node.evidence.path ? { path: node.evidence.path } : {}),
        ...(node.evidence.lines
          ? { lines: { from: node.evidence.lines.start, to: node.evidence.lines.end } }
          : {}),
      });
      if (node.bullets?.length) {
        items.push({
          kind: 'text',
          id: `sb-node-${node.id}-bullets`,
          at: { x: geom.at.x + 4, y: geom.at.y + 18 },
          text: node.bullets.map((b) => `• ${b}`).join('\n'),
        });
      }
    } else {
      items.push({
        kind: 'text',
        id: `sb-node-${node.id}`,
        at: { ...geom.at },
        text: nodeBodyText(node),
      });
    }
  }

  for (const edge of board.edges) {
    const fromGeom = layout.nodes[edge.from];
    const toGeom = layout.nodes[edge.to];
    if (!fromGeom || !toGeom) continue;

    const from = nodeEdgeAnchor(fromGeom, 'out');
    const to = nodeEdgeAnchor(toGeom, 'in');
    items.push({
      kind: 'shape',
      id: `sb-edge-${edge.id}`,
      shape: 'arrow',
      from,
      to,
    });

    if (edge.pin?.trim()) {
      const mid = {
        x: Math.floor((from.x + to.x) / 2),
        y: Math.floor((from.y + to.y) / 2) - 8,
      };
      items.push({
        kind: 'text',
        id: `sb-edge-pin-${edge.id}`,
        at: mid,
        text: edge.pin.trim(),
      });
    }
  }

  if (board.issues.length > 0) {
    items.push({
      kind: 'shape',
      id: 'sb-issues-frame',
      shape: 'rect',
      from: { x: layout.issuesFrame.x, y: layout.issuesFrame.y },
      to: {
        x: layout.issuesFrame.x + layout.issuesFrame.w,
        y: layout.issuesFrame.y + layout.issuesFrame.h,
      },
    });
    items.push({
      kind: 'text',
      id: 'sb-issues-title',
      at: { x: layout.issuesFrame.x + 8, y: layout.issuesFrame.y + 6 },
      text: 'Issues',
    });
  }

  for (const issue of board.issues) {
    const card = layout.issueCards[issue.id];
    if (!card) continue;
    items.push({
      kind: 'shape',
      id: `sb-issue-${issue.id}`,
      shape: 'rect',
      from: { x: card.x, y: card.y },
      to: { x: card.x + card.w, y: card.y + card.h },
    });
    const title = `${issue.priority} — ${issue.title}`;
    items.push({
      kind: 'text',
      id: `sb-issue-${issue.id}-title`,
      at: { x: card.x + 6, y: card.y + 6 },
      text: title,
    });
    if (issue.detail?.trim()) {
      items.push({
        kind: 'text',
        id: `sb-issue-${issue.id}-detail`,
        at: { x: card.x + 6, y: card.y + 24 },
        text: issue.detail.trim(),
      });
    }
  }

  return items;
}
