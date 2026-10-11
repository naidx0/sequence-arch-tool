/**
 * Tier-3 resilience pattern catalog (moat layer 3).
 * Spec: docs/tier-3-test-spec.md (file no longer exists; the living record is docs/adr/ADR-010-three-tier-completion-program.md) · docs/decisions/tier-p5-patterns.md
 */
import type { ResiliencePattern } from './index.js';

export const RESILIENCE_PATTERNS: ResiliencePattern[] = [
  {
    id: 'read-cache',
    domain: 'data-access',
    appliesWhen:
      'A service issues db_read or db_access to a postgres datastore on a hot path and no redis ' +
      'cache datastore sits between the caller and the store in scan evidence.',
    checkerRules: [
      {
        id: 'edge:db_read-without-cache-hop',
        description:
          'ArchEdge.kind is db_read or db_access with dstId targeting a datastore node ' +
          '(meta.tech postgres) and no parallel db_read/db_access edge targets meta.tech redis ' +
          'for the same caller — grounded in scan evidence file:line.',
      },
      {
        id: 'node:missing-cache-datastore',
        description:
          'No datastore node with meta.tech redis appears on any read path from the hot caller ' +
          'to the cited postgres node in the ArchGraph edge list.',
      },
    ],
  },
  {
    id: 'circuit-breaker',
    domain: 'service-mesh',
    appliesWhen:
      'A service fans out over http or grpc to two or more downstream services without breaker ' +
      'or timeout evidence on those outbound edges (shopfront gateway → orders/payments/shipping).',
    checkerRules: [
      {
        id: 'edge:http-fanout-no-breaker',
        description:
          'Caller has ≥2 outbound http/grpc ArchEdges and no edge detail or service meta cites ' +
          'breaker, timeout, or bulkhead configuration — scan evidence only, not LLM prose.',
      },
      {
        id: 'meta:missing-resilience-hint',
        description:
          'Downstream http/grpc targets lack meta.resilience (breaker | timeout | bulkhead) on the ' +
          'caller service node when fan-out count ≥ 2.',
      },
    ],
  },
  {
    id: 'idempotent-consumer',
    domain: 'messaging',
    appliesWhen:
      'A service consumes from a topic via queue_consume (e.g. notifications or shipping on ' +
      'topic:order.created) without idempotency-key or dedup evidence in scan.',
    checkerRules: [
      {
        id: 'edge:queue_consume-no-idempotency',
        description:
          'ArchEdge.kind is queue_consume with dstId targeting a topic node and the consumer ' +
          'service has no meta.idempotencyKey or dedup table edge in scan evidence.',
      },
      {
        id: 'evidence:missing-dedup-anchor',
        description:
          'No file:line evidence on the consumer references idempotency keys, dedup stores, or ' +
          'at-least-once safe handlers — required before the pattern can be marked satisfied.',
      },
    ],
  },
];
