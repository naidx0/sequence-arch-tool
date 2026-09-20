/**
 * SeqDiagram v1 — the JSON IR for grounded architecture diagrams.
 *
 * Canonical artifact for chat chips, `.sequence/diagrams/*.seqd` files,
 * Structural SVG export, and Mermaid projections. Every node/edge id traces to
 * ArchGraph evidence via the `grounded` block; `projections.mermaid` is derived
 * and never authoritative.
 *
 * PURE and browser-safe — no fs, no network, no renderers.
 */

/** Declared diagram flow type — inferred server-side, not regex on Mermaid. */
export type SeqDiagramKind =
  | 'service-sequence'
  | 'service-flow'
  | 'package-map'
  | 'agent-workflow'
  | 'function-path'
  | 'breakout-interior';

export const SEQ_DIAGRAM_KINDS: readonly SeqDiagramKind[] = [
  'service-sequence',
  'service-flow',
  'package-map',
  'agent-workflow',
  'function-path',
  'breakout-interior',
];

export type SeqDiagramTheme = 'structural' | 'macos-dark';

export const SEQ_DIAGRAM_THEMES: readonly SeqDiagramTheme[] = ['structural', 'macos-dark'];

/** Where the diagram was produced — used to gate grounded chat render. */
export type SeqDiagramOrigin = 'export' | 'scan' | 'chat' | 'design';

export const SEQ_DIAGRAM_ORIGINS: readonly SeqDiagramOrigin[] = [
  'export',
  'scan',
  'chat',
  'design',
];

/** Node role in sequence vs flow layouts. */
export type SeqDiagramNodeRole = 'participant' | 'actor' | 'boundary' | 'group';

export const SEQ_DIAGRAM_NODE_ROLES: readonly SeqDiagramNodeRole[] = [
  'participant',
  'actor',
  'boundary',
  'group',
];

/** Lifted ArchGraph node kinds commonly shown on diagrams. */
export type SeqDiagramNodeKind =
  | 'service'
  | 'datastore'
  | 'topic'
  | 'module'
  | 'file'
  | 'package'
  | 'function'
  | 'agent';

export const SEQ_DIAGRAM_NODE_KINDS: readonly SeqDiagramNodeKind[] = [
  'service',
  'datastore',
  'topic',
  'module',
  'file',
  'package',
  'function',
  'agent',
];

/** Edge family — meaning-locked hues in Structural theme (never accent orange). */
export type SeqDiagramEdgeFamily =
  | 'http'
  | 'grpc'
  | 'queue'
  | 'db'
  | 'import'
  | 'call'
  | 'control';

export const SEQ_DIAGRAM_EDGE_FAMILIES: readonly SeqDiagramEdgeFamily[] = [
  'http',
  'grpc',
  'queue',
  'db',
  'import',
  'call',
  'control',
];

/** MADR-style expandable detail slots — omitted when unknown, never invented. */
export interface SeqDiagramNodeDetail {
  whatItIs?: string;
  whatItDoes?: string;
  parts?: string[];
  talksTo?: string[];
}

/** Agent prompt pack on workflow diagram nodes — editable before launch. */
export interface SeqDiagramAgentPack {
  /** Required for `kind: agent` nodes on `agent-workflow` diagrams. */
  prompt: string;
  /** ACP agent id when `runtime` is `acp`. */
  agentRef?: string;
  /** Repo-relative paths this agent may touch. */
  scopeFiles?: string[];
  /** Execution backend — defaults to gateway when omitted. */
  runtime?: 'gateway' | 'acp';
}

export interface SeqDiagramNode {
  id: string;
  label: string;
  kind: SeqDiagramNodeKind;
  role?: SeqDiagramNodeRole;
  /** When true, node is a primary rollup shown in flow-first lane headers. */
  primary?: boolean;
  /** Grounded evidence pointer, e.g. `scan:src/handler.ts:41`. */
  evidenceRef?: string;
  detail?: SeqDiagramNodeDetail;
  /** Workflow agent instructions — meaningful on `kind: agent` for agent-workflow. */
  agent?: SeqDiagramAgentPack;
}

