/**
 * The filter. This is the part of Phase 0 that is actually load-bearing.
 *
 * `docs/lora-operator-guide.md` §2: **we own the grader.** So the accept/reject
 * decision here is made by ONE thing — `extractArchProposalFromAnswer` from
 * `packages/web/src/graph/archProposal.ts`, the exact function production calls,
 * loaded from source by `engine.mjs`. Not a copy, not a re-implementation, not a
 * relaxed variant. If the validator returns null, the candidate is gone.
 *
 * REJECTS ARE DISCARDED, NEVER REPAIRED (guide §5). There is deliberately no
 * "fix the JSON and retry" path in this file. The model must learn the shape of
 * things that pass, not the shape of things we patched.
 *
 * Two honest complications, stated rather than hidden:
 *
 * 1. **The validator returns null and nothing else.** It has no reason codes. So
 *    `classifyRejection` re-walks the same conditions purely to LABEL a
 *    rejection the validator already made — it never overturns one. If the
 *    classifier and the validator ever disagreed, the validator wins and the
 *    reason is recorded as `validator_rejected_unclassified`, which is itself a
 *    signal worth seeing in the counts.
 *
 * 2. **We are stricter than the validator in exactly two places**, both required
 *    by this round's brief ("every anchorId/srcId/dstId must resolve against the
 *    real graph") and both marked with their own reason code so the owner can
 *    see how much they cost:
 *      - `unreal_remove_id` — the validator does not ground `removeCardIds`, but
 *        a training sample that deletes a node the repo does not have is a
 *        hallucination we would be paying to teach.
 *      - `undeclared_prop_endpoint` — the validator accepts ANY `prop:`-prefixed
 *        endpoint, declared or not. `applyArchProposalToDraft` then silently
 *        drops that edge (`if (!nodeIds.has(srcId) ...) continue`), so the user
 *        would accept a change that quietly does less than it said.
 *    Both are stricter, never looser. Nothing the validator rejects is accepted.
 */

export const REJECT_REASONS = Object.freeze({
  /** No fenced block at all in the reply. */
  NO_FENCE: 'no_fence',
  /** A fence exists but its contents are not parseable JSON (wrong fence language, prose inside, trailing comma...). */
  BAD_JSON: 'bad_json',
  /** Parsed, but not an object with a string `summary`. */
  NO_SUMMARY: 'no_summary',
  /** addCards, addEdges and removeCardIds are all empty — a proposal that proposes nothing. */
  EMPTY_DIFF: 'empty_diff',
  /** A card's `anchorId` is not a node id in the real graph. */
  UNREAL_ANCHOR: 'unreal_anchor',
  /** An edge endpoint is neither a real node id nor a `prop:` id. */
  UNREAL_EDGE_ENDPOINT: 'unreal_edge_endpoint',
  /** Stricter than the validator: a removed id that does not exist. */
  UNREAL_REMOVE_ID: 'unreal_remove_id',
  /** Stricter than the validator: a `prop:` endpoint no addCards entry declares. */
  UNDECLARED_PROP_ENDPOINT: 'undeclared_prop_endpoint',
  /** The validator said no and we could not reproduce which rule it was. */
  UNCLASSIFIED: 'validator_rejected_unclassified',
});

const PROPOSAL_PREFIX = 'prop:';

/** The same fence regex `extractArchProposalFromAnswer` uses, for diagnosis only. */
const FENCE_RE = /```(?:proposal|json)?\s*([\s\S]*?)```/i;

/**
 * Why did the validator say no? Diagnosis only — see the header note.
 * @returns {string} a REJECT_REASONS value
 */
