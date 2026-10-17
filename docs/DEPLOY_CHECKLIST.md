# Deploy Checklist — ship today

Terse, ordered, honest. Every claim cites a file. Where an older doc disagrees with the code,
the code wins and it's flagged. Anything not directly checkable in this pass is marked
UNVERIFIED rather than guessed.

---

## What deploys today with zero new infrastructure

The local-first app: clone → `./start.sh` → done. Confirmed by reading `start.sh` (repo root):
installs deps via pnpm/corepack, builds if `packages/analyzer/dist/cli.js` /
`packages/web2/dist/index.html` are missing or stale, then runs
`node packages/analyzer/dist/cli.js` and opens the browser at `127.0.0.1`.

With **no key at all** (`packages/analyzer/src/server/provider.ts`, `repoServer.ts`):
- The app boots, binds loopback only (`assertSafeBind`/`bindHost` default `127.0.0.1` —
  `repoServer.ts:3159`), and scans/renders the user's own repo — full graph, risks, impact,
  Draw canvas, file/functions rail all work with no network call.
- Chat/AI (`mode:'default'`) is honestly gated OFF: `loadAiConfig()` only stamps
  `gatewayLive:true` when either `DEEPSEEK_API_KEY` is set on the server or
  `SEQUENCE_GATEWAY_URL` is configured (`repoServer.ts:2435-2457`). Neither is set locally, so
  a chat request throws `FREE_TIER_NOT_LIVE_MSG` — *"the free assistant is not live yet — add
  your own API key in Settings to chat"* (`provider.ts:148`) — before any fetch. This is a
  clean, worded refusal, not a crash.
- BYO key (`mode:'api-key'`, Settings → paste an Anthropic or OpenAI-compatible key) makes chat
  work immediately, fully local, no infra.
- web2 does **not** ship a Terminal / Browser / AI-canvas pane yet (`shipped: false` on those
  `+` menu items). The analyzer may still enable a loopback terminal socket
  (`resolveTerminalEnabled`, `repoServer.ts`) for a future UI — that is not a product tab.

So: **zero infra, zero secrets, zero signup** gets a user the shipped product except chat; one
pasted key gets them chat too. Nothing to deploy for this path — it's already what `./start.sh`
does.

---

## Path A — ship the desktop/local product (fastest to real users)

`packages/desktop` is an Electron shell around the same server (`packages/desktop/README.md`):
spawns `packages/analyzer/dist/cli.js` as a child process, polls `127.0.0.1:<port>`, and points
a `BrowserWindow` at it — no reimplementation.

Steps:
1. `pnpm install` at repo root (Electron's JS/types install without the binary under pnpm 10 —
   `packages/desktop/README.md`).
