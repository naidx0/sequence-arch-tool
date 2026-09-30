# ADR-013 — Sequence-native, JCode-inspired model efficiency

- **Status:** Proposed (2026-08-05)
- **Drives:** Structural rebuild plan Phase 9
- **Scope:** Analyzer provider/session architecture and optional ACP agent profiles; no UI or product-code change

## Context

Sequence already has useful, separate primitives:

- `server/provider.ts` owns Anthropic and OpenAI-compatible wire formats, API-key hygiene, the
  hosted/default gateway route, and capped provider responses.
- `llm/tokenBudget.ts` applies explicit prompt budgets and honest omission markers.
- `server/meter.ts` applies a gateway soft allotment and hard global spend backstop.
- `server/acpSessionCache.ts` reuses ACP sessions with per-session serialization, a ten-minute idle
  TTL, LRU eviction, and an eight-session cap.
- `server/auth.ts` and `server/session.ts` implement Sequence account OAuth and signed browser
  sessions. They are not model-provider credentials.

Phase 9 needs lower prompt cost and bounded long-running sessions without turning Sequence into a
fork of another editor or agent. JCode is prior art for the efficiency goals only: compact
provider routing, cache-stable prompts, bounded context, and low idle memory. Sequence keeps its
TypeScript analyzer, local-first product, grounded graph, and ACP boundary.

The name “JCode” also refers elsewhere in product canon to a late Java/Kotlin architecture track.
This ADR does not schedule or alter that language track. Here, “JCode-inspired” means efficiency
prior art and the optional external ACP profile described below.

## Options

| Option | Behavior |
|--------|----------|
| **A** | Fork or embed JCode and adapt Sequence around its runtime |
| **B** | Keep today's direct provider calls and optimize each route independently |
| **C** | Add a Sequence-native request/session service over the existing provider, meter, prompt-budget, and ACP seams |

## Decision

**Accept Option C.** Build a small Sequence-native model request/session service in a later wave.
It owns route selection, prompt envelopes, usage records, bounded compaction, and session limits.
Existing provider wire adapters remain the credential-to-network chokepoint.

### 1. Typed provider routes

Represent routing as a discriminated union, not combinations of optional fields:

- `api-key`: a user-supplied Anthropic or OpenAI-compatible API credential.
- `model-subscription-oauth`: a provider-issued model credential obtained through an explicitly
  documented third-party OAuth flow.
- `gateway`: Sequence's metered hosted route; no funded credential enters local config.
- `local-openai-compatible`: a loopback/private OpenAI-compatible endpoint, with no credential
  required unless the user explicitly configures one.

Each route declares its wire format, model, capabilities, privacy boundary, retry policy, and cost
source. Credential material stays route-local and is never serialized into client responses,
prompts, usage events, failover errors, or another route.

`model-subscription-oauth` is a typed capability, not permission to reuse consumer subscription
tokens. Sequence account OAuth remains separate. A built-in model OAuth route may ship only when
the provider documents and permits third-party use for this purpose. Otherwise configuration
fails closed with an actionable error. At this ADR's adoption, no built-in subscription OAuth
route is assumed live.

### 2. Explicit, bounded failover

A request carries an ordered list of user-approved routes. Failover is allowed only when:

1. the next route satisfies the request's required capabilities and privacy policy;
2. the failure is transient (network failure, timeout, HTTP 408/429, or provider 5xx);
3. no tool or file side effect has begun; and
4. the route's request and spend budgets still allow the attempt.

Authentication, authorization, invalid-request, context-overflow, and policy failures do not
fail over. At most one alternate route is attempted by default. Every attempt is returned in
structured, secret-free diagnostics. Sequence never silently moves repository context from a
local route to a remote route.

### 3. Cache-friendly prompt envelope

All model calls use a versioned envelope with a stable prefix and volatile suffix:

1. stable Sequence policy and response contract;
2. stable tool schemas and grounded architecture snapshot, content-addressed by hash;
3. compacted prior-session state;
4. recent turns and the current user request;
5. volatile request metadata, kept last and excluded unless needed.

Stable sections use deterministic ordering, normalized whitespace, and versioned hashes. Dates,
request IDs, counters, and changing status prose never enter the stable prefix. Provider adapters
may map the envelope to provider-specific cache controls, but the canonical envelope remains
provider-neutral. Cache misses must preserve correctness.

### 4. Bounded multi-turn compaction

