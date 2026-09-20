import type {
  ArchEdge,
  ArchGraph,
  FunctionEdgeKind,
  FunctionGraph,
  FunctionNodeKind,
} from '@sequence/schema';
import { functionEdgeId, functionNodeId } from '@sequence/schema';
import type { FunctionFact } from '../types.js';
import { enclosingFunction } from './buildFunctionGraph.js';

const INTERACTION_KINDS = new Set<ArchEdge['kind']>([
  'http',
  'grpc',
  'queue_publish',
  'queue_consume',
  'db_read',
  'db_write',
  'db_access',
]);

function archKindToFnKind(kind: ArchEdge['kind']): FunctionEdgeKind | undefined {
  if (kind === 'http') return 'http';
  if (kind === 'grpc') return 'grpc';
  if (kind === 'queue_publish' || kind === 'queue_consume') return 'queue';
  if (kind === 'db_read' || kind === 'db_write' || kind === 'db_access') return 'db';
  return undefined;
}

function boundaryKindForId(nodeId: string, archGraph: ArchGraph): FunctionNodeKind | undefined {
  const archNode = archGraph.nodes.find((n) => n.id === nodeId);
  if (archNode) {
    if (archNode.kind === 'service') return 'service';
    if (archNode.kind === 'datastore') return 'datastore';
    if (archNode.kind === 'topic') return 'topic';
    return undefined;
  }
  if (nodeId.startsWith('svc:')) return 'service';
  if (nodeId.startsWith('ds:')) return 'datastore';
  if (nodeId.startsWith('topic:')) return 'topic';
  return undefined;
}

/** Map an arch dstId to a service/topic/datastore boundary when needed. */
function boundaryTargetId(archEdge: ArchEdge, archGraph: ArchGraph): string | undefined {
  const dst = archEdge.dstId;
  if (dst.startsWith('svc:') || dst.startsWith('ds:') || dst.startsWith('topic:')) return dst;

  if (dst.startsWith('file:')) {
    const fileNode = archGraph.nodes.find((n) => n.id === dst);
    let cur = fileNode?.parentId;
    while (cur) {
      const n = archGraph.nodes.find((x) => x.id === cur);
      if (!n) break;
      if (n.kind === 'service' || n.kind === 'datastore' || n.kind === 'topic') return n.id;
      cur = n.parentId;
    }
    const ts = archEdge.detail?.targetService;
    if (typeof ts === 'string' && ts) return `svc:${ts}`;
  }
  return undefined;
}

function fnNodeId(file: string, fn: FunctionFact): string {
  return functionNodeId(file, fn.name, fn.startLine);
}

function edgeLabel(archEdge: ArchEdge): string | undefined {
  for (let i = archEdge.evidence.length - 1; i >= 0; i--) {
    const note = archEdge.evidence[i]?.note;
    if (note) return note;
  }
  const d = archEdge.detail;
  if (d?.method && d?.pathPattern) return `${d.method} ${d.pathPattern}`;
  if (d?.topic) return String(d.topic);
  if (d?.table) return String(d.table);
  if (d?.matchedRoute) return String(d.matchedRoute);
  return undefined;
}

/**
 * Attribute arch interaction edges to enclosing functions and append
 * function↔function or function→boundary edges. Pure, deterministic, never throws.
 */
