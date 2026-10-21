/**
 * B1 — Sequence-native Task Board document persisted under `.sequence/board.json`.
 * Separate from `board.ts` (the architecture whiteboard view-model).
 */

export const SEQUENCE_BOARD_VERSION = 1 as const;

export type TaskStatus = 'idle' | 'running' | 'done' | 'error';

export type SequenceBoardNodeKind = 'task-card';

/** Serializable task-card fields — mirrors `TaskCardProps` without geometry. */
export interface TaskCardDocProps {
  title: string;
  owner: string;
  status: TaskStatus;
  kind: 'command' | 'ai';
  aiIntent: 'ask' | 'edit';
  command: string;
  prompt: string;
  description: string;
  linkedServiceIds: string;
  prUrl: string;
  result: string;
}

export interface SequenceBoardNode {
  id: string;
  kind: SequenceBoardNodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  props: TaskCardDocProps;
}

export interface SequenceBoardEdge {
  id: string;
  source: string;
  target: string;
}

export interface SequenceBoardViewport {
  x: number;
  y: number;
  zoom: number;
}

/** A persisted freehand annotation stroke in flow/page coordinates. */
export interface SequenceBoardInkStroke {
  id: string;
  points: { x: number; y: number }[];
}

export interface SequenceBoardDoc {
  version: typeof SEQUENCE_BOARD_VERSION;
  nodes: SequenceBoardNode[];
  edges: SequenceBoardEdge[];
  /** Optional freehand ink annotations (B2). Omitted on older saves. */
  ink?: SequenceBoardInkStroke[];
  viewport?: SequenceBoardViewport;
}

export const BOARD_JSON_FILE = 'board.json';

const TASK_STATUSES = new Set<TaskStatus>(['idle', 'running', 'done', 'error']);
const TASK_KINDS = new Set<TaskCardDocProps['kind']>(['command', 'ai']);
const AI_INTENTS = new Set<TaskCardDocProps['aiIntent']>(['ask', 'edit']);

/** Default props for a freshly spawned native task card. */
export function defaultTaskCardDocProps(
  partial: Partial<TaskCardDocProps> = {},
): TaskCardDocProps {
  return {
    title: 'New task',
    owner: 'Agent',
    status: 'idle',
    kind: 'command',
    aiIntent: 'ask',
    command: 'echo "hello from sequence"',
    prompt: '',
    description: '',
    linkedServiceIds: '',
    prUrl: '',
    result: '',
    ...partial,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asFinite(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function parseTaskCardProps(raw: unknown): TaskCardDocProps | undefined {
  if (!isRecord(raw)) return undefined;
  const status = raw.status;
  const kind = raw.kind;
  const aiIntent = raw.aiIntent;
  if (!TASK_STATUSES.has(status as TaskStatus)) return undefined;
  if (!TASK_KINDS.has(kind as TaskCardDocProps['kind'])) return undefined;
  if (!AI_INTENTS.has(aiIntent as TaskCardDocProps['aiIntent'])) return undefined;
  return {
    title: asString(raw.title, 'New task'),
    owner: asString(raw.owner, 'Agent'),
    status: status as TaskStatus,
    kind: kind as TaskCardDocProps['kind'],
    aiIntent: aiIntent as TaskCardDocProps['aiIntent'],
    command: asString(raw.command),
    prompt: asString(raw.prompt),
    description: asString(raw.description),
    linkedServiceIds: asString(raw.linkedServiceIds),
    prUrl: asString(raw.prUrl),
    result: asString(raw.result),
  };
}

function parseNode(raw: unknown): SequenceBoardNode | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.kind !== 'task-card') return undefined;
  const props = parseTaskCardProps(raw.props);
  if (!props) return undefined;
  const id = asString(raw.id);
  if (!id) return undefined;
  return {
    id,
    kind: 'task-card',
    x: asFinite(raw.x),
    y: asFinite(raw.y),
    w: asFinite(raw.w, 260),
    h: asFinite(raw.h, 148),
    props,
  };
}

function parseEdge(raw: unknown): SequenceBoardEdge | undefined {
  if (!isRecord(raw)) return undefined;
  const id = asString(raw.id);
  const source = asString(raw.source);
  const target = asString(raw.target);
  if (!id || !source || !target) return undefined;
  return { id, source, target };
}

function parseInkPoint(raw: unknown): { x: number; y: number } | undefined {
  if (!isRecord(raw)) return undefined;
  const x = asFinite(raw.x);
  const y = asFinite(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

function parseInkStroke(raw: unknown): SequenceBoardInkStroke | undefined {
  if (!isRecord(raw)) return undefined;
  const id = asString(raw.id);
  if (!id || !Array.isArray(raw.points) || raw.points.length < 2) return undefined;
  const points: { x: number; y: number }[] = [];
  for (const p of raw.points) {
    const pt = parseInkPoint(p);
    if (!pt) return undefined;
    points.push(pt);
  }
  return { id, points };
}

/** Validate and normalize a persisted board document. Returns undefined when invalid. */
export function parseSequenceBoardDoc(raw: unknown): SequenceBoardDoc | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.version !== SEQUENCE_BOARD_VERSION) return undefined;
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return undefined;

  const nodes: SequenceBoardNode[] = [];
  for (const n of raw.nodes) {
    const parsed = parseNode(n);
    if (!parsed) return undefined;
    nodes.push(parsed);
  }

  const edges: SequenceBoardEdge[] = [];
  for (const e of raw.edges) {
    const parsed = parseEdge(e);
    if (!parsed) return undefined;
    edges.push(parsed);
  }

  let viewport: SequenceBoardViewport | undefined;
  if (raw.viewport !== undefined) {
    if (!isRecord(raw.viewport)) return undefined;
    viewport = {
      x: asFinite(raw.viewport.x),
      y: asFinite(raw.viewport.y),
      zoom: asFinite(raw.viewport.zoom, 1),
    };
  }

  let ink: SequenceBoardInkStroke[] | undefined;
  if (raw.ink !== undefined) {
    if (!Array.isArray(raw.ink)) return undefined;
    ink = [];
    for (const s of raw.ink) {
      const parsed = parseInkStroke(s);
      if (!parsed) return undefined;
      ink.push(parsed);
    }
  }

  return { version: SEQUENCE_BOARD_VERSION, nodes, edges, ...(ink ? { ink } : {}), viewport };
}

/** Flip persisted `running` cards back to idle on load — no in-flight run survives reload. */
export function reconcileRunningBoardNodes(nodes: readonly SequenceBoardNode[]): SequenceBoardNode[] {
  return nodes.map((n) => {
    if (n.props.status !== 'running') return n;
    return {
      ...n,
      props: {
        ...n.props,
        status: 'idle',
        result: 'Reset on reload — the previous run was not tracked across the reload.',
      },
    };
  });
}

/** Empty board used when nothing is persisted yet. */
export function emptySequenceBoardDoc(): SequenceBoardDoc {
  return { version: SEQUENCE_BOARD_VERSION, nodes: [], edges: [] };
}
