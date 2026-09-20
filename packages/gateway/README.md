# @sequence/gateway

A tiny, dependency-light HTTP service that is the funded backend for Sequence's
**free default model tier**. It holds the funded **OpenRouter** API key
server-side, speaks the OpenAI-compatible `POST /v1/chat/completions` shape the
app already sends in `default` mode, injects the funded key downstream, and
enforces an **authoritative global spend backstop** plus a token clamp and a
best-effort abuse rate-limit.

The funded key lives ONLY here. It is never returned to a client, never logged,
and never echoed in an error body. This is the one "unverified-until-deployed"
seam described in `docs/GATEWAY_DEPLOY.md`, retargeted DeepSeek → OpenRouter.

Runtime dependencies: **none** (Node 20's built-in `http` + `fetch`). TypeScript
is a build-time dev dependency only.

## Routes

| Method | Path                    | Purpose                                                              |
| ------ | ----------------------- | ------------------------------------------------------------------- |
| `POST` | `/v1/chat/completions`  | The proxy. Validates, remaps, meters, forwards, returns verbatim.   |
| `GET`  | `/healthz`              | `{ "ok": true }` liveness probe.                                    |
| `GET`  | `/v1/usage`             | `{ globalSpendToDate, backstop, monthYear }` for ops.               |

## The request/response contract (fixed — the client does NOT change)

Request the app sends:

```
POST <gateway>/v1/chat/completions
content-type: application/json
authorization: Bearer <SEQUENCE_GATEWAY_TOKEN>   # optional
{ "model": "deepseek-v4-flash", "messages": [ { "role": "user", "content": "..." } ] }
```

- On success the gateway returns the **OpenRouter response body verbatim** with
  the upstream 2xx status, so the client reads `choices[0].message.content`.
- Any non-2xx is rendered by the client as an "add your key" nudge. The gateway
  returns:
  - **401** — caller `Authorization: Bearer` not in the allowlist.
  - **402** — global spend backstop reached (`{"error":{"message":"free tier exhausted — add your own key"}}`).
  - **413** — request body over the byte cap.
  - **429** — per-caller abuse rate-limit tripped.
  - **400** — malformed body / missing `messages[]`.
  - **500** — gateway misconfigured (no `OPENROUTER_API_KEY`).
  - **502** — upstream failed or returned 5xx (sanitized; never leaks the key).

### What the proxy does, in order

1. **500** if `OPENROUTER_API_KEY` is unset (never crash-loops).
2. **Caller auth** — if `SEQUENCE_GATEWAY_TOKEN` is set, the caller's bearer must
   be in the comma-separated allowlist, else **401**.
3. **Rate-limit** — per-caller-token sliding window, else **429**.
4. **Body clamp** — over `GATEWAY_MAX_REQUEST_BYTES` ⇒ **413**; must be JSON with
   a `messages` array, else **400**.
5. **Spend backstop** — `globalSpendToDate >= GLOBAL_SPEND_BACKSTOP_USD` ⇒ **402**
   (checked *before* any upstream call).
6. **Model coercion (strict allowlist)** — incoming `deepseek-v4-flash`, empty,
   or any model NOT in `GATEWAY_ALLOWED_MODELS` ⇒ coerced to `GATEWAY_DEFAULT_MODEL`
   (never rejected — the app keeps working). Only an allowlisted model passes
   through. Net effect: the funded key can only ever be spent on approved models,
   whatever the client sends.
7. **Forward** — only `model` + `messages` + a server `max_tokens` cap go
   downstream (all other client fields dropped, including client `max_tokens`).
   Injects `Authorization: Bearer $OPENROUTER_API_KEY` (+ optional attribution
   headers) and POSTs to `${OPENROUTER_BASE_URL}/chat/completions`.
8. **Meter + return** — on a 2xx, add `EST_COST_PER_CALL` to the global counter
   and return the upstream body verbatim.

## Configuration (environment)

| Variable                    | Default                        | Purpose                                                                                   |
| --------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`        | — (**required**)               | The funded key. If unset the service boots but every proxy call returns 500. Never logged. |
| `SEQUENCE_GATEWAY_TOKEN`    | *(unset)*                      | Comma-separated allowlist of accepted caller bearers. **Unset ⇒ accept all (dev only, loud warning).** Empty ⇒ reject all. |
| `OPENROUTER_BASE_URL`       | `https://openrouter.ai/api/v1` | Upstream base URL (no trailing slash needed).                                              |
| `GATEWAY_DEFAULT_MODEL`     | `deepseek/deepseek-chat`       | Coercion target for empty / placeholder / non-allowlisted models.                         |
| `GATEWAY_ALLOWED_MODELS`    | `deepseek/deepseek-chat`       | Comma-separated allowlist of models the funded key may be spent on. Others are coerced to the default. The default model is always implicitly allowed. |
| `GLOBAL_SPEND_BACKSTOP_USD` | `50`                           | Monthly global spend ceiling. At/over ⇒ 402.                                              |
| `EST_COST_PER_CALL`         | `0.0018`                       | Flat USD added per successful call (estimate; the true guard is the OpenRouter balance).  |
| `PORT`                      | `8787`                         | Listen port.                                                                              |
| `OPENROUTER_HTTP_REFERER`   | *(unset)*                      | Optional OpenRouter-recommended `HTTP-Referer` attribution header.                        |
| `OPENROUTER_X_TITLE`        | *(unset)*                      | Optional OpenRouter-recommended `X-Title` attribution header.                             |
| `GATEWAY_STATE_DIR`         | `os.tmpdir()`                  | Directory for the durable `spend.json` counter.                                           |
| `GATEWAY_MAX_REQUEST_BYTES` | `262144` (256 KiB)             | Request body cap ⇒ 413 over.                                                              |
| `GATEWAY_MAX_RESPONSE_BYTES`| `20971520` (20 MiB)            | Upstream response buffer cap ⇒ 502 over.                                                  |
| `GATEWAY_MAX_TOKENS`        | `2048`                         | Server-imposed `max_tokens` on every downstream call (bounds cost).                       |
| `GATEWAY_RATE_LIMIT_PER_MIN`| `60`                           | Per-caller-token requests/minute; over ⇒ 429. `0` disables.                               |

## Global spend store & durability

The backstop is enforced against an injectable `SpendStore { read(monthYear), add(monthYear, usd) }`.
The default `FileSpendStore` persists to `$GATEWAY_STATE_DIR/spend.json`.

> **Render note:** the container disk is **ephemeral** — a redeploy/restart
> resets `spend.json`, so the file store is a per-instance best effort. For true
> durability, implement the same `SpendStore` interface over `DATABASE_URL`
> (Postgres) or a mounted volume and inject it at the `createGateway` call site.
> That seam is intentionally left open; no `pg` dependency is added in this phase.

The abuse rate-limit is likewise **in-memory and per-instance** — a speed bump,
not a distributed quota. Behind N replicas the effective ceiling is `limit × N`.
The authoritative money guard is the spend backstop.

## Run

```bash
pnpm --filter @sequence/gateway build
OPENROUTER_API_KEY=sk-or-... SEQUENCE_GATEWAY_TOKEN=tok1,tok2 pnpm --filter @sequence/gateway start
```

Or via Docker:

```bash
docker build -t sequence-gateway packages/gateway
docker run -p 8787:8787 -e OPENROUTER_API_KEY=sk-or-... -e SEQUENCE_GATEWAY_TOKEN=tok1 sequence-gateway
```

## Test

```bash
pnpm --filter @sequence/gateway test
```

Tests (`node:test`) inject a mock `fetch` and an in-memory store, so **no network
and no real key are needed**. They lock: caller-token 401, backstop 402, model
remap, OpenAI-shape verbatim passthrough with the funded key attached downstream
but **proven absent from the response**, oversize 413, sanitized upstream errors,
and the rate-limit 429. **Live OpenRouter behavior is verified only on deploy.**
