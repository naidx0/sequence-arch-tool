# What only a real model can tell us, ready to run

The deterministic replay (`../run.mjs`) shows the notes get found, are small, and the detectors are
precise enough. It cannot show that a note changes what a model does, or that it makes answers
better. Two runs on Jaden's PC cover that. Read the pre-registration below before running either.

## Pre-registration (write down, then run once)

- Data: `replay-cases.json` and `labelled-turns.json`, hashes in `SEALED.txt`. Both scripts refuse other bytes.
- Run `manip` once, then `harm` once per agent. No re-runs after looking. A broken run is reported as broken.
- Win bars, decided now:
  - `manip` (local model, $0): notes ON makes at least 15 more of the 60 replies use the note's words than OFF
    (the model read the note and used it), McNemar exact p < 0.05, and the note's words show up in at most 5 of the 60
    replies to unrelated asks (the leak count).
  - `harm` (Claude or Codex, uses subscription quota): file F1 with the 60 unrelated notes in front is not lower
    than plain by more than 1 SE of the paired difference, and tokens in rise by no more than the block
    (about 200 tokens) per first turn of a thread.
- NOT answered by either run: whether a note makes the agent's real work better. That is measured in
  use, per note, by the recurrence tracker (a note with no effect or a worse rate is flagged on the card).
  The honest label for `manip` is "the note reached the answer", not "the answer improved".

## manip: does the note reach a local model's answer? (free)

1. Start Sequence on Jaden's PC with the local model (MiniCPM5 via Ollama) on a SCRATCH repo, with no `.sequence/memory/NOTES.md`.
2. `node tools/bench/refine-replay/on-pc/run.mjs manip --server http://127.0.0.1:<port> --repo <scratch repo> --data <dir with SEALED.txt and the two data files> --out <dir>`

It builds the 60-note pool through the real code (failure report, signal, candidate, accepted note), asks the
60 repeat asks plus 60 unrelated asks with the notes file parked (OFF) and in place (ON), and scores each
reply with a fixed word check (`lib.mjs`: at least two of the reason's words that the person's ask did not
contain). No judge model. About 240 local asks.

## harm: does the block cost accuracy or tokens on a task it is not about?

`node tools/bench/refine-replay/on-pc/run.mjs harm --agent claude --questions tools/bench/agent-ab/sets/arch-questions-v1.json --repos tools/bench/agent-ab/sets/repos.local.json --data <dir> --limit 36 --out <dir>`
(then `--agent codex`). It runs the existing agent-ab twice, plain and with the notes block in front
(`AB_PREFIX_FILE`, a 3-line change in `agent-ab/run.mjs`; unset, the prompt is unchanged). Score the two
`.jsonl` files with `agent-ab/score.mjs` and compare paired F1 and tokens.

## Not covered

- Time to see an effect: a note needs at least 3 matching asks after it before the tracker will say anything.
- The wording of the tips is a template. A local-model rewrite (`enhanceAfter`) is wired for the by-hand route only and is not measured.
