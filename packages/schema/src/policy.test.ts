import assert from 'node:assert';
import { test } from 'node:test';
import type { ArchEdge, ArchGraph } from './index.js';
import { isValidPolicy, validatePolicy, type Policy } from './policy.js';
import {
  checkPolicy,
  policyVerdictIsEmpty,
  resolvePolicyTarget,
  SYNC_EDGE_KINDS,
  type PolicyEdge,
} from './policyChecker.js';

/* ------------------------------- validatePolicy ------------------------------ */

test('validatePolicy accepts a grounded quant-firm policy', () => {
  const policy: Policy = {
    version: 1,
    name: 'Latency first',
    rules: [
      { kind: 'no-sync-into', target: 'svc:pricing', reason: 'the pricing path must stay non-blocking' },
      { kind: 'flag-network-hop' },
    ],
  };
  assert.deepEqual(validatePolicy(policy), []);
  assert.equal(isValidPolicy(policy), true);
});

test('validatePolicy reports EVERY problem in a malformed file, never just the first', () => {
  const errors = validatePolicy({
    version: 2,
    name: 7,
    rules: [
      { kind: 'no-sync-into' }, // missing target
      { kind: 'no-sync-into', target: '   ' }, // blank target
      { kind: 'teleport' }, // unknown kind
      { kind: 'flag-network-hop', reason: 12 }, // bad reason type
      'nope', // not an object
    ],
  });
  assert.ok(errors.some((e) => e.includes('version')), errors.join(' | '));
  assert.ok(errors.some((e) => e.includes('name must be a string')));
  assert.ok(errors.some((e) => e.includes('rule 0 (no-sync-into) needs a non-empty target')));
  assert.ok(errors.some((e) => e.includes('rule 1 (no-sync-into) needs a non-empty target')));
  assert.ok(errors.some((e) => e.includes('rule 2 has unknown kind "teleport"')));
  assert.ok(errors.some((e) => e.includes('rule 3 reason must be a string')));
  assert.ok(errors.some((e) => e.includes('rule 4 must be an object')));
});

test('validatePolicy refuses a non-object, a missing rules array, and an empty rule list', () => {
  assert.deepEqual(validatePolicy(null), ['policy must be a JSON object']);
  assert.deepEqual(validatePolicy([]), ['policy must be a JSON object']);
  assert.ok(validatePolicy({ version: 1 }).includes('policy must have a rules array'));
  assert.ok(validatePolicy({ version: 1, rules: [] }).includes('policy has no rules'));
  assert.ok(validatePolicy({ version: 1, scope: '  ', rules: [{ kind: 'flag-network-hop' }] }).some((e) => e.includes('scope must be a non-empty string')));
});

/* --------------------------------- fixtures --------------------------------- */

function edge(id: string, srcId: string, dstId: string, kind: ArchEdge['kind']): ArchEdge {
  return { id, srcId, dstId, kind, confidence: 1, origin: 'deterministic', evidence: [] };
}

/** gateway → orders → pricing. `pricing` is two hops from `gateway`. */
const real: ArchGraph = {
  version: 1,
  scannedAt: '',
  repoRoot: '/r',
  repoName: 'r',
  warnings: [],
  nodes: [
    { id: 'repo', kind: 'repo', label: 'r' },
    { id: 'svc:gateway', kind: 'service', label: 'Gateway', parentId: 'repo' },
    { id: 'svc:orders', kind: 'service', label: 'Orders', parentId: 'repo' },
    { id: 'svc:pricing', kind: 'service', label: 'Pricing', parentId: 'repo' },
    { id: 'svc:reports', kind: 'service', label: 'Reports', parentId: 'repo' },
  ],
  edges: [
    edge('e:gw-orders', 'svc:gateway', 'svc:orders', 'http'),
    edge('e:orders-pricing', 'svc:orders', 'svc:pricing', 'http'),
  ],
};

const withAdded = (added: ArchEdge[]): ArchGraph => ({ ...real, edges: [...real.edges, ...added] });

const asPolicyEdges = (edges: ArchEdge[]): PolicyEdge[] =>
  edges.map((e) => ({ srcId: e.srcId, dstId: e.dstId, kind: e.kind }));

const latencyFirst: Policy = {
  version: 1,
  name: 'Latency first',
  rules: [{ kind: 'no-sync-into', target: 'svc:pricing', reason: 'pricing must stay non-blocking' }],
};

/* -------------------------------- no-sync-into ------------------------------- */

