
## 2026-08-29 — first official score: 21/50 (42.0%) on Verified-Mini-50

- Model: `minimax/minimax-m3:free` via OpenRouter ($0 total, key in `~/.sequence/openrouter-key`, NEVER in a repo).
- Eval dataset must be **`SWE-bench/SWE-bench_Verified`** (new org) — the princeton-nlp name lacks
  swebench 5.x's `image`/`eval_script`/`log_parser`/`eval_type` columns and dies with KeyError 'image'.
- **Windows eval hosts:** swebench 5.0.2 writes `eval.sh` and `patch.diff` with `Path.write_text`
  in text mode → CRLF → every command in the Linux container carries `\r` and ALL instances score
  unresolved. Patched locally in `.sweenv/.../swebench/harness/run_evaluation.py`: both
  `write_text(..., newline=chr(10))`. Re-apply after any venv rebuild.
- Report: `artifacts/<run>/official-report.json`. 41/50 non-empty patches, 21 resolved.
- The score rode on four harness fixes, each with a locking test (commits 7401fb39, 47bb6345):
  prose-diff salvage, last-chance diff round, scaled dead-end budget, sequence.txt prompt template
  (brace-escaped for str.format!).

## 2026-08-31 — the efficient iteration ladder (owner directive: stop re-running full-50 for every fix)

Validate every change at the CHEAPEST level that can falsify it; escalate only on pass:
1. **Locking tests** (seconds): reproduce the measured failure shape offline. Mandatory for every fix.
2. **Single-instance probe** (~5 min): temp-0 makes instances deterministic — a fix aimed at one
   failure re-runs that one instance manually (docker + bundle CLI + stream-json; see memory notes).
3. **Quick-15 panel** (~45 min): `bash run-sequence-quick15.sh` — stratified from 3 scored runs:
   5 always-resolved (regression canaries), 5 sometimes (flip targets), 5 never (breakthrough
   detectors). Score >10/15 with canaries intact = promote.
4. **Full mini-50** (~3h): milestone scores only — these go on the artifact.

Cross-run resolve history (v8/v13/v14): 16 always, 11 sometimes, 23 never. The 11 "sometimes"
are the top stabilization targets (they are wins the model can already reach); the free-tier
ceiling is their sum: 27/50 = 54%. Paid runs use --workers 2+ (free tier stays at 1).