2. Fetch Electron's real binary: `pnpm approve-builds` or
   `node node_modules/electron/install.js` (skipped by pnpm 10's default install-script policy).
3. `pnpm --filter @sequence/desktop dist` → runs `scripts/prepare-server.mjs` (bundles analyzer
   dist + de-symlinked `node_modules` + web dist into `server-bundle/`) then `electron-builder`,
   producing installers per `packages/desktop/electron-builder.yml`: macOS `dmg`+`zip`
   (arm64/x64), Windows `nsis` (x64), Linux `AppImage`+`deb` (x64).

**What's missing / UNVERIFIED:**
- `electron-builder.yml`'s own header says this config has **never been run** in this build
  environment — `npm install electron`'s postinstall gets a 403 in the sandbox, so no window has
  ever actually opened here and no installer has ever actually been produced. It must be run and
  eyeballed on a real machine before shipping.
- **No code signing or notarization is configured anywhere in the repo** — grep of
  `electron-builder.yml` shows no `mac.identity`, no `afterSign` hook, no `win.certificateFile`.
  Shipping today means: unsigned macOS builds trigger Gatekeeper's "unidentified developer"
  warning (no Apple Developer ID + notarization = users must right-click → Open, or the app is
  blocked outright depending on macOS version); unsigned Windows builds trigger SmartScreen
  warnings. This is a real UX tax but not a hard blocker for a small early-access rollout.
  Signing requires: an Apple Developer Program membership ($99/yr) + notarization credentials for
  macOS, and a code-signing certificate (EV cert recommended to avoid SmartScreen) for Windows —
  both are owner-only purchases/identities, not something an agent can provision.
- **No app icon is configured either — `electron-builder.yml` has no `mac.icon` / `win.icon` /
  `linux.icon` key at all.** `buildResources: build` is set, which means electron-builder falls
  back to its own default lookup inside `packages/desktop/build/` — a directory that does not
  exist in this repo yet. This was checked directly (r184): `grep -n "icon" electron-builder.yml`
  returns nothing, and `packages/desktop/build/` is absent. Left as-is, a real
  `electron-builder` run either fails outright or falls back to Electron's own generic icon.
  An agent cannot generate real `.icns`/`.ico` raster icons (they require actual pixel art, not
  markup) — this is a raster-asset gap only the owner can close, from the same chrome render the
  new brand mark was drawn from. He must supply, under `packages/desktop/build/`:
  - `icon.icns` — macOS, a multi-resolution icon family bundled as one `.icns` (source PNGs at
    16, 32, 64, 128, 256, 512, and 1024px, each provided at 1x and 2x per Apple's HIG, then
    packed with `iconutil` or electron-builder's own PNG→icns conversion).
  - `icon.ico` — Windows, a multi-resolution `.ico` containing at minimum 16, 32, 48, and 256px
    frames.
  - `icon.png` — Linux (AppImage/deb), a single 512×512 (or 1024×1024) PNG; electron-builder
    derives the smaller AppImage/deb sizes from it.
  All three should be the **three-plane mark** (geometry recorded in git history at the deleted
  v1 paths `packages/web/src/ui/BrandMark.tsx` / `packages/web/public/favicon.svg`, commit
  `20d1424` — re-draw for web2 is still open; Graphite has no mark sheet yet),
  24px variant, not the
  16px favicon variant — these render large, e.g. a 128px Dock icon, where three planes read
  fine) rendered on a fixed background (transparent for `.icns`/`.ico`; app chrome recommends a
  filled square background matching `--win`/`--bg` for OS icon grids that don't composite
  transparency well, e.g. some Windows contexts) rather than `currentColor`, the same reasoning
  as the favicon. Once supplied, wire them with `mac.icon: build/icon.icns`, `win.icon:
  build/icon.ico`, `linux.icon: build/icon.png` in `electron-builder.yml` — an agent can do that
  part once the raster files exist; nothing else in this checklist blocks on it.

This path has **no server, no OAuth, no DB, no gateway** — it's the fastest way to put a real
binary in someone's hands today, with the same "no key → full graph, no chat" / "BYO key → full
chat" behavior as `./start.sh`.

---

## Path B — ship the hosted free tier

Two independent ways to make the free (no-key) chat default light up. Both are real, wired, and
env-gated in `repoServer.ts:2435-2457` — whichever env is set first wins (DeepSeek-direct is
checked first).

### B-fast — DeepSeek direct (no gateway service needed)
Set `DEEPSEEK_API_KEY` (a funded DeepSeek key) directly on the app service. `loadAiConfig()`
then routes `mode:'default'` straight to `https://api.deepseek.com` with `gatewayLive:true`
stamped (`provider.ts:87-132`, `repoServer.ts:2436-2450`). No `packages/gateway` deploy, no
second service, no OpenRouter account. This is the fastest way to turn chat on for a hosted
instance, but it has **no per-request spend backstop of its own** beyond the per-user daily cap
below — fund the DeepSeek key with a small balance and watch it, or use Path B-gateway instead
for the hard ceiling.

### B-gateway — the funded gateway + full free-tier stack (what `render.yaml` builds)
`render.yaml` (repo root) is a 3-resource Render Blueprint, already written and internally
consistent with the code (`packages/gateway/src/config.ts`, `packages/analyzer/src/server/auth.ts`,
`pgStore.ts`). Full runbook: `docs/GO_LIVE.md` (verified current against code in this pass — no
contradictions found). In order:

1. **Deploy the gateway** (`packages/gateway`, `type: web`/`runtime: docker`,
   `dockerfilePath: ./packages/gateway/Dockerfile`) on Render. It's a standalone Node service
   with **zero runtime npm dependencies** (Dockerfile comment, confirmed by
   `packages/gateway/package.json` — no `dependencies` key). Env it reads
   (`packages/gateway/src/config.ts`):
   - `OPENROUTER_API_KEY` — the funded key. Absent ⇒ the service still boots (`/healthz` is up)
     but every proxy call returns a clean 500, never a crash loop (`server.ts:20-24`).
   - `SEQUENCE_GATEWAY_TOKEN` — comma-separated caller-token allowlist. **Unset ⇒ accepts ALL
     callers** (dev-only, loud startup warning); **set-but-empty ⇒ accepts NONE** (fail closed).
   - `GATEWAY_ALLOWED_MODELS` (default: just the default model) — strict allowlist; anything
     else, including the app's own placeholder id, is silently coerced to the default model
     (`config.ts:remapModel`).
   - `GLOBAL_SPEND_BACKSTOP_USD` — hard ceiling, **default 50** (USD). At/over ⇒ 402.
   - `GATEWAY_STATE_DIR` — where the spend counter file (`FileSpendStore`) lives. Default
     `os.tmpdir()`. **On Render's default ephemeral disk this counter is NOT durable** — a
     container replacement resets the spend backstop to zero (flagged in both `render.yaml`'s
     comments and `docs/GO_LIVE.md`). Fix: attach a Render persistent disk (commented-out block
     already in `render.yaml`) and point `GATEWAY_STATE_DIR` at its mount — requires a paid Render
     instance type.
   - Also: `OPENROUTER_BASE_URL`, `GATEWAY_DEFAULT_MODEL`, `EST_COST_PER_CALL` (default
     $0.0018/call), `GATEWAY_MAX_REQUEST_BYTES` (256 KiB), `GATEWAY_MAX_RESPONSE_BYTES` (20 MiB),
     `GATEWAY_MAX_TOKENS` (2048), `GATEWAY_RATE_LIMIT_PER_MIN` (60/caller-token/instance),
     `PORT` (8787), all with working defaults.
   - What it proxies to: OpenAI-compatible `POST /v1/chat/completions` → OpenRouter
     (`https://openrouter.ai/api/v1`), forwarding to `deepseek/deepseek-chat` by default.
     `GET /healthz`, `GET /v1/usage`.
   - Cost: Render free-tier web service for the container itself, **plus real OpenRouter spend**
     capped at the backstop ($50 default) — this is the money line item, not a platform fee.

2. **Fund a provider key.** Sign in at openrouter.ai, add credit, create a key → paste into
   `sequence-gateway`'s `OPENROUTER_API_KEY` in the Render dashboard (`docs/GO_LIVE.md` §1, §6).

3. **Wire per-user metering.** Two layers exist in code today, and they are **not the same
   mechanism**:
   - **Monthly usage, per user, durable** — `UsageStore` in `repoServer.ts:508-513`: when
     `DATABASE_URL` is set it uses `createPgUsageStore` (`packages/analyzer/src/server/pgStore.ts`,
     a real Postgres-backed sync-cache/async-write-through store against `user_usage` — schema in
     `packages/analyzer/schema.sql`); unset, it falls back to a **per-identity local file** under
     the user config dir. **This code exists today and is wired**, not hypothetical. A DB **is
     required** for this to be durable/shared across instances and restarts on a hosted multi-user
     deploy; `render.yaml` provisions `sequence-db` (Postgres, `plan: free`) and wires
     `DATABASE_URL` via `fromDatabase` automatically.
   - **Daily rate cap, per user — durable when `DATABASE_URL` is set** — `freeTierLimit.ts` +
     `dailyGate` in `repoServer.ts:508-516`, default 100 req/user/day (`FREE_TIER_DAILY_LIMIT`
     env override). Same env gate as the monthly store: **`DATABASE_URL` set ⇒
     `createDurableDailyGate` over `createPgDailyUsageStore`** (Postgres table `user_daily_usage`,
     schema in `packages/analyzer/schema.sql`) — one cap **shared by every instance** and
     **surviving restarts/redeploys**, because the charge is a single atomic
     `INSERT ... ON CONFLICT DO UPDATE SET used_count = used_count + 1 RETURNING used_count`
     (a read-then-write would race across instances). **`DATABASE_URL` unset ⇒ the in-memory
     per-instance gate**, unchanged for local/single-instance use. So this **does still require a
     DB**: with no `DATABASE_URL` on a multi-instance deploy the old N×-the-cap /
     resets-on-restart behaviour is exactly what you get.
     - **Failure posture: fail CLOSED.** If the DB is configured but the counter query fails, the
       free default is **denied** with an honest 503 (`FREE_TIER_LIMIT_UNAVAILABLE_MSG`) rather
       than falling back to a permissive in-memory count — a DB outage must not become uncapped
       free spend. BYO-key mode is never metered or capped and keeps working throughout; nothing
       local-first is affected. Failures are logged by error name/code only — never a connection
       string or key.
     - Rows older than 7 days are pruned by the app (one `DELETE` per process per UTC day), so the
       table stays bounded. Day boundaries are UTC (`currentDayUtc`), unchanged.
     - Locked by `packages/analyzer/src/test/daily-limit-durable.test.ts` (multi-instance shared
       cap, restart, no-store parity, store-failure posture, UTC rollover, prune).
   - Run the DDL once: `psql "$DATABASE_URL" -f packages/analyzer/schema.sql` (idempotent,
     `CREATE ... IF NOT EXISTS` — `docs/GO_LIVE.md` §7).

4. **Point `DEFAULT_GATEWAY_URL` / `SEQUENCE_GATEWAY_URL` at the deployed gateway.** The
   compile-time constant `DEFAULT_GATEWAY_URL = 'https://gateway.sequence.dev'`
   (`provider.ts:87`) is a **placeholder, never actually deployed at that hostname** — don't rely
   on it. The real seam is the env var: set `SEQUENCE_GATEWAY_URL` on `sequence-app` to the
   gateway's real `https://` URL (Render's `fromService` can only hand back a bare host, no
   scheme, so this is a hand-entered dashboard value — `render.yaml` comment,
   `docs/GO_LIVE.md` §6). `serveRepo` reads it into `opts.gatewayBaseUrl`
   (`repoServer.ts:3151-3152`).

