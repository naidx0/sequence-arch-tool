/**
 * EXPLICIT TOKEN BUDGETS for everything we assemble into a model prompt.
 *
 * ================================ WHY THIS EXISTS ==========================
 * Before this module every prompt-assembly point had its own ad-hoc, SILENT cap:
 *
 *   - `llm/label.ts`      — `readmeExcerpt.slice(0, 1500)`, and nothing at all on
 *                           the component list (one line per component, unbounded).
 *   - `explain/explain.ts`— `MAX_FILES_PER_SERVICE = 50` / `MAX_EDGES = 300` inside
 *                           `buildDigest`, which bound the digest PER SERVICE but
 *                           not in total: a repo with 100 services still produces a
 *                           100 × 50-file digest. `DESIGN_ASK_MAX_OUTLINE_CHARS`
 *                           silently chopped the design outline mid-word.
 *   - `explain/askIntents`— `MAX_CONTEXT_LINES = 64` / `MAX_CONTEXT_CHARS = 8_000`
 *                           on the client-compiled scope, applied by `break`ing out
 *                           of the loop with no trace left in the prompt.
 *
 * Two problems with that. (1) Nothing bounded the WHOLE assembled prompt, so a
 * pathological repo (the 1140-file fastapi scan) could hand a provider a prompt
 * far past its context window and get an opaque provider error back. (2) Every
 * one of those caps was silent: the model was handed a truncated list with no
 * signal that it was truncated, so "these are all the files" was a lie we told it.
 *
 * This module is the shared primitive. It cuts the TAIL (no relevance ranking is
 * invented — each call site's own ordering is the ranking it already chose) and
 * ALWAYS appends an honest marker line saying how much was dropped and why.
 *
 * ============================== HONESTY OF THE COUNT =======================
 * `approxTokens` is an APPROXIMATION — 4 characters per token, the usual
 * English/code rule of thumb. It is NOT a tokenizer: real BPE counts vary by
 * model and by content. We use it deliberately: a real tokenizer would mean
 * shipping a model-specific vocabulary per provider, and these budgets are
 * guardrails against pathological inputs, not billing. Anywhere a caller needs a
 * hard byte guarantee it should read `approxChars` and treat it as chars, not
 * tokens.
 *
 * THIS PARAGRAPH USED TO GUESS THE DIRECTION AND GUESSED IT BACKWARDS. It said
 * "long identifiers run sparser" — fewer tokens per character. Measured against a
 * real tokenizer on this repository's own prompts, the count runs about a QUARTER
 * HIGHER than chars/4, not lower. The guess was reasonable and it was wrong, in
 * the direction that makes a fitting check say yes when the answer is no. The
 * numbers and what each kind of caller must do about them are on
 * {@link approxTokens}; read that before using this for a decision.
 */

/** Characters per token, the standard rough English/code heuristic. See file header. */
export const CHARS_PER_TOKEN = 4;

/**
 * Approximate token count of `text`. An APPROXIMATION, never a tokenizer count.
 *
 * ⚠ IT IS BIASED, AND IT IS BIASED THE SAME WAY EVERY TIME. chars/4 is an
 * English heuristic; this repository's prompts are paths, identifiers,
 * punctuation and JSON, which tokenize worse. Measured 2026-09-04 against
 * granite42-hermes' `prompt_eval_count`, on three real ask prompts built from
 * this repository's own graph:
 *
 *     approx 10,003 -> real 12,344   (1.234)
 *     approx 12,043 -> real 15,111   (1.255)
 *     approx  9,937 -> real 12,288   (1.237)
 *
 * So it reads about a QUARTER LOW, consistently. That is not a rounding error to
 * shrug at, because the direction is what matters and it differs by caller:
 *
 *   FITTING — "will this still fit?" An underestimate says yes when the answer
 *     is no, most confidently on the biggest inputs, which is exactly when it
 *     truncates. These callers MUST calibrate: see {@link TOKEN_ESTIMATE_SAFETY},
 *     which {@link planContextFit} applies. The other fitting consumer is
 *     `compaction.ts` (`tokensBefore <= contextThresholdTokens`), where a low
 *     reading means compaction fires LATER than its threshold intends.
 *
 *   CUTTING — "how much may I keep?" An underestimate keeps about a quarter MORE
 *     than the budget names. Over-inclusion rather than truncation, so it is not
 *     a correctness bug — but every such budget is quietly looser than its
 *     constant claims. Do NOT apply the safety multiplier here: a margin for
 *     fitting and a margin for cutting point in opposite directions, and using
 *     one for the other would shrink every prompt by a quarter for no reason.
 *
 *   REPORTING — `askCli` stamps this as `usage.inputTokens` with
 *     `estimated: true` only when the provider returned no usage of its own.
 *     Honest about being an estimate; worth knowing it leans low rather than
 *     scattering either way.
 */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** The character allowance a token budget approximately corresponds to. */
export function budgetChars(budgetTokens: number): number {
  return Math.max(0, Math.floor(budgetTokens * CHARS_PER_TOKEN));
}