export function enrichWithCrossServiceEdges(
  graph: FunctionGraph,
  archGraph: ArchGraph | undefined,
  functionsByFile: Map<string, FunctionFact[]>
): FunctionGraph {
  if (!archGraph || !Array.isArray(archGraph.edges)) return graph;

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const edgeIds = new Set(graph.edges.map((e) => e.id));
  const nodes = [...graph.nodes];
  const edges = [...graph.edges];

  const ensureBoundaryNode = (boundaryId: string): string | undefined => {
    if (nodeById.has(boundaryId)) return boundaryId;
    const kind = boundaryKindForId(boundaryId, archGraph);
    if (!kind) return undefined;
    const archNode = archGraph.nodes.find((n) => n.id === boundaryId);
    const boundary: (typeof nodes)[0] = {
      id: boundaryId,
      name: archNode?.label ?? boundaryId.split(':').slice(1).join(':'),
      file: archNode?.path ?? '',
      startLine: 0,
      endLine: 0,
      lang: (archNode?.meta?.language as string | undefined) ?? '',
      kind,
    };
    nodes.push(boundary);
    nodeById.set(boundaryId, boundary);
    return boundaryId;
  };

  const ensureFnNode = (file: string, fn: FunctionFact): string => {
    const id = fnNodeId(file, fn);
    if (!nodeById.has(id)) {
      const node = { id, name: fn.name, file, startLine: fn.startLine, endLine: fn.endLine, lang: '' };
      nodes.push(node);
      nodeById.set(id, node);
    }
    return id;
  };

  const resolveFnAtEvidence = (
    ev: { file: string; line: number } | undefined
  ): string | undefined => {
    if (!ev?.file || ev.line <= 0) return undefined;
    const fns = functionsByFile.get(ev.file);
    if (!fns) return undefined;
    const fn = enclosingFunction(ev.line, fns);
    if (!fn) return undefined;
    return ensureFnNode(ev.file, fn);
  };

  /**
   * Resolve a route's handler-argument name (`router.get('/x', listOrders)`)
   * to the function that actually defines it, so the server side of an http
   * function edge lands on the code that serves the request rather than the
   * enclosing function at the registration call. Same-file first — the
   * common case, and unambiguous by construction; otherwise a name that is
   * unique across every function this scan knows about. More than one match,
   * or none at all, is genuinely ambiguous: the caller must fall back to the
   * registration site and say so, not guess.
   */
  const resolveHandlerFn = (
    handlerName: string,
    registrationFile: string
  ): { file: string; fn: FunctionFact } | 'ambiguous' | undefined => {
    const sameFile = (functionsByFile.get(registrationFile) ?? []).filter((fn) => fn.name === handlerName);
    if (sameFile.length === 1) return { file: registrationFile, fn: sameFile[0] };
    if (sameFile.length > 1) return 'ambiguous';

    const crossFile: { file: string; fn: FunctionFact }[] = [];
    for (const [file, fns] of functionsByFile) {
      if (file === registrationFile) continue;
      for (const fn of fns) {
        if (fn.name === handlerName) crossFile.push({ file, fn });
      }
    }
    if (crossFile.length === 1) return crossFile[0];
    if (crossFile.length > 1) return 'ambiguous';
    return undefined;
  };

  const ambiguities: string[] = [];

  for (const archEdge of archGraph.edges) {
    if (!INTERACTION_KINDS.has(archEdge.kind)) continue;
    const fnKind = archKindToFnKind(archEdge.kind);
    if (!fnKind) continue;

    const srcFnId = resolveFnAtEvidence(archEdge.evidence[0]);
    if (!srcFnId) continue;

    const regEv = archEdge.evidence[1];
    const handlerName =
      fnKind === 'http' && typeof archEdge.detail?.handlerName === 'string'
        ? archEdge.detail.handlerName
        : undefined;

    let serverFnId: string | undefined;
    let unresolvedHandler = false;
    if (handlerName && regEv?.file) {
      const resolved = resolveHandlerFn(handlerName, regEv.file);
      if (resolved && resolved !== 'ambiguous') {
        serverFnId = ensureFnNode(resolved.file, resolved.fn);
      } else {
        // Honest coarse fallback — the registration site is still real
        // evidence, it's just not the handler. Say so instead of going
        // quiet: silence here is the exact failure mode that cost this
        // project three rounds (see discovery/compose.ts's ambiguity note).
        serverFnId = resolveFnAtEvidence(regEv);
        unresolvedHandler = true;
        const why = resolved === 'ambiguous' ? 'matches more than one function' : 'matches no known function';
        ambiguities.push(
          `route handler "${handlerName}" registered at ${regEv.file}:${regEv.line} ${why} — attributed to the registration site instead of the handler`
        );
      }
    } else {
      serverFnId = regEv ? resolveFnAtEvidence(regEv) : undefined;
    }

    let dstId: string | undefined;
    if (serverFnId) {
      dstId = serverFnId;
    } else {
      const boundaryId = boundaryTargetId(archEdge, archGraph);
      if (!boundaryId) continue;
      dstId = ensureBoundaryNode(boundaryId);
    }
    if (!dstId) continue;

    const id = functionEdgeId(fnKind, srcFnId, dstId);
    if (edgeIds.has(id)) continue;
    edgeIds.add(id);
    const baseLabel = edgeLabel(archEdge);
    edges.push({
      id,
      srcId: srcFnId,
      dstId,
      kind: fnKind,
      confidence: archEdge.confidence,
      label: unresolvedHandler
        ? [baseLabel, UNRESOLVED_HANDLER_NOTE].filter(Boolean).join(' — ')
        : baseLabel,
    });
  }

  lastServerAttributionAmbiguity = ambiguities.length > 0 ? ambiguities : undefined;

  nodes.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => a.id.localeCompare(b.id));
  return { nodes, edges };
}

/** Fixed, grep-able marker for an http function edge whose route had a named
 * handler we could not resolve (not found, or ambiguous across files) — the
 * edge still lands on the registration site, but must not read as a
 * confirmed handler attribution. */
export const UNRESOLVED_HANDLER_NOTE = 'handler unresolved — attributed to registration site';

/**
 * The route-handler resolution ambiguities the last `enrichWithCrossServiceEdges`
 * call hit, so the caller can report them instead of letting a downgrade to
 * the registration site pass as silently as a confirmed one. Module-scoped
 * read-and-clear, same pattern as discovery/compose.ts's
 * lastAmbiguity/takeAmbiguity — a stale value must never be attributed to a
 * later call, and silence here is the same failure mode that cost this
 * project three rounds elsewhere.
 */
let lastServerAttributionAmbiguity: string[] | undefined;
export function takeServerAttributionAmbiguity(): string[] | undefined {
  const v = lastServerAttributionAmbiguity;
  lastServerAttributionAmbiguity = undefined;
  return v;
}