export function classifyRejection(text, graph) {
  const match = typeof text === 'string' ? text.match(FENCE_RE) : null;
  if (!match) return REJECT_REASONS.NO_FENCE;
  let raw;
  try {
    raw = JSON.parse(match[1]);
  } catch {
    return REJECT_REASONS.BAD_JSON;
  }
  if (!raw || typeof raw.summary !== 'string') return REJECT_REASONS.NO_SUMMARY;
  const addCards = Array.isArray(raw.addCards) ? raw.addCards : [];
  const addEdges = Array.isArray(raw.addEdges) ? raw.addEdges : [];
  const removeCardIds = Array.isArray(raw.removeCardIds) ? raw.removeCardIds : [];
  if (addCards.length === 0 && addEdges.length === 0 && removeCardIds.length === 0) {
    return REJECT_REASONS.EMPTY_DIFF;
  }
  const ids = new Set((graph.nodes ?? []).map((n) => n.id));
  for (const c of addCards) {
    if (!c || !c.anchorId || !ids.has(c.anchorId)) return REJECT_REASONS.UNREAL_ANCHOR;
  }
  for (const e of addEdges) {
    const ok = (id) => ids.has(id) || String(id).startsWith(PROPOSAL_PREFIX);
    if (!e || !ok(e.srcId) || !ok(e.dstId)) return REJECT_REASONS.UNREAL_EDGE_ENDPOINT;
  }
  return REJECT_REASONS.UNCLASSIFIED;
}

/**
 * Checks the validator does NOT make but this round's brief requires. Run only
 * on candidates the validator already accepted; can only ever reject further.
 * @returns {string|null} a REJECT_REASONS value, or null when clean
 */
export function extraGroundingReason(proposal, graph) {
  const ids = new Set((graph.nodes ?? []).map((n) => n.id));
  for (const id of proposal.removeCardIds ?? []) {
    if (!ids.has(id)) return REJECT_REASONS.UNREAL_REMOVE_ID;
  }
  const declared = new Set((proposal.addCards ?? []).map((c) => c.id));
  for (const e of proposal.addEdges ?? []) {
    for (const endpoint of [e.srcId, e.dstId]) {
      const s = String(endpoint);
      if (s.startsWith(PROPOSAL_PREFIX) && !declared.has(s)) return REJECT_REASONS.UNDECLARED_PROP_ENDPOINT;
    }
  }
  return null;
}

/**
 * Grade ONE candidate.
 *
 * @param {object} args
 * @param {string} args.text     the raw completion, exactly as the model emitted it
 * @param {object} args.graph    the real scanned graph for that repo
 * @param {Function} args.validate the REAL `extractArchProposalFromAnswer`
 * @returns {{ok: true, proposal: object} | {ok: false, reason: string}}
 */
export function gradeCandidate({ text, graph, validate }) {
  if (typeof validate !== 'function') {
    throw new TypeError('gradeCandidate: `validate` must be the real extractArchProposalFromAnswer');
  }
  let proposal = null;
  try {
    proposal = validate(typeof text === 'string' ? text : '', graph);
  } catch {
    // The validator is documented as total (it try/catches its own JSON.parse),
    // but a candidate that makes it throw is still a reject, never a crash.
    proposal = null;
  }
  if (!proposal) return { ok: false, reason: classifyRejection(text, graph) };
  const extra = extraGroundingReason(proposal, graph);
  if (extra) return { ok: false, reason: extra };
  return { ok: true, proposal };
}

/**
 * Grade a batch and count the reasons.
 *
 * The reason counts are a first-class output, not logging: guide §7 warns that
 * the filter can "quietly narrow the set to only the easiest cases", and the
 * only way to notice that is to look at what is being thrown away and why.
 *
 * @param {{id?: string, repoId?: string, request?: string, text: string, graph: object}[]} candidates
 * @param {Function} validate the real validator
 */
export function filterCandidates(candidates, validate) {
  const accepted = [];
  const rejected = [];
  const reasonCounts = {};
  for (const c of candidates) {
    const result = gradeCandidate({ text: c.text, graph: c.graph, validate });
    if (result.ok) {
      accepted.push({ ...c, proposal: result.proposal });
    } else {
      reasonCounts[result.reason] = (reasonCounts[result.reason] ?? 0) + 1;
      // The rejected TEXT is kept out of the returned record on purpose: it is
      // not training data and nothing downstream may be tempted to repair it.
      rejected.push({ id: c.id, repoId: c.repoId, request: c.request, reason: result.reason });
    }
  }
  return {
    accepted,
    rejected,
    reasonCounts,
    total: candidates.length,
    passRate: candidates.length === 0 ? 0 : accepted.length / candidates.length,
  };
}