export interface SeqDiagramEdge {
  id: string;
  from: string;
  to: string;
  family: SeqDiagramEdgeFamily;
  label?: string;
  /** Grounded evidence pointer, e.g. `scan:compose:gateway:env.API_URL`. */
  evidenceRef?: string;
}

/** Explicit containment group — preferred over inferring from role:group nodes alone. */
export interface SeqDiagramGroup {
  id: string;
  label: string;
  memberIds: string[];
}

/** Named left-to-right flow lane (flow-first `.seqd` board projection). */
export interface SeqDiagramFlow {
  id: string;
  label: string;
  nodeIds: string[];
  edgeIds?: string[];
}

/** Boundary or external-system frame around member nodes. */
export interface SeqDiagramBoundary {
  id: string;
  label: string;
  memberIds?: string[];
  /** When true, marks an external dependency boundary (outside repo scope). */
  external?: boolean;
  evidenceRef?: string;
}

/** External dependency not fully modeled as an in-diagram node. */
export interface SeqDiagramExternalDependency {
  id: string;
  label: string;
  /** Optional link to a boundary-role node id. */
  boundaryNodeId?: string;
  evidenceRef?: string;
}

/** Links the diagram to its source ArchGraph — `graphId` is required. */
export interface SeqDiagramGrounded {
  graphId: string;
  repoPath?: string;
  scopeNodeIds?: string[];
  origin?: SeqDiagramOrigin;
  /** Honest unknowns scoped to grounding — omitted when none. */
  unknowns?: string[];
}

export type SeqDiagramLayoutEngine = 'sequence' | 'layered-flow' | 'grid' | 'circular-loop';

export type SeqDiagramLayoutDirection = 'LR' | 'TD';

export interface SeqDiagramLayout {
  engine?: SeqDiagramLayoutEngine;
  direction?: SeqDiagramLayoutDirection;
  showTitleBlock?: boolean;
}

export interface SeqDiagramProjections {
  /** Derived Mermaid text — may be stale relative to nodes/edges. */
  mermaid?: string;
  capNote?: string;
}

export interface SeqDiagramMeta {
  createdAt?: string;
  generator?: string;
  /**
   * Scenario family for Architecture depth chips.
   * `software` → Business / Systems / Contracts (scanned repos).
   * `process` → Overview / Detail / Connections (design / chat / process flows).
   */
  diagramFamily?: 'software' | 'process';
}

export interface SeqDiagramV1 {
  version: 1;
  kind: SeqDiagramKind;
  title: string;
  grounded: SeqDiagramGrounded;
  theme?: SeqDiagramTheme;
  nodes: SeqDiagramNode[];
  edges: SeqDiagramEdge[];
  /** Explicit containment groups (member ids must reference nodes). */
  groups?: SeqDiagramGroup[];
  /** Named flows for flow-first board lanes. */
  flows?: SeqDiagramFlow[];
  /** Rollup node ids when primary flags are not set per-node. */
  primaryNodeIds?: string[];
  /** Boundary frames and external-system envelopes. */
  boundaries?: SeqDiagramBoundary[];
  /** External deps not fully represented as nodes. */
  externalDependencies?: SeqDiagramExternalDependency[];
  /** Diagram-level honest unknowns — never invented filler. */
  unknowns?: string[];
  layout?: SeqDiagramLayout;
  projections?: SeqDiagramProjections;
  meta?: SeqDiagramMeta;
}

export const SEQ_DIAGRAM_VERSION = 1 as const;

