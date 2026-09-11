import assert from 'node:assert';
import { test } from 'node:test';
import { joinAll, segmentsMatch, urlPartsToHostAndPath, type JoinInput } from '../join/join.js';
import type {
  ClientCallFact,
  Discovery,
  Part,
  RouteFact,
  ServiceRole,
  Wire,
} from '../types.js';

// Direct unit tests for the HTTP edge-grounding branches in `joinAll`. These
// lock the tier-1 "every edge traces to real evidence — no fabricated edges"
// invariant: an unwired env host with no code default must NEVER become an
// edge, a static code default must only ground when it names a real service,
// and route confirmation must move confidence in the correct direction. The
// only prior coverage was the end-to-end shopfront fixture, which never hits
// these branches.

// ---- minimal fixture builders -------------------------------------------

function mkDiscovery(
  services: { name: string; role?: ServiceRole }[],
  wires: Wire[] = []
): Discovery {
  return {
    composeFile: 'docker-compose.yml',
    services: services.map((s) => ({
      name: s.name,
      env: {},
      dependsOn: [],
      role: s.role ?? 'app',
    })),
    wires,
    warnings: [],
    manifestKind: 'compose',
  };
}

function mkInput(over: { discovery: Discovery } & Partial<JoinInput>): JoinInput {
  return {
    discovery: over.discovery,
    routes: over.routes ?? [],
    mounts: over.mounts ?? [],
    clients: over.clients ?? [],
    queueOps: over.queueOps ?? [],
    tables: over.tables ?? [],
    connections: over.connections ?? [],
    grpcClients: over.grpcClients ?? [],
    grpcServers: over.grpcServers ?? [],
    protoServices: over.protoServices ?? [],
  };
}

function route(service: string, method: string, path: string, file: string): RouteFact {
  return { service, method, path, file, line: 1 };
}

/** A client HTTP call whose URL host comes from an env var. `fallback` is the
 * code-shipped static default (the `URL || 'http://x'` right-hand side). */
function envClient(opts: {
  service: string;
  envName: string;
  path: string;
  fallback?: string;
  method?: string;
  file?: string;
}): ClientCallFact {
  const first: Part = {
    t: 'env',
    name: opts.envName,
    ...(opts.fallback ? { fallback: [{ t: 'lit', v: opts.fallback }] as Part[] } : {}),
  };
  const url: Part[] = [first, { t: 'lit', v: opts.path }];
  return {
    service: opts.service,
    method: opts.method,
    url,
    file: opts.file ?? `${opts.service}/index.ts`,
    line: 10,
    snippet: `fetch(process.env.${opts.envName} + "${opts.path}")`,
  };
}

function httpWire(service: string, envKey: string, value: string, targetService: string): Wire {
  return { service, envKey, value, targetService, kind: 'http', composeLine: 3 };
}

/** A client HTTP call whose URL host is a hard-coded literal (no env var) — e.g.
 * `fetch('https://api.stripe.com/v1/charges')`. */
function litClient(opts: { service: string; url: string; method?: string; file?: string }): ClientCallFact {
  return {
    service: opts.service,
    method: opts.method,
    url: [{ t: 'lit', v: opts.url }] as Part[],
    file: opts.file ?? `${opts.service}/index.ts`,
    line: 10,
    snippet: `fetch("${opts.url}")`,
  };
}

// ---- segmentsMatch (pure exported helper) --------------------------------

test('segmentsMatch: exact segment equality matches', () => {
  assert.strictEqual(segmentsMatch(['orders'], ['orders']), true);
  assert.strictEqual(segmentsMatch(['api', 'orders'], ['api', 'orders']), true);
});

test('segmentsMatch: wildcard/param position is tolerant on either side', () => {
  // a param on the route side ("*") absorbs a concrete client segment...
  assert.strictEqual(segmentsMatch(['orders', '123'], ['orders', '*']), true);
  // ...and vice versa (client path templated, route concrete).
  assert.strictEqual(segmentsMatch(['orders', '*'], ['orders', '123']), true);
});

