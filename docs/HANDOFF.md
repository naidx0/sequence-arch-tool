# Sequence — agent handoff (onboarding + traps)

> **Current program state and open queue:** [`HANDOFF-AGENT-RESTART.md`](HANDOFF-AGENT-RESTART.md) only.
> This file is traps, run commands, and the three gates. If it disagrees with RESTART or tip `main`, RESTART wins.
> The historical r97-era handoff was deleted with the rest of the archive on 2026-08-20; it is in git history if you ever need it.

## Thirty seconds

Sequence reads a real repository into a **live, grounded architecture graph** you can read, edit, draw, and reason about, with chat beside it and `.seqd` as the artifact. Local-first: core value with **no network and no API key**. **That is the product, not the shipped v1 screens** — the whole UI is being rebuilt from zero (`PIVOT-V2.md`); the pane arrangement is settled by the Graphite canvas sheets, not by this paragraph.

pnpm monorepo: `schema` · `analyzer` · `acp` · **`web2`** (the v2 UI — build here) · ~~`web`~~ (the v1 UI — deleted 2026-08-20) · `ink` · `export` · `desktop` · `mcp` · `gateway`. Docs in `docs/`, and there is no archive folder — retired docs are deleted, not parked, so everything under `docs/` is live. **There is no marketing site** — the v1 site was deleted 2026-08-20 and trysequence.app is not redeployed from this repo.

**The traps below are book-agnostic and all still bind** — they are incident history, not UI spec.

## Run

```bash
pnpm install
pnpm -r build
pnpm app -- --no-open --port 4173 --repo "$PWD"
# or: ./start.sh
node packages/analyzer/dist/cli.js doctor <path-to-repo>
```

Optional AI: Settings → Connect AI, or `<repo>/.sequence/ai.json`. Never leak a key. Scan, edges, and module paths are deterministic without a key; a key buys names.

Browse-root jail: `/api/attach` and `/api/browse` stay under `$HOME`. Launch with `--repo <abs-path>` to scan on startup.

## Three gates

Binding: [`release-gate.md`](release-gate.md). A change is not done until **correctness**, **legibility** (real repo + `tmp-shots/legibility/`), and **human-usability** all hold. Fixture-scale green is not a layout proof.

## Traps that actually cost rounds

Every item is a real incident. Read twice.

1. **Every gate can pass while the app is visibly broken.** A stray `.board-chat-input button` selector crushed a menu; types/vitest/e2e were green. The legibility sweep exists because of this.
2. **Ellipsis is deliberate truncation, so the audit passes it.** `buil…` / `pro…` was green. **Look at `tmp-shots/`.**
3. **Fixture scale proves logic; only a REAL repo proves the result.** Overflow, truncation, and “+30 more” cannot occur on 3–10 file fixtures.
4. **Reproduce the owner's reported shape before claiming a fix.** Tests must fail on the *reported* shape, not a convenient nearby one.
5. **Silence is the worst failure mode.** Honest “I could not tell” beats a confident wrong answer.
6. **Fix the audit, don't exempt the finding.** `IGNORE` hid a charcoal canvas on paper themes.
7. **When a test asserts a contract the product no longer has, rewrite it — never delete it.**
8. **Parallel agents need disjoint file ownership.** Re-run the gate yourself; a builder's self-report is not sufficient.
9. **A surface with no legibility stop is a surface nobody is checking.** Add the stop in the same change.
10. **A stop whose drive silently no-ops is worse than no stop.** Assert the state you meant to reach was actually reached.
11. **Built, tested, green — and unreachable.** Compiling is not shipping. Assert the *rendered* result.
12. **The log can be wrong.** Trust pixels over `owner-feedback-log.md` / loop-log, then correct the record.

## Non-negotiables

Grounded, not guessed. Never leak a user key. Local-first without login. Honest errors. Build and judge from the user's seat.
