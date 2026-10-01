/**
 * Per-org harness policies (G-E) — declarative, repo-committed rules that
 * customise how the harness JUDGES a proposed change.
 *
 * WHY THIS EXISTS. `graphChecker.ts` answers "is this mutation structurally
 * legal" — ungrounded ids, a graph that fails `validateGraph`, an edge with no
 * endpoint. That question has the same answer at every company. The question a
 * quant firm actually asks is different and is theirs alone: *"no new
 * synchronous call into the pricing path."* That cannot live in our code — it is
 * a property of THEIR system, so it lives in THEIR repo, as data, committed
 * beside the code it constrains (`.sequence/policies/*.json`, carved out of the
 * `.sequence` gitignore in the same commit that added this file — without that
 * carve-out the feature dies on a fresh clone).
 *
 * SHAPE. Hand-written pure validation pushing error STRINGS, exactly like
 * `validateProgram` / `validateGraph`. No JSON-schema, no ajv: this repo has
 * none anywhere and adding a validator runtime for two rule kinds would be a
 * dependency bought with nothing.
 *
 * HONESTY, binding (the language-pack posture, `analyzer/src/lang/packs.ts`):
 *   - no policies ⇒ an honest NO-OP. A repo with no `.sequence/policies/`
 *     behaves byte-identically to a repo from before this file existed, and
 *     there is a test locking that.
 *   - a policy may BLOCK a proposal or FLAG it. It never silently rewrites one.
 *     The harness proposes and a human accepts; a rule that edited the proposal
 *     behind their back would be exactly the "agent output mutates truth"
 *     failure the checker primitive exists to prevent.
 *   - a malformed policy file is REPORTED BY NAME, never silently dropped
 *     (`readPolicies` in the analyzer store) — silence is the worst failure mode.
 *
 * NOT IN THIS SLICE (deliberately, so what ships is honest): rule severities are
 * fixed per kind (see `policyChecker.ts`), there is no rule ordering/priority,
 * and there is no UI for authoring a policy — you write the JSON file.
 */

/**
 * Block a NEW synchronous call that reaches `target`.
 *
 * `target` resolves against the REAL graph, in this order (first match wins,
 * and all matches at that level are taken):
 *   1. exact node id — `svc:pricing`;
 *   2. case-insensitive, whitespace-trimmed node LABEL — `Pricing`.
 * A target that resolves to NOTHING yields no hits at all: we cannot judge a
 * path we cannot find, and inventing a verdict for it would be a guess. (The
 * file is still valid — a policy shared across an org's repos legitimately names
 * services that only exist in some of them.)
 *
 * "Synchronous" is read off the edge KIND, which the analyzer already splits:
 * `http` / `grpc` are a blocking call out; `queue_publish` / `queue_consume` are
 * not. See `SYNC_EDGE_KINDS` in `policyChecker.ts`.
 */
export interface NoSyncIntoRule {
  kind: 'no-sync-into';
  /** A real node id, or a node label matched case-insensitively. */
  target: string;
  /** Why the org made this rule — printed verbatim on the hit. */
  reason?: string;
}

/**
 * Block a NEW `db_write` edge that lands on `target`.
 *
 * `target` resolves the same way as {@link NoSyncIntoRule.target}: exact node id
 * first, then case-insensitive label. A target that resolves to nothing yields no
 * hits — we cannot judge a datastore we cannot find.
 */
export interface NoDbWriteIntoRule {
  kind: 'no-db-write-into';
  /** A real datastore node id, or a node label matched case-insensitively. */
  target: string;
  /** Why the org made this rule — printed verbatim on the hit. */
  reason?: string;
}

/**
 * Flag any proposed edge that introduces a network hop to somewhere that is not
 * in the scanned system yet — i.e. one of its endpoints is a node the PROPOSAL
 * is adding rather than one the scan found. Warn-only: adding a service is a
 * normal, legitimate thing to propose; the point is that a reviewer sees it
 * named before they accept.
 */
export interface FlagNetworkHopRule {
  kind: 'flag-network-hop';
  reason?: string;
}

export type PolicyRule = NoSyncIntoRule | NoDbWriteIntoRule | FlagNetworkHopRule;

/** Every rule kind this slice understands. An unknown kind is a hard error. */
export const POLICY_RULE_KINDS: readonly PolicyRule['kind'][] = [
  'no-sync-into',
  'no-db-write-into',
  'flag-network-hop',
];

/** One repo-committed policy file: `.sequence/policies/<name>.json`. */
export interface Policy {
  /** Only `1` exists. A future shape bumps this rather than guessing. */
  version: 1;
  /** Human name, printed on a hit so a blocked user knows WHICH policy spoke. */
  name?: string;
  /**
   * When set, this file applies only to the named service node (e.g. `svc:orders`).
   * Files without `scope` apply repo-wide. See `composePolicies`.
   */
  scope?: string;
  rules: PolicyRule[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate a parsed policy, mirroring `validateProgram`: PURE, returns EVERY
 * error it finds as a plain string (never throws, never stops at the first),
 * and an empty array means valid. Takes `unknown` on purpose — the input is a
 * file the user hand-wrote, so it must be checked before it is trusted, not
 * cast into shape.
 */
export function validatePolicy(policy: unknown): string[] {
  const errors: string[] = [];
  if (!isPlainObject(policy)) {
    return ['policy must be a JSON object'];
  }

  if (policy.version !== 1) {
    errors.push(`unsupported policy version: ${JSON.stringify(policy.version) ?? 'undefined'} (expected 1)`);
  }
  if (policy.name !== undefined && typeof policy.name !== 'string') {
    errors.push('policy name must be a string');
  }
  if (policy.scope !== undefined && (typeof policy.scope !== 'string' || policy.scope.trim() === '')) {
    errors.push('policy scope must be a non-empty string');
  }

  if (!Array.isArray(policy.rules)) {
    errors.push('policy must have a rules array');
    return errors;
  }
  if (policy.rules.length === 0) {
    errors.push('policy has no rules');
  }

  policy.rules.forEach((rule: unknown, i: number) => {
    if (!isPlainObject(rule)) {
      errors.push(`rule ${i} must be an object`);
      return;
    }
    const kind = rule.kind;
    if (typeof kind !== 'string' || !POLICY_RULE_KINDS.includes(kind as PolicyRule['kind'])) {
      errors.push(
        `rule ${i} has unknown kind ${JSON.stringify(kind)} (expected one of: ${POLICY_RULE_KINDS.join(', ')})`,
      );
      return;
    }
    if (rule.reason !== undefined && typeof rule.reason !== 'string') {
      errors.push(`rule ${i} reason must be a string`);
    }
    if (kind === 'no-sync-into' || kind === 'no-db-write-into') {
      if (typeof rule.target !== 'string' || rule.target.trim() === '') {
        errors.push(`rule ${i} (${kind}) needs a non-empty target`);
      }
    }
  });

  return errors;
}

/** True when `validatePolicy` finds nothing wrong — a typed narrowing helper. */
export function isValidPolicy(policy: unknown): policy is Policy {
  return validatePolicy(policy).length === 0;
}