test('segmentsMatch: genuine mismatches are rejected (no over-matching)', () => {
  // different concrete segment
  assert.strictEqual(segmentsMatch(['orders'], ['users']), false);
  // length mismatch never matches, even with a trailing wildcard
  assert.strictEqual(segmentsMatch(['orders'], ['orders', '*']), false);
});

// ---- urlPartsToHostAndPath (pure exported helper) ------------------------

test('urlPartsToHostAndPath: env-first URL preserves env host + static fallback', () => {
  const parts: Part[] = [
    { t: 'env', name: 'ORDERS_URL', fallback: [{ t: 'lit', v: 'http://orders:8080' }] },
    { t: 'lit', v: '/orders' },
  ];
  const { host, pathSkeleton } = urlPartsToHostAndPath(parts);
  assert.ok(host && host.type === 'env', 'host should be classified as env');
  assert.strictEqual(host.type === 'env' ? host.name : '', 'ORDERS_URL');
  assert.ok(host.type === 'env' && host.fallback, 'fallback must be carried through');
  assert.strictEqual(pathSkeleton, '/orders');
});

test('urlPartsToHostAndPath: literal full URL splits host from path; holes become "*"', () => {
  const litParts: Part[] = [{ t: 'lit', v: 'http://orders:8080/orders' }];
  const lit = urlPartsToHostAndPath(litParts);
  assert.ok(lit.host && lit.host.type === 'lit');
  assert.strictEqual(lit.host.type === 'lit' ? lit.host.value : '', 'http://orders:8080');
  assert.strictEqual(lit.pathSkeleton, '/orders');

  const holeParts: Part[] = [
    { t: 'lit', v: 'http://orders:8080/orders/' },
    { t: 'hole' },
  ];
  assert.strictEqual(urlPartsToHostAndPath(holeParts).pathSkeleton, '/orders/*');
});

// ---- THE anti-fabrication lock -------------------------------------------

test('joinAll HTTP: unwired env host with NO code default emits NO edge and warns', () => {
  const input = mkInput({
    discovery: mkDiscovery([{ name: 'web' }, { name: 'orders' }]),
    clients: [envClient({ service: 'web', envName: 'ORDERS_URL', path: '/orders' })],
  });
  const { edges, warnings } = joinAll(input);

  // The core "don't fabricate" invariant: no compose wiring, no static code
  // default => there is no evidence of a target, so no edge may exist.
  assert.strictEqual(edges.length, 0, `expected zero edges, got ${JSON.stringify(edges)}`);
  assert.ok(
    warnings.some(
      (w) =>
        w.includes('ORDERS_URL') && w.includes('no compose wiring and no code default')
    ),
    `expected a skip warning, got: ${JSON.stringify(warnings)}`
  );
});

// ---- literal external host (the `else` branch, join.ts:231-240) -----------

test('joinAll HTTP: a literal host that is NOT a known service (api.stripe.com) emits NO edge', () => {
  // join.ts:231-240 — a hard-coded literal URL whose hostname is not one of the
  // discovered serviceNames is external (a third-party API). There is nothing
  // in-graph to point at, so the joiner `continue`s: no fabricated edge, and
  // (unlike the env-with-no-default case) no warning either.
  const input = mkInput({
    discovery: mkDiscovery([{ name: 'web' }, { name: 'orders' }]),
    // even a matching route on a real service must not tempt an edge — the HOST
    // is external, so the call never resolves to `orders`.
    routes: [route('orders', 'POST', '/v1/charges', 'orders/routes.ts')],
    clients: [litClient({ service: 'web', url: 'https://api.stripe.com/v1/charges', method: 'POST' })],
  });
  const { edges } = joinAll(input);
  assert.strictEqual(
    edges.length,
    0,
    `an external literal host must not fabricate an edge, got ${JSON.stringify(edges)}`
  );
});

