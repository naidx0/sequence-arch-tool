# Shell / sessions wave — plan

Owner ask (2026-08-26): Cursor/OpenCode-style **sessions sidebar**, **chat home context** (repo · branch · model), **side-by-side** session layout (chat + board/review), **cross-platform** chrome (opaque default; conditional glass specimen).

## Two design directions (owner picks one for product landing)

| | **A — OpenCode-clean (opaque)** | **B — Conditional glass** |
|---|--------------------------------|---------------------------|
| Sessions sidebar | Solid `--surface-2`, hairline edge, no blur | Same IA; `@supports (backdrop-filter)` frost on pane body |
| Default in tree | `data-shell-surface="opaque"` on `sessions-side` | Opt-in: `data-shell-surface="glass"` |
| Cross-platform | Identical on Linux/Windows/Web | Mac-quality frost where supported; opaque fallback elsewhere |

Both specimens share the same markup and tests — only CSS differs.

## Waves

### Wave 1 — Sessions sidebar v2 (this PR)

**Owner quote:** sessions as repos, relative timing, easy switching, New Chat, settings foot.

**Done when (user seat):**

- Left sidebar lists sessions **newest-first**, pinned on top, **relative time** (`1h`, `8d`) that refreshes while the pane is open.
- **New chat** is the first control in the sidebar (not buried under the list).
- Workspace mode groups **General** vs **repo folders**; repo sections **collapse**.
- Settings gear stays **bottom-left** of the sidebar (Decision 5).
- Row actions still **reveal on hover**; active session marked with `aria-current`.

**Files:** `SessionsPanel.tsx`, `sessionWhen.ts`, `sessions.css`, `SessionsPanel.test.tsx`, `shell.css` (surface tokens).

**Locking tests:** relative `when` label; New chat at top (`sessions-new` before list); repo section collapse toggle.

### Wave 2 — Chat home context

**Owner quote:** home with repo/model context above the composer (Cursor-like).

**Done when:**

- Empty thread (`live === false`): a **chip row** above the composer shows **repo** (or “no repo”), **branch** when attached and known, **model** when configured.
- Chips are read-only context — not permission or grounding substitutes.
- Branch comes from **`GET /api/git/status`** when a repo is attached (honest null until the server answers).

**Files:** `SessionHomeContext.tsx`, `ChatColumn.tsx`, `chat.css`, `connect.tsx` (git status probe), `Composer.test.tsx` / `ChatColumn` tests.

### Wave 3 — Side-by-side polish

**Owner quote:** chat left, work surface right; sessions persist without attach.

Already structural (Decision 5). This wave verifies:

- Attached repo + **Architecture** tab → chat column + board pane visible together.
- Minimise restores via dock icons; no third empty region at boot.

**Files:** `workspaceViews.ts` (unchanged unless regressions), `App.test.tsx` locking side-by-side.

### Wave 4 — Cross-platform surface CSS

**Done when:**

- Opaque pane backgrounds use **`--surface-1` / `--surface-2`** only (no rgba scrims on pane chrome).
- Glass specimen gated behind **`@supports (backdrop-filter: blur(1px))`** with opaque fallback.

## Out of scope (report, do not invent)

- Light theme tuning (Decision 1 deferred).
- Session switch without reload (no cross-slice reload path yet).
- Work/Code mini-tabs under composer (Work mode deferred).

## Gate

- `pnpm --filter @sequence/web2 test`
- `pnpm -r build`
- Manual: blank workspace → sessions + home chips; attach → branch chip fills; Architecture tab → chat + board side-by-side.
