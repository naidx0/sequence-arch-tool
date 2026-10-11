# Go-Live — Sequence hosted free tier on Render

A copy-paste runbook for standing up Sequence's hosted free tier: a funded
**OpenRouter gateway**, the **app** with Google + GitHub sign-in, and a managed
**Postgres**, all from the repo-root [`render.yaml`](../render.yaml) Blueprint.

The code is built and locally verified against mocks; this guide is the owner's
deploy step — the first real OAuth + OpenRouter round-trips happen here with your
own accounts and secrets. Nothing below puts a real secret in the repo.

---

## 0. Read this first — bind host + two honest follow-ups

1. **Bind host — handled by config.** The app binds `127.0.0.1` by default;
   `SEQUENCE_BIND_HOST=0.0.0.0` (already set on `sequence-app` in `render.yaml`)
   exposes it so Render can route to `0.0.0.0:$PORT`. **Security:** a non-loopback
   bind MUST be paired with OAuth — the server warns if you bind public without
   auth. Both providers are configured on this service, so you're covered; just
   don't skip filling the OAuth secrets in step 6.

2. **Two real hardening follow-ups remain** (they don't block deploy):
   - The gateway's global-spend counter is a file (`FileSpendStore` under
     `GATEWAY_STATE_DIR`) and is **not durable** on Render's ephemeral disk —
     wire it to a persistent disk or DB before relying on the backstop across
     restarts.
   - Multi-user **workspace isolation** is not yet hardened (shared
     `sequence-workspaces/`, no per-user tenant boundary).

   Both are detailed in the "Honesty & limits" section below.

---

## 1. Create the OpenRouter key

1. Sign in at <https://openrouter.ai>, add credit to fund the free tier, and
   create an API key (Keys → Create Key).
2. You'll paste it later into **`sequence-gateway` → `OPENROUTER_API_KEY`** as a
   dashboard secret (step 6). It never leaves the gateway service and is never
   returned to a client or logged.

> The gateway pins the model to `deepseek/deepseek-chat` via
> `GATEWAY_ALLOWED_MODELS`, so the funded key can only ever spend on that model,
> and `GLOBAL_SPEND_BACKSTOP_USD=50` caps total spend.

---

## 2. Create the GitHub OAuth app

<https://github.com/settings/developers> → **New OAuth App**.

- **Application name:** Sequence (or anything).
- **Homepage URL:** `https://sequence-app.onrender.com`
- **Authorization callback URL (exact):**
  `https://sequence-app.onrender.com/auth/callback/github`
- Create it, then **Generate a new client secret**.
- Copy the **Client ID** and **Client secret** → you'll paste them into
  **`sequence-app` → `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`** (step 6).

> Replace `sequence-app` with your real app service name/URL if Render assigns a
> different subdomain. The callback path `/auth/callback/github` is fixed by
> `auth.ts` (`callbackUrl(cfg, 'github')`).

---

## 3. Create the Google OAuth client

<https://console.cloud.google.com/apis/credentials> → **Create credentials → OAuth
client ID** → Application type **Web application**.

- **Authorized JavaScript origins:** `https://sequence-app.onrender.com`
- **Authorized redirect URI (exact):**
  `https://sequence-app.onrender.com/auth/callback/google`
- Create it, then copy the **Client ID** and **Client secret** → you'll paste
  them into **`sequence-app` → `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`**
  (step 6).

> The redirect path `/auth/callback/google` is fixed by `auth.ts`. You may need
> to configure the OAuth consent screen first if this is a fresh Google project.

---

## 4. Suggested values you generate yourself

You never type `SESSION_SECRET` or the gateway token by hand — Render mints them
(`generateValue` / `fromService`). But if you ever need to set them manually
(local testing, a second environment), generate strong values:

```sh
# Session cookie signing key (app)
openssl rand -hex 32

# Gateway caller token (must match on both services if set by hand)
openssl rand -hex 32
```

In this blueprint: the app's `SESSION_SECRET` is `generateValue: true`, and the
app's `SEQUENCE_GATEWAY_TOKEN` is copied from the gateway's generated token via
`fromService` — so they line up automatically, nothing to paste.

---

## 5. Deploy the Blueprint

1. In Render: **New → Blueprint**.
2. Connect the GitHub repo **`naidx0/sequence-arch-tool`** (grant Render access if asked).
3. Render reads [`render.yaml`](../render.yaml) and shows three resources to
   create: `sequence-gateway` (Docker web), `sequence-app` (Node web), and
   `sequence-db` (Postgres). Apply.
4. First build runs. The **gateway** should come up and pass `/healthz`, and the
   **app** should come up on `0.0.0.0:$PORT` (via `SEQUENCE_BIND_HOST`). The app
   won't be fully functional until you fill the OAuth + URL secrets in step 6.

