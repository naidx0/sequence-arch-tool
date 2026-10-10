# Sequence on Claw-SWE-Bench

Harness-controlled comparison: the model, the task set, the container runtime and the
official SWE-bench evaluator are all held fixed, and only the **harness** varies. That is
the one comparison that answers "is our agent scaffold any good", and
[claw-swe-bench](https://github.com/opensquilla/claw-swe-bench) is built for it — five
other harnesses are already published there with their cost.

Two files here:

| file | what it is |
|---|---|
| `sequence_adapter.py` | the `BaseClawAdapter` implementation. Copy to `claw_swebench/claws/sequence.py` in a claw-swe-bench checkout. |
| `build-bundle.mjs` | builds the single-file CLI the adapter mounts into the container. |

## Why a bundle rather than the checkout

A pnpm workspace resolves through a symlink farm rooted at absolute host paths. Bind-mounted
into a Linux container from a Windows or macOS host those links do not resolve, and the CLI
dies at `Cannot find package '@sequence/schema'` before it reads a line of the repo.
`pnpm deploy` emits the same absolute symlinks; dereferencing them flattens the nested
layout pnpm needs and it then fails one level deeper on a transitive dependency.

So the adapter mounts one esbuild bundle (~2.4 MB) plus the few packages that are
`require()`d at runtime and cannot be inlined.

## Setup

```bash
# 1. Build Sequence, then the bundle
pnpm -r build
node tools/bench/claw/build-bundle.mjs C:/seqbundle

# 2. A linux-x64 Node for the container (SWE-bench images have no Node)
mkdir -p C:/seqnode/bin
docker create --name n node:22-slim && docker cp n:/usr/local/bin/node C:/seqnode/bin/node && docker rm -f n

# 3. The claw framework
git clone https://github.com/opensquilla/claw-swe-bench C:/claw
cp tools/bench/claw/sequence_adapter.py C:/claw/claw_swebench/claws/sequence.py
uv venv --python 3.12 C:/claw/.venv
uv pip install --python C:/claw/.venv -r C:/claw/requirements.txt
```

Register it in two places, exactly as the framework's own docs require:

```python
# claw_swebench/claws/__init__.py
from claw_swebench.claws.sequence import SequenceAdapter
CLAWS = { ..., "sequence": SequenceAdapter }

# claw_swebench/config.py
CLAW_DEFAULTS = { ...,
    "sequence": {"model": "granite4-hermes:latest", "timeout": 3600, "max_turns": 300},
}
```

## Environment

```bash
export SEQUENCE_NODE_HOST=C:/seqnode        # mounted read-only at /opt/sequence-node
export SEQUENCE_HOME_HOST=C:/seqbundle      # mounted read-only at /opt/sequence
export SEQUENCE_AI_PROVIDER=openai-compatible
export SEQUENCE_AI_BASE_URL=http://host.docker.internal:11434/v1
export SEQUENCE_AI_KEY=ollama-local-no-key-needed
```

The key is required even for Ollama: from inside a container the provider URL is
`host.docker.internal`, which is not loopback, and the config validator only waives the key
for a loopback base URL. Ollama ignores the value.

On a Windows host also set `PYTHONUTF8=1` — an issue statement containing a zero-width space
otherwise dies at `'charmap' codec can't encode character '\u200b'` before the agent starts.

## Smoke one instance

```bash
cd C:/claw
echo django__django-11790 > config/smoke_one.txt
docker pull swebench/sweb.eval.x86_64.django_1776_django-11790:latest

./.venv/Scripts/python.exe run_infer.py \
    --claw sequence --dataset verified --run_id seq-smoke \
    --instance_file config/smoke_one.txt --timeout 1500 --workers 1
```

Measured on this machine, granite4-hermes over Ollama: container started, scan of the Django
tree at **2,618 nodes / 7,530 edges in 6.7s**, agent exit 0 in 21.7s, `usage {input: 7436,
output: 1789, estimated: false}` parsed from `--json`, `predictions.jsonl` written in
SWE-bench submission format. **Patch empty** — the model correctly identified the
`AuthenticationForm` `maxlength` regression in prose and never called `edit_file`. The
plumbing is proven; the score is the model's.

## The 160,815-line patch, and why the adapter deletes a directory

The first successful run produced a patch that was almost entirely `.sequence/graph.json` —
Sequence caches its scan under the repo, and the runner's `git diff /testbed` swept it in. A
"solution" would have been a six-figure junk diff no evaluator could apply.

`send_task` now removes `/testbed/.sequence` before returning. It is done in the adapter
rather than filtered by the runner because the runner is claw-agnostic by design and should
not have to know what any particular agent scribbles. Only Sequence's own cache is touched;
anything written to the source tree is left exactly as it is, which is the thing being measured.

## Running the Lite subset

**There is no `lite_80.txt` in the repository.** The README describes the 80-instance Lite
subset as "selected by the cost-aware, rank-aware procedure described in the paper", and ships
only `config/multilingual_300_instances.txt` (300) and `config/verified_mini_50.txt` (50),
which together are the 350-instance full set. Anyone who prints a `--instance_file
config/lite_80.txt` command has not looked.

Until that list is published, run a subset you define yourself and **say how you chose it** —
an undisclosed 80 out of 350 is the cherry-picking a reviewer will assume by default:

```bash
# Deterministic first-80 of the multilingual set. Not the paper's Lite subset,
# and must not be reported as if it were.
head -80 config/multilingual_300_instances.txt > config/lite80_first.txt

./.venv/Scripts/python.exe run_infer.py \
    --claw sequence --dataset multilingual --run_id seq-lite80 \
    --instance_file config/lite80_first.txt \
    --timeout 3600 --workers 4

./.venv/Scripts/python.exe run_eval.py \
    --predictions artifacts/seq-lite80/predictions.jsonl \
    --dataset_name SWE-bench/SWE-bench_Multilingual \
    --run_id seq-lite80
```

`run_eval.py` needs the official SWE-bench harness in its own venv at `/data/swe-bench-env`
(override with `SWEBENCH_VENV`), and every instance image pulled — budget the disk, the
django image alone is 4.18 GB.

Before spending that: a local 7B model scored an empty patch on the one instance smoked here.
Point `SEQUENCE_AI_*` at a frontier model before running 80, or the result measures the model
and gets reported as if it measured the harness.
