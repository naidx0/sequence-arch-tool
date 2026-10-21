# Focused reasoning and long Agents runs: round 2

Verified 2026-10-20 in `workspaces/ux-finish-20261020/lane2-traces`, branch `wip/0184-r2-traces`. Product baseline for this lane: `62e301864`. Tested source head: `3aa1a0b49` (documentation and screenshots follow separately).

## What shipped

- `f19ef851b`: agent-supplied reasoning in Focused mode opens as paragraph steps with the provider's own headings. Detailed keeps the original text.
- `858b27b06`: a dot marks each reasoning step, only the unfinished tail is live, and a settled agent thought shows its provider mark.
- `079a483ad`: consecutive completed tools of the same kind fold into counted rows in Agents. Failed, running, stalled and focused steps stay separate. The roster uses a known provider mark; unknown providers get no invented mark.
- `a3099e93f`, `3aa1a0b49`: production-build browser coverage of traces, long runs and narrow layout; the narrow test explicitly selects the Agents view before measuring it.

## Gates and exact subject

All commands ran from the lane checkout. They read its current source or freshly rebuilt `packages/web2/dist`, not another checkout's bundle.

| Command | Bare exit | Result |
| --- | --- | --- |
| `pnpm --filter @sequence/web2 build` | 0 | TypeScript, Vite and prerender passed |
| `pnpm --filter @sequence/web2 test -- src/chat/reasoningTrace.test.ts src/chat/reasoningTraceRender.test.tsx src/chat/agentThoughtTrace.test.tsx src/agents/agentsTraceStatus.test.tsx src/agents/agentsR9Trace.test.tsx` | 0 | 40 tests, 5 files |
| `pnpm --filter @sequence/web2 test -- src/agents/agentsLongRun.test.tsx` | 0 | 8 tests |
| `pnpm --filter @sequence/web2 test -- src/chat/traceMarks.test.tsx` | 0 | Trace mark regression tests passed |
| `node --import ./tools/test-guard/no-real-binaries.mjs packages/web2/e2e/agents-traces-0184r2.mjs` | 0 | 46 checks |

Raw logs are in the parent workspace: `lane2-build.log`, `lane2-tests.log`, `lane2-longrun.log`, `lane2-marks.log`, `lane2-e2e-corrected.log`.

The first expanded E2E attempt found an instrument problem: at 760px the panel remained mounted but hidden behind the Chat tab, so an overflow check could measure a zero-size box. The corrected harness rejects hidden roots and selects Agents. That attempt's exit was 1 (`lane2-e2e.log`); the corrected run passed. This is not evidence of a product overflow defect.

## Visual inspection

Screenshots in [0184-r2-traces](0184-r2-traces/) were generated from the rebuilt app with loopback SSE fixtures, without executing an agent or contacting a model vendor.

- Dark and light themes at 1440, 1024 and 760px: structured settled reasoning, folded long Agents run, expanded fold.
- Focused and Detailed at 1024px: live reasoning and the same thought after answer text arrives. Focused marks only the unfinished paragraph live; Detailed preserves `##` headings verbatim.
- A 44-step Agents turn contains 30 reads, a failed read, five searches, six edits, a failed command and one running read. Failures remain readable outside folds. Opening the fold reveals its individual children.
- Directly inspected desktop dark 1024, narrow light 760, live Focused and settled Detailed screenshots. Text wraps inside its pane; no horizontal spill or clipped failure message was visible.

Useful images: `focused-reasoning-1024-dark.png`, `agents-window-long-760-light.png`, `agents-window-fold-open-1024-dark.png`, `reasoning-live-focused-1024.png`, `reasoning-settled-detailed-1024.png`.

## Limits and integration

These fixtures prove rendering and event-state handling, not a live provider connection. They use only explicit supplied text and tool events; this lane creates no synthetic reasoning, external sources or citations. Answer arrival settles the thought; the fixture deliberately keeps the run stream open, so its top-level Working status is expected.

The original three product commits were recovered already committed. This continuation reran their green regressions and layout gates; it does not claim to have rerun their historical pre-fix red states. Broader integration, startup/deletion performance, provider connection UX and packaged release gates belong to the parent program.