The session service tracks measured provider tokens when returned and conservative estimates
otherwise. Before a configured context threshold, it compacts only the oldest eligible turns:

- preserve the system contract, pinned user decisions, unresolved actions, grounded evidence
  references, and a configurable recent-turn tail;
- summarize into a versioned structured record with source turn IDs/hashes;
- include an honest omission marker for material dropped by a hard budget;
- cap summary input, summary output, and compaction attempts (one normal attempt plus one smaller
  retry); and
- if the bounded result still cannot fit, stop with a context-limit error rather than recurse,
  truncate silently, or start an unbounded summarization loop.

Compaction never rewrites the architecture graph or treats a model summary as scan evidence.
Raw expired turns are dropped from active memory after compaction; persistence, if enabled, uses
the existing local workspace boundary and a documented byte/TTL cap.

### 5. Capped session service

Use the existing ACP cache semantics as the baseline: per-key turn serialization, race-free
creation, idle TTL, LRU eviction, error disposal, and shutdown cleanup. The first implementation
should keep the current defaults of ten minutes idle and eight live sessions unless benchmarks
justify different values.

The cap includes pending creations so concurrent cold starts cannot temporarily exceed it.
Per-session limits cover active prompt bytes, compacted-state bytes, queued turns, and wall-clock
turn duration. Eviction never interrupts an active turn; admission queues briefly or rejects with
a retryable capacity error. No background worker may keep the process alive solely for a session.

### 6. Usage, cost, and spend controls

Record per attempt:

- route kind and model;
- input, cached-input, and output tokens;
- cache read/write outcome when the provider reports it;
- latency, retry/failover count, and terminal status; and
- provider-reported cost when available, otherwise a versioned estimate marked as estimated.

Do not record prompt text, repository content, credentials, or user identifiers outside the
existing local/account metering boundary. Local routes report tokens and latency but zero remote
spend. Gateway admission checks both per-request token ceilings and configurable user/org spend
caps before each attempt; successful usage reconciles estimates with provider-reported totals.
Concurrent reservations must not overshoot a hard cap.

### 7. Optional JCode ACP external profile

JCode may be offered later as an opt-in external ACP agent profile using the existing ACP process
boundary. Sequence may declare executable, arguments, capabilities, and session-sharing defaults;
it does not embed JCode's runtime, copy its TUI, auto-install it, or grant repository/network
access beyond the normal ACP profile controls. Missing executables produce an honest setup error
and never affect Sequence's built-in local-first path.

## Non-goals

- No Rust rewrite, TUI fork, parallel editor shell, or replacement of Sequence's analyzer.
- No Java/Kotlin language-track implementation under the similarly named product initiative.
- No autonomous swarm, agent-to-agent delegation fabric, self-modification, or recursive
  improvement loop.
- No telemetry service or upload of prompts, repository content, session transcripts, or local
  benchmark results.
- No undocumented consumer subscription-token reuse or coupling of Sequence login to model auth.
- No semantic cache that reuses model answers across different grounded graph states.
- No promise of zero-copy prompts, exact tokenizer parity across providers, or universal failover.
- No competitor leaderboard or benchmark claim against JCode or any other product.

## Attribution and license

JCode is credited as architectural inspiration for the efficiency goals in this ADR. This draft
copies no JCode source code, tests, UI, prompts, or protocol definitions.

Before any implementation imports or adapts upstream code, the implementing wave must record the
exact upstream repository and commit, verify its MIT license, preserve the copyright and MIT
license notice in the distributed source/NOTICE location, and identify modified files. Concepts
implemented independently do not require source headers, but the docs should retain this
attribution. “Inspired by” must not imply affiliation, endorsement, or benchmark superiority.

## Phased implementation checklist

### Phase A — Lock the baseline

- [x] Add a benchmark fixture and record Sequence baseline results before architecture changes.
- [x] Define request, route, capability, usage, and secret-redacted diagnostic types.
- [x] Lock current API-key, gateway, prompt-budget, metering, and ACP cache behavior with tests.
- [x] Document which model providers, if any, permit the proposed subscription OAuth route.

**Phase A note (subscription OAuth):** At adoption (2026-08-05) no built-in provider documents
third-party OAuth for model subscription credentials. The `model-subscription-oauth` route kind is
typed and fails closed with an actionable error (`MODEL_SUBSCRIPTION_OAUTH_UNAVAILABLE_MSG` in
`modelRoutes.ts`); Phase E may add adapters only after explicit upstream documentation and license
verification.