---

## 6. Fill the dashboard secrets

Render created the services with `sync: false` placeholders. Fill them in each
service's **Environment** tab, then let it redeploy.

**`sequence-gateway`:**

| Key | Value |
| --- | --- |
| `OPENROUTER_API_KEY` | your OpenRouter key from §1 |

**`sequence-app`:**

| Key | Value |
| --- | --- |
| `GITHUB_CLIENT_ID` | from §2 |
| `GITHUB_CLIENT_SECRET` | from §2 |
| `GOOGLE_CLIENT_ID` | from §3 |
| `GOOGLE_CLIENT_SECRET` | from §3 |
| `PUBLIC_BASE_URL` | `https://sequence-app.onrender.com` (your app's real URL) |
| `SEQUENCE_GATEWAY_URL` | `https://sequence-gateway.onrender.com` (your gateway's real URL) |

> **Why `PUBLIC_BASE_URL` and `SEQUENCE_GATEWAY_URL` are entered by hand:** the
> app needs full `https://…` URLs (OAuth callbacks; `${gateway}/v1/chat/completions`).
> Render's `fromService` can only supply a bare host with no scheme, so these two
> are dashboard values. `SEQUENCE_GATEWAY_TOKEN` and `DATABASE_URL` are wired
> automatically and need no entry.

If Render assigned different subdomains, use those actual URLs everywhere in
steps 2, 3, and 6 (callback URLs must match exactly).

---

## 7. Apply the DB schema (required)

The app uses the Postgres per-user `UsageStore` whenever `DATABASE_URL` is set
(wired via `fromDatabase`). Apply `packages/analyzer/schema.sql` once so the
`user_usage` / `users` tables exist. The DDL is idempotent
(`CREATE ... IF NOT EXISTS`), so re-running it is safe. Use either:

- **Render psql:** the `sequence-db` page → **Connect → PSQL command**, then
  `\i packages/analyzer/schema.sql` (or paste the file contents), or
- **A one-off Job / local shell:** `psql "$DATABASE_URL" -f packages/analyzer/schema.sql`.

---

## 8. Verify

Work top-down; each step gates the next.

1. **Gateway health:** `curl https://sequence-gateway.onrender.com/healthz` → 200.
   Also `GET /v1/usage` returns the global spend counter.
2. **App loads:** open `https://sequence-app.onrender.com` → the home screen
   renders. (If it doesn't, confirm `SEQUENCE_BIND_HOST=0.0.0.0` is set on the
   app service — a loopback bind is unreachable from Render's router.)
3. **Sign in — GitHub:** click GitHub sign-in → provider consent → you're
   redirected back to `/auth/callback/github` and land signed in. `GET /api/me`
   returns `{ signedIn: true, provider: "github", … }`.
4. **Sign in — Google:** same round-trip via `/auth/callback/google`.
5. **A metered chat call:** with default AI mode, send a prompt. It should route
   through the gateway (`${SEQUENCE_GATEWAY_URL}/v1/chat/completions`), succeed,
   and increment usage (`GET /api/usage`).
6. **Free-tier cap → the nudge:** exhaust the monthly soft cap (or trip the
   gateway backstop) and confirm the client renders the "add your own key" nudge
   on the non-2xx (402/429) response rather than failing silently.

---

## Honesty & limits (what "free tier" does and does not do)

- **Terminal is OFF on the hosted bind.** `SEQUENCE_ENABLE_TERMINAL` is left
  unset, so the pipe shell (real command execution as the server user) is
  refused. Do **not** set it to `1` on this shared/public deploy — that would
  hand every visitor a shell. Terminal stays a local-only feature.
- **The hosted app scans repos you import via GitHub, not your local disk.** On
  the hosted bind there is no access to your machine's filesystem; you attach a
  repo through GitHub import, which clones it server-side (SSRF-guarded,
  token-hygiene enforced — see `docs/DEPLOY_BLUEPRINT.md`).
- **Multi-user workspace isolation is not yet hardened.** GitHub imports land in
  a shared `sequence-workspaces/` on the container's filesystem — there is no
  per-user tenant boundary. Treat this as a single-trust deployment until
  per-user isolation (one sandbox/container per session) is added. **Next
  hardening step.**
- **The global spend backstop is not durable yet.** The gateway's counter is a
  file (`FileSpendStore` under `GATEWAY_STATE_DIR`) on Render's ephemeral disk,
  so a container replacement resets it. Wire it to a persistent disk (see the
  commented `disk:` block in `render.yaml`) or a DB before relying on the
  backstop across restarts. **Next hardening step.**
- **Per-user usage IS durable** via Postgres: with `DATABASE_URL` set (wired by
  `fromDatabase`) the app uses the Postgres `UsageStore` (`schema.sql`), so
  per-user monthly usage persists across redeploys. (This is separate from the
  gateway's global backstop counter above, which still needs durable storage.)

---

## Marketing site (trysequence.app) — LIVE, deployed from `site/` in this repo

**CORRECTED 2026-09-10. This section said "RETIRED 2026-08-20, not deployed from this repo" and
that has been wrong since 2026-08-26** — six days before it was last read, and it was read as the
state and reported that way at least once. The retirement is kept below as history, because it
happened; what follows it is what is true now.

**The site is in this repo, at [`site/`](../site/), and the domain serves it.** Ten files —
`index.html`, `styles.css`, `favicon.svg`, four woff2 faces, `.vercelignore`, `README.md`, and
`site/vercel.json`. Deployment is **Vercel with Root Directory `site`**, which is why the config
lives at `site/vercel.json` rather than at the repo root:

- `f6dfb9e9` (2026-08-26) rebuilt it on Graphite, publishable on Vercel.
- `664126cf` (2026-08-26) moved `vercel.json` into `site/`, where the Root Directory is.

So a push to `main` that touches `site/` **does** deploy the public website. That is the opposite of
what this section used to say, and it is the sentence a reader needs.

<details><summary>Historical — the 2026-08-20 retirement, which is what the old text described</summary>

The v1 site was built to the retired Console brand book and its screenshots showed the v1 UI being
deleted at Wave 7, so on 2026-08-20 the owner retired it and ruled it out of the tree rather than
parked in an archive folder. All 32 files were deleted and the repo-root `vercel.json` went with
them, deliberately not re-pointed — publishing a retired site as the public website would have been
worse than not publishing.

That state held for six days. The rebuild above ended it, and the Graphite-era site the old text
called "separate work" is the one now serving.

</details>

<details><summary>Historical — how the v1 site deployed (for reference only)</summary>

Static HTML, no monorepo build, deployed on every push to the Vercel-connected branch. Either
layout worked: repo root with `outputDirectory: "site"`, or Root Directory `site` with its own
`site/vercel.json`. Framework Preset had to be `Other` — set to Node.js it failed with
`No entrypoint found in site`. Both configs and the site README were deleted with the site on
2026-08-20; `git log --diff-filter=D --name-only -- site/` finds them.

**And they came back.** The rebuild restored `site/README.md` and, at `664126cf`, `site/vercel.json`
— so of the two layouts above it is the second that ships today: Root Directory `site`, config
inside it. This paragraph is left in place because the v1 deployment history is still worth having;
the sentence above it is not the current state and was read as one.

**r46 product canon (2026-07-24):** Landing aligned with unified Architecture, Agents rename, Task Board import — deploy from `main` after push. Local `main` may be **ahead of origin** until owner merges the r45–r50 stack (47 commits vs origin/v20); Vercel follows **pushed** `main` only.

</details>

---

## Appendix — env var reference

**`sequence-gateway`**

| Var | Source | Notes |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | dashboard secret (`sync:false`) | funded key; never logged/returned |
| `SEQUENCE_GATEWAY_TOKEN` | generated (`generateValue`) | caller allowlist token |
| `GATEWAY_ALLOWED_MODELS` | literal `deepseek/deepseek-chat` | strict model allowlist |
| `GLOBAL_SPEND_BACKSTOP_USD` | literal `50` | hard spend ceiling |
| `OPENROUTER_HTTP_REFERER` / `OPENROUTER_X_TITLE` | optional dashboard | OpenRouter attribution |
| `GATEWAY_STATE_DIR` | optional | point at a persistent disk for durability |
| `PORT` | Render-provided | gateway reads it (default 8787) |

**`sequence-app`**

| Var | Source | Notes |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | dashboard secret | OAuth |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | dashboard secret | OAuth |
| `SESSION_SECRET` | generated (`generateValue`) | session cookie HMAC |
| `PUBLIC_BASE_URL` | dashboard | full `https://` app URL (callback base) |
| `SEQUENCE_GATEWAY_URL` | dashboard | full `https://` gateway URL |
| `SEQUENCE_GATEWAY_TOKEN` | wired (`fromService`) | copied from gateway's token |
| `DATABASE_URL` | wired (`fromDatabase`) | selects the Postgres `UsageStore` |
| `SEQUENCE_BIND_HOST` | literal `0.0.0.0` | exposes the app so Render can route |
| `SEQUENCE_ENABLE_TERMINAL` | intentionally unset | terminal OFF on shared bind |
| `PORT` | Render-provided | passed via `--port $PORT`; host from `SEQUENCE_BIND_HOST` |