test('joinAll HTTP: a literal host that IS a known service still grounds (control for the external case)', () => {
  // The same code path with an in-graph hostname DOES ground — proving the
  // zero-edge result above is caused by externality, not by literal-host handling
  // being broken. base 0.85 (literal host) + 0.05 (route match) = 0.90.
  const input = mkInput({
    discovery: mkDiscovery([{ name: 'web' }, { name: 'orders' }]),
    routes: [route('orders', 'GET', '/orders', 'orders/routes.ts')],
    clients: [litClient({ service: 'web', url: 'http://orders:8080/orders', method: 'GET' })],
  });
  const { edges } = joinAll(input);
  assert.strictEqual(edges.length, 1, `expected one edge, got ${JSON.stringify(edges)}`);
  assert.strictEqual(edges[0].dstId, 'file:orders/routes.ts');
  assert.strictEqual(edges[0].detail?.targetService, 'orders');
});

// ---- code static default grounding ---------------------------------------

test('joinAll HTTP: code default naming a REAL service grounds exactly one edge (base 0.85)', () => {
  // No compose wire for ORDERS_URL, but the code ships `|| 'http://orders:8080'`.
  // "orders" is a real service AND exposes a matching route, so the edge is
  // grounded and confirmed: base 0.85 + 0.05 (route match) = 0.90, dst is the
  // matched route's file node (the specific handler, not a service stub).
  const input = mkInput({
    discovery: mkDiscovery([{ name: 'web' }, { name: 'orders' }]),
    routes: [route('orders', 'GET', '/orders', 'orders/routes.ts')],
    clients: [
      envClient({
        service: 'web',
        envName: 'ORDERS_URL',
        path: '/orders',
        fallback: 'http://orders:8080',
      }),
    ],
  });
  const { edges } = joinAll(input);
  assert.strictEqual(edges.length, 1, `expected exactly one edge, got ${edges.length}`);
  const e = edges[0];
  assert.strictEqual(e.kind, 'http');
  assert.strictEqual(e.origin, 'deterministic');
  assert.strictEqual(e.srcId, 'file:web/index.ts');
  assert.strictEqual(e.dstId, 'file:orders/routes.ts', 'matched route => file node dst');
  assert.strictEqual(e.confidence, 0.9, 'base 0.85 + 0.05 route-match');
  assert.ok(e.evidence.length >= 1 && e.evidence[0].note?.includes('code default'), 'evidence names the code default');
  assert.strictEqual(e.detail?.targetService, 'orders');
});

test('joinAll HTTP: code default to a real service but UNconfirmed path emits at base-0.15 (0.70) to svc stub', () => {
  // Same code default, but "orders" has no route confirming the client's path.
  // The edge still grounds (the default names a real service) but is downgraded
  // and points at the service stub rather than a file — locking base 0.85.
  const input = mkInput({
    discovery: mkDiscovery([{ name: 'web' }, { name: 'orders' }]),
    routes: [], // no route confirmation available
    clients: [
      envClient({
        service: 'web',
        envName: 'ORDERS_URL',
        path: '/orders',
        fallback: 'http://orders:8080',
      }),
    ],
  });
  const { edges } = joinAll(input);
  assert.strictEqual(edges.length, 1);
  assert.strictEqual(edges[0].confidence, 0.7, 'base 0.85 - 0.15 (no route match)');
  assert.strictEqual(edges[0].dstId, 'svc:orders', 'unmatched => svc:<target> fallback');
});

test('joinAll HTTP: code default naming a NON-existent service fabricates NOTHING', () => {
  // The default resolves to "ghost", which is not a service in the graph.
  // There is no real target, so no edge may be invented — the call is skipped.
  const input = mkInput({
    discovery: mkDiscovery([{ name: 'web' }, { name: 'orders' }]),
    routes: [route('orders', 'GET', '/orders', 'orders/routes.ts')],
    clients: [
      envClient({
        service: 'web',
        envName: 'GHOST_URL',
        path: '/orders',
        fallback: 'http://ghost:8080',
      }),
    ],
  });
  const { edges } = joinAll(input);
  assert.strictEqual(
    edges.length,
    0,
    `a default naming a non-existent service must not fabricate an edge, got ${JSON.stringify(edges)}`
  );
});