### Phase B — Route and prompt seams

- [x] Adapt existing API-key and gateway paths to the typed route union without changing wire bytes.
- [x] Add loopback/private-host validation and explicit consent for local OpenAI-compatible routes.
- [x] Introduce the deterministic, versioned prompt envelope and cache-key diagnostics.
- [x] Add bounded timeout/retry and one-hop, capability-aware failover with secret-free errors.

### Phase C — Sessions and compaction

- [x] Generalize the ACP cache lifecycle rules into the capped model session service.
- [x] Count pending plus live sessions and bound queues, bytes, TTL, and turn duration.
- [x] Add structured compaction with preserved decisions/evidence, source hashes, and hard budgets.
- [x] Test context overflow, compactor failure, eviction during contention, shutdown, and recovery.

### Phase D — Usage and spend

- [x] Capture provider-reported token/cache usage and mark all fallback estimates.
- [x] Add atomic gateway spend reservations, reconciliation, and configurable hard caps.
- [x] Expose local, secret-free diagnostics without adding remote telemetry.
- [x] Test that failed, blocked, and local calls are charged correctly and cannot overshoot caps.

### Phase E — Optional integrations and gate

- [ ] Add model-subscription OAuth adapters only for providers with documented third-party support.
- [ ] Add the optional JCode ACP profile and MIT attribution only after upstream/license verification.
- [ ] Run correctness, legibility where a surface changes, and human-usability gates.
- [ ] Publish benchmark deltas against the recorded Sequence baseline only.

## Benchmark harness

Run each scenario in a fresh process and a warmed process with fixed fixture content, deterministic
turn scripts, fixed model/route settings, and at least 20 repetitions after warm-up. Report median,
p95, sample count, environment, and raw JSON. Compare the candidate only with the pre-change
Sequence baseline from the same machine and provider/mock.

| Area | Metrics |
|------|---------|
| Prompt size | total input tokens; stable-prefix tokens; volatile-suffix tokens; provider-reported tokens plus estimated tokens when unavailable |
| Compaction | tokens before/after; absolute and percentage reduction; preserved decision/evidence count; recent turns retained; compaction latency; retries/failures |
| Cache cold/warm | cold request latency and input tokens; first warm latency; cache-read/write tokens; stable-prefix hash reuse rate; cold-to-warm delta |
| Memory | process proportional set size (PSS) after settle at 0, 1, and 8 idle sessions; peak PSS during one turn; PSS after TTL eviction and `disposeAll()` |
| Sessions | cold-create latency; reused-turn latency; queued-turn wait; live + pending high-water mark; LRU/TTL evictions; subprocess count |
| Reliability | success rate; transient retry count; one-hop failover rate; prevented unsafe failovers; context-limit failures; orphan process count |
| Gateway spend | reserved, estimated, provider-reported, and reconciled cost; cap rejections; maximum concurrent reservation overshoot (must be $0); spend per successful turn |

Required scenarios are: a cold single turn, an eight-turn warm session, a long session that crosses
the compaction threshold twice, eight concurrent sessions at cap, a ninth admission, a transient
primary-route failure, an authentication failure that must not fail over, gateway spend just below
and at the hard cap, TTL eviction, and clean shutdown.

## Consequences

- Sequence gets one bounded place to reason about provider choice, prompt caching, compaction,
  sessions, and spend while retaining existing credential and ACP boundaries.
- Stable envelopes and compaction should reduce repeated input, but add hashes, summaries, and
  diagnostics that must be versioned and tested.
- Typed subscription OAuth prevents accidental conflation with Sequence account OAuth, but it may
  remain intentionally unavailable when providers do not permit it.
- Failover becomes predictable and visible, at the cost of rejecting some failures rather than
  guessing another route.
- The eight-session/ten-minute defaults remain hypotheses until the baseline harness provides
  PSS and latency evidence.

## Alternatives considered

- **A — fork/embed JCode** — rejected: it creates a second product runtime and imports unrelated
  UI and lifecycle constraints. Sequence needs the efficiency properties, not another editor.
- **B — optimize routes independently** — rejected: prompt, session, failover, and spend limits
  would remain inconsistent across call sites and make credential-boundary review harder.
- **Unbounded transcript retention** — rejected: memory and token cost grow with session age.
- **Automatic cheapest-provider routing** — rejected: cost alone cannot preserve privacy,
  capabilities, model behavior, or user consent.
