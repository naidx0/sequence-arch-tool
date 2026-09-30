/**
 * Grounded resilience-pattern advisor — single source for web + analyzer.
 * Spec: docs/tier-3-test-spec.md (file no longer exists; the living record is docs/adr/ADR-010-three-tier-completion-program.md) Layer 3 · docs/decisions/tier-p5-patterns.md
 */
import type { ArchEdge, ArchGraph, ArchNode } from '../index.js';
import {
  RESILIENCE_PATTERNS,
  type ResiliencePattern,
  type ResiliencePatternId,
} from './index.js';

export type PatternEvidenceRef =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string };

export interface PatternAdvisorySuggestion {
  patternId: ResiliencePatternId;
  ruleIds: string[];
  evidenceRefs: PatternEvidenceRef[];
}

/** One rule per row — analyzer compatibility shape. */
export interface PatternAdvisoryFinding {
  patternId: ResiliencePatternId;
  ruleId: string;
  evidenceRefs: PatternEvidenceRef[];
}

const DB_READ_KINDS = new Set<ArchEdge['kind']>(['db_read', 'db_access']);
const RPC_KINDS = new Set<ArchEdge['kind']>(['http', 'grpc']);

function nodeById(graph: ArchGraph): Map<string, ArchNode> {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

function isPostgresDatastore(node: ArchNode | undefined): boolean {
  return node?.kind === 'datastore' && node.meta?.tech === 'postgres';
}

function isRedisDatastore(node: ArchNode | undefined): boolean {
  return node?.kind === 'datastore' && node.meta?.tech === 'redis';
}

function hasResilienceEvidence(caller: ArchNode | undefined, edge: ArchEdge): boolean {
  const edgeResilience = edge.detail?.resilience ?? edge.detail?.breaker ?? edge.detail?.timeout;
  if (typeof edgeResilience === 'string' && edgeResilience.trim()) return true;
  if (edgeResilience === true) return true;

  const meta = caller?.meta;
  if (!meta) return false;
  const resilience = meta.resilience;
  if (typeof resilience === 'string') {
    return /breaker|timeout|bulkhead/i.test(resilience);
  }
  if (resilience && typeof resilience === 'object') {
    const r = resilience as Record<string, unknown>;
    return Boolean(r.breaker || r.timeout || r.bulkhead);
  }
  return false;
}

function hasIdempotencyEvidence(consumer: ArchNode | undefined, graph: ArchGraph): boolean {
  if (!consumer) return false;
  const meta = consumer.meta;
  if (meta?.idempotencyKey || meta?.dedup) return true;

  for (const e of graph.edges) {
    if (e.srcId !== consumer.id) continue;
    if (e.kind === 'db_read' || e.kind === 'db_access' || e.kind === 'db_write') {
      const dst = graph.nodes.find((n) => n.id === e.dstId);
      if (dst?.meta?.role === 'dedup' || dst?.label?.toLowerCase().includes('dedup')) {
        return true;
      }
    }
  }
  return false;
}

function callerReadsRedis(callerId: string, edges: ArchEdge[], nodes: Map<string, ArchNode>): boolean {
  for (const e of edges) {
    if (e.srcId !== callerId || !DB_READ_KINDS.has(e.kind)) continue;
    if (isRedisDatastore(nodes.get(e.dstId))) return true;
  }
  return false;
}

function readCacheFindings(
  graph: ArchGraph,
  pattern: ResiliencePattern,
): PatternAdvisorySuggestion[] {
  const nodes = nodeById(graph);
  const ruleIds: string[] = [];
  const evidenceRefs: PatternEvidenceRef[] = [];
  const hasRedisDatastore = [...nodes.values()].some((n) => isRedisDatastore(n));

  for (const edge of graph.edges) {
    if (!DB_READ_KINDS.has(edge.kind)) continue;
    const store = nodes.get(edge.dstId);
    if (!isPostgresDatastore(store)) continue;
    if (callerReadsRedis(edge.srcId, graph.edges, nodes)) continue;

    ruleIds.push('edge:db_read-without-cache-hop');
    evidenceRefs.push(
      { kind: 'edge', id: edge.id },
      { kind: 'node', id: edge.srcId },
      { kind: 'node', id: edge.dstId },
    );
  }

  if (!hasRedisDatastore && evidenceRefs.length > 0) {
    const redisRule = pattern.checkerRules.find((r) => r.id === 'node:missing-cache-datastore');
    if (redisRule) {
      ruleIds.push(redisRule.id);
      for (const n of nodes.values()) {
        if (isPostgresDatastore(n)) evidenceRefs.push({ kind: 'node', id: n.id });
      }
    }
  }

  if (ruleIds.length === 0) return [];
  return [
    {
      patternId: pattern.id as ResiliencePatternId,
      ruleIds: [...new Set(ruleIds)],
      evidenceRefs,
    },
  ];
}

function circuitBreakerFindings(
  graph: ArchGraph,
  pattern: ResiliencePattern,
): PatternAdvisorySuggestion[] {
  const nodes = nodeById(graph);
  const byCaller = new Map<string, ArchEdge[]>();

  for (const edge of graph.edges) {
    if (!RPC_KINDS.has(edge.kind)) continue;
    const dst = nodes.get(edge.dstId);
    if (dst?.kind !== 'service') continue;
    const list = byCaller.get(edge.srcId) ?? [];
    list.push(edge);
    byCaller.set(edge.srcId, list);
  }

  const ruleIds: string[] = [];
  const evidenceRefs: PatternEvidenceRef[] = [];

  for (const [callerId, outbound] of byCaller) {
    if (outbound.length < 2) continue;
    const caller = nodes.get(callerId);
    const anyResilience = outbound.some((e) => hasResilienceEvidence(caller, e));
    if (anyResilience) continue;

    ruleIds.push('edge:http-fanout-no-breaker');
    evidenceRefs.push(
      { kind: 'node', id: callerId },
      ...outbound.map((e) => ({ kind: 'edge' as const, id: e.id })),
      ...outbound.map((e) => ({ kind: 'node' as const, id: e.dstId })),
    );
  }

  if (ruleIds.length === 0) return [];
  return [
    {
      patternId: pattern.id as ResiliencePatternId,
      ruleIds: [...new Set(ruleIds)],
      evidenceRefs,
    },
  ];
}

function idempotentConsumerFindings(
  graph: ArchGraph,
  pattern: ResiliencePattern,
): PatternAdvisorySuggestion[] {
  const nodes = nodeById(graph);
  const ruleIds: string[] = [];
  const evidenceRefs: PatternEvidenceRef[] = [];

  for (const edge of graph.edges) {
    if (edge.kind !== 'queue_consume') continue;
    const topic = nodes.get(edge.dstId);
    if (topic?.kind !== 'topic') continue;

    const consumer = nodes.get(edge.srcId);
    if (hasIdempotencyEvidence(consumer, graph)) continue;

    ruleIds.push('edge:queue_consume-no-idempotency');
    evidenceRefs.push(
      { kind: 'edge', id: edge.id },
      { kind: 'node', id: edge.srcId },
      { kind: 'node', id: edge.dstId },
    );
  }

  if (ruleIds.length === 0) return [];
  return [
    {
      patternId: pattern.id as ResiliencePatternId,
      ruleIds: [...new Set(ruleIds)],
      evidenceRefs,
    },
  ];
}

const PATTERN_DETECTORS: Record<
  ResiliencePatternId,
  (graph: ArchGraph, pattern: ResiliencePattern) => PatternAdvisorySuggestion[]
> = {
  'read-cache': readCacheFindings,
  'circuit-breaker': circuitBreakerFindings,
  'idempotent-consumer': idempotentConsumerFindings,
};

/** Patterns whose scan evidence satisfies catalog preconditions. */
export function evaluateResilienceSuggestions(
  graph: ArchGraph,
  patterns: ResiliencePattern[] = RESILIENCE_PATTERNS,
): PatternAdvisorySuggestion[] {
  const suggestions: PatternAdvisorySuggestion[] = [];
  for (const pattern of patterns) {
    const detector = PATTERN_DETECTORS[pattern.id as ResiliencePatternId];
    if (!detector) continue;
    suggestions.push(...detector(graph, pattern));
  }
  return suggestions;
}

/** Flattened findings — one row per checker rule id (analyzer moat lock). */
export function patternAdvisor(
  graph: ArchGraph,
  patterns: ResiliencePattern[] = RESILIENCE_PATTERNS,
): PatternAdvisoryFinding[] {
  const findings: PatternAdvisoryFinding[] = [];
  for (const suggestion of evaluateResilienceSuggestions(graph, patterns)) {
    for (const ruleId of suggestion.ruleIds) {
      findings.push({
        patternId: suggestion.patternId,
        ruleId,
        evidenceRefs: suggestion.evidenceRefs,
      });
    }
  }
  return findings;
}
