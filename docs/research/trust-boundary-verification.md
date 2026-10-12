# The two security criticals, verified against the code before building

**Owner ruling, 2026-09-02 (relayed):** close both criticals, *and* add an auto-approve autonomy
mode so tools can run unattended — with a hard ordering constraint: **auto-approve must not ship
before the trust boundary exists.** Today a hostile repository can run code as the owner the first
time he attaches it; auto-approve before the boundary turns that from dangerous into automatic and
silent. That ordering is right and is not re-litigated here.

What *is* re-examined here is whether each claimed hole exists. Four were named. **Three are real
and one is not** — and building middleware for the one that is not would have been a wasted wave
against a defence that already works.

## Summary

| # | claim | verdict |
| --- | --- | --- |
| 1 | a repo's own `AGENTS.md` reaches the model as **binding instruction** with no trust gate | **CONFIRMED** |
| 2 | the command allowlist matches a **literal string** over an indirection | **CONFIRMED** |
| 3 | `/api/ai-config`, `/api/ask`, `/api/search` lack host/origin validation | **FALSE — already covered** |
| 4 | `AGENTS.md` is read with plain `readFileSync`, so a symlink escapes | **CONFIRMED — fixed, `14162f58`** |

## 1. CONFIRMED — repo text becomes binding instruction, with no trust gate

`packages/analyzer/src/explain/instructions.ts` reads the first of
`.sequence/instructions.md`, `AGENTS.md`, `CLAUDE.md`, `.cursorrules` and
`renderInstructionsSection` renders it under a header naming it *"the user's own rules for this
repository"*, followed by:

> These are the standing instructions for this repository. Follow them unless the code contradicts
> them, and say so when it does.

Nothing anywhere asks whether the repository is trusted. Attaching a repo is enough. The one
mitigation already present is real but partial: the belt ranks instructions **below** grounded
evidence, deliberately, so a file cannot overrule a measurement — that limits what the text can
*claim*, not what it can *ask for*.

**This is the one to fix at the root, and it is the boundary the ordering constraint is about.**

## 2. CONFIRMED — the allowlist matches a name, not a behaviour

`packages/analyzer/src/harness/verifyGate.ts`:

```ts
export const VERIFY_COMMAND_ALLOWLIST = [
  'pnpm test',
  'pnpm -r build',
  'pnpm build',
  'pnpm --filter @sequence/schema test',
] as const;

export function isVerifyCommandAllowlisted(cmd: string): cmd is VerifyAllowlistedCommand {
  return (VERIFY_COMMAND_ALLOWLIST as readonly string[]).includes(cmd);
}
```

All four entries are **indirections**. `pnpm test` is not a command; it is a lookup into the
repository's own `package.json`, which the repository controls. A hostile repo whose `scripts.test`
is anything at all gets that executed under an allowlist that believes it approved "the test
suite".

The surrounding hardening is genuinely good and is **not** the weak point: `run_command` spawns via
`spawnSync` with `shell: false` and a fixed argv (no ambient shell), and `isSafeVerifyCommand`
rejects `..` and shell metacharacters. None of that helps, because nothing hostile needs to appear
in the *command string* — the payload is in the file the command resolves to.

Either resolve the script and show the real command before it runs, or refuse to allowlist an
indirection. A literal-string allowlist over an indirection is not an allowlist.

## 3. FALSE — origin validation is already global, and already covers all three named routes

This claim does not survive contact with the code, and the correction matters: the proposed fix was
"middleware, not three patches", and **the middleware already exists**.

`packages/analyzer/src/server/repoServer.ts`, in `handle()`, before routing:

```ts
const engineRequest =
  pathname === '/archgraph.json' || pathname === '/api' || pathname.startsWith('/api/');
if (engineRequest && !isOriginAllowed(req, authOn ? authConfig!.publicBaseUrl : undefined)) {
  sendError(res, 403, API_ORIGIN_ERROR);
  return;
}
```

Its own comment states the ordering guarantee — *"This must run before routing, auth, body reads,
file access or provider calls"* — and `pathname.startsWith('/api/')` covers **all 126** `/api`
routes, the three named ones included. There is no exemption list.

