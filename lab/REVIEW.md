# Sequence lane: what to review (2026-09-23)

Everything below sits on branch `lab/patches-at-599b1c35` in the worktree `C:/Users/<user>/Projects/seq-patches`, pushed to your private codeforge repo as that branch. It is not on main and not installed. Every commit is authored as maxnaid1. The patch files are in `gpu/port-599b1c35/` in this repo.

## Gates

The branch head (cf03dacd) has the same code as 59f572a0. At 59f572a0 all four gates were green:

| gate | result |
|---|---|
| CI | 362/362 |
| analyzer | 3102/3102 |
| web2 | 3248/3248 |
| schema | 488/488 |

The base, 599b1c35, gave CI 333, analyzer 3054 and web2 3191.

## The commits, in order

1. f0406b0f: 0001 lesson-quality tools.
2. 86050f29: 0005 gpu-lock signal race.
3. 167fa06c: 0015 canvas doc read once at boot.
4. c099844c: 0017 terminal keyboard exit.
5. 4d5ae303: 0018a drops invented links in propose_chart, plus the zero-link refusal (flag `SEQUENCE_CHART_DROP_INVENTED_LINKS=1`).
6. 9cad28cd: 0002 plain-words stop note.
7. 869008ff: 0013 shared GET for concurrent reads.
8. 9bd58298: 0014 drawing-language A/B kit (schema and tools only).
9. e074ac4e: 0020 D2 and state-machine arms for the kit.
10. c442fa98: 0011 schema half (flowLines.ts), which 0014 imports.
11. b71da02d: kit worker waits for its sockets before exit (Windows libuv crash).
12. 9f667ee2: 0021 contrast. One ambiguous hunk was placed by hand on `.v3-session-more`.
13. b5a0199d: 0019 accessibility nesting and focus, without its Files-pane collapse. Head already rails a narrow pane at 420px.
14. 3ba8f6b7: 0003 picture pointer (flag `SEQUENCE_TEACH_PICTURE_POINTER=1`).
15. 73d023ad: 0016 a subscription grounds either way, including head's liftedEdgeKeys.
16. 6ce3f6b7: 0004 worked example (flag `SEQUENCE_TEACH_WORKED_EXAMPLE=1`).
17. 232cbbbb: 0006 plan before/after chart (flag `SEQUENCE_PLAN_BEFORE_AFTER=1`).
18. 7d6b7cfa: 0008 the chat write names its thread. The hunks for SessionsPanel.test.tsx were dropped because that file is gone at head.
19. 47c6003e: 0009 CSS not ported; its Chromium probe is kept as a regression check. Head already fits at 180 to 480px.
20. a63afb9b: 0007 one request, one frame (design call A below).
21. 551a9ba4: 0010 deflection floor (flag `SEQUENCE_TEACH_DEFLECT_FLOOR`; design call B below).
22. 4e246e44: 0011 app half, flow lines (flag `SEQUENCE_CHART_FLOW_LINES=1`; design call C below).
23. 36e8b485: drops a duplicate flowLines export.
24. 59f572a0: `SEQUENCE_CHART_LANG=dot`, so small models draw charts as Graphviz DOT, with the invented-link drop on.
25. 3229caf4: chart-first tool menu experiment.
26. cf03dacd: reverts commit 25, because its measurement found no effect.

0012 (read the sessions list once) was not ported. At head, surface-load finds GET /api/sessions called twice at boot and no duplicates per tab click, so the problem is already fixed.

## Design calls, and how to revert each

- **A. 0007: a redraw is matched only on its own surface.** Head routes charts to surfaces (the Plan tab), so a chart with the same title on another tab counts as a new frame. To undo it: `git revert a63afb9b`
- **B. 0010: one test assertion rewritten.** Head's Slice 12 settle pass already strips a closing offer and quotes it in a note, so the test now requires the hand-back to be absent everywhere except that note. To undo it: `git revert 551a9ba4`
- **C. 0011: with the flag off, propose_chart publishes head's own text.** Head's text includes steps and surface; the 0.1.2 text from the patch is not restored. To undo it: `git revert 4e246e44`

## The DOT flag and the zero-link refusal