/**
 * The marker appended whenever anything was cut. Exported so tests — and any
 * debug view of the assembled prompt — can assert on the exact shape, and so a
 * reader of a prompt can tell a short list from a TRUNCATED one.
 */
export function omissionMarker(count: number, unit = 'lines'): string {
  return `…${count} more ${unit} omitted to fit the model budget`;
}

export interface CutResult {
  /** The kept lines, plus the marker line when anything was cut. */
  lines: string[];
  /** How many input lines were dropped. `0` ⇒ `lines` is the input, unchanged. */
  omitted: number;
}

/**
 * Cut `lines` to `budgetTokens`, at LINE granularity, from the TAIL.
 *
 * The call site's ordering is preserved exactly: this never re-ranks. If a call
 * site wants its most valuable content kept it must already have put it first —
 * inventing a relevance order here would silently change which evidence reaches
 * the model.
 *
 * Returns the input array's contents unchanged (`omitted: 0`) when it already
 * fits, so today's normal-sized prompts are byte-identical.
 */
export function cutToBudget(
  lines: readonly string[],
  budgetTokens: number,
  opts: { unit?: string } = {},
): CutResult {
  const unit = opts.unit ?? 'lines';
  const limit = budgetChars(budgetTokens);
  // The joined size is what actually reaches the provider — count the newlines.
  const total = lines.reduce((n, l) => n + l.length + 1, 0);
  if (total <= limit) return { lines: [...lines], omitted: 0 };

  // Reserve room for the marker itself, so the RESULT (marker included) fits.
  // Worst case the marker names every line, so size it against that count.
  const reserve = omissionMarker(lines.length, unit).length + 1;
  const allowance = Math.max(0, limit - reserve);
  const kept: string[] = [];
  let used = 0;
  for (const l of lines) {
    const next = used + l.length + 1;
    if (next > allowance) break;
    kept.push(l);
    used = next;
  }
  const omitted = lines.length - kept.length;
  if (omitted === 0) return { lines: kept, omitted: 0 };
  kept.push(omissionMarker(omitted, unit));
  return { lines: kept, omitted };
}

export interface CutTextResult {
  /** The kept text, with the marker appended on its own line when anything was cut. */
  text: string;
  /** How many characters were dropped. `0` ⇒ `text` is the input, unchanged. */
  omitted: number;
}

/**
 * Cut a free-text blob (a README excerpt, a design outline) to `budgetTokens`.
 *
 * Character granularity, because these have no meaningful line structure to
 * preserve — but never silent: the marker says how much went. Cuts the tail, for
 * the same reason `cutToBudget` does.
 */
export function cutTextToBudget(text: string, budgetTokens: number): CutTextResult {
  const limit = budgetChars(budgetTokens);
  if (text.length <= limit) return { text, omitted: 0 };
  const reserve = omissionMarker(text.length, 'characters').length + 1;
  const keep = Math.max(0, limit - reserve);
  const omitted = text.length - keep;
  return { text: `${text.slice(0, keep)}\n${omissionMarker(omitted, 'characters')}`, omitted };
}

/* ===========================================================================
 * DOES THE ASSEMBLED PROMPT ACTUALLY FIT THE WINDOW THE SERVER WILL RUN?
 *
 * Everything above bounds what we ASSEMBLE. Nothing above knew what the server
 * would ACCEPT, and the file header guessed wrong about the failure mode: it
 * expected "an opaque provider error back". Ollama does not error. It returns
 * HTTP 200 and silently drops the overflow, so every honesty mechanism
 * downstream stays intact and lies — `coverage` still reports edgesSeen against
 * edgesTotal while the model never saw most of them.
 *
 * MEASURED 2026-09-04 on this machine, granite42-hermes via Ollama 0.33.2:
 *
 *   POST /v1/chat/completions with num_ctx (top level AND in `options`)
 *     -> HTTP 200, /api/ps context_length UNCHANGED at 65536.
 *   POST /api/chat with options.num_ctx = 8192
 *     -> the model loads at exactly 8192.
 *
 * So the OpenAI-compatible wire ACCEPTS the field and IGNORES it. Adding
 * `num_ctx` to the outgoing body would have shipped a no-op that returns 200 and
 * looks like a fix. That is why this is a client-side budget and a refusal
 * rather than a request parameter — and it matches the wire's existing rule two
 * hundred lines up in provider.ts, that unknown fields are not sent because some
 * local servers reject them.
 *
 * WHY THE HEADROOM IS LARGE, and it is not padding. Ollama does not degrade
 * gracefully at the boundary — it truncates to HALF the window. Measured in the
 * sibling ML Harness repo (`app/providers/budget.py`) against a 13,213-token turn:
 *
 *     num_ctx = 13,213  ->  6,609 evaluated   (half)
 *     num_ctx = 13,312  -> 13,213 evaluated   (whole)
 *
 * Ninety-nine tokens apart, and one of them loses six thousand. There is no
 * "slightly truncated" state to land in, so the margin must absorb both this
 * estimator's error and the tool results and reply that arrive DURING the turn.
 * =========================================================================== */

/**
 * Tokens reserved on top of the prompt for the reply and for tool results that
 * come back mid-turn. See the cliff above: this is a safety margin against a
 * discontinuity, not a rounding allowance.
 */
