import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  WORKING_HEADROOM_TOKENS,
  TOKEN_ESTIMATE_SAFETY,
  approxTokens,
  planContextFit,
} from '../llm/tokenBudget.js';
import { contextLengthFrom, effectiveContextFrom } from '../server/localProviders.js';

/**
 * THE BUG THIS LOCKS, and why a green test is not automatically proof.
 *
 * Ollama truncates a prompt that exceeds its window and returns HTTP 200 with no
 * error, so the failure is invisible from the response. Sequence read the
 * context ceiling and never used it. These tests pin the decision that stops it.
 *
 * The obvious "fix" — sending `num_ctx` on the outgoing request — was MEASURED
 * on 2026-09-04 against Ollama 0.33.2 and is a NO-OP on the openai-compatible
 * wire: HTTP 200, and `/api/ps` unchanged at 65536. The native `/api/chat` path
 * honours the same option (the model loads at exactly 8192). So the enforcement
 * has to be client-side, and a test that only asserted "we send num_ctx" would
 * go green while the truncation continued.
 */
describe('planContextFit — the prompt fits the window the server will actually run', () => {
  it('refuses when the prompt plus its reply cannot fit', () => {
    const plan = planContextFit({ need: 24_000, effective: 4_096 });
    assert.equal(plan.verdict, 'refuse');
    assert.equal(plan.effective, 4_096);
    /* The refusal has to be actionable, not just a rejection. It quotes the
       CALIBRATED need (24,000 x 1.3), because that is the number the decision was
       made on — quoting the raw estimate would not explain the verdict. */
    assert.match(plan.reason ?? '', /31,200/);
    assert.match(plan.reason ?? '', /4,096/);
    assert.match(plan.reason ?? '', /partial view/);
  });

  it('is EXACT at the boundary, because the boundary is a cliff', () => {
    // Ollama does not degrade gracefully: past the window it truncates to HALF.
    // So "just barely over" must refuse rather than round down and hope.
    const effective = 8_192;
    /* Expressed in RAW estimate terms, because that is what a caller passes: the
       largest raw figure whose calibrated value still leaves room for the reply.
       The property is unchanged — the comparison is exact, one token either side
       decides it — but the quantity compared is now the calibrated need, since a
       raw estimate sitting exactly on the boundary is ~30% over it in reality. */
    const need = Math.floor((effective - WORKING_HEADROOM_TOKENS) / TOKEN_ESTIMATE_SAFETY);

    assert.equal(planContextFit({ need, effective }).verdict, 'fits');
    assert.equal(planContextFit({ need: need + 40, effective }).verdict, 'refuse');
  });

  it('an unreadable window is UNKNOWN, never an implied pass', () => {
    // The whole class of bug this file exists for is a gap in our knowledge
    // being reported as a fact about the world. `null` means we could not read
    // the Modelfile's num_ctx, which is precisely the case where the SERVER
    // DEFAULT applies — the shape that truncates.
    const plan = planContextFit({ need: 100, effective: null });
    assert.equal(plan.verdict, 'unknown');
    assert.notEqual(plan.verdict, 'fits');
    assert.match(plan.reason ?? '', /truncates silently/);
  });

  it('passes an ordinary turn', () => {
    const plan = planContextFit({ need: 12_000, effective: 65_536 });
    assert.equal(plan.verdict, 'fits');
    assert.equal(plan.reason, undefined);
  });

  it('THE TRAINED CEILING MUST NOT BE USED HERE — it says yes where it truncates', () => {
    // Real /api/show bodies from this machine, 2026-09-04. `model_info` carries
    // the GGUF architecture ceiling; `parameters` carries the Modelfile, which
    // is what the server honours. Feeding the ceiling to the planner turns a
    // refusal into a confident pass on the one model that actually truncates.
    const stockGranite = {
      model_info: { 'granite.context_length': 131_072 },
      parameters: 'temperature 1\ntop_p 0.95\n', // no num_ctx -> server default
    };

    assert.equal(contextLengthFrom(stockGranite), 131_072);
    assert.equal(effectiveContextFrom(stockGranite), null);

    const withCeiling = planContextFit({ need: 24_000, effective: contextLengthFrom(stockGranite) });
    const withEffective = planContextFit({ need: 24_000, effective: effectiveContextFrom(stockGranite) });

    assert.equal(withCeiling.verdict, 'fits'); // wrong, and confidently so
    assert.equal(withEffective.verdict, 'unknown'); // honest
  });

  it('reads the effective window off a real Modelfile block', () => {
    const hermes = {
      model_info: { 'granite.context_length': 131_072 },
      parameters: 'num_batch                      1024\nnum_ctx                        65536\ntemperature 1\n',
    };
    assert.equal(effectiveContextFrom(hermes), 65_536);
    assert.equal(planContextFit({ need: 24_000, effective: effectiveContextFrom(hermes) }).verdict, 'fits');
  });

  it('estimates from text with the module’s one estimator', () => {
    // One definition in one place: the planner takes tokens, and the caller uses
    // the estimator this module already exported rather than inventing a second.
    const need = approxTokens('x'.repeat(40_000));
    assert.equal(need, 10_000);
    assert.equal(planContextFit({ need, effective: 8_192 }).verdict, 'refuse');
  });
});

it('the estimate is CALIBRATED before it is compared — an additive margin cannot absorb a multiplicative error', () => {
  /*
   * MEASURED 2026-09-04 against granite42-hermes' prompt_eval_count, on three
   * real ask prompts built from this repository's own graph:
   *
   *     approx 10,003 -> real 12,344   (1.234)
   *     approx 12,043 -> real 15,111   (1.255)
   *     approx  9,937 -> real 12,288   (1.237)
   *
   * approxTokens is chars/4, an English heuristic, and these prompts are paths,
   * identifiers and punctuation. Uncalibrated, the planner clears exactly the
   * case that truncates: 50,000 + 4,096 fits a 65,536 window on paper while the
   * real prompt needs about 62,000 before the reply is written.
   */
  const uncalibrated = 50_000;
  const plan = planContextFit({ need: uncalibrated, effective: 65_536 });
  assert.equal(
    plan.verdict,
    'refuse',
    'a 50k estimate is really ~62k of tokens and must not be waved through a 65,536 window',
  );
  assert.ok(
    plan.need > uncalibrated,
    'the reported need is the calibrated figure the decision was made on',
  );

  /* And the calibration must not make it paranoid: a prompt with real room still fits. */
  assert.equal(planContextFit({ need: 20_000, effective: 65_536 }).verdict, 'fits');
});
