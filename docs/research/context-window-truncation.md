# Silent context truncation — measured, with two corrections to the obvious fix

**Status:** diagnosed, **not fixed**, with a **known-good fix identified and verified**. The
obvious fix (adding a field) was measured to be a no-op; the real one is a transport change that
wants the owner present. **Measured 2026-09-03/04** against the live Ollama on this
machine (v0.33.2).

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


## The exposure

`num_ctx` appears **zero times** in the entire `packages/` tree. Sequence never tells the provider
how much context it wants, so it inherits whatever the server decides. Today that is harmless by
accident: the model the owner happens to be pointed at, `granite42-hermes`, bakes
`PARAMETER num_ctx 65536` in its Modelfile, and his prompts measure ~24k tokens. **Sequence
contributes nothing to that outcome.**

One click away it breaks. `granite4.2:3b` — same weights, the most natural thing to try next —
bakes no `num_ctx`, so Ollama applies the server default. `OLLAMA_CONTEXT_LENGTH` in the *running*
process is **4096** (the User-scope value of 32768 was set later and never took, because nothing
restarted). A 24,000-token prompt becomes 4,096. HTTP 200, no warning, a fluent well-cited answer
built on 17% of the evidence. `granite-bench` and `deepseek-teach` bake 16384, so they would
truncate at a third value. Three of four models degrade differently and the fourth is the only
reason nobody has noticed.

**Why this is a grounding bug and not a config note.** Truncation removes evidence *after* the
pipeline decided what to include and *before* the model saw it, so every honesty mechanism stays
intact and lies: `coverage` still reports edgesSeen against edgesTotal, `claims` still checks the
prose, and the scope line still says "answered from 212 of 2,514 edges" while the model never saw
most of the 212. It is the absence-of-a-signal law (`docs/how-to-verify.md`) with the signal removed
by a third party. llama.cpp's own log even reports `truncated = 0`, correctly — from its side
nothing was truncated, because the prompt arrived already short.

## CORRECTION 1 — `probeContextWindow` does not return the effective window

It returns the model's **trained** ceiling. `contextLengthFrom` reads
`model_info["*.context_length"]` out of `/api/show`, which is GGUF architecture metadata: what the
weights support. It is not the Modelfile `num_ctx`, and it is not the server default.

So on stock `granite4.2:3b` the probe would report something like 131072 while the running server
uses 4096 — **wrong by 32× in exactly the case that fails.** Using it to decide "does the digest
fit" would produce a confident, wrong "24k fits in 131k" and a silently truncated answer. That is
the same defect one layer up: a number that is real, well-named, and answering a different question
than the caller thinks.

It becomes the right number the moment Sequence *sets* the window — then the trained ceiling is the
correct upper bound to clamp a requested `num_ctx` against. Order matters: set first, then measure.

## CORRECTION 2 — the OpenAI-compatible path accepted `num_ctx` and ignored it

Sequence talks to `/v1/chat/completions`. Measured directly:

```
POST /v1/chat/completions  {..., "num_ctx": 8192}   ->  HTTP 200
GET  /api/ps                                        ->  context_length: 65536   (unchanged)
```

The request succeeded and the window did not move. **HTTP 200 proves only that it did not 400** —
OpenAI-compat layers ignore unknown fields, and this one did. (A loaded slot may also refuse to
resize without a reload; both readings lead to the same conclusion.)

This matters more than it looks: the tempting fix is to add `num_ctx` to the existing request body,
observe 200, and declare truncation handled. That would be a no-op shipped as a fix — and every
"green but wrong" this repo has catalogued has that shape. `provider.ts` already carries a comment
warning that "servers 400 on unexpected fields", so the field cannot simply be added unconditionally
either.

The reliable control is Ollama's **native** `/api/chat` with `options: { num_ctx }`, which is a
different endpoint from the one Sequence uses. Choosing that is a provider-path change.


## RESOLVED — the effective window IS discoverable, and the native path DOES honour it

Both open questions are now measured, and together they turn "design around the unknowable" into a
concrete fix.

**The effective window comes from `parameters`, not `model_info`.** The same `/api/show` response
already fetched carries a `parameters` block — the Modelfile — and that is the value the server
honours. Verified against the running slot:

```
granite42-hermes  parameters -> num_ctx 65536   /api/ps -> context_length 65536   exact match
                  model_info -> 131072          the trained ceiling, 2x wrong
```

Three states, and the third is the finding rather than a gap:

| `parameters.num_ctx` | meaning |
|---|---|
| present | that **is** the effective window — trustworthy |
| absent | the **server default** applies, and `/api/show` does not report it — unknowable here |
| — | `model_info.context_length` is the trained ceiling. **Never** the effective window |

The absent case is exactly the one that truncates: stock `granite4.2:3b` bakes no `num_ctx`. This is
now executable rather than prose — `effectiveContextFrom()` in `localProviders.ts`, with the real
measured shapes as fixtures, sitting beside `contextLengthFrom()` which now carries a warning that
it must never decide whether a prompt fits.

**And the native path honours `options.num_ctx`.** Measured directly, which settles whether a real
fix exists:

```
/api/ps                                              -> context_length 65536
POST /api/chat  {"options":{"num_ctx":8192}}         -> HTTP 200
/api/ps                                              -> context_length 8192     <- moved
POST /api/chat  {"options":{"num_ctx":65536}}        -> restored
```

So the fix is a **transport change, not a field addition**: the local-Ollama path has to speak
`/api/chat` with `options` rather than `/v1/chat/completions`, which accepts `num_ctx` and ignores
it. That is a real change to how Sequence talks to a provider and it wants the owner present — but
it is now a known-good change rather than an experiment.

**Revised order:**

1. Move the local-Ollama path to `/api/chat` with `options: { num_ctx }`, clamped to the trained
   ceiling from `contextLengthFrom`. *(Verified to work; needs the owner.)*
2. Where `effectiveContextFrom` returns null — no Modelfile `num_ctx` — the window is unknowable
   from `/api/show`, so setting it explicitly per step 1 is what makes it knowable at all.
3. Compare the prompt against the window we set, and if the digest does not fit, **say which part
   was lost** rather than letting the provider choose silently.

*(The loaded slot was restored to 65536 with its original VRAM footprint after the test.)*

## Why this is not fixed tonight

The owner is away, this is his running stack, and step 1 needs a model **load** to verify — which
changes what is resident in his VRAM. Two of the three steps in the original plan rested on premises
that measurement contradicted, and a fix built on those would have looked green and done nothing.
Recording the measurements so the next attempt starts from facts is worth more than a fast no-op.

**The probe is also the third value computed and thrown away tonight** — after the anatomy locks'
pinned numbers and the premise verdict that reached no route. `repoServer.ts` calls
`probeContextWindow` on the config GET, reports it to the client, and nothing uses it to shape a
request.
