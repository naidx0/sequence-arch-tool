/**
 * Deterministic layout for SystemBoard IR v0 — lane profile (integer coords).
 *
 * Same IR twice ⇒ same geometry. No elkjs on the main thread for v0.
 */
import type { SystemBoardV0 } from '@sequence/schema';

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SystemBoardNodeLayout {
  /** Top-left anchor for the node mark. */
  at: LayoutPoint;
  w: number;
  h: number;
}

export interface SystemBoardLayout {
  titleAt: LayoutPoint;
  legendFrame: LayoutRect;
  /** Stable track key → frame rect (includes untracked bucket). */
  trackFrames: Record<string, LayoutRect>;
  nodes: Record<string, SystemBoardNodeLayout>;
  issuesFrame: LayoutRect;
  issueCards: Record<string, LayoutRect>;
}

const MARGIN = 40;
const TITLE_Y = 24;
const LEGEND_W = 220;
const LEGEND_H = 108;
const TRACK_PAD = 16;
const NODE_W = 148;
const NODE_H = 56;
const NODE_GAP_X = 20;
const TRACK_GAP_Y = 28;
const ISSUE_W = 196;
const ISSUE_H = 52;
const ISSUE_GAP = 10;
const ISSUES_COL_GAP = 32;

const UNTRACKED = '__untracked__';

function trackOrder(board: SystemBoardV0): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const n of board.nodes) {
    const key = n.track?.trim() || UNTRACKED;
    if (!seen.has(key)) {
      seen.add(key);
      order.push(key);
    }
  }
  return order.sort((a, b) => {
    if (a === UNTRACKED) return 1;
    if (b === UNTRACKED) return -1;
    return a.localeCompare(b);
  });
}

function nodesInTrack(board: SystemBoardV0, trackKey: string): string[] {
  return board.nodes
    .filter((n) => (n.track?.trim() || UNTRACKED) === trackKey)
    .map((n) => n.id)
    .sort((a, b) => a.localeCompare(b));
}

function trackFrameWidth(nodeCount: number): number {
  if (nodeCount <= 0) return NODE_W + TRACK_PAD * 2;
  return TRACK_PAD * 2 + nodeCount * NODE_W + (nodeCount - 1) * NODE_GAP_X;
}

/**
 * Lay out a SystemBoard document. `layered` and `poster` delegate to lane for v0.
 */
export function layoutSystemBoard(board: SystemBoardV0): SystemBoardLayout {
  const tracks = trackOrder(board);
  const legendFrame: LayoutRect = {
    x: MARGIN,
    y: MARGIN + 28,
    w: LEGEND_W,
    h: LEGEND_H,
  };

  let contentLeft = legendFrame.x + legendFrame.w + ISSUES_COL_GAP;
  let y = legendFrame.y;
  const trackFrames: Record<string, LayoutRect> = {};
  const nodes: Record<string, SystemBoardNodeLayout> = {};

  let maxTrackRight = contentLeft;

  for (const trackKey of tracks) {
    const ids = nodesInTrack(board, trackKey);
    const w = trackFrameWidth(ids.length);
    const h = TRACK_PAD * 2 + NODE_H;
    const frame: LayoutRect = { x: contentLeft, y, w, h };
    trackFrames[trackKey] = frame;
    maxTrackRight = Math.max(maxTrackRight, frame.x + frame.w);

    let nx = frame.x + TRACK_PAD;
    const ny = frame.y + TRACK_PAD;
    for (const id of ids) {
      nodes[id] = { at: { x: nx, y: ny }, w: NODE_W, h: NODE_H };
      nx += NODE_W + NODE_GAP_X;
    }

    y += h + TRACK_GAP_Y;
  }

  const issuesX = maxTrackRight + ISSUES_COL_GAP;
  let issuesY = legendFrame.y;
  const issueCards: Record<string, LayoutRect> = {};
  const sortedIssues = [...board.issues].sort((a, b) => a.id.localeCompare(b.id));
  for (const issue of sortedIssues) {
    issueCards[issue.id] = { x: issuesX, y: issuesY, w: ISSUE_W, h: ISSUE_H };
    issuesY += ISSUE_H + ISSUE_GAP;
  }

  const issuesFrame: LayoutRect = {
    x: issuesX - TRACK_PAD,
    y: legendFrame.y - TRACK_PAD,
    w: ISSUE_W + TRACK_PAD * 2,
    h: Math.max(
      ISSUE_H + TRACK_PAD * 2,
      sortedIssues.length * ISSUE_H + (sortedIssues.length - 1) * ISSUE_GAP + TRACK_PAD * 2,
    ),
  };

  return {
    titleAt: { x: MARGIN, y: TITLE_Y },
    legendFrame,
    trackFrames,
    nodes,
    issuesFrame,
    issueCards,
  };
}

/** Center-right anchor for edge routing out of a node. */
export function nodeEdgeAnchor(
  layout: SystemBoardNodeLayout,
  side: 'out' | 'in',
): LayoutPoint {
  const cy = layout.at.y + Math.floor(layout.h / 2);
  if (side === 'out') return { x: layout.at.x + layout.w, y: cy };
  return { x: layout.at.x, y: cy };
}