`isOriginAllowed` (`terminal.ts`) is a real DNS-rebinding defence, not a token check: the request
`Host` must be a loopback name (or the single configured hosted origin), and `Origin`, when present,
must equal it. A page from `seq.attacker.example` rebound to 127.0.0.1 keeps its non-loopback Host
and is refused.

**The part of the claim that does survive:** a request with **no `Origin` header at all** is
allowed, deliberately — native clients (curl, the tests, the CLI) send none, and a browser cannot
suppress it on a cross-origin request. So the gate stops hostile *web pages*, which is what it was
built for, and does not stop a hostile *local process*. That is the gap the proposed **per-launch
capability token** actually closes, and it is worth doing on its own merits — but it should be
built and described as "authenticate local callers", not as "add the missing origin validation",
because the origin validation is present and working.

## 4. CONFIRMED, AND FIXED — `14162f58`

`readRepoInstructions` used `path.join` + `readFileSync`. Both follow symlinks, and §1 above is what
the result is rendered as. So a repository committing `AGENTS.md -> <anything>` had up to
`INSTRUCTIONS_CAP_BYTES` (24,000) of that file injected as its own binding rules. Git stores
symlinks, so a clone carries the payload.

On Linux the headline target is `/proc/self/environ`. **On Windows — the owner's platform — the
sharper one is `~/.sequence/openrouter-key`**, which makes this key exfiltration to the provider,
not merely prompt injection, against the repo law that says never leak a user key.

Fixed by routing resolution through the **existing** jail (`server/jail.ts` —
`canonicalRoot` + `resolveInRepo`), which already carried this exact lesson for *writes*: its
dangling-symlink branch records an escape where a repo could commit
`notes.md -> /outside/pwned.txt`. Reads of a trusted-text file needed the same jail. Locked with
real symlinks against real temp dirs, mutation-proven.

## DECISION D1 — the per-launch capability token is DEFERRED (2026-09-02)

**Status: DEFERRED, deliberately. This is a decision, not a gap. Do not re-propose it without the
trigger below.**

Ruled by the orchestrator under the owner's standing delegation — *"for sequence safety rulings I
trust your recommended option, follow through with it"* — on the pricing in the section below.

**The reasoning, in one line:** a token that must be readable by the CLI, `packages/mcp` and the
browser lives in a file, and a same-user process that can read that file can read
`~/.sequence/openrouter-key` directly and skip the API entirely. Against the attacker the ruling
named it buys nothing. Shipping it would put a lock on a door whose wall is missing, and let
everyone feel finished.

**What is genuinely defended, and is what auto-approve now rides on:**

1. the origin gate refuses hostile web pages on all 126 `/api` routes (§3);
2. `assertSafeBind` refuses a non-loopback bind unless auth is configured;
3. the trust boundary makes an untrusted repo untrusted by default, with the `ai.json`
   provider-hijack closed.

**THE ONE TRIGGER THAT REVERSES THIS.** The token is a real boundary against a process running as a
**different user on the same machine**. That is not the owner's situation today — single-user
Windows desktop, his own account. **If that changes — a shared box, a second account, a remote or
multi-seat deployment — this comes straight off the shelf and ships.** That specific change is the
condition, not a general "revisit someday".

**Why this is written as a decision at all.** Three deliberate omissions were re-proposed as
oversights this week — `BootSurface` twice (it was unmounted by `seat-walk(W1)` `34b6a38e` with a
verified replacement) and now this. A deliberate omission that leaves no record is indistinguishable
from a bug, and costs a wave every time someone rediscovers it.

## Rule 3's remnant: what a per-launch token actually buys

Rule 3 as written was false (§3). What survives is real but narrow, and worth pricing before it is
built, because the regression surface is 126 routes plus the CLI plus the MCP server plus every test
that speaks HTTP.

**The threat, stated precisely.** The origin gate refuses hostile web pages. `assertSafeBind` refuses
a non-loopback bind unless auth is configured, so a local install listens on 127.0.0.1 only. What
remains is a process **on the same machine** calling the API with no `Origin` header — which is
allowed deliberately, because native callers (the CLI, the MCP server, curl, the tests) send none.

**Now price the defence.** A capability token has to be readable by every legitimate local caller:
the CLI, `packages/mcp`, and the browser that was served the page. That means it lives in a file (an
`engine.json`-style handshake) or the environment.

