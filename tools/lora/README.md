# `tools/lora` — the Phase 0 data + evaluation pipeline

> ### ⚠ BROKEN SINCE THE v1 DELETION — 2026-08-20
>
> This harness loads its teacher/validator directly out of `packages/web/src`, a package that was
> deleted in `20d1424`. `pnpm lora:test` fails 3 tests today; `pnpm lora` cannot run at all. There
> is no successor to `extractArchProposalFromAnswer` in `packages/web2` or `packages/schema` yet.
> Nothing in CI invokes it, which is why the breakage was silent.
>
> Fixing it is a port, not an edit: the validator has to move into a package that still exists.
> Until then, read the rest of this file as a record of how the loop worked, not as instructions
> you can follow.


Everything needed to turn our pinned repo corpus into a **format-adherence
training set** for a small local model, and to score whether tuning actually
helped. Read `docs/lora-operator-guide.md` first; this file is the *how you run
it*, that one is the *what and why*.

**Nothing here has been run against a model. No API was called, no weights were
downloaded, and nothing has cost anything.** Phase 0 is parked until the owner
green-lights it in person, so every path that could spend money is off behind an
explicit env var, and the entire test suite runs on fixtures.

---

## The one-paragraph version

Our own validator is the teacher. `extractArchProposalFromAnswer`
(`packages/web/src/graph/archProposal.ts`) either parses a candidate proposal and
grounds every id against the real scanned graph, or it rejects the whole thing.
So we can generate training data and score a tuned model automatically, with no
human judgement and no judge model in the loop. This directory is that loop:
**corpus → grounded change requests → prompts → teacher → filter → JSONL →
eval**.

## What the owner runs, in order

```bash
# 0. Build the engine. Everything here loads the SHIPPED analyzer from dist/.
pnpm -r build

# 1. Prove the pipeline's own logic. Offline, seconds, free.
pnpm lora:test

# 2. Look at the split before trusting any number that comes out of it.
node tools/lora/run.mjs splits

# 3. Rehearse the whole thing on real repos with a fixture teacher — free.
#    Writes train.jsonl, verify-template.txt and report.json under tools/lora/runs/.
node tools/lora/run.mjs dataset --repos express,gin --per-repo 4

# 4. READ tools/lora/runs/<stamp>/verify-template.txt.
#    This is guide §7's highest-risk silent failure made visible. Do not skip it.

# 5. Size the real generation pass before paying for it. Scans, synthesizes and
#    assembles every prompt; generates nothing.
node tools/lora/run.mjs dataset --dry-run

# 6. ---- THE ONLY STEP THAT COSTS MONEY. Owner only, deliberately. ----
export SEQUENCE_LORA_TEACHER_ENABLE=1
export SEQUENCE_LORA_TEACHER_BASE_URL=https://api.openai.com/v1   # or any openai-compatible
export SEQUENCE_LORA_TEACHER_MODEL=<a strong model id>
export SEQUENCE_LORA_TEACHER_KEY=sk-...
node tools/lora/run.mjs dataset --teacher api --per-repo 2 --repos express,gin   # cents, proves the loop
node tools/lora/run.mjs dataset --teacher api --per-repo 12                      # the full pass

# 7. Train. That happens on the GPU box, not here — guide §4 and §7.
#    Feed it runs/<stamp>/train.jsonl. Check the held-out pass rate EVERY epoch.

# 8. Score it. Free against local Ollama; the two arms must use the SAME sampling.
export SEQUENCE_LORA_EVAL_ENABLE=1
node tools/lora/run.mjs evaluate \
  --untuned qwen2.5-coder:7b --tuned sequence-qwen2.5-coder:7b \
  --base-url http://127.0.0.1:11434/v1 --min-improvement 0.15
```

Step 8 exits non-zero when the tuned model fails the stop rule. That is the
point: §7 says decide the threshold *before* the run, so the threshold is an
argument and the verdict is printed either way.

## What is stubbed, and where the real thing plugs in

| Seam | Default (used by every test) | The real one | Guard |
|---|---|---|---|
| Teacher — `generateProposal(prompt)` | `createFixtureTeacher` in `lib/teacher.mjs`; the CLI's default is `groundedFixtureCompletion` in `fixtures/candidates.mjs`, which anchors to the request's own real ids so a free rehearsal exercises the real filter | `createApiTeacher` — openai-compatible `/chat/completions`, one user message, no system role | throws unless `SEQUENCE_LORA_TEACHER_ENABLE=1`, **and** the CLI needs `--teacher api` |
| Eval client | `createStubClient` in `lib/evaluate.mjs` | `createOpenAICompatibleClient` — works against Ollama at `127.0.0.1:11434/v1`, the same endpoint `localModelRecommend.ts` already points Sequence at | throws unless `SEQUENCE_LORA_EVAL_ENABLE=1` |
| Chat template | `renderQwenChatML` — our **transcription** of Qwen2.5's ChatML | the tokenizer's own `chat_template` on the training box | `verify-template.txt` section D tells you exactly how to check it, and says the template wins |

