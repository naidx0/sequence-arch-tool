# Eval practice + teaching UX — adoption plan (2026-09-01)

From SWE-agent's ACI paper, SWE-bench Verified's annotation method, the Agentic Benchmark
Checklist, Anthropic's agent-evals guidance, τ-bench's pass^k, Prime's Environments Hub,
Khanmigo/LearnLM/BEA-2025 tutoring literature, CodeTour and ICAP. Citations in the research
trail; decisions here.

## Bench practices to adopt (our mini-50 + quick-15)

1. **Annotate all 50 instances once, Verified-style**: issue-ambiguity and test-over-
   specificity 0–3 each; drop/repair ≥2. A resolve rate over unvalidated denominators is
   uninterpretable.
2. **Gold + empty patch validation, 3× each**: gold must resolve, empty must fail,
   identically across runs, before an instance counts. Catches flaky suites and graders
   that pass without a fix.
3. **Measure the noise band**: quick-panel 3× per config, mean ± spread; pre-commit a
   minimum believable delta (>2 instances on 50). Report **pass^k on the panel** as the
   reliability number beside pass@1 (90% pass@1 ≈ 57% pass^8 — the headline hides it).
4. **Four trajectory metrics beside resolve rate** (all computable from stored
   trajectories): empty-patch rate, stuck-in-loop rate (same action 3×), file-level
   localization match vs gold patch, steps/cost per resolve. They say WHY a score moved.
5. **Institutionalized transcript reading** every run, and ACI thinking: when a transcript
   shows flailing, the fix is usually the interface (feedback verbosity, fiddly action,
   false-firing guardrail), not the model. Guardrails only at ~100% precision.
6. **Version the bench as its own artifact** (dataset + harness + graders pinned), history
   comparable across agent versions; keep sourcing instances from real owner failures.

## Teach Mode vs published tutoring science

Already satisfied: load management (one concept/~150 words), active learning
(predict-then-reveal), answer-withholding at format level, groundedness verification (the
Khanmigo "math agent" pattern — ours is the harness grader), real-artifact anchoring
(CodeTour's validated advantage).

Missing, ranked: **(1) mistake remediation** (the BEA-2025 8-dimension taxonomy — published,
auto-gradeable: identification / location / reveal-discipline / guidance / actionability);
(2) adaptive pacing (depth responds to learner signal); (3) outcome measurement (transfer:
does the learner solve the NEXT thing); (4) metacognition prompts; (5) learner history.

## Teach-eval rubric v2 (auto-gradeable)

- Deterministic: word cap; cited symbols exist; predict-precedes-reveal structure; nodes
  named in text ⊆ nodes highlighted; one canvas op per concept.
- Seeded-misconception probes: scripted wrong answers; judge scores the four BEA remediation
  sub-dimensions (published judge prompts exist).
- Reveal discipline: does a check-in turn contain its own answer? (binary judge)
- Adaptive pacing: fast/struggling personas on one lesson; depth must diverge by turn 3;
  report pass^k across personas.
- **Transfer proxy**: end-of-lesson quiz answered by a fresh model given ONLY the lesson
  transcript, graded against graph truth — automatable next-item correctness.

## Interaction patterns to build, ranked

1. Seeded-misconception remediation flow (locate → hint → actionable step; never reveal).
2. **Predict-on-canvas** (draw the predicted edge; reveal diffs it against the real graph) —
   constructive > active > passive (ICAP), and it is the moat move.
3. Progressive hint ladder (3 tiers, tier-reached logged as the scaffolding metric).
4. Explain-back turns (learner traces a flow in their own words; judged against the graph).
5. Replayable lesson-as-tour (persist lessons as canvas-anchored tours — durable onboarding
   assets from every teach session).