export interface ValidateSeqDiagramResult {
  ok: boolean;
  errors: string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Models invent node kinds (`interface`, `cli`, …). Coerce any unknown kind to
 * `service` so a seqd dump still paints. Valid kinds (`module` / `agent` /
 * `datastore` / …) stay. Do not add invented kinds to the enum.
 */
export function coerceMissingNodeKind(doc: unknown): void {
  if (!isPlainObject(doc)) return;
  const nodes = doc.nodes;
  if (!Array.isArray(nodes)) return;
  for (const n of nodes) {
    if (!isPlainObject(n)) continue;
    const kind = n.kind;
    if (
      typeof kind !== 'string' ||
      !SEQ_DIAGRAM_NODE_KINDS.includes(kind as SeqDiagramNodeKind)
    ) {
      n.kind = 'service';
    }
  }
}

/**
 * Models often emit `name` instead of `label`. Copy before the empty-label check.
 */
export function coerceNodeNameToLabel(doc: unknown): void {
  if (!isPlainObject(doc)) return;
  const nodes = doc.nodes;
  if (!Array.isArray(nodes)) return;
  for (const n of nodes) {
    if (!isPlainObject(n)) continue;
    const label = typeof n.label === 'string' ? n.label.trim() : '';
    const name = typeof n.name === 'string' ? n.name.trim() : '';
    if (!label && name) n.label = name;
  }
}

/** Human-readable version mismatch — semver strings are a common mistake. */
function formatSeqDiagramVersionError(version: unknown): string {
  if (version === undefined) {
    return `unsupported seqdiagram version: undefined (expected ${SEQ_DIAGRAM_VERSION})`;
  }
  if (typeof version === 'string' && /\d+\.\d+/.test(version)) {
    return `SeqDiagram IR version must be the integer ${SEQ_DIAGRAM_VERSION}, not a package semver. You passed ${JSON.stringify(version)} — use "version": ${SEQ_DIAGRAM_VERSION} in the .seqd file.`;
  }
  return `unsupported seqdiagram version: ${JSON.stringify(version)} (expected ${SEQ_DIAGRAM_VERSION})`;
}

/**
 * Validate a SeqDiagram v1 document. PURE and TOTAL — never throws; returns
 * every structural problem found (not just the first).
 */
export function validateSeqDiagram(doc: unknown): ValidateSeqDiagramResult {
  const errors: string[] = [];

  if (!isPlainObject(doc)) {
    return { ok: false, errors: ['seqdiagram must be a JSON object'] };
  }

  // r3 Wave 2 — coerce `"version": "1"` → 1 before the strict check. Semver
  // strings ("0.1.0") are left untouched so the dedicated message still fires.
  if (doc.version === '1') {
    doc.version = SEQ_DIAGRAM_VERSION;
  }

  if (doc.version !== SEQ_DIAGRAM_VERSION) {
    errors.push(formatSeqDiagramVersionError(doc.version));
  }

  if (typeof doc.kind !== 'string' || !SEQ_DIAGRAM_KINDS.includes(doc.kind as SeqDiagramKind)) {
    errors.push(`invalid or missing kind (expected one of: ${SEQ_DIAGRAM_KINDS.join(', ')})`);
  }

  if (!isNonEmptyString(doc.title)) {
    errors.push('title must be a non-empty string');
  }

  if (!isPlainObject(doc.grounded)) {
    errors.push('grounded must be an object');
  } else {
    if (!isNonEmptyString(doc.grounded.graphId)) {
      errors.push('grounded.graphId must be a non-empty string');
    }
    if (doc.grounded.repoPath !== undefined && typeof doc.grounded.repoPath !== 'string') {
      errors.push('grounded.repoPath must be a string');
    }
    if (doc.grounded.scopeNodeIds !== undefined) {
      if (!Array.isArray(doc.grounded.scopeNodeIds)) {
        errors.push('grounded.scopeNodeIds must be an array');
      } else {
        doc.grounded.scopeNodeIds.forEach((id, i) => {
          if (!isNonEmptyString(id)) errors.push(`grounded.scopeNodeIds[${i}] must be a non-empty string`);
        });
      }
    }
    if (
      doc.grounded.origin !== undefined &&
      (typeof doc.grounded.origin !== 'string' ||
        !SEQ_DIAGRAM_ORIGINS.includes(doc.grounded.origin as SeqDiagramOrigin))
    ) {
      errors.push(`invalid grounded.origin (expected one of: ${SEQ_DIAGRAM_ORIGINS.join(', ')})`);
    }
    if (doc.grounded.unknowns !== undefined) {
      if (!Array.isArray(doc.grounded.unknowns)) {
        errors.push('grounded.unknowns must be an array');
      } else {
        doc.grounded.unknowns.forEach((u, i) => {
          if (!isNonEmptyString(u)) errors.push(`grounded.unknowns[${i}] must be a non-empty string`);
        });
      }
    }
  }

  if (doc.theme !== undefined) {
    if (
      typeof doc.theme !== 'string' ||
      !SEQ_DIAGRAM_THEMES.includes(doc.theme as SeqDiagramTheme)
    ) {
      errors.push(`invalid theme (expected one of: ${SEQ_DIAGRAM_THEMES.join(', ')})`);
    }
  }

  const rawNodes = Array.isArray(doc.nodes) ? doc.nodes : null;
  if (rawNodes === null) {
    errors.push('nodes must be an array');
  } else {
    coerceMissingNodeKind(doc);
    coerceNodeNameToLabel(doc);
  }

  const rawEdges = Array.isArray(doc.edges) ? doc.edges : null;
  if (rawEdges === null) {
    errors.push('edges must be an array');
  }

  const nodes: SeqDiagramNode[] = [];
  if (rawNodes) {
    rawNodes.forEach((n, i) => {
      if (!isPlainObject(n)) {
        errors.push(`node[${i}] is not an object`);
        return;
      }
      if (!isNonEmptyString(n.id)) errors.push(`node[${i}] has an empty id`);
      if (!isNonEmptyString(n.label)) errors.push(`node[${i}] has an empty label`);
      if (
        typeof n.kind !== 'string' ||
        !SEQ_DIAGRAM_NODE_KINDS.includes(n.kind as SeqDiagramNodeKind)
      ) {
        errors.push(`node[${i}] has invalid kind`);
      }
      if (
        n.role !== undefined &&
        (typeof n.role !== 'string' ||
          !SEQ_DIAGRAM_NODE_ROLES.includes(n.role as SeqDiagramNodeRole))
      ) {
        errors.push(`node[${i}] has invalid role`);
      }
      if (n.primary !== undefined && typeof n.primary !== 'boolean') {
        errors.push(`node[${i}] primary must be a boolean`);
      }
      if (n.evidenceRef !== undefined && typeof n.evidenceRef !== 'string') {
        errors.push(`node[${i}] evidenceRef must be a string`);
      }
      if (n.detail !== undefined) {
        if (!isPlainObject(n.detail)) {
          errors.push(`node[${i}] detail must be an object`);
        } else {
          if (n.detail.whatItIs !== undefined && typeof n.detail.whatItIs !== 'string') {
            errors.push(`node[${i}] detail.whatItIs must be a string`);
          }
          if (n.detail.whatItDoes !== undefined && typeof n.detail.whatItDoes !== 'string') {
            errors.push(`node[${i}] detail.whatItDoes must be a string`);
          }
          if (n.detail.parts !== undefined) {
            if (!Array.isArray(n.detail.parts)) {
              errors.push(`node[${i}] detail.parts must be an array`);
            } else {
              n.detail.parts.forEach((p, j) => {
                if (!isNonEmptyString(p)) errors.push(`node[${i}] detail.parts[${j}] must be a non-empty string`);
              });
            }
          }
          if (n.detail.talksTo !== undefined) {
            if (!Array.isArray(n.detail.talksTo)) {
              errors.push(`node[${i}] detail.talksTo must be an array`);
            } else {
              n.detail.talksTo.forEach((t, j) => {
                if (!isNonEmptyString(t)) errors.push(`node[${i}] detail.talksTo[${j}] must be a non-empty string`);
              });
            }
          }
        }
      }
      if (n.agent !== undefined) {
        if (!isPlainObject(n.agent)) {
          errors.push(`node[${i}] agent must be an object`);
        } else {
          if (!isNonEmptyString(n.agent.prompt)) {
            errors.push(`node[${i}] agent.prompt must be a non-empty string`);
          }
          if (n.agent.agentRef !== undefined && typeof n.agent.agentRef !== 'string') {
            errors.push(`node[${i}] agent.agentRef must be a string`);
          }
          if (n.agent.scopeFiles !== undefined) {
            if (!Array.isArray(n.agent.scopeFiles)) {
              errors.push(`node[${i}] agent.scopeFiles must be an array`);
            } else {
              n.agent.scopeFiles.forEach((p, j) => {
                if (!isNonEmptyString(p)) {
                  errors.push(`node[${i}] agent.scopeFiles[${j}] must be a non-empty string`);
                }
              });
            }
          }
          if (
            n.agent.runtime !== undefined &&
            n.agent.runtime !== 'gateway' &&
            n.agent.runtime !== 'acp'
          ) {
            errors.push(`node[${i}] agent.runtime must be 'gateway' or 'acp'`);
          }
        }
      }
      if (
        doc.kind === 'agent-workflow' &&
        n.kind === 'agent' &&
        (!isPlainObject(n.agent) || !isNonEmptyString(n.agent.prompt))
      ) {
        errors.push(`node[${i}] kind agent on agent-workflow requires agent.prompt`);
      }
      nodes.push(n as unknown as SeqDiagramNode);
    });
  }

  const nodeIds = new Set<string>();
  for (const n of nodes) {
    if (nodeIds.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    nodeIds.add(n.id);
  }

  const edges: SeqDiagramEdge[] = [];
  if (rawEdges) {
    rawEdges.forEach((e, i) => {
      if (!isPlainObject(e)) {
        errors.push(`edge[${i}] is not an object`);
        return;
      }
      if (!isNonEmptyString(e.id)) errors.push(`edge[${i}] has an empty id`);
      if (!isNonEmptyString(e.from)) errors.push(`edge[${i}] has an empty from`);
      if (!isNonEmptyString(e.to)) errors.push(`edge[${i}] has an empty to`);
      if (
        typeof e.family !== 'string' ||
        !SEQ_DIAGRAM_EDGE_FAMILIES.includes(e.family as SeqDiagramEdgeFamily)
      ) {
        errors.push(`edge[${i}] has invalid family`);
      }
      if (e.label !== undefined && typeof e.label !== 'string') {
        errors.push(`edge[${i}] label must be a string`);
      }
      if (e.evidenceRef !== undefined && typeof e.evidenceRef !== 'string') {
        errors.push(`edge[${i}] evidenceRef must be a string`);
      }
      edges.push(e as unknown as SeqDiagramEdge);
    });
  }

  const edgeIds = new Set<string>();
  for (const e of edges) {
    if (edgeIds.has(e.id)) errors.push(`duplicate edge id: ${e.id}`);
    edgeIds.add(e.id);
    if (!nodeIds.has(e.from)) errors.push(`edge ${e.id} has unknown from-node ${e.from}`);
    if (!nodeIds.has(e.to)) errors.push(`edge ${e.id} has unknown to-node ${e.to}`);
  }

  function validateIdArray(
    ids: unknown,
    label: string,
    requireNonEmptyItems: boolean
  ): string[] | null {
    if (!Array.isArray(ids)) {
      errors.push(`${label} must be an array`);
      return null;
    }
    const out: string[] = [];
    ids.forEach((id, i) => {
      if (!isNonEmptyString(id)) {
        errors.push(`${label}[${i}] must be a non-empty string`);
      } else {
        out.push(id);
      }
    });
    if (requireNonEmptyItems && out.length === 0 && ids.length === 0) {
      errors.push(`${label} must not be empty`);
    }
    return out;
  }

  function validateMemberRefs(memberIds: string[] | null, label: string) {
    if (!memberIds) return;
    memberIds.forEach((mid) => {
      if (!nodeIds.has(mid)) errors.push(`${label} references unknown node ${mid}`);
    });
  }

  function validateEdgeRefs(edgeIdList: string[] | null, label: string) {
    if (!edgeIdList) return;
    edgeIdList.forEach((eid) => {
      if (!edgeIds.has(eid)) errors.push(`${label} references unknown edge ${eid}`);
    });
  }

  if (doc.primaryNodeIds !== undefined) {
    const primaryIds = validateIdArray(doc.primaryNodeIds, 'primaryNodeIds', false);
    if (primaryIds) {
      primaryIds.forEach((pid) => {
        if (!nodeIds.has(pid)) errors.push(`primaryNodeIds references unknown node ${pid}`);
      });
    }
  }

  if (doc.unknowns !== undefined) {
    if (!Array.isArray(doc.unknowns)) {
      errors.push('unknowns must be an array');
    } else {
      doc.unknowns.forEach((u, i) => {
        if (!isNonEmptyString(u)) errors.push(`unknowns[${i}] must be a non-empty string`);
      });
    }
  }

  const groupIds = new Set<string>();
  if (doc.groups !== undefined) {
    if (!Array.isArray(doc.groups)) {
      errors.push('groups must be an array');
    } else {
      doc.groups.forEach((g, i) => {
        if (!isPlainObject(g)) {
          errors.push(`groups[${i}] is not an object`);
          return;
        }
        if (!isNonEmptyString(g.id)) errors.push(`groups[${i}] has an empty id`);
        if (!isNonEmptyString(g.label)) errors.push(`groups[${i}] has an empty label`);
        const members = validateIdArray(g.memberIds, `groups[${i}].memberIds`, true);
        validateMemberRefs(members, `groups[${i}].memberIds`);
        if (isNonEmptyString(g.id)) {
          if (groupIds.has(g.id)) errors.push(`duplicate group id: ${g.id}`);
          groupIds.add(g.id);
        }
      });
    }
  }

  const flowIds = new Set<string>();
  if (doc.flows !== undefined) {
    if (!Array.isArray(doc.flows)) {
      errors.push('flows must be an array');
    } else {
      doc.flows.forEach((f, i) => {
        if (!isPlainObject(f)) {
          errors.push(`flows[${i}] is not an object`);
          return;
        }
        if (!isNonEmptyString(f.id)) errors.push(`flows[${i}] has an empty id`);
        if (!isNonEmptyString(f.label)) errors.push(`flows[${i}] has an empty label`);
        const flowNodes = validateIdArray(f.nodeIds, `flows[${i}].nodeIds`, true);
        if (flowNodes) {
          flowNodes.forEach((nid) => {
            if (!nodeIds.has(nid)) errors.push(`flows[${i}].nodeIds references unknown node ${nid}`);
          });
        }
        if (f.edgeIds !== undefined) {
          const flowEdges = validateIdArray(f.edgeIds, `flows[${i}].edgeIds`, false);
          validateEdgeRefs(flowEdges, `flows[${i}].edgeIds`);
        }
        if (isNonEmptyString(f.id)) {
          if (flowIds.has(f.id)) errors.push(`duplicate flow id: ${f.id}`);
          flowIds.add(f.id);
        }
      });
    }
  }

  const boundaryIds = new Set<string>();
  if (doc.boundaries !== undefined) {
    if (!Array.isArray(doc.boundaries)) {
      errors.push('boundaries must be an array');
    } else {
      doc.boundaries.forEach((b, i) => {
        if (!isPlainObject(b)) {
          errors.push(`boundaries[${i}] is not an object`);
          return;
        }
        if (!isNonEmptyString(b.id)) errors.push(`boundaries[${i}] has an empty id`);
        if (!isNonEmptyString(b.label)) errors.push(`boundaries[${i}] has an empty label`);
        if (b.external !== undefined && typeof b.external !== 'boolean') {
          errors.push(`boundaries[${i}].external must be a boolean`);
        }
        if (b.evidenceRef !== undefined && typeof b.evidenceRef !== 'string') {
          errors.push(`boundaries[${i}].evidenceRef must be a string`);
        }
        if (b.memberIds !== undefined) {
          const members = validateIdArray(b.memberIds, `boundaries[${i}].memberIds`, false);
          validateMemberRefs(members, `boundaries[${i}].memberIds`);
        }
        if (isNonEmptyString(b.id)) {
          if (boundaryIds.has(b.id)) errors.push(`duplicate boundary id: ${b.id}`);
          boundaryIds.add(b.id);
        }
      });
    }
  }

  const externalDepIds = new Set<string>();
  if (doc.externalDependencies !== undefined) {
    if (!Array.isArray(doc.externalDependencies)) {
      errors.push('externalDependencies must be an array');
    } else {
      doc.externalDependencies.forEach((d, i) => {
        if (!isPlainObject(d)) {
          errors.push(`externalDependencies[${i}] is not an object`);
          return;
        }
        if (!isNonEmptyString(d.id)) errors.push(`externalDependencies[${i}] has an empty id`);
        if (!isNonEmptyString(d.label)) errors.push(`externalDependencies[${i}] has an empty label`);
        if (d.evidenceRef !== undefined && typeof d.evidenceRef !== 'string') {
          errors.push(`externalDependencies[${i}].evidenceRef must be a string`);
        }
        if (d.boundaryNodeId !== undefined) {
          if (!isNonEmptyString(d.boundaryNodeId)) {
            errors.push(`externalDependencies[${i}].boundaryNodeId must be a non-empty string`);
          } else if (!nodeIds.has(d.boundaryNodeId)) {
            errors.push(
              `externalDependencies[${i}].boundaryNodeId references unknown node ${d.boundaryNodeId}`
            );
          }
        }
        if (isNonEmptyString(d.id)) {
          if (externalDepIds.has(d.id)) errors.push(`duplicate external dependency id: ${d.id}`);
          externalDepIds.add(d.id);
        }
      });
    }
  }

  if (doc.layout !== undefined) {
    if (!isPlainObject(doc.layout)) {
      errors.push('layout must be an object');
    } else {
      const engines: SeqDiagramLayoutEngine[] = ['sequence', 'layered-flow', 'grid', 'circular-loop'];
      const directions: SeqDiagramLayoutDirection[] = ['LR', 'TD'];
      if (
        doc.layout.engine !== undefined &&
        (typeof doc.layout.engine !== 'string' || !engines.includes(doc.layout.engine as SeqDiagramLayoutEngine))
      ) {
        errors.push('layout.engine must be sequence, layered-flow, grid, or circular-loop');
      }
      if (
        doc.layout.direction !== undefined &&
        (typeof doc.layout.direction !== 'string' ||
          !directions.includes(doc.layout.direction as SeqDiagramLayoutDirection))
      ) {
        errors.push('layout.direction must be LR or TD');
      }
      if (doc.layout.showTitleBlock !== undefined && typeof doc.layout.showTitleBlock !== 'boolean') {
        errors.push('layout.showTitleBlock must be a boolean');
      }
    }
  }

  if (doc.projections !== undefined) {
    if (!isPlainObject(doc.projections)) {
      errors.push('projections must be an object');
    } else {
      if (doc.projections.mermaid !== undefined && typeof doc.projections.mermaid !== 'string') {
        errors.push('projections.mermaid must be a string');
      }
      if (doc.projections.capNote !== undefined && typeof doc.projections.capNote !== 'string') {
        errors.push('projections.capNote must be a string');
      }
    }
  }

  if (doc.meta !== undefined) {
    if (!isPlainObject(doc.meta)) {
      errors.push('meta must be an object');
    } else {
      if (doc.meta.createdAt !== undefined && typeof doc.meta.createdAt !== 'string') {
        errors.push('meta.createdAt must be a string');
      }
      if (doc.meta.generator !== undefined && typeof doc.meta.generator !== 'string') {
        errors.push('meta.generator must be a string');
      }
      if (
        doc.meta.diagramFamily !== undefined &&
        doc.meta.diagramFamily !== 'software' &&
        doc.meta.diagramFamily !== 'process'
      ) {
        errors.push('meta.diagramFamily must be "software" or "process"');
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** True when {@link validateSeqDiagram} finds nothing wrong — typed narrowing helper. */
export function isValidSeqDiagram(doc: unknown): doc is SeqDiagramV1 {
  return validateSeqDiagram(doc).ok;
}
