import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanRepo } from '../scan.js';

/**
 * A TRAILING SLASH IN Go's ServeMux IS A SUBTREE, NOT A PATH.
 *
 * `mux.HandleFunc("/shipments/", getShipment)` matches everything beneath
 * `/shipments/` — it is how a Go service takes a path parameter without pulling
 * in a router, and `shipping/main.go:53` in the shopfront fixture does exactly
 * that, reading the id back out with `r.URL.Path[len("/shipments/"):]`.
 *
 * The gateway calls `/shipments/{id}`. `pathToSegments` drops the trailing empty
 * segment, so the registration became `['shipments']` and the call
 * `['shipments','*']` — different lengths, no match. The edge survived only by
 * degrading to the SERVICE at confidence 0.75 with `matchedRoute: null`, while
 * every other http edge in the same fixture matched a FILE at 0.95.
 *
 * That mattered beyond a confidence number. The next feature to read this signal
 * — "which routes have no caller?" — would have reported `/shipments/` as
 * dangling when the gateway calls it on the line above. A false negative
 * delivered with a citation is the failure CANON calls worse than no tool.
 *
 * The flag is set by the DETECTOR, where the framework is known. A blanket
 * "trailing slash means prefix" rule in the joiner would be wrong for Express
 * and FastAPI, where it is just part of the path.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.resolve(HERE, '..', '..', 'test', 'fixtures', 'shopfront');

test('a Go subtree route is matched by a caller passing a path parameter', async () => {
  const g = await scanRepo(SHOPFRONT, { cluster: true });

  const shipmentEdge = g.edges.find(
    (e) => e.kind === 'http' && String(e.srcId).includes('gateway/src/routes/shipments.ts'),
  );
  assert.ok(shipmentEdge, 'the gateway calls the shipping service; that edge must exist');

  /* It resolves to the HANDLER FILE, not merely to the service — which is what
   * "the route was matched" means in this graph. */
  assert.match(String(shipmentEdge.dstId), /shipping\/main\.go$/);
  assert.ok(
    Number(shipmentEdge.confidence) >= 0.9,
    `a matched route earns the confident tier; got ${shipmentEdge.confidence}`,
  );

  const detail = shipmentEdge.detail as { matchedRoute?: string } | undefined;
  assert.match(String(detail?.matchedRoute ?? ''), /\/shipments\//);
});

/*
 * THE GUARD. A subtree must not swallow a sibling that merely shares a prefix
 * of its NAME. `/shipments/` covers `/shipments/42`; it does not cover `/ships`.
 */
test('a subtree route does not match a path that only shares a name prefix', async () => {
  const { segmentsUnderPrefix } = await import('../join/join.js');

  assert.equal(segmentsUnderPrefix(['shipments', '42'], ['shipments']), true);
  assert.equal(segmentsUnderPrefix(['shipments', 'a', 'b'], ['shipments']), true);
  assert.equal(segmentsUnderPrefix(['ships'], ['shipments']), false);
  /* An exact-length path is `segmentsMatch`'s job, not this one — otherwise a
   * subtree would report itself as being under itself. */
  assert.equal(segmentsUnderPrefix(['shipments'], ['shipments']), false);
  assert.equal(segmentsUnderPrefix([], ['shipments']), false);
});
