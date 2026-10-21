# Orchestration protocol — how rounds actually get run

*Written 2026-08-03, from what has actually cost us rounds. This is operational canon:
the orchestrator follows it, and every builder brief is generated from it. Update it when
a round teaches something new; never delete a rule without recording why.*

---

## 1. Model tiering (owner rule, standing)

*Claude-native as of 2026-08-18. Cursor/Composer and Codex are no longer in the chain;
Composer dispatch is parked in the `cursor-build` skill if quota returns.*

- **Orchestrator never builds, explores, or tests.** It writes briefs, verifies gates
  independently, merges, and reports. That is the whole job.
- **Builders build and test** — `builder-haiku` or `builder-sonnet`, routed by size (below);
  Opus leads, assigns, reviews and merges (owner rule 2026-10-08).
- **Sonnet explores and researches.** Scoping, competitive teardowns, landscape reads.
- **Opus reviews, every time** (owner rule 2026-10-08), as a panel of 2–3 with distinct
  lenses — correctness, contract-and-timing, owner-seat. The spread still buys
  independence; a finding dies only on majority refute. No Sonnet or Haiku reviewer.
- **Tasks under about 100k tokens go to `builder-haiku`** (small inline changes,
  alignment, copy, search, logs, mechanical edits, tests); larger features and fixes go
  to `builder-sonnet`. See AGENTS.md "Builder subagents".
- Design-implementation work (HTML/CSS/React craft) always goes to Opus.
- **Efforts larger than one build program get a mega-plan first** —
  `docs/<program>-program.md`: end-state sentence, decomposition into independently
  gateable efforts, dependency order, the gate that holds across all of them, and the
  stated edge of the program. See the `orchestrated-build` skill, Stage 0.

## 2. Isolation and ownership

- Every builder runs in its **own git worktree** on its own branch, never on main.
- Briefs assign **explicit, disjoint file ownership**, listed positively (what you own)
  and negatively (what another builder owns right now — do not touch).
- Concurrent builders must not share a file. If two slices need the same file, they are
  **sequenced, not parallelised** — the second consumes what the first landed.
- The orchestrator **snapshots in-flight work** (`git diff > scratchpad/<task>.patch`)
  whenever an agent goes quiet, so a death cannot destroy hours of work.

## 3. Split by root cause, not by symptom — learned the hard way (2026-08-03)

Five QA findings (H5–H9) looked like five independent defects across discovery, scan,
and parse. The instinct — and the owner's own suggestion — was to split them across three
agents by file. **That would have failed.** All of them shared ONE root cause: tree-sitter
syntax trees were never freed, the WASM heap filled partway through a large repo,
emscripten set a module-wide kill switch, and every repo scanned *after* that point in the
same process reported zero files.

Three agents each investigating one repo would each have found "it scans fine on its own"
and concluded there was no bug. The defect only exists in the *sequence*.

**The rule:** before splitting a defect batch, ask whether the symptoms could share an
upstream cause — especially when several fail the same way (all zero, all truncated, all
after some point). Split by **suspected root cause**, never by which file the symptom
surfaced in. Splitting is for genuinely independent work; a symptom cluster is one job.

## 4. The verification burden belongs to the orchestrator

Builders were previously asked to re-run the full 26-repo QA tier before committing. That
is the single most expensive operation available and it lands exactly when a builder's
context is thinnest — a reliable way to kill an agent right before it commits.

- **Builders verify narrowly:** `node tools/qa-loop/run.mjs --repos <the failing ones>`.
- **The orchestrator runs the full tier**, after merge, on main.
- **Verbose output goes to a file and gets grepped** — never dumped into an agent's
  context. A single large-repo scan can emit thousands of lines.

## 5. Gate discipline (binding, from `docs/release-gate.md`)

- `pnpm -r build` — read **the bare command's exit code**. Never trust a piped `| tail`;
  that hid a red build for three rounds.
- **After any merge, rebuild `dist/` before measuring.** A `--ff-only` merge onto main
  does not recompile; running QA or e2e against stale `packages/*/dist` will report
  numbers for the wrong code (same class of error as trusting a piped exit code).
- Full suites for whatever was touched; e2e legibility + bindings for anything rendered,
  **and then actually look at `tmp-shots/legibility/`**.
- Every fix carries a locking test that **fails before the fix**. Changed contracts get
  rewritten, never deleted.
- **Never push a red gate.** A partial green slice merged beats a perfect slice that
  never lands — tell the builder that explicitly when it is running long.

## 6. Trust, then verify — independently

Builder self-reports are evidence, not proof. Two rounds were saved by re-checking:

- One builder reported a failing e2e suite as "pre-existing red on base." It was green on
  base; its own change caused it. **Re-run the claimed-broken thing on main yourself.**
- Another reported gates green from a stale build. **Re-run the gate after rebasing onto
  current main**, in the builder's worktree, before merging.

Merge only what the orchestrator has re-verified at the current head.

## 7. Working in sequence, automatically

- **The plan of record is `docs/PIVOT-V2.md` (the decision) plus
  `docs/research/v2-architecture-and-gaps.md` (the executable wave plan).**
  `docs/HANDOFF-AGENT-RESTART.md` carries current program state on top of them.
  **Retired and deleted from the tree 2026-08-20 — there is nothing to dispatch against:** the
  Console owner-walk register and its wave scaffold (every row was a `packages/web` v1 defect,
  and the scaffold scoped a wave to `packages/web/**`, which is dead code awaiting deletion at
  Wave 7 — an orchestrator following it sent builders into the tree being deleted), the older
  round plan `final-vision-gap-plan.md`, and the `AAA_FIXES.md` defect list. All of it is in git
  history and nowhere in the working tree. Do not cite any of them as live.
- When a builder lands: rebase → re-gate → merge → **update the ledger in the same
  push** → clean the worktree → dispatch the next queued slice.
- Keep 2–4 builders in flight with disjoint ownership; queue anything that would collide.
- Arm a fallback check-in (`send_later`, ~an hour) whenever agents are running, so a
  silent death is caught rather than waited on forever. Cancel it once the queue drains.
- A quiet worktree with modified files and no commit means the agent died. Resume it from
  its transcript with recovery instructions (commit the green subset, verify narrowly)
  before assuming the work is lost.

## 7b. Agents die without warning — commit early, always

Three builders were lost in one hour to a session limit. They did not go quiet and get
noticed; they died mid-tool-call. The snapshot rule in §2 only helps when the orchestrator
*notices* — it is useless against an instant infrastructure failure.

- **Every builder brief says: commit each item as soon as it is green and test-locked,
  rather than holding everything to the end.** A partial merged slice beats a perfect lost
  one. The one agent of the three that had committed kept its work; the other two lost
  everything, including one that had already written correct failing-on-base tests.
- When a builder dies, check its worktree before assuming loss: a commit on its branch is
  merge-ready and the orchestrator can gate it directly rather than resurrecting the agent.
- Snapshot uncommitted worktree output (`git diff`, or `tar` for untracked dirs) to the
  scratchpad before removing anything.
- **Never remove a worktree until the agent has reported.** Doing so mid-run cost one
  builder its final verification and its tracker edit — the orchestrator's error, not the
  builder's.

## 8. Standing queue

Work is pulled from, in order: owner-reported defects (`AAA_FIXES.md` OPEN) → ranked plan
gaps (`final-vision-gap-plan.md` §3) → known residuals (§G-G). Owner-scoped items
(E6, F7, D1–D5) wait for the owner and are never guessed at.
