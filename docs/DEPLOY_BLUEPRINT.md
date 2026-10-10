# Deploy Blueprint

This is the complete v10 turnkey guide for taking Sequence from a **local, single-user
IDE** to a **hosted / multi-user** deployment. It covers the four load-bearing seams —
the terminal deploy gate, accounts + per-identity metering, the hosted AI gateway, and
GitHub repo import/clone — each with the drop-in points a real deployment populates.

Every capability that is safe on `127.0.0.1` for one trusted user but **dangerous on a
shared or public bind** is listed here with its required deploy-time action. Treat this
file as the deploy gate checklist.

---

## Terminal (v10 Phase 2) — MUST disable or per-user sandbox before any shared deploy

The terminal tab (`packages/analyzer/src/server/terminal.ts`) is **real command
execution**: a WebSocket at `/api/terminal` pipes a login shell
(`child_process.spawn`) whose cwd is the attached repo root. That shell runs as the
**server's OS user** and **bypasses every file jail / reserved-dir guard / byte-cap**
the rest of the HTTP server enforces — exactly like VS Code's integrated terminal.

**Why it is safe locally:** it ships behind five ordered upgrade guards —
`path → origin → enabled → requireRepo → cap`:

1. **Path-scoped** — only `/api/terminal` upgrades; any other path is dropped.
2. **Origin-checked** — a localhost WebSocket is reachable by *any* web page the user
   visits, so a cross-origin `Origin` (a page on `http://evil.example` opening
   `ws://127.0.0.1:<port>/api/terminal`) is **rejected**. Only same-origin
   (`Origin` host === `Host` header) or Origin-absent native clients pass. As
   defense-in-depth against DNS rebinding, the `Host` header must also be a
   **loopback name** (`127.0.0.1` / `localhost` / `::1`), so a rebound
   `attacker.example` (whose Origin would match its Host) is still refused.
3. **Disable switch** — the `terminalEnabled` server option AND the
   `SEQUENCE_DISABLE_TERMINAL=1` env override; when off, every upgrade is refused.
4. **Require-repo** — no shell without an attached repo; cwd is the canonical repo root.
5. **Concurrency cap** — at most 8 live shells at once.

Plus: the server's **sole bind is `127.0.0.1`**, and the shell's stdin/stdout are
**never logged**.

### Deploy gate (REQUIRED)

A **multi-user or non-localhost** deployment gives every visitor a shell as the server
user. Before any such deploy you MUST do ONE of:

- **Disable it:** set `terminalEnabled: false` in `RepoServerOptions`, or export
  `SEQUENCE_DISABLE_TERMINAL=1`. This refuses every terminal upgrade with a clear
  reason (verified by test). This is the default-safe choice for a hosted product.
- **Per-user sandbox it:** run each user session in its own isolated container (one
  ephemeral container per session, no shared filesystem, no host network), and only
  then expose the terminal *inside* that boundary. Never expose the pipe shell on a
  shared or public bind without this isolation.

### Known limitation (pipe shell, not a PTY)

The shell is spawned over plain stdio **pipes**, not a pseudo-terminal. `node-pty`
(a true PTY) needs a native build that pnpm 10 skips in this repo, so it is not
verifiable here and is an opt-in, unverified-until-deploy upgrade. Consequences: no
TTY echo/line-editing (command *output* still flows), TTY-only programs (`vi`,
colored prompts) may misbehave, and **window resize is a no-op** — a
`{type:"resize"}` control message is accepted but a running pipe shell has no winsize
to update.

---

## Accounts + per-identity metering (v10 Phase 4) — the drop-in seams

Real Google/GitHub **account login** is inherently hosted (an OAuth app, a callback
URL, a session store), so it is **not faked locally** — there is no fake "Signed in
as…" state and no dead Google button. Instead the two load-bearing seams are authored
and mock-verified so the deployment is a drop-in, and the free-plan DeepSeek quota is
enforced per person the moment those seams are populated.

### Seam 1 — `extractIdentity(req)` (the auth-middleware slot)

`packages/analyzer/src/server/repoServer.ts` computes a per-request identity at the
top of `handle`:

```
const identity = extractIdentity(req);   // 'local' today
```

`extractIdentity` returns `'local'` in the local single-user IDE (no auth layer, one
trusted user on `127.0.0.1`), so metering keeps its pre-v10 single-file behaviour. It
delegates to the injectable `RepoServerOptions.resolveIdentity(req)` — **this is where
a deployed auth middleware plugs in**. Every metered path (`/api/ask`, `/api/explain`,
`/api/design-suggest`) and `GET /api/usage` already key off `identity`, so nothing else
changes when you populate it.

**What to stand up in production:**

1. **OAuth apps** — register a Google OAuth 2.0 client and/or a GitHub OAuth App.
   Set the **authorized callback URL** to `https://<your-host>/auth/callback` (one per
   provider). Store the client id/secret as server env (never in the repo).