| attacker | can it read the token? | does the token stop it? |
| --- | --- | --- |
| same user, same machine | **yes** — it can read any file that user can | **no** |
| different user on the machine | no | **yes** |
| sandboxed process (HTTP but no filesystem) | no | **yes** |

**So it does not defend against the threat the ruling names.** A same-user process that can read
`engine.json` can read `~/.sequence/openrouter-key` directly, and can read the repository — it has
no need of the API at all. Against that attacker the token is theatre.

Against a **different-user** process on a shared machine it is a genuine boundary, and that is not a
hypothetical on a work laptop with a second account or a CI box. That is the case it should be built
and described for.

**Recommendation.** Build it, but scope and name it honestly: *"authenticate local callers so a
process running as another user cannot drive the engine."* Do not describe it as closing the hostile
-repository path (the trust boundary does that) or as adding origin validation (§3: already present
and working). And weigh it against the ordering constraint — auto-approve is blocked behind rules 1
and 2, both of which are **done**, so this is the only thing standing between the owner and the
autonomy mode he asked for. If it is deferred, defer it *explicitly*, because the reason it was ever
sequenced ahead of auto-approve was a threat model that turned out to describe a different attacker.

## What this changes about the plan

- **Rule 1 (trust boundary) and rule 2 (resolve the command) are the wave.** Both confirmed, and
  rule 1 is the root that makes the rest coherent.
- **Rule 3 shrinks and is renamed.** Not "add origin validation to three routes" — that exists and
  passes. It is "authenticate local callers with a per-launch capability token", a smaller, honestly
  described change against the no-`Origin` allowance.
- **Rule 4 is done.**
- **Rule 5 (auto-approve) stays last**, unchanged. The ordering argument holds regardless of the
  correction above, because it rests on rules 1 and 2, both of which are real.

## Rule 5 — AUTO-APPROVE, SHIPPED (2026-09-02)

Rules 1 and 2 landed (`4920a235`, `d2165789`, `5445ae11`), so the ordering constraint was satisfied
and the mode was built. `packages/analyzer/src/server/autoApprove.ts` owns it; this is the summary
for anyone who reads the ordering argument above and wants to know how it came out.

**It is one transform.** An `ask` verdict from `evaluatePermission` becomes `allow` for the session.
Nothing else changes — no rule is skipped, no subject re-matched, no code refusal relaxed.

**The five properties it is held to**, each with a lock in
`packages/analyzer/src/test/auto-approve.test.ts`:

1. **`deny` is never overridden, structurally.** `approveAskVerdict` takes an `AskPermissionVerdict`,
   obtainable only through the `isAskVerdict` guard, so widening the call site to
   `decision !== 'allow'` is a **compile error** rather than a wider mode.
2. **Gated on TRUST, and re-asked every turn.** Enabling is refused on an untrusted repo
   (`PUT /api/auto-approve` answers 403 with the reason), and `isAutoApproveActive` re-reads
   `isRepoTrusted` on every call — so revoking trust, or attaching a different repo, turns it off
   without anyone touching the switch. This is why it is gated on the boundary rather than on a
   settings toggle: a toggle would have made the boundary decorative.
3. **Session-scoped.** A module-scope `Set`, never written to disk, cleared on attach and detach.
4. **Visible while on.** The pipeline streams the `step:*` pair `AUTO_APPROVE_STEP_ID`, which web2
   renders as an announced work row — the same mechanism and the same reason as the teach row.
   No new ask-stream event, so no new row in the reachability baseline.
5. **No ceiling is raised.** The write jail, the runner allowlist and the resolved-script check
   still refuse: a hostile `pnpm test` is refused with the mode on, and the receipt shows a
   permission that said yes over code that said no.

**Still true and unchanged:** D1 above. The per-launch capability token stays deferred, and
auto-approve does not alter its trigger — a same-user local process could always read
`~/.sequence/openrouter-key` directly and never needed the API.

## A note on how this list was checked

Every claim was read in the code before being accepted or rejected, and the one that failed did so
on a straightforward reading of a single function. That is the same pattern as the Anatomy figures
(`anatomy-view-measurements.md`), where a relayed table's headline row described the wrong thing.
Neither error was careless — both were plausible summaries of a real concern. The rule that catches
them is the cheap one: **read the code before building against the description of it.**
