# Hosted model gateway — deploy spec

**Status: IMPLEMENTED (`packages/gateway`), deploy via `render.yaml`.**
The service is built and unit-tested; standing it up on Render (with a real
funded key) is the owner's deploy step — see `docs/GO_LIVE.md`.

> **Downstream provider: OpenRouter, not DeepSeek.** This spec was originally
> authored against DeepSeek's API directly; the shipped gateway targets
> **OpenRouter** (`https://openrouter.ai/api/v1`, default model
> `deepseek/deepseek-chat`) with the funded **`OPENROUTER_API_KEY`**. OpenRouter
> is OpenAI-compatible, so the client contract is unchanged. References to
> "DeepSeek key / `DEEPSEEK_API_KEY` / `api.deepseek.com`" below mean
> "OpenRouter key / `OPENROUTER_API_KEY` / `openrouter.ai/api/v1`".

The FREE metered default model needs a tiny HOSTED gateway that holds OUR funded
OpenRouter key and does per-user accounting. That secret key can **never** ship
inside a local app, so it lives ONLY here. This build ships everything *around*
the gateway — the `default` provider mode, the metering logic, the client — all
verified against a **mock** gateway (`ai-gateway.test.ts`, `usage-meter.test.ts`),
and the gateway itself is a standalone Node service under `packages/gateway/`
with its own tests (auth reject, backstop 402, model remap, key-never-leaked,
OpenAI-shape passthrough). Standing up the live instance with a real funded key
is a deploy step **outside this sandbox** — the honest boundary is now just the
first live OpenRouter round-trip, not the gateway code.

Until it is deployed, the default-mode path is honestly labeled in the UI
("ready — activates when the hosted model gateway is deployed") and **never
silently fails**: a call to the placeholder host surfaces a clean `ProviderError`.

## What the local app already does (verified here)

- `AiConfig.mode = 'default'` carries **no user key and no funded key** — only the
  gateway base URL (`DEFAULT_GATEWAY_URL`, a placeholder constant) and a model id.
- `resolveEndpoint()` routes default mode to `${gateway}/v1/chat/completions` and
  authenticates the **app** (an optional `SEQUENCE_GATEWAY_TOKEN` from the env),
  never a user credential.
- `server/meter.ts` decides allow/soft-cap/backstop; repoServer increments
  `~/.sequence/usage.json` on each successful default-mode call and serves
  `GET /api/usage`.

## What the deployed gateway does (implemented in `packages/gateway`)

1. **Holds the funded key server-side.** Reads `OPENROUTER_API_KEY` from its own
   env/secret store. It is never returned to a client and never logged.
2. **Speaks OpenAI-compatible** `POST /v1/chat/completions` (pass-through to
   `https://openrouter.ai/api/v1`, default model `deepseek/deepseek-chat`,
   overridable via `GATEWAY_DEFAULT_MODEL`/`OPENROUTER_BASE_URL`). Forwards
   `{model, messages}`, remaps the app's `deepseek-v4-flash` → the pinned model,
   and injects `Authorization: Bearer $OPENROUTER_API_KEY` downstream.
3. **Authenticates the app/instance**, not the user: verifies the incoming
   `Authorization: Bearer <app-token>` against `SEQUENCE_GATEWAY_TOKEN` (a
   comma-separated allowlist). No user secret is ever expected or accepted.
4. **Meters authoritatively.** The local per-user `usage.json` is a client-side
   convenience; the gateway keeps the authoritative global running-spend counter
   and returns a 402 past the backstop / 429 on abuse rate-limit — the client
   renders either as the "add your key" nudge.
5. **Global spend backstop** via `GLOBAL_SPEND_BACKSTOP_USD` (default $50) on the
   OpenRouter account, so a bug or abuse cannot run up the bill. **Durability
   caveat:** the counter is a file (`FileSpendStore` under `GATEWAY_STATE_DIR`);
   on an ephemeral disk a container replacement resets it. Wire it to a
   persistent disk or DB for a durable backstop (flagged in `docs/GO_LIVE.md`).
6. **Abuse guards:** strict model allowlist (`GATEWAY_ALLOWED_MODELS` — coerces
   any other/empty model to the pinned default), request-token clamp, and a
   per-instance rate limiter.

Endpoints: `POST /v1/chat/completions`, `GET /healthz`, `GET /v1/usage`. Listens
on `PORT` (default 8787) and binds all interfaces (Render-routable as-is).

## Cutover

Deploy the gateway from the repo-root `render.yaml` Blueprint, then point the app
at it via **`SEQUENCE_GATEWAY_URL`** (the app-side env that `serveRepo` reads into
`gatewayBaseUrl` — this replaced the old compile-time `DEFAULT_GATEWAY_URL`
constant) and share the caller token via **`SEQUENCE_GATEWAY_TOKEN`** (the app
copies the gateway's generated token via `fromService`). No other local code
changes: the client path is byte-identical to the mock-verified path with the
placeholder host swapped for the live one. Full step-by-step: `docs/GO_LIVE.md`.

## Explicitly NOT built (dropped, not deferred)

"Sign in with your Claude/Codex subscription." Anthropic and OpenAI prohibit
third-party apps using subscription/OAuth credentials (enforced from 2026-01; see
`docs/AI_CONNECT_RESEARCH.md` Q2). There is no fake login anywhere in this build.
