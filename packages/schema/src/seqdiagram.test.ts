import assert from 'node:assert';
import { test } from 'node:test';
import {
  validateSeqDiagram,
  type SeqDiagramV1,
} from './seqdiagram.js';

function validDoc(): SeqDiagramV1 {
  return {
    version: 1,
    kind: 'service-sequence',
    title: 'Checkout request path',
    grounded: {
      graphId: 'arch',
      repoPath: '/path/to/repo',
      scopeNodeIds: ['svc:gateway', 'svc:api'],
      origin: 'export',
    },
    theme: 'structural',
    nodes: [
      {
        id: 'svc:gateway',
        label: 'gateway',
        kind: 'service',
        role: 'participant',
        detail: {
          whatItIs: 'Edge HTTP entry',
          whatItDoes: 'Routes public traffic to internal services',
          parts: ['svc:gateway'],
          talksTo: ['svc:api'],
        },
      },
      {
        id: 'svc:api',
        label: 'api',
        kind: 'service',
        role: 'participant',
      },
    ],
    edges: [
      {
        id: 'e:gateway-api-http',
        from: 'svc:gateway',
        to: 'svc:api',
        family: 'http',
        label: 'GET /tickets',
        evidenceRef: 'scan:compose:gateway:env.API_URL',
      },
    ],
    layout: { engine: 'sequence', direction: 'LR' },
    projections: { mermaid: 'sequenceDiagram\n  ...', capNote: '2 of 8 services shown' },
    meta: { createdAt: '2026-08-04T00:00:00Z', generator: '@sequence/export@0.1.0' },
  };
}

test('validateSeqDiagram: valid doc passes', () => {
  const res = validateSeqDiagram(validDoc());
  assert.deepEqual(res, { ok: true, errors: [] });
});

test('validateSeqDiagram: missing grounded.graphId fails', () => {
  const doc = validDoc();
  doc.grounded = { repoPath: '/tmp' } as SeqDiagramV1['grounded'];
  const res = validateSeqDiagram(doc);
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('grounded.graphId')));
});

test('validateSeqDiagram: orphan edge fails', () => {
  const doc = validDoc();
  doc.edges.push({
    id: 'e:orphan',
    from: 'svc:missing',
    to: 'svc:api',
    family: 'http',
  });
  const res = validateSeqDiagram(doc);
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('unknown from-node svc:missing')));
});

test('validateSeqDiagram: never throws on null or garbage input', () => {
  assert.deepEqual(validateSeqDiagram(null), {
    ok: false,
    errors: ['seqdiagram must be a JSON object'],
  });
  assert.strictEqual(validateSeqDiagram(undefined).ok, false);
  assert.strictEqual(validateSeqDiagram('not-json').ok, false);
  assert.strictEqual(validateSeqDiagram([]).ok, false);
});

test('validateSeqDiagram: duplicate node id fails', () => {
  const doc = validDoc();
  doc.nodes.push({ ...doc.nodes[0] });
  const res = validateSeqDiagram(doc);
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('duplicate node id')));
});

test('validateSeqDiagram: package semver version string fails with human message', () => {
  const doc = { ...validDoc(), version: '0.1.0' as unknown as 1 };
  const res = validateSeqDiagram(doc);
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors[0]?.includes('integer 1'));
  assert.ok(res.errors[0]?.includes('semver'));
  assert.ok(res.errors[0]?.includes('0.1.0'));
});

// r3 Wave 2 — models often emit `"version": "1"` (string); coerce to the integer 1.
test('validateSeqDiagram: string version "1" is coerced to the integer 1', () => {
  const doc = { ...validDoc(), version: '1' as unknown as 1 };
  const res = validateSeqDiagram(doc);
  assert.strictEqual(res.ok, true, res.errors.join('; '));
});

test('validateSeqDiagram: numeric future version fails closed', () => {
  const doc = { ...validDoc(), version: 2 as unknown as 1 };
  const res = validateSeqDiagram(doc);
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors[0]?.includes('unsupported seqdiagram version'));
  assert.ok(res.errors[0]?.includes('expected 1'));
});

/** Minimal v1 doc without Wave 5a optional fields — backward compat lock. */
function legacyDoc(): SeqDiagramV1 {
  return {
    version: 1,
    kind: 'service-flow',
    title: 'Legacy flow',
    grounded: { graphId: 'arch-legacy' },
    nodes: [
      { id: 'svc:a', label: 'A', kind: 'service' },
      { id: 'svc:b', label: 'B', kind: 'service' },
    ],
    edges: [{ id: 'e:ab', from: 'svc:a', to: 'svc:b', family: 'http' }],
  };
}

test('validateSeqDiagram: legacy doc without optional fields passes', () => {
  const res = validateSeqDiagram(legacyDoc());
  assert.deepEqual(res, { ok: true, errors: [] });
});

