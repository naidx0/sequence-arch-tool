/**
 * WHAT CLASS OF ARTIFACT AN EDGE WAS READ FROM.
 *
 * CANON records the incident: `svc:gateway`'s only two inbound edges were nginx
 * confs inside TEST FIXTURES, and both carried `origin: 'deterministic'` —
 * honestly produced, and wrong about the world. "Deterministic" was true and
 * useless, because to it a fixture and a production config are the same word.
 *
 * `instrument` is the missing word. `test` is the one that matters and the
 * reason this is not merely `actor`: an edge whose every citation sits in a
 * fixture is a claim about a test suite wearing the costume of a claim about
 * the system.
 *
 * IT CLASSIFIES, IT DOES NOT JUDGE. A `test` instrument is not an error — a
 * test really does call that endpoint — and nothing here drops such an edge.
 * What it does is make the difference SAYABLE, so a surface can decide and a
 * reader can see. Dropping them silently would trade one invisible wrong answer
 * for another.
 */

import { isTestFile } from '../testFiles.js';
import type { ArchEdge, EdgeInstrument, Evidence } from '@sequence/schema';

const CONFIG_RE = /\.(conf|ini|cfg|properties|env|toml)$|(^|\/)nginx[^/]*$|(^|\/)\.env(\.|$)/i;
const MANIFEST_RE =
  /(^|\/)(docker-compose[^/]*\.ya?ml|compose\.ya?ml|Dockerfile[^/]*|package\.json|pyproject\.toml|go\.mod|Cargo\.toml|pom\.xml|build\.gradle[^/]*|Chart\.ya?ml|values[^/]*\.ya?ml)$/i;

/** The class of ONE file. */
export function instrumentOfPath(file: string): Exclude<EdgeInstrument, 'mixed'> {
  const p = file.replace(/\\/g, '/');
  /* TEST WINS OVER EVERYTHING. A compose file inside `test/fixtures` is a
     fixture first — that is precisely the gateway incident, where the artifact
     looked exactly like production config because in every other respect it
     was one. */
  if (isTestFile(p)) return 'test';
  if (MANIFEST_RE.test(p)) return 'manifest';
  if (CONFIG_RE.test(p)) return 'config';
  return 'source';
}

/**
 * The class of an edge, over all of its evidence.
 *
 * `mixed` when the citations disagree — one in a fixture and one in real
 * source is a genuinely different situation from either, and collapsing it to
 * whichever came first would hide the half that matters. An edge with no
 * evidence gets no instrument at all: inventing one would be a claim about a
 * reading that never happened.
 */
export function instrumentOfEvidence(evidence: readonly Evidence[]): EdgeInstrument | undefined {
  const kinds = new Set<Exclude<EdgeInstrument, 'mixed'>>();
  for (const e of evidence) {
    if (!e || typeof e.file !== 'string' || e.file === '') continue;
    kinds.add(instrumentOfPath(e.file));
  }
  if (kinds.size === 0) return undefined;
  if (kinds.size === 1) return [...kinds][0];
  return 'mixed';
}

/**
 * True when EVERY citation on this edge sits in a test file.
 *
 * The gateway incident's exact shape, and the reason `mixed` is a separate
 * value: an edge with one fixture citation and one real one is grounded, and
 * one with only fixture citations is a claim about the test suite.
 */
export function groundedInTestsOnly(evidence: readonly Evidence[]): boolean {
  return instrumentOfEvidence(evidence) === 'test';
}

/**
 * Which detector an edge's kind came from.
 *
 * Read off the KIND rather than set by each producer, deliberately: a field
 * every producer must remember is a field that is right until the eleventh
 * producer, and the eleventh producer's edge is the one nobody checks.
 */
const ACTOR_BY_KIND: Readonly<Record<string, string>> = {
  http: 'detectors/http',
  grpc: 'detectors/grpc',
  queue_publish: 'detectors/queues',
  queue_consume: 'detectors/queues',
  db_read: 'detectors/db',
  db_write: 'detectors/db',
  db_access: 'detectors/db',
  import: 'scan/imports',
};

/**
 * Fill `actor` and `instrument` on every edge that lacks them.
 *
 * Only fills what is ABSENT, so it is idempotent and safe to run at more than
 * one exit — which it must be: import edges are assembled in `scan.ts` and
 * never pass through `joinAll`, so a stamp in the joiner alone left every one
 * of them unattributed.
 */
export function stampProvenance(edges: ArchEdge[]): ArchEdge[] {
  for (const e of edges) {
    if (e.actor === undefined) e.actor = ACTOR_BY_KIND[e.kind] ?? 'join';
    if (e.instrument === undefined) {
      const found = instrumentOfEvidence(e.evidence ?? []);
      if (found !== undefined) e.instrument = found;
    }
  }
  return edges;
}
