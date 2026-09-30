/**
 * SystemBoard IR v0 — semantic document for SeqDraw structured boards.
 *
 * Typed roles, narrative tracks, grounded evidence, and issue cards. Geometry
 * is produced by the layout + materializer layers — not by the model.
 *
 * PURE and browser-safe — no fs, no network.
 */

export const SYSTEM_BOARD_IR_VERSION = 0 as const;

/** Legend-bound node role on a system-design worksheet. */
export type SystemBoardNodeRole =
  | 'component'
  | 'action'
  | 'state'
  | 'store'
  | 'runtime'
  | 'note';

export const SYSTEM_BOARD_NODE_ROLES: readonly SystemBoardNodeRole[] = [
  'component',
  'action',
  'state',
  'store',
  'runtime',
  'note',
];

export type SystemBoardLayoutProfile = 'lane' | 'layered' | 'poster';

export const SYSTEM_BOARD_LAYOUT_PROFILES: readonly SystemBoardLayoutProfile[] = [
  'lane',
  'layered',
  'poster',
];

/** Optional grounding back to scan evidence — sketch nodes omit this block. */
export interface SystemBoardEvidence {
  /** ArchGraph node id — must be in the validator's known set when present. */
  nodeId?: string;
  /** Repo-relative path when citing a file range. */
  path?: string;
  lines?: { start: number; end: number };
}

export interface SystemBoardNode {
  id: string;
  role: SystemBoardNodeRole;
  /** Horizontal narrative band — nodes with the same track share a lane row. */
  track?: string;
  label: string;
  bullets?: string[];
  evidence?: SystemBoardEvidence;
}

export interface SystemBoardEdge {
  id: string;
  from: string;
  to: string;
  /** Priority pin label on the connector (e.g. P1). */
  pin?: string;
}

export interface SystemBoardIssue {
  id: string;
  priority: string;
  title: string;
  detail?: string;
}

export interface SystemBoardV0 {
  version?: typeof SYSTEM_BOARD_IR_VERSION;
  title?: string;
  layoutProfile: SystemBoardLayoutProfile;
  nodes: SystemBoardNode[];
  edges: SystemBoardEdge[];
  issues: SystemBoardIssue[];
}

export interface ValidateSystemBoardOptions {
  /**
   * Known ArchGraph node ids. When set, every `evidence.nodeId` must be a member.
   * Omit to skip graph grounding checks (structural validation only).
   */
  knownNodeIds?: ReadonlySet<string>;
}