5. **Verify `gatewayLive` flips the UI's honest label.** `loadAiConfig()` stamps
   `gatewayLive:true` the moment `gatewayBaseUrl` is set (`repoServer.ts:2451-2453`) — this
   drives `provider.ts`'s `requestModelText` gate (no more `FREE_TIER_NOT_LIVE_MSG`) and is the
   same flag `redactAiConfig` returns to the client (`provider.ts:307-310`) for the UI's
   "ready"/"live" labeling. Confirm with a real metered chat call, then `GET /api/usage`.

---

## Authentication

**What exists in code right now:**
- Full OAuth sign-in for **Google and GitHub**, env-gated and additive
  (`packages/analyzer/src/server/auth.ts`, `session.ts`). With no OAuth env set, `authEnabled()`
  is false, no `/auth/*` routes light up, and the server stays single-user local (identity
  `'local'`) — confirmed by grep of `repoServer.ts:213,560,585,729,2989,3142-3146`.
- Routes, real and wired: `GET /auth/login/:provider` (302 to provider with signed CSRF state +
  PKCE), `GET /auth/callback/:provider` (exchanges code → mints signed session cookie),
  `GET /api/me` (session state + which providers are configured) — all in
  `packages/analyzer/src/server/repoServer.ts:756-820`.
- Sessions are signed, tamper-evident HMAC-SHA256 tokens in an HttpOnly/Secure/SameSite=Lax
  cookie (`session.ts`) — no external session store, no JWT library, just `node:crypto`. 7-day
  TTL default.
