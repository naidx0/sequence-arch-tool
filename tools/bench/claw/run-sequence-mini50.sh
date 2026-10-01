#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Sequence on SWE-bench Verified-Mini-50 (published list) — the scoring run.
#
#   OPENROUTER_API_KEY=sk-or-... bash run-sequence-mini50.sh [model]
#
# Default model: z-ai/glm-5.2:free  ($0 usage; needs an OpenRouter account
# with >= $10 lifetime top-up for the 1000 free-requests/day tier).
# For the exact harness-table comparison use: qwen/qwen3.6-flash  (paid).
#
# Everything else is already staged on this machine:
#   - adapter registered + smoked (claw_swebench/claws/sequence.py)
#   - CLI bundle at C:/seqbundle, linux Node at C:/seqnode
#   - official SWE-bench 5.0.2 evaluator venv at C:/claw/.sweenv (verified)
#   - all 50 instance images pre-pulled (pull-mini50.sh)
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

MODEL="${1:-minimax/minimax-m3:free}"
: "${OPENROUTER_API_KEY:?set OPENROUTER_API_KEY}"

export MSYS_NO_PATHCONV=1 PYTHONUTF8=1
export SEQUENCE_NODE_HOST=C:/seqnode
export SEQUENCE_HOME_HOST=C:/seqbundle
export SEQUENCE_AI_PROVIDER="${SEQUENCE_AI_PROVIDER:-openai-compatible}"
export SEQUENCE_AI_BASE_URL="${SEQUENCE_AI_BASE_URL:-https://openrouter.ai/api/v1}"
export SEQUENCE_AI_KEY="${SEQUENCE_AI_KEY:-$OPENROUTER_API_KEY}"
export SEQUENCE_AI_MAX_RETRIES=4
export SWEBENCH_VENV=C:/claw/.sweenv
export SWEBENCH_WORK_DIR=C:/claw/swework

RUN_ID="seq-mini50-$(echo "$MODEL" | tr '/:' '--')"

echo "── infer: Sequence + $MODEL on verified_mini_50 (workers=1, free-tier friendly)"
./.venv/Scripts/python.exe run_infer.py \
    --claw sequence --model "$MODEL" \
    --dataset verified --run_id "$RUN_ID" \
    --instance_file config/verified_mini_50.txt \
    --timeout 2700 --workers 1

echo "── eval: official SWE-bench harness"
./.venv/Scripts/python.exe run_eval.py \
    --predictions "artifacts/$RUN_ID/predictions.jsonl" \
    --dataset_name SWE-bench/SWE-bench_Verified \
    --run_id "$RUN_ID-eval"

echo "── report:"
find swework/logs/run_evaluation/"$RUN_ID-eval" C:/claw -maxdepth 1 -name "*$RUN_ID-eval.json" 2>/dev/null | head -3