// ---- route confirmation direction (env-wire path, base 0.9) --------------

test('joinAll HTTP: env-wired call with MATCHED route => high confidence (0.95) to the specific handler', () => {
  const input = mkInput({
    discovery: mkDiscovery(
      [{ name: 'web' }, { name: 'orders' }],
      [httpWire('web', 'ORDERS_URL', 'http://orders:8080', 'orders')]
    ),
    routes: [route('orders', 'GET', '/orders', 'orders/routes.ts')],
    clients: [envClient({ service: 'web', envName: 'ORDERS_URL', path: '/orders', method: 'GET' })],
  });
  const { edges } = joinAll(input);
  assert.strictEqual(edges.length, 1);
  const e = edges[0];
  assert.ok(e.confidence >= 0.9, `matched route must be >=0.90, got ${e.confidence}`);
  assert.strictEqual(e.confidence, 0.95, 'env-wire base 0.9 + 0.05 route-match');
  assert.strictEqual(e.dstId, 'file:orders/routes.ts', 'dst resolves to the matched handler file');
  assert.ok(
    e.evidence.some((ev) => ev.note === 'matched route'),
    'a matched-route evidence entry must be present'
  );
});

test('joinAll HTTP: env-wired call with UNmatched route => downgraded (base-0.15=0.75) to svc:<target>', () => {
  const input = mkInput({
    discovery: mkDiscovery(
      [{ name: 'web' }, { name: 'orders' }],
      [httpWire('web', 'ORDERS_URL', 'http://orders:8080', 'orders')]
    ),
    // route exists but on a different path — genuine no-match
    routes: [route('orders', 'GET', '/health', 'orders/routes.ts')],
    clients: [envClient({ service: 'web', envName: 'ORDERS_URL', path: '/orders', method: 'GET' })],
  });
  const { edges } = joinAll(input);
  assert.strictEqual(edges.length, 1);
  const e = edges[0];
  assert.strictEqual(e.confidence, 0.75, 'env-wire base 0.9 - 0.15 (no route match)');
  assert.strictEqual(e.dstId, 'svc:orders', 'unmatched route falls back to svc:<target>, not a file node');
  assert.ok(
    !e.evidence.some((ev) => ev.note === 'matched route'),
    'no matched-route evidence when nothing matched'
  );
});

test('joinAll HTTP: SPA public env wire (VITE_API_URL) grounds frontend→API without client call', () => {
  const input = mkInput({
    discovery: mkDiscovery(
      [{ name: 'storefront' }, { name: 'api' }],
      [httpWire('storefront', 'VITE_API_URL', 'http://api:3000', 'api')]
    ),
    clients: [],
    routes: [],
  });
  const { edges } = joinAll(input);
  assert.strictEqual(edges.length, 1, `expected one SPA env edge, got ${JSON.stringify(edges)}`);
  const e = edges[0];
  assert.strictEqual(e.kind, 'http');
  assert.strictEqual(e.srcId, 'svc:storefront');
  assert.strictEqual(e.dstId, 'svc:api');
  assert.strictEqual(e.confidence, 0.75);
  assert.ok(
    e.evidence.some((ev) => ev.note?.includes('SPA public env')),
    'evidence must name the manifest-declared SPA env path'
  );
  assert.strictEqual(e.detail?.targetService, 'api');
  assert.strictEqual(e.detail?.envVar, 'VITE_API_URL');
});

test('joinAll HTTP: SPA public env wire does not duplicate an existing client-detected edge', () => {
  const input = mkInput({
    discovery: mkDiscovery(
      [{ name: 'storefront' }, { name: 'api' }],
      [httpWire('storefront', 'VITE_API_URL', 'http://api:3000', 'api')]
    ),
    routes: [route('api', 'GET', '/health', 'api/routes.ts')],
    clients: [
      envClient({ service: 'storefront', envName: 'VITE_API_URL', path: '/health', method: 'GET' }),
    ],
  });
  const { edges } = joinAll(input);
  assert.strictEqual(edges.length, 1, 'client-detected edge must win; SPA wire must not duplicate');
});