- `authEnabled(cfg)` requires **all three**: `SESSION_SECRET` set, `PUBLIC_BASE_URL` set, and at
  least one provider (both its client id AND secret) present (`auth.ts:91-123`).
- **Live OAuth is verified only against a mock `fetch` in tests** — the real accounts.google.com
  / github.com round-trip has never actually happened in this build (`auth.ts` header comment).
  First real login on deploy is the honest unverified seam.

**What's needed to turn it on — CONFIGURE, not build:**
| Env var | Where | Source |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | `sequence-app` | Google Cloud Console → OAuth client, redirect URI `https://<app-url>/auth/callback/google` |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | `sequence-app` | GitHub OAuth App, callback `https://<app-url>/auth/callback/github` |
| `SESSION_SECRET` | `sequence-app` | Render mints it (`generateValue: true`) — never hand-typed |
| `PUBLIC_BASE_URL` | `sequence-app` | full `https://` app URL by hand (Render can't self-reference its own scheme) |

Callback paths are fixed by code (`callbackUrl()` in `auth.ts:126-128`), not configurable —
must match exactly in each provider's dashboard.

**What's NOT built (and would need real engineering, not config):**
- No third-party account system beyond Google/GitHub OAuth identity — no password auth, no email
  magic links, no other providers.
- No admin/ops UI for managing users, revoking sessions, or viewing spend per user beyond
  `GET /api/usage` for the caller's own identity.
- Daily rate limiting is durable/shared **only when `DATABASE_URL` is set** (see Path B step 3);
  with no DB it stays per-instance and per-process, so a multi-instance deploy without Postgres
  still gets N× the intended cap and a reset on every restart.
- Multi-user workspace isolation: GitHub-imported repos land in a **shared**
  `sequence-workspaces/` directory on the container filesystem with **no per-user tenant
  boundary** (`docs/GO_LIVE.md` "Honesty & limits", `docs/DEPLOY_BLUEPRINT.md`). Treat a hosted
  multi-user deploy as single-trust until this is hardened — this is a real gap, not paperwork.
- "Sign in with your Claude/Codex subscription" is explicitly **not built, on purpose** —
  Anthropic/OpenAI prohibit third-party apps reusing subscription OAuth credentials
  (`docs/GATEWAY_DEPLOY.md`, bottom section).

---

## Blockers only the owner can clear

- **Money:** OpenRouter (or DeepSeek) account funding for Path B; Render service costs beyond
  free tier if durability (persistent disk for the spend counter, paid instance type) is wanted.
- **Domains:** the app's real public URL (`sequence-app.onrender.com` or a custom domain) must
  exist before OAuth apps can be registered — callback URLs are exact-match.
- **Credentials:** creating the Google OAuth client and GitHub OAuth App (needs owner's Google
  Cloud / GitHub accounts — `docs/GO_LIVE.md` §2-3).
- **tldraw / Task Board:** **retired with v1** (2026-08-20). web2 has no tldraw dependency
  (`docs/TLDRAW_LICENSE.md` is history, not a live ship blocker). Whiteboard is Sequence-native.
- **Product screenshots / marketing site.** The v1 `site/` tree and its `site/assets/` heroes
  were **deleted 2026-08-20**. Do not republish them. Graphite marketing rebuild is a separate
  owner lane (PR #124); this finish-open agent does not regenerate marketing shots or attach
  Vercel. App ship path is clone + `./start.sh` / `.\start.ps1` until the owner publishes a site.

- **Desktop signing identities:** Apple Developer Program membership + notarization credentials
  (macOS), code-signing certificate (Windows) — see Path A. Not required to ship an
  early-access/internal build, but required before a public download link that doesn't scare
  users with OS warnings.

---

## Pre-flight verification (run before pushing a release)

From `docs/HANDOFF.md` / `docs/release-gate.md` — the three gates, ALL must hold:

> **Package note (v2 pivot, 2026-08-20).** `@sequence/web` was **deleted** (`20d1424`). For v2 work
> run gates against **`@sequence/web2`**. The gate shapes do not change; the filter does. Legibility
> e2e for web2 is not yet a named script — judge by opening the app until it ships.

```sh
pnpm -r build
node --test                                    # schema/acp/analyzer
pnpm --filter @sequence/web2 test              # vitest
pnpm --filter @sequence/web2 test:e2e          # e2e (when Chromium present)
pnpm --filter @sequence/web2 test:e2e:shell    # shell e2e
```

Then **look at `tmp-shots/legibility/`** — the legibility gate has shipped green on a visibly
broken layout before (a stray CSS selector crushed a whole menu while every check passed); do
not skip the visual look.

For the hosted path specifically, add the deploy-side checks from `docs/GO_LIVE.md` §8:
gateway `/healthz` 200, app home screen loads, GitHub sign-in round-trip, Google sign-in
round-trip, one real metered chat call increments `/api/usage`, and hitting the daily/backstop
cap renders the "add your own key" nudge rather than failing silently.

---

*Commands and env vars above were read directly from `packages/gateway/src/config.ts`,
`packages/gateway/src/server.ts`, `packages/analyzer/src/server/{auth,session,provider,
freeTierLimit,pgStore,repoServer}.ts`, `render.yaml`, `start.sh`,
`packages/desktop/{package.json,electron-builder.yml,README.md}`, and
`docs/{GATEWAY_DEPLOY,GO_LIVE,DEPLOY_BLUEPRINT,TLDRAW_LICENSE}.md` in this pass.
Root `vercel.json` only silences a GH check for the retired marketing deploy — it is not a live
app deploy config. No infrastructure or numbers were invented; anything not directly checkable
is called out above.*