export const WORKING_HEADROOM_TOKENS = 4096;

/**
 * Multiplier applied to an `approxTokens` estimate before it is compared with a
 * real context window.
 *
 * chars/4 is an English heuristic and Sequence's prompts are paths, identifiers
 * and punctuation. Measured against a real tokenizer on three ask prompts built
 * from this repository: 1.234, 1.255, 1.237. Set above the measurement, because
 * refusing early costs a narrower question and refusing late costs a silently
 * partial answer.
 *
 * `need` in a returned {@link ContextPlan} is the CALIBRATED figure — the number
 * the decision was actually made on, so a reason string quoting it is quoting
 * what was compared rather than a rawer number that would not explain the
 * verdict.
 *
 * FOR FITTING DECISIONS ONLY. A caller asking "how much may I keep?" must NOT
 * use this: a cutting budget that under-counts keeps more than intended, and
 * multiplying it here would shrink every prompt by a quarter to fix a comparison
 * it is not part of. See {@link approxTokens} for the three directions.
 */
export const TOKEN_ESTIMATE_SAFETY = 1.3;

/** What {@link planContextFit} decided, and why. */
export type ContextVerdict =
  /** The prompt plus headroom fits the window the server will actually run. */
  | 'fits'
  /** It does not fit. Sending would truncate silently; refuse and say so. */
  | 'refuse'
  /**
   * The effective window could not be established. NOT a synonym for "fine" —
   * this is the `unverifiable` case, and the caller must surface it rather than
   * proceed as though the answer were grounded in everything it assembled.
   */
  | 'unknown';

export interface ContextPlan {
  verdict: ContextVerdict;
  /** Approximate tokens the prompt needs, by {@link approxTokens}. */
  need: number;
  /** The window the server will run, or `null` when it could not be read. */
  effective: number | null;
  /** Reserve applied on top of `need`. */
  headroom: number;
  /** A sentence for the user. Present on `refuse` and `unknown`, absent on `fits`. */
  reason?: string;
}

/**
 * Decide whether a prompt may be sent to a local model without being truncated.
 *
 * PURE and total. `effective` comes from `effectiveContextFrom` in
 * `server/localProviders.ts` — the Modelfile's `num_ctx`, which is the window the
 * server honours. Do NOT pass `contextLengthFrom`'s value here: that is the
 * TRAINED ceiling and it is wrong by 2x, 32x and 64x on the three models on this
 * machine, most confidently in exactly the case that truncates.
 */
export function planContextFit(opts: {
  need: number;
  effective: number | null;
  headroom?: number;
}): ContextPlan {
  /*
   * CALIBRATE THE ESTIMATE BEFORE COMPARING IT, because the headroom above is
   * ADDITIVE and this error is MULTIPLICATIVE.
   *
   * `approxTokens` is chars/4, the standard English heuristic. Sequence's
   * prompts are not English: they are paths, identifiers, punctuation and JSON,
   * which tokenize worse. Measured 2026-09-04 against granite42-hermes'
   * `prompt_eval_count` on three real ask prompts built from this repository's
   * own graph:
   *
   *     approx 10,003 -> real 12,344   (1.234)
   *     approx 12,043 -> real 15,111   (1.255)
   *     approx  9,937 -> real 12,288   (1.237)
   *
   * Uncalibrated, the planner says "fits" most confidently exactly where it
   * truncates: on a 65,536 window an estimated 50,000 clears 50,000 + 4,096, and
   * really needs about 62,000 before the reply. A fixed 4,096 margin cannot
   * absorb a 24% error at that scale — it is roughly a third of it.
   *
   * 1.3 rather than the measured 1.25, because being early to refuse costs a
   * narrower question and being late costs a silently partial answer, and those
   * are not the same price. Applied here rather than by changing
   * CHARS_PER_TOKEN, which the prompt-assembly cutters also read — moving it
   * would resize every budget in the file to fix one comparison.
   */
  const need = Math.max(0, Math.ceil(opts.need * TOKEN_ESTIMATE_SAFETY));
  const headroom = Math.max(0, Math.floor(opts.headroom ?? WORKING_HEADROOM_TOKENS));
  const effective = opts.effective;

  if (effective === null || !Number.isInteger(effective) || effective <= 0) {
    return {
      verdict: 'unknown',
      need,
      effective: null,
      headroom,
      reason:
        'The context window this model runs with could not be read, so I cannot tell whether ' +
        'the whole repository digest reached it. Ollama truncates silently and returns success, ' +
        'so treat this answer as possibly built on a partial view.',
    };
  }

  if (need + headroom > effective) {
    return {
      verdict: 'refuse',
      need,
      effective,
      headroom,
      reason:
        `This question needs about ${need.toLocaleString()} tokens of repository context and the ` +
        `model runs a ${effective.toLocaleString()}-token window (reserving ` +
        `${headroom.toLocaleString()} for the reply). Sending it would silently drop the overflow ` +
        'and answer from a partial view. Narrow the question, or run a model with a larger window.',
    };
  }

  return { verdict: 'fits', need, effective, headroom };
}
