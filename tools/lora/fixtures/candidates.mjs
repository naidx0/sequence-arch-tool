/**
 * Candidate completions used by every test and by `run.mjs --teacher fixture`.
 *
 * These are HAND-WRITTEN stand-ins for what a teacher model would return. They
 * exist so the whole pipeline — synthesis, filtering, JSONL emission, template
 * verification, eval — can be exercised end to end with no network, no key and
 * no spend. Each one is labelled with the outcome it is supposed to produce, and
 * the tests assert exactly that outcome, so a change in the real validator that
 * flips one of these shows up as a red test rather than as a quietly different
 * dataset.
 */

/** ACCEPT — well-formed, fenced `proposal`, every id real or declared. */
export const GOOD = `Here is where a cache belongs.

\`\`\`proposal
{
  "summary": "Add a Redis read cache in front of catalog",
  "addCards": [
    {
      "id": "prop:catalog-cache",
      "title": "Catalog Cache",
      "summary": "Redis read cache for catalog lookups",
      "kind": "datastore",
      "entranceIndex": 0,
      "anchorId": "svc:catalog",
      "dx": 280,
      "dy": 40
    }
  ],
  "addEdges": [
    {
      "id": "prop:e:svc:checkout->prop:catalog-cache:0",
      "srcId": "svc:checkout",
      "dstId": "prop:catalog-cache",
      "labels": ["cache read"],
      "status": "proposed"
    }
  ],
  "removeCardIds": []
}
\`\`\``;

/** ACCEPT — the removal shape, so `removeCardIds` is not always empty. */
export const GOOD_REMOVE = `Retiring it looks like this.

\`\`\`proposal
{
  "summary": "Retire the payments service",
  "addCards": [],
  "addEdges": [],
  "removeCardIds": ["svc:payments"]
}
\`\`\``;

/** REJECT no_fence — a perfectly sensible answer with no proposal block at all. */
export const NO_FENCE = 'You could put a cache in front of svc:catalog, backed by Redis.';

/** REJECT bad_json — fenced, but the JSON is malformed (trailing comma). */
export const MALFORMED = `\`\`\`proposal
{
  "summary": "Add a cache",
  "addCards": [],
  "addEdges": [],
  "removeCardIds": ["svc:catalog"],
}
\`\`\``;

/**
 * REJECT bad_json — the WRONG FENCE. The validator's fence regex only names
 * `proposal` and `json`; a ```yaml fence leaves "yaml" glued to the front of the
 * captured body, so JSON.parse fails and the whole reply is discarded.
 */
export const WRONG_FENCE = `\`\`\`yaml
{
  "summary": "Add a cache",
  "addCards": [],
  "addEdges": [],
  "removeCardIds": ["svc:catalog"]
}
\`\`\``;

/** REJECT unreal_anchor — anchored to a service this repo does not have. */
export const UNREAL_ANCHOR = `\`\`\`proposal
{
  "summary": "Add a cache in front of the inventory service",
  "addCards": [
    {
      "id": "prop:inv-cache",
      "title": "Inventory Cache",
      "summary": "cache",
      "kind": "datastore",
      "entranceIndex": 0,
      "anchorId": "svc:inventory",
      "dx": 280,
      "dy": 40
    }
  ],
  "addEdges": [],
  "removeCardIds": []
}
\`\`\``;

/** REJECT unreal_edge_endpoint — an edge from a node that does not exist. */
export const UNREAL_EDGE = `\`\`\`proposal
{
  "summary": "Point the shipping service at the cache",
  "addCards": [],
  "addEdges": [
    {
      "id": "prop:e:0",
      "srcId": "svc:shipping",
      "dstId": "ds:orders-db",
      "labels": ["read"],
      "status": "proposed"
    }
  ],
  "removeCardIds": []
}
\`\`\``;

/** REJECT unreal_remove_id — stricter than the validator, on purpose (see filter.mjs). */
export const UNREAL_REMOVE = `\`\`\`proposal
{
  "summary": "Retire the shipping service",
  "addCards": [],
  "addEdges": [],
  "removeCardIds": ["svc:shipping"]
}
\`\`\``;

/**
 * REJECT undeclared_prop_endpoint — a `prop:` endpoint no addCards entry
 * declares. The validator waves it through; applyArchProposalToDraft then
 * silently drops the edge, so the user would accept a change that does less than
 * it claims.
 */
export const UNDECLARED_PROP = `\`\`\`proposal
{
  "summary": "Wire checkout to a queue",
  "addCards": [],
  "addEdges": [
    {
      "id": "prop:e:0",
      "srcId": "svc:checkout",
      "dstId": "prop:never-declared",
      "labels": ["publish"],
      "status": "proposed"
    }
  ],
  "removeCardIds": []
}
\`\`\``;

/** REJECT empty_diff — parses, grounds, proposes nothing. */
export const EMPTY_DIFF = `\`\`\`proposal
{ "summary": "Nothing to change", "addCards": [], "addEdges": [], "removeCardIds": [] }
\`\`\``;

/** REJECT no_summary — valid JSON, wrong shape. */
export const NO_SUMMARY = `\`\`\`proposal
{ "addCards": [], "addEdges": [], "removeCardIds": ["svc:catalog"] }
\`\`\``;

/**
 * A grounded stand-in completion for ANY synthesized request.
 *
 * This is what `--teacher fixture` uses at the CLI, and it is the reason the
 * whole pipeline can be rehearsed end to end — real repos, real digests, real
 * prompts, real filtering, a real train.jsonl and a real verify-template.txt —
 * for zero dollars and with no network. It anchors to the first id the request
 * actually cited, so it passes the filter for the same reason a good model's
 * answer would: because the id is real.
 *
 * It is NOT training data anyone should train on. Every sample it produces is
 * the same cache-shaped diff, which would teach a model exactly one trick. Its
 * job is to prove the plumbing, and the report it produces says so.
 */
export function groundedFixtureCompletion(request) {
  const anchor = request?.citedIds?.[0];
  if (!anchor) return NO_FENCE;
  const cacheId = 'prop:read-cache';
  return `A read cache belongs beside \`${anchor}\`.

\`\`\`proposal
${JSON.stringify(
  {
    summary: `Add a read cache beside ${anchor}`,
    addCards: [
      {
        id: cacheId,
        title: 'Read Cache',
        summary: 'Redis read cache',
        kind: 'datastore',
        entranceIndex: 0,
        anchorId: anchor,
        dx: 280,
        dy: 40,
      },
    ],
    addEdges: [
      { id: `prop:e:${anchor}->${cacheId}:0`, srcId: anchor, dstId: cacheId, labels: ['cache read'], status: 'proposed' },
    ],
    removeCardIds: [],
  },
  null,
  2
)}
\`\`\``;
}