Nothing else is stubbed. The scanner, the digest builder, the ask-prompt builder
and the validator are all the shipped ones, loaded from `dist/` (or, for the
validator, from `packages/web/src` — the web package has no `tsc` output, so
`lib/webimport.mjs` installs a narrow `.js`→`.ts` resolve hook).

## What it costs

The prompt is a full repo digest and dominates. Measured on the pinned corpus:
`express` and `gin` produce prompts around **28.5k characters (~7k tokens)**.
19 training repos × 12 requests ≈ 228 calls; at roughly 7–15k input and ~400
output tokens each that is on the order of 2–3M input tokens — **roughly $5–25
for one full generation pass** at current frontier list prices, plus reruns.
Inside the guide's sub-$100 Phase 0 budget. Confirm against the provider's price
page; this is an estimate, not a quote. `--dry-run` prints your real prompt sizes
so you can redo this arithmetic with your own numbers before spending anything.

## The files

| File | What it is |
|---|---|
| `run.mjs` | the CLI: `dataset`, `evaluate`, `splits` |
| `splits.json` | **train / held-out, declared up front.** The four ground-truthed repos are reserved for eval and a test enforces it |
| `request-recipes.json` | **the change-request mix** — an editable, reviewable list with a `why` on every row, because §7 names curation as a human judgement call |
| `lib/paths.mjs` | where everything lives; the shared clone-cache convention |
| `lib/corpus.mjs` | reads the QA manifest as data, validates the split, shallow-clones a pinned SHA |
| `lib/engine.mjs` | loads the SHIPPED scanner/digest/prompt/validator — never a copy |
| `lib/webimport.mjs` | the `.js`→`.ts` resolve hook that makes the real validator loadable from `.mjs` |
| `lib/prompt.mjs` | the proposal contract + `buildProposalPrompt` — the ONE place training and inference agree |
| `lib/requests.mjs` | grounded, seeded request synthesis; refuses to emit an ungrounded request |
| `lib/filter.mjs` | the grader. Validator decides; this labels the reason. Rejects are discarded, never repaired |
| `lib/teacher.mjs` | the teacher seam — fixture by default, API behind a switch |
| `lib/dataset.mjs` | JSONL emitter + `verify-template.txt` |
| `lib/evaluate.mjs` | held-out pass rate, tuned vs untuned, same sampling, stop rule |
| `fixtures/` | a small ArchGraph and one candidate per accept/reject outcome |
| `test/` | 58 tests, `node --test`, all offline |

## What we copied from `tools/qa-loop`, and why

`tools/qa-loop/**` belongs to another workstream and was rewritten mid-round to
per-repo child processes. So this pipeline **reads `tools/qa-loop/manifest.json`
as data** and re-implements two small things rather than importing them:
`cloneUrl` (one line) and a reduced `ensureRepoAtSha` (from
`tools/qa-loop/lib/clone.mjs`). About forty duplicated lines, taken deliberately
so a refactor next door cannot silently change which commit our training data
came from. The clone-cache location is shared on purpose — `SEQUENCE_QA_CACHE`,
else `<tmp>/sequence-qa-cache` — so a repo cloned by either tool serves both.

## Rejection reasons

`report.json` counts every one. Watch them: §7 warns that the filter can quietly
narrow the set to only the easiest cases, which makes the eval look strong for
the wrong reason.

- `no_fence` — no fenced block at all
- `bad_json` — fenced but unparseable (includes the **wrong fence language**;
  the validator's regex only accepts ` ```proposal ` and ` ```json `)
- `no_summary` — parsed, but not an object with a string `summary`
- `empty_diff` — proposes nothing
- `unreal_anchor` — an `anchorId` that is not a real node
- `unreal_edge_endpoint` — an edge endpoint that is neither real nor `prop:`
- `unreal_remove_id` — **stricter than the product validator**: it does not
  ground `removeCardIds`, but training on a deletion of a node that does not
  exist would be paying to teach hallucination
- `undeclared_prop_endpoint` — **stricter than the product validator**: a
  `prop:` endpoint no card declared. `applyArchProposalToDraft` silently drops
  that edge, so the user would accept a change that quietly does less than it said
- `validator_rejected_unclassified` — the validator said no and our classifier
  could not reproduce which rule. A non-zero count here means this file has
  drifted from `archProposal.ts` and should be re-read

Both stricter rules can only ever **reject further**; a locking test asserts the
validator is never overruled upward.

## Honest limits

- The fixture teacher produces one shape of diff. It proves the plumbing; it is
  not training data and the run note says so.
- Our ChatML render is a transcription, not the tokenizer's. Section D of the
  artifact exists precisely because we cannot check it from here.
- The token-cost figures are chars/4 estimates. The real tokenizer is the authority.
- Training data generated by our own engine teaches the model *our engine*. That
  is correct for format adherence — the validator is the teacher there — and it
  is **not** a basis for claiming the tuned model is smarter. Guide §2, in full.