2. **Login + callback routes** — add `/auth/login/<provider>` (redirect to the provider)
   and `/auth/callback` (exchange the `code` for the provider profile, look up/create the
   user row, mint a **session**). Mirror the existing injectable-fetch honesty of
   `github.ts`: the token exchange goes through an injected `fetch` so it is unit-testable.
3. **Session → identity** — set a signed, `HttpOnly`, `Secure`, `SameSite=Lax` **session
   cookie** (or a short-lived JWT). Then inject:

   ```
   resolveIdentity: (req) => verifySession(req.headers.cookie)?.userId
   ```

   `verifySession` MUST cryptographically validate the cookie/JWT. **Never trust a raw
   client-supplied identity header on a public bind** — on a shared deploy that would let
   any user impersonate another and read/charge their quota. (The tests inject an
   `x-test-identity` header only because the test client is trusted; that is not a
   production pattern.)

### Seam 2 — `UsageStore { read(identity), write(identity, usage) }`

`meter.ts` is **identity-agnostic and unchanged** — its `decide()`/`recordUse()` take
usage as a pure parameter. All single-user coupling now lives behind the `UsageStore`
interface in `repoServer.ts`. The **local impl is one file per identity** under
`~/.sequence/` (`usageFileForIdentity`): identity `'local'` → today's `usage.json`
(byte-for-byte unchanged), any other identity → `usage.<safe-id>.json`.

**What to stand up in production:** a **per-user usage table** (e.g. Postgres
`user_usage(user_id PK, month_year, used_this_month, global_spend_to_date)`) and a
`UsageStore` whose `read`/`write` hit that row:

```
const dbUsageStore: UsageStore = {
  read:  (id) => normalizeUsage(db.getUsageRow(id), currentMonthYear()),
  write: (id, usage) => db.upsertUsageRow(id, usage),
};
```

Drop it in where the local file store is constructed. `meter.ts`, the policy, and the
`/api/usage` contract are untouched — you have swapped only the storage.

### Free-plan quota enforcement (how the two seams combine)

The DeepSeek free default is guarded on **two axes**, both already wired:

- **Per-identity monthly soft cap** (`DEFAULT_METER_POLICY.monthlyAllotment`, 100/mo) —
  now keyed per user via `identity` + `UsageStore`, so one user's usage can neither be
  **read** nor **charged** by another (locked by `identity-meter.test.ts`). The soft cap
  is a *nudge to add your own key*, never a hard 429 wall.
- **Global spend backstop** (`DEFAULT_METER_POLICY.globalSpendBackstop`, $50) — the
  org-wide ceiling on the funded account. This is the only HARD block; enforce it **at
  the gateway** (the funded DeepSeek proxy) as the real backstop, in addition to the
  server-side check, so no bug or client can bypass it.

Once `resolveIdentity` returns real user ids and `UsageStore` is DB-backed, free-plan
users are metered per person with **no change to `meter.ts` or the endpoints**.

---

## GitHub repo import (v10 Phase 4) — real, and safe on a shared bind too

`POST /api/github/clone` really clones a repo into `<browseRoot>/sequence-workspaces/`
and attaches it. It is built for real (git is present; github.com is reachable), and its
guards are deploy-relevant:

- **SSRF guard** — the target must be an `https://github.com/<owner>/<repo>` URL, host
  pinned by **exact** hostname equality (`gitClone.ts::validateGithubCloneUrl`); a
  `fullName` is resolved against the token owner's OWN repo list as an allow-list. Any
  other scheme/host (ssh/file/git, a look-alike `github.com.evil.tld`, embedded
  credentials) is refused before a subprocess is spawned.
- **Jail containment** — the dest is chosen server-side inside the browse root and its
  realpath is vetted **before** the clone (parent) and **after** (the clone) — `attachRepo`
  has no intrinsic jail check, so the endpoint enforces it. A clone that resolves outside
  the browse root is refused and removed.
- **Token hygiene** — a private-repo token is supplied to git **only via `GIT_ASKPASS`**
  (read from the environment by a temp script that holds no secret). The token is never in
  the process **argv**, never in `<dest>/.git/config`, and never logged; configured
  credential helpers are disabled so it is never persisted. Locked by `clone-import.test.ts`.
- **Disk/DoS guard** — `git clone --depth 1` (shallow), a hard clone **timeout**, and
  **no-clobber** unique destinations.

**Deploy note:** on a multi-user host, `browseRoot` (and thus `sequence-workspaces`) must
be **per-user isolated** — the same container/tenant boundary the terminal deploy-gate
requires. A shared filesystem would let one user's import land where another can reach it.

---

## Later (packaging)

- Hosted AI gateway + funded provider key (the one seam unverifiable in this build;
  injected via `gatewayBaseUrl` and mock-verified).
- Packaging / process supervision for the hosted service.
