# Sequence lane handoff (machine side)

## Now (2026-09-26 02:25Z)
- Port branch lab/patches-at-599b1c35 (C:/Users/<user>/Projects/seq-patches) at 8d6a6d51. Kept today, all on by default:
  - no-shape-bounce (753a2c3d): sealed bank 9.20 s to 7.82 s (4.1 SE), fastgate ACCEPT.
  - concept chart caption names what travels (649d305e): 21/21 blind screenshot judgments.
    The canvas never showed a concept caption before (title-echo rule); fixed.
  - flow chart fits its frame width (cad0dce3): 440 px byte-identical, 900 px full boxes.
- Discarded today: concept chart v1 (labels + steps; failed the render check), ask-kind seed (1 of 54 asks).
- Running: short product answer (SEQUENCE_TEACH_PRODUCT_SHORT=1), candidate arm only, queued behind
  ML harness on the card (scratchpad ab-short.sh). Baseline = gpu/ab/release-bank/noshape2/bank-noshape2-cand.json
  (first-prompt keys 72/72 at 8d6a6d51). Score with the paired script + fastgate (see log).
- Bank number: 90% full product answers at 7.8 s.
- Gates at 649d305e: analyzer 3134/3137 (two console-bound terminal tests fail from a non-console shell);
  web2 3256/3256 at cad0dce3.
- Render harness for chart screenshots: copy of scratchpad render3/ is in gpu/ab/concept-steps/v2/ (images);
  the harness mounts SeqChartView as AiCanvas does, via web2's vite config.
- Not pushed: sequence-lab main and the port branch (push was refused by this session's permissions).
- Idle rule: a runner queued on the card is not work; do offline work while it waits.

## Done
- Drawing-language A/B on MiniCPM5, 210/210 answers, scored. No language kept; DOT leads on hop
  coverage (+0.43, 7 SE) but not grounded. See log.md and gpu/ab/draw-lang-minicpm5/.
- 0018 rescored on the same answers: kept. Zero-link refusal added (kit bdf62c6f): kept.

## Re-run recipe (resumes; finished calls are skipped)
SEQUENCE_GPU_LOCK="C:/Users/<user>/OneDrive/Documents/Obsidian Vault/max-brain/09-Nightshift/gpu.lock"
node tools/measure/draw-lang-ab.mjs --scan tools/measure/fixtures/shopfront.scan.json \
  --questions tools/measure/questions.shopfront-hard.json --langs json,flow,mermaid,dot,path \
  --runs 6 --max-nodes 40 --reasoning-effort none --temperature default --out out/draw-lang-gpu
`--max-nodes` must stay >= 36 or the prompts change (default 24 cuts the hard set's expected paths).

## Done (2)
- Fresh-answer confirmation: DOT and path both beat JSON with 0018 + refusal (log 2026-09-23).

## Next
- Build DOT (and path as the fast option) into propose_chart for small models, with 0018 + refusal;
  A/B it in the real teach turn against JSON.
- Rewritten cloud patches onto a fresh branch off 599b1c35, gated.

## State at end of 2026-09-23 session
- Port branch lab/patches-at-599b1c35 (worktree C:/Users/<user>/Projects/seq-patches): all cloud
  fixes in or measured unneeded; DOT flag added; all four gates green. Patches: gpu/port-599b1c35/.
- Next: A/B the DOT flag in the real teach turn (MiniCPM5, 6+ runs a side) against JSON; then the
  ML harness adapter (D5) if Jaden allows local training; Nebius sampling waits on Jaden's permission.