export interface ValidateSystemBoardResult {
  ok: boolean;
  errors: string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateEvidence(
  raw: unknown,
  path: string,
  knownNodeIds: ReadonlySet<string> | undefined,
  errors: string[],
): void {
  if (!isPlainObject(raw)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (raw.nodeId !== undefined) {
    if (!isNonEmptyString(raw.nodeId)) {
      errors.push(`${path}.nodeId must be a non-empty string`);
    } else if (knownNodeIds && !knownNodeIds.has(raw.nodeId)) {
      errors.push(`${path}.nodeId references unknown graph node ${raw.nodeId}`);
    }
  }
  if (raw.path !== undefined && typeof raw.path !== 'string') {
    errors.push(`${path}.path must be a string`);
  }
  if (raw.lines !== undefined) {
    if (!isPlainObject(raw.lines)) {
      errors.push(`${path}.lines must be an object`);
    } else {
      if (typeof raw.lines.start !== 'number' || !Number.isFinite(raw.lines.start)) {
        errors.push(`${path}.lines.start must be a finite number`);
      }
      if (typeof raw.lines.end !== 'number' || !Number.isFinite(raw.lines.end)) {
        errors.push(`${path}.lines.end must be a finite number`);
      }
    }
  }
}

/**
 * Validate a SystemBoard IR v0 document. PURE and TOTAL — never throws.
 */
export function validateSystemBoard(
  doc: unknown,
  options: ValidateSystemBoardOptions = {},
): ValidateSystemBoardResult {
  const errors: string[] = [];
  const knownNodeIds = options.knownNodeIds;

  if (!isPlainObject(doc)) {
    return { ok: false, errors: ['systemBoard must be a JSON object'] };
  }

  if (doc.version !== undefined && doc.version !== SYSTEM_BOARD_IR_VERSION) {
    errors.push(
      `unsupported systemBoard version: ${JSON.stringify(doc.version)} (expected ${SYSTEM_BOARD_IR_VERSION})`,
    );
  }

  if (doc.title !== undefined && typeof doc.title !== 'string') {
    errors.push('title must be a string');
  }

  if (
    typeof doc.layoutProfile !== 'string' ||
    !SYSTEM_BOARD_LAYOUT_PROFILES.includes(doc.layoutProfile as SystemBoardLayoutProfile)
  ) {
    errors.push(
      `layoutProfile must be one of: ${SYSTEM_BOARD_LAYOUT_PROFILES.join(', ')}`,
    );
  }

  const nodes: SystemBoardNode[] = [];
  if (!Array.isArray(doc.nodes)) {
    errors.push('nodes must be an array');
  } else {
    doc.nodes.forEach((n, i) => {
      if (!isPlainObject(n)) {
        errors.push(`nodes[${i}] is not an object`);
        return;
      }
      if (!isNonEmptyString(n.id)) errors.push(`nodes[${i}] has an empty id`);
      if (!isNonEmptyString(n.label)) errors.push(`nodes[${i}] has an empty label`);
      if (
        typeof n.role !== 'string' ||
        !SYSTEM_BOARD_NODE_ROLES.includes(n.role as SystemBoardNodeRole)
      ) {
        errors.push(`nodes[${i}] has invalid role`);
      }
      if (n.track !== undefined && typeof n.track !== 'string') {
        errors.push(`nodes[${i}].track must be a string`);
      }
      if (n.bullets !== undefined) {
        if (!Array.isArray(n.bullets)) {
          errors.push(`nodes[${i}].bullets must be an array`);
        } else {
          n.bullets.forEach((b, j) => {
            if (!isNonEmptyString(b)) errors.push(`nodes[${i}].bullets[${j}] must be a non-empty string`);
          });
        }
      }
      if (n.evidence !== undefined) {
        validateEvidence(n.evidence, `nodes[${i}].evidence`, knownNodeIds, errors);
      }
      nodes.push(n as unknown as SystemBoardNode);
    });
  }

  const nodeIds = new Set<string>();
  for (const n of nodes) {
    if (nodeIds.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    nodeIds.add(n.id);
  }

  if (!Array.isArray(doc.edges)) {
    errors.push('edges must be an array');
  } else {
    doc.edges.forEach((e, i) => {
      if (!isPlainObject(e)) {
        errors.push(`edges[${i}] is not an object`);
        return;
      }
      if (!isNonEmptyString(e.id)) errors.push(`edges[${i}] has an empty id`);
      if (!isNonEmptyString(e.from)) errors.push(`edges[${i}] has an empty from`);
      if (!isNonEmptyString(e.to)) errors.push(`edges[${i}] has an empty to`);
      if (isNonEmptyString(e.from) && !nodeIds.has(e.from)) {
        errors.push(`edges[${i}] references unknown from-node ${e.from}`);
      }
      if (isNonEmptyString(e.to) && !nodeIds.has(e.to)) {
        errors.push(`edges[${i}] references unknown to-node ${e.to}`);
      }
      if (e.pin !== undefined && typeof e.pin !== 'string') {
        errors.push(`edges[${i}].pin must be a string`);
      }
    });
  }

  const edgeIds = new Set<string>();
  if (Array.isArray(doc.edges)) {
    for (const e of doc.edges) {
      if (!isPlainObject(e) || !isNonEmptyString(e.id)) continue;
      if (edgeIds.has(e.id)) errors.push(`duplicate edge id: ${e.id}`);
      edgeIds.add(e.id);
    }
  }

  if (!Array.isArray(doc.issues)) {
    errors.push('issues must be an array');
  } else {
    doc.issues.forEach((issue, i) => {
      if (!isPlainObject(issue)) {
        errors.push(`issues[${i}] is not an object`);
        return;
      }
      if (!isNonEmptyString(issue.id)) errors.push(`issues[${i}] has an empty id`);
      if (!isNonEmptyString(issue.priority)) errors.push(`issues[${i}] has an empty priority`);
      if (!isNonEmptyString(issue.title)) errors.push(`issues[${i}] has an empty title`);
      if (issue.detail !== undefined && typeof issue.detail !== 'string') {
        errors.push(`issues[${i}].detail must be a string`);
      }
    });
  }

  const issueIds = new Set<string>();
  if (Array.isArray(doc.issues)) {
    for (const issue of doc.issues) {
      if (!isPlainObject(issue) || !isNonEmptyString(issue.id)) continue;
      if (issueIds.has(issue.id)) errors.push(`duplicate issue id: ${issue.id}`);
      issueIds.add(issue.id);
    }
  }

  return { ok: errors.length === 0, errors };
}

/** True when {@link validateSystemBoard} finds nothing wrong — typed narrowing helper. */
export function isValidSystemBoard(doc: unknown, options?: ValidateSystemBoardOptions): doc is SystemBoardV0 {
  return validateSystemBoard(doc, options).ok;
}