test('no-sync-into BLOCKS a new sync edge that lands directly on the target', () => {
  const added = [edge('e:new', 'svc:reports', 'svc:pricing', 'http')];
  const v = checkPolicy(real, withAdded(added), asPolicyEdges(added), [latencyFirst]);
  assert.equal(v.ok, false);
  assert.equal(v.blocks.length, 1);
  assert.equal(v.warns.length, 0);
  const hit = v.blocks[0]!;
  assert.equal(hit.ruleKind, 'no-sync-into');
  assert.equal(hit.policyName, 'Latency first');
  assert.ok(hit.explanation.includes('no-sync-into'));
  assert.ok(hit.explanation.includes('svc:pricing'));
  assert.ok(hit.explanation.includes('pricing must stay non-blocking'));
});

test('no-sync-into BLOCKS a new sync edge that REACHES the target transitively', () => {
  // reports → gateway is two hops from pricing (gateway → orders → pricing).
  const added = [edge('e:new', 'svc:reports', 'svc:gateway', 'grpc')];
  const v = checkPolicy(real, withAdded(added), asPolicyEdges(added), [latencyFirst]);
  assert.equal(v.ok, false);
  assert.ok(v.blocks[0]!.explanation.includes('reaches svc:pricing through svc:gateway'));
});

test('no-sync-into does NOT fire on an async edge into the very same target', () => {
  const added = [edge('e:new', 'svc:reports', 'svc:pricing', 'queue_publish')];
  const v = checkPolicy(real, withAdded(added), asPolicyEdges(added), [latencyFirst]);
  assert.deepEqual(v, { ok: true, blocks: [], warns: [] });
  assert.equal(SYNC_EDGE_KINDS.has('queue_publish'), false);
});

test('no-sync-into does NOT fire when the target is unreachable from the new edge', () => {
  // pricing → reports: reports depends on nothing, so pricing is not downstream.
  const added = [edge('e:new', 'svc:pricing', 'svc:reports', 'http')];
  const v = checkPolicy(real, withAdded(added), asPolicyEdges(added), [latencyFirst]);
  assert.equal(v.ok, true);
  assert.equal(v.blocks.length, 0);
});

test('no-sync-into stays silent when its target resolves to nothing in this repo', () => {
  const elsewhere: Policy = { version: 1, rules: [{ kind: 'no-sync-into', target: 'svc:ledger' }] };
  const added = [edge('e:new', 'svc:reports', 'svc:pricing', 'http')];
  const v = checkPolicy(real, withAdded(added), asPolicyEdges(added), [elsewhere]);
  assert.equal(policyVerdictIsEmpty(v), true);
});

test('no-sync-into resolves a target by node LABEL, case-insensitively', () => {
  assert.deepEqual([...resolvePolicyTarget(real, ' pricing ')], ['svc:pricing']);
  const byLabel: Policy = { version: 1, rules: [{ kind: 'no-sync-into', target: 'Pricing' }] };
  const added = [edge('e:new', 'svc:reports', 'svc:pricing', 'http')];
  assert.equal(checkPolicy(real, withAdded(added), asPolicyEdges(added), [byLabel]).ok, false);
});

test('no-sync-into judges only ADDED edges — the existing sync call is the status quo', () => {
  // The real graph already has orders → pricing (http). With NOTHING added the
  // policy must be silent, or the rule could never be satisfied.
  assert.deepEqual(checkPolicy(real, real, [], [latencyFirst]), { ok: true, blocks: [], warns: [] });
});

/* ------------------------------ no-db-write-into ----------------------------- */

const realWithDb: ArchGraph = {
  ...real,
  nodes: [
    ...real.nodes,
    { id: 'ds:postgres', kind: 'datastore', label: 'Postgres', parentId: 'repo' },
  ],
  edges: [...real.edges, edge('e:orders-pg', 'svc:orders', 'ds:postgres', 'db_read')],
};

const noWritePostgres: Policy = {
  version: 1,
  name: 'Write cap',
  rules: [{ kind: 'no-db-write-into', target: 'ds:postgres', reason: 'orders must not write here' }],
};

test('no-db-write-into BLOCKS a new db_write edge that lands on the target', () => {
  const added = [edge('e:new', 'svc:reports', 'ds:postgres', 'db_write')];
  const v = checkPolicy(realWithDb, withAdded(added), asPolicyEdges(added), [noWritePostgres]);
  assert.equal(v.ok, false);
  assert.equal(v.blocks.length, 1);
  const hit = v.blocks[0]!;
  assert.equal(hit.ruleKind, 'no-db-write-into');
  assert.equal(hit.policyName, 'Write cap');
  assert.ok(hit.explanation.includes('no-db-write-into'));
  assert.ok(hit.explanation.includes('ds:postgres'));
  assert.ok(hit.explanation.includes('orders must not write here'));
});

test('no-db-write-into does NOT fire on db_read into the same target', () => {
  const added = [edge('e:new', 'svc:reports', 'ds:postgres', 'db_read')];
  const v = checkPolicy(realWithDb, withAdded(added), asPolicyEdges(added), [noWritePostgres]);
  assert.deepEqual(v, { ok: true, blocks: [], warns: [] });
});