test('validateSeqDiagram: extended optional fields pass when well-formed', () => {
  const doc: SeqDiagramV1 = {
    ...legacyDoc(),
    nodes: [
      {
        id: 'svc:a',
        label: 'Intake',
        kind: 'service',
        primary: true,
        evidenceRef: 'scan:src/intake/handler.ts:41',
      },
      { id: 'svc:b', label: 'Bind', kind: 'service', role: 'boundary' },
      { id: 'grp:lane', label: 'Lane 01', kind: 'module', role: 'group' },
    ],
    edges: [{ id: 'e:ab', from: 'svc:a', to: 'svc:b', family: 'http' }],
    groups: [{ id: 'grp:lane', label: 'Lane 01', memberIds: ['svc:a', 'svc:b'] }],
    flows: [
      {
        id: 'flow:checkout',
        label: 'Checkout',
        nodeIds: ['svc:a', 'svc:b'],
        edgeIds: ['e:ab'],
      },
    ],
    primaryNodeIds: ['svc:a'],
    boundaries: [
      {
        id: 'bnd:ext',
        label: 'External CRM',
        external: true,
        memberIds: ['svc:b'],
        evidenceRef: 'scan:compose:crm:env.URL',
      },
    ],
    externalDependencies: [
      {
        id: 'ext:crm',
        label: 'Salesforce',
        boundaryNodeId: 'svc:b',
        evidenceRef: 'scan:compose:gateway:env.CRM_URL',
      },
    ],
    unknowns: ['Downstream billing path not in scan scope'],
    grounded: {
      graphId: 'arch-legacy',
      unknowns: ['Helm values for staging only'],
    },
  };
  const res = validateSeqDiagram(doc);
  assert.deepEqual(res, { ok: true, errors: [] });
});

test('validateSeqDiagram: rejects malformed optional fields without breaking legacy shape', () => {
  const badGroups = { ...legacyDoc(), groups: [{ id: 'g1', label: 'G', memberIds: ['svc:missing'] }] };
  assert.ok(!validateSeqDiagram(badGroups).ok);
  assert.ok(
    validateSeqDiagram(badGroups).errors.some((e) => e.includes('groups[0].memberIds references unknown node'))
  );

  const badFlows = {
    ...legacyDoc(),
    flows: [{ id: 'f1', label: 'F', nodeIds: ['svc:a'], edgeIds: ['e:missing'] }],
  };
  assert.ok(!validateSeqDiagram(badFlows).ok);
  assert.ok(
    validateSeqDiagram(badFlows).errors.some((e) => e.includes('flows[0].edgeIds references unknown edge'))
  );

  const badPrimary = { ...legacyDoc(), primaryNodeIds: ['svc:ghost'] };
  assert.ok(!validateSeqDiagram(badPrimary).ok);

  const badUnknowns = { ...legacyDoc(), unknowns: [''] };
  assert.ok(!validateSeqDiagram(badUnknowns).ok);

  const badNodeEvidence = {
    ...legacyDoc(),
    nodes: [{ id: 'svc:a', label: 'A', kind: 'service', evidenceRef: 42 }],
  };
  assert.ok(!validateSeqDiagram(badNodeEvidence).ok);
  assert.ok(validateSeqDiagram(badNodeEvidence).errors.some((e) => e.includes('evidenceRef must be a string')));
});

test('validateSeqDiagram: new fields remain optional — doc without them still valid', () => {
  const doc = validDoc();
  delete (doc as Partial<SeqDiagramV1>).groups;
  delete (doc as Partial<SeqDiagramV1>).flows;
  delete (doc as Partial<SeqDiagramV1>).primaryNodeIds;
  delete (doc as Partial<SeqDiagramV1>).boundaries;
  delete (doc as Partial<SeqDiagramV1>).externalDependencies;
  delete (doc as Partial<SeqDiagramV1>).unknowns;
  const res = validateSeqDiagram(doc);
  assert.deepEqual(res, { ok: true, errors: [] });
});

test('validateSeqDiagram: coerces missing kind on proposal/design nodes to service', () => {
  const doc: {
    version: number;
    kind: string;
    title: string;
    grounded: { graphId: string; origin: string };
    nodes: Array<{ id: string; label: string; kind?: string }>;
    edges: unknown[];
  } = {
    version: 1,
    kind: 'service-flow',
    title: 'Proposal box',
    grounded: { graphId: 'chat:prop', origin: 'design' },
    nodes: [{ id: 'proposal:box1', label: 'x' }],
    edges: [],
  };
  const res = validateSeqDiagram(doc);
  assert.strictEqual(res.ok, true, res.errors.join('; '));
  assert.strictEqual(doc.nodes[0]?.kind, 'service');
});

test('validateSeqDiagram: coerces invented kinds and name→label so a Work dump paints', () => {
  const doc: {
    version: number;
    kind: string;
    title: string;
    grounded: { graphId: string; origin: string };
    nodes: Array<{ id: string; kind: string; name: string; label?: string }>;
    edges: unknown[];
  } = {
    version: 1,
    kind: 'service-flow',
    title: 'Test harness',
    grounded: { graphId: 'chat:plan', origin: 'design' },
    nodes: [{ id: 'cli', kind: 'interface', name: 'CLI Entrypoint' }],
    edges: [],
  };
  const res = validateSeqDiagram(doc);
  assert.strictEqual(res.ok, true, res.errors.join('; '));
  assert.strictEqual(doc.nodes[0]?.kind, 'service');
  assert.strictEqual(doc.nodes[0]?.label, 'CLI Entrypoint');
  assert.ok(!res.errors.some((e) => e.includes('invalid kind')));
});

test('validateSeqDiagram: keeps module/agent/datastore kinds', () => {
  const doc = validDoc();
  doc.nodes[0]!.kind = 'module';
  doc.nodes[1]!.kind = 'datastore';
  let res = validateSeqDiagram(doc);
  assert.strictEqual(res.ok, true, res.errors.join('; '));
  assert.strictEqual(doc.nodes[0]?.kind, 'module');
  assert.strictEqual(doc.nodes[1]?.kind, 'datastore');
  doc.nodes[0]!.kind = 'agent';
  res = validateSeqDiagram(doc);
  assert.strictEqual(res.ok, true, res.errors.join('; '));
  assert.strictEqual(doc.nodes[0]?.kind, 'agent');
});
