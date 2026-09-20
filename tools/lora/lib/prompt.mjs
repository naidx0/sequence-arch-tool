/**
 * Prompt assembly — the ONE place training and inference agree.
 *
 * `buildProposalPrompt` is used for BOTH the training sample and the eval /
 * inference call. That is not tidiness, it is the §7 risk control: the guide
 * names chat-template and prompt drift between training and inference as the
 * single highest-risk silent failure in the whole project, and the only reliable
 * defence is that there is no second copy of the prompt to drift from.
 *
 * WHAT PRODUCTION ACTUALLY SENDS — and the honest gap.
 * `POST /api/ask` (packages/analyzer/src/server/repoServer.ts) calls
 * `buildAskPrompt(digest, question, compose)` and hands the result to the
 * provider as a SINGLE user message with no system role
 * (`packages/analyzer/src/server/provider.ts`). We call the same shipped
 * function, on a digest from the same shipped `scanRepo` + `buildDigest`.
 *
 * The gap, stated plainly because it matters for what Phase 0 can claim:
 * **production never instructs the model to emit a proposal block.**
 * `BoardChat.tsx` calls `extractArchProposalFromAnswer` OPPORTUNISTICALLY on
 * whatever the ask endpoint returned, and falls back to a local
 * `buildLocalArchProposal` when nothing parses. There is therefore no shipped
 * "proposal contract" text to reuse. The contract below is written here, derived
 * field-by-field from what `archProposal.ts` actually accepts, and it rides on
 * production's own composition seam (`AskComposition.intentLines`, the labelled
 * section the server uses for invoked actions) rather than being glued onto the
 * user's words. When production grows a real proposal request path, the honest
 * move is to move THIS constant into `explain.ts` and import it — not to write
 * a second one.
 */

/** Bump when the contract text changes; it is stamped into every artifact. */
export const PROPOSAL_CONTRACT_VERSION = 'phase0/v1';

/**
 * The proposal contract, field-by-field from `archProposal.ts`.
 *
 * Every rule below is a rule the validator (or `applyArchProposalToDraft`)
 * actually enforces. Nothing here is aspirational — a rule the grader does not
 * check would teach the model a discipline nothing rewards.
 */
export const PROPOSAL_CONTRACT_LINES = Object.freeze([
  '--- REQUESTED ACTIONS ---',
  'The user is asking for an ARCHITECTURE CHANGE. In addition to your short prose answer,',
  'end your reply with exactly one fenced block, opened with three backticks and the word',
  'proposal, containing ONLY a single JSON object with this shape:',
  '',
  '{',
  '  "summary": string,',
  '  "addCards": [{',
  '    "id": string,          // a NEW component you are proposing; MUST start with "prop:"',
  '    "title": string,       // short human title, e.g. "Redis Cache"',
  '    "summary": string,     // one line: what it is for',
  '    "kind": "service" | "datastore" | "topic",',
  '    "entranceIndex": number,  // 0, 1, 2 ... in the order the cards should appear',
  '    "anchorId": string,    // a REAL node id from the digest above — what it hangs off',
  '    "dx": number, "dy": number   // offset from the anchor, in board units',
  '  }],',
  '  "addEdges": [{',
  '    "id": string,          // unique, e.g. "prop:e:<src>-><dst>:0"',
  '    "srcId": string,       // a REAL node id from the digest, or a "prop:" id you declared above',
  '    "dstId": string,       // same rule',
  '    "labels": [string],    // e.g. ["cache read"], ["publish"], ["grpc"]',
  '    "status": "proposed"',
  '  }],',
  '  "removeCardIds": [string]   // REAL node ids from the digest that the change deletes',
  '}',
  '',
  'Hard rules — a reply that breaks any of them is discarded whole, not repaired:',
  '- Every `anchorId`, every `removeCardIds` entry, and every `srcId`/`dstId` that is not a',
  '  `prop:` id you declared in `addCards` MUST be an id that appears verbatim in the digest',
  '  above. Never invent an id, never guess at one, never use a display name in place of an id.',
  '- At least one of `addCards`, `addEdges`, `removeCardIds` must be non-empty.',
  '- The block must contain valid JSON and nothing else — no comments, no trailing prose',
  '  inside the fence, no second fenced block anywhere in the reply.',
]);

/**
 * The exact prompt string for one (repo digest, change request) pair.
 *
 * Deterministic by construction: `buildAskPrompt` is pure, the contract is a
 * frozen constant, and nothing here reads a clock, a random source, or the
 * environment.
 *
 * @param {object} args
 * @param {object} args.digest        from the shipped `buildDigest`
 * @param {string} args.request       the user-voice change request
 * @param {Function} args.buildAskPrompt the shipped `buildAskPrompt`
 * @returns {string}
 */
export function buildProposalPrompt({ digest, request, buildAskPrompt }) {
  if (typeof buildAskPrompt !== 'function') {
    throw new TypeError('buildProposalPrompt: buildAskPrompt (the shipped one) is required');
  }
  if (typeof request !== 'string' || request.trim() === '') {
    throw new TypeError('buildProposalPrompt: request must be a non-empty string');
  }
  return buildAskPrompt(digest, request.trim(), {
    intentLines: [...PROPOSAL_CONTRACT_LINES],
  });
}