test('no-db-write-into resolves a target by node LABEL, case-insensitively', () => {
  const byLabel: Policy = { version: 1, rules: [{ kind: 'no-db-write-into', target: 'postgres' }] };
  const added = [edge('e:new', 'svc:reports', 'ds:postgres', 'db_write')];
  assert.equal(checkPolicy(realWithDb, withAdded(added), asPolicyEdges(added), [byLabel]).ok, false);
});

test('no-db-write-into stays silent when its target resolves to nothing in this repo', () => {
  const elsewhere: Policy = { version: 1, rules: [{ kind: 'no-db-write-into', target: 'ds:redis' }] };
  const added = [edge('e:new', 'svc:reports', 'ds:postgres', 'db_write')];
  assert.equal(policyVerdictIsEmpty(checkPolicy(realWithDb, withAdded(added), asPolicyEdges(added), [elsewhere])), true);
});

test('validatePolicy requires a target for no-db-write-into', () => {
  const errors = validatePolicy({
    version: 1,
    rules: [{ kind: 'no-db-write-into' }, { kind: 'no-db-write-into', target: '   ' }],
  });
  assert.ok(errors.some((e) => e.includes('rule 0 (no-db-write-into) needs a non-empty target')));
  assert.ok(errors.some((e) => e.includes('rule 1 (no-db-write-into) needs a non-empty target')));
});

/* ------------------------------ flag-network-hop ----------------------------- */

const flagHops: Policy = {
  version: 1,
  name: 'Network hops',
  rules: [{ kind: 'flag-network-hop', reason: 'every hop costs a round trip' }],
};

test('flag-network-hop WARNS on an edge to a node the proposal is adding — and never blocks', () => {
  const proposedGraph: ArchGraph = {
    ...real,
    nodes: [...real.nodes, { id: 'ds:redis-cache', kind: 'datastore', label: 'redis cache', parentId: 'repo' }],
    edges: [...real.edges, edge('e:new', 'svc:orders', 'ds:redis-cache', 'db_read')],
  };
  const added = [edge('e:new', 'svc:orders', 'ds:redis-cache', 'db_read')];
  const v = checkPolicy(real, proposedGraph, asPolicyEdges(added), [flagHops]);
  assert.equal(v.ok, true); // warnings NEVER block
  assert.equal(v.blocks.length, 0);
  assert.equal(v.warns.length, 1);
  assert.ok(v.warns[0]!.explanation.includes('ds:redis-cache is new'));
  assert.ok(v.warns[0]!.explanation.includes('every hop costs a round trip'));
});

test('flag-network-hop does NOT fire when both endpoints already exist', () => {
  const added = [edge('e:new', 'svc:reports', 'svc:orders', 'http')];
  const v = checkPolicy(real, withAdded(added), asPolicyEdges(added), [flagHops]);
  assert.deepEqual(v, { ok: true, blocks: [], warns: [] });
});

/* ---------------------------------- no-op ----------------------------------- */

test('zero policies is an honest no-op, whatever the change is', () => {
  const added = [edge('e:new', 'svc:reports', 'svc:pricing', 'http')];
  assert.deepEqual(checkPolicy(real, withAdded(added), asPolicyEdges(added), []), {
    ok: true,
    blocks: [],
    warns: [],
  });
});

test('checkPolicy is total: a cycle terminates and a malformed rule is skipped', () => {
  const cyclic: ArchGraph = {
    ...real,
    edges: [
      edge('e:a', 'svc:gateway', 'svc:orders', 'http'),
      edge('e:b', 'svc:orders', 'svc:gateway', 'http'),
      edge('e:c', 'svc:orders', 'svc:pricing', 'http'),
    ],
  };
  const added = [edge('e:new', 'svc:reports', 'svc:gateway', 'http')];
  const junk = { version: 1, rules: [null, { kind: 'flag-network-hop' }] } as unknown as Policy;
  const v = checkPolicy(cyclic, { ...cyclic, edges: [...cyclic.edges, ...added] }, asPolicyEdges(added), [
    latencyFirst,
    junk,
  ]);
  assert.equal(v.ok, false); // the cycle still reaches pricing
  assert.equal(v.blocks.length, 1);
});

test('two policies naming the same target each speak, but neither double-reports an edge', () => {
  const second: Policy = { version: 1, name: 'Risk desk', rules: [{ kind: 'no-sync-into', target: 'Pricing' }] };
  const added = [edge('e:new', 'svc:reports', 'svc:pricing', 'http')];
  const v = checkPolicy(real, withAdded(added), asPolicyEdges(added), [latencyFirst, second]);
  assert.equal(v.blocks.length, 2);
  assert.deepEqual(
    v.blocks.map((b) => b.policyName),
    ['Latency first', 'Risk desk'],
  );
});