- **Zero-link refusal.** The invented-link repair refuses a chart when every one of its links was invented; before this it drew boxes joined to nothing. On the 210 MiniCPM5 answers it caught 25 such charts.
- **DOT with the repair on.** Across 12 fresh runs (84 answers per language), DOT is grounded 80% against JSON's 41%, with hop coverage 0.50 against 0.16. Both gaps are about 7 SE, and four fresh confirmations agree. D2 ties DOT, and state machine and path are no better.
- **In real teach turns, the language makes no difference.** MiniCPM5 draws on about 1 teach turn in 6 or 7 whatever the chart tool looks like, so the flag stays off by default. Across 40 teach-turn chart calls, the repair raises the share drawn from 90% to 95%.

## New since the first review (2026-09-24): product questions

- **Product mode, on by default on this branch** (`SEQUENCE_TEACH_PRODUCT_MODE=0` turns it off). A teach
  question about what the repo's product is, who it is for, why it exists or its flow gets a newcomer's
  answer (read the README first; what, who, why, numbered steps, advantages), no file quiz, and its steps
  drawn as a flow chart when the model draws none. Needs an attached repository.
- **Repeat guard, on by default** (`SEQUENCE_TEACH_REPEAT_GUARD=0` turns it off). A draft that is nearly
  the previous answer is retried hot (temperature 0.8, up to twice); still the same, it says it already
  covered that instead of resending.
- **Evidence.** On your own three questions, repeats fell from 39% of later answers to 3%. The fourth
  sealed blind check, written by a separate worker, passed: full product answers went from 0% to 46%,
  nothing was resent, and quality was inside the bar. Details are in log.md.
- **To undo:** `git revert d7a847fe 3d31b453`, or set either variable to 0.

## Two decisions for you

Both were decided by the coordinator on your behalf (2026-09-24):
1. **Canvas slices 2 and later:** stay on slice 1 for now.
2. **Files beside Architecture at 400px:** the 0px reading area no longer happens at your head (279x349px measured), so nothing was changed.

## Parked until you say yes

- **generate_rows** for ML harness adapter run 3: about 675 new rows on the local GPU, written only to scratch files. The harness needs a person's approval for it.
- **The Nebius student sampler** (`scripts\nebius_students.ps1` in `Projects\executed-pivots`): 32 requests to Token Factory. This machine's permission guard refused to let me run it.
- **Pushes to your Sequence remotes, merging to main and installing.** Only sequence-lab has been pushed.

## Also blocked by this machine's permission guard

- **ML harness JSON plan-mode check on MiniCPM5 (probe A10 against A04).** The guard refused to fetch the lane's plan-kit and small-model code from its report onto this machine. To run it yourself: unpack the ML harness pack (`ml-harness-pack.zip.b64.txt` with `apply.ps1` from report K25DMUNkm9ojAX95Yg7Aqu), then run this from the lab folder:
  `python plan-kit/probe.py --only A04 A10 --out runs --lock-cmd "python <ml-harness>\scripts\take_the_card.py --lane plan-probe --lock \"C:/Users/<user>/OneDrive/Documents/Obsidian Vault/max-brain/09-Nightshift/gpu.lock\"" --unlock-cmd "python <ml-harness>\scripts\take_the_card.py --lane plan-probe --release --lock \"C:/Users/<user>/OneDrive/Documents/Obsidian Vault/max-brain/09-Nightshift/gpu.lock\""`
  H8 is confirmed if A10's pass rate and mean score are not below A04's.

## Added 2026-09-24 evening

- Product-question classifier (64ac2647), with code-word veto (934dcfd6): on by default, SEQUENCE_TEACH_PRODUCT_CLASSIFIER=0 turns it off. Sealed sets: set 9 16 -> 28 of 30 product; real answers: full product shape 0% -> 21%, file charts 33% -> 0%.
- README inline for product turns (41d99051, default on at 2f9d4023): SEQUENCE_TEACH_PRODUCT_README_INLINE=0 turns it off. 3.8 s faster per product turn.
- gpu-lock reaper (bd4501b2): another lane's lock is reaped only after 10 min on an idle card.

## Release bank v1 (sealed 2026-09-25)

- File: gpu/ab/release-bank/release-bank-v1.json (set 13, 40 generic product questions, sha256 4f44d897). No change is tuned on it. It is only read to report release numbers, never to decide a keep.
- Protocol: the detector picks the questions (36 of 40 today), one-question convos alternating ml-harness and sequence, 2 runs, bench product-question-ab.mjs arm 'guard', held alone under the card lock.
- Today's defaults on it (port f5b08f50, from the set 13 skeleton run): full product answer 39%, lesson quality 59.5, mean turn 14.0 s, concept flow chart 54%, 0 resends, 0 errors.
- Any later release reports against these numbers, on this file, with this protocol. A new bank gets a new version number; it never replaces this one in place.
