"""Sequence (naidx0/codeforge) adapter for harness-controlled SWE-bench evaluation.

Architecture
------------
Sequence is a local-first Node app: a repository scanner that builds a grounded
architecture graph, plus an ask pipeline with a tool belt (read_file, edit_file,
search_files, locate_symbol, who_calls, propose_files, run_command, git_*). Its
headless entry point is:

    node <dist>/cli.js ask "<prompt>" --repo /testbed --permission full \
         --timeout <ms> --json

`--permission full` is what makes it a coding agent rather than a question
answerer: proposals are written to disk through the repo jail, and `run_command`
is available. Without it the turn is words only and the patch is empty.

`--json` puts one object on stdout at the end — {"text","coverage","usage"} —
and every progress line on stderr, so token usage is parsed from stdout without
any log scraping.

What has to be mounted, and why
-------------------------------
SWE-bench images are Python images with no Node runtime, so BOTH the interpreter
and the app come from the host, read-only, exactly as the hermes/generic claws
mount a standalone Python:

    SEQUENCE_NODE_HOST  a linux-x64 Node distribution (bin/node must be inside),
                        mounted read-only at /opt/sequence-node
    SEQUENCE_HOME_HOST  a directory holding the single-file CLI bundle (and the
                        few pure-JS packages it require()s at runtime), mounted
                        read-only at /opt/sequence

Host and container paths are deliberately distinct. A Windows host mounts
C:/seqbundle, which is not a legal path inside a Linux container, so the
same-path convention the other claws use cannot work here.

The bundle exists because a pnpm workspace resolves through a symlink farm that
does not survive being mounted into a container from another OS — the checkout
fails at "Cannot find package '@sequence/schema'". Build it with esbuild from
packages/analyzer/dist/cli.js; see the README section this adapter ships with.

Patch collection
----------------
None of this reports a patch. The runner takes `git diff` from /testbed after
the agent exits, which is the framework's rule and the reason the comparison is
fair — an agent cannot describe a change it did not make.

State
-----
Stateless across instances: no daemon, no session directory, no agent registry.
Each instance gets its own container and its own scan cache under /testbed.
"""

import json
import logging
import os
import subprocess
import time
from pathlib import Path

from claw_swebench.claws.base import BaseClawAdapter, decode_output
from claw_swebench.types import AgentResult

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Host locations, overridable so this works on someone else's machine.
# ---------------------------------------------------------------------------
# HOST paths (what to mount) are separate from CONTAINER paths (where it lands).
# They are not the same string on purpose: a Windows host mounts C:/seqbundle,
# which is not a legal path inside a Linux container, so the same-path convention
# the other claws use cannot work here.
SEQUENCE_NODE_HOST = os.environ.get("SEQUENCE_NODE_HOST", "/opt/sequence-node")
SEQUENCE_HOME_HOST = os.environ.get("SEQUENCE_HOME_HOST", "/opt/sequence")

# Fixed mount points inside the container.
NODE_MOUNT = "/opt/sequence-node"
SEQ_MOUNT = "/opt/sequence"

# The CLI entry point, relative to SEQ_MOUNT.
#
# Default is a single-file esbuild bundle rather than the checkout's
# packages/analyzer/dist/cli.js. A pnpm workspace resolves through a symlink
# farm that does not survive being mounted into a container from another OS —
# the checkout fails with "Cannot find package '@sequence/schema'". The bundle
# is 2.4 MB plus a handful of pure-JS packages that are require()d at runtime
# for CJS interop, and it runs anywhere Node does.
SEQUENCE_CLI_REL = os.environ.get("SEQUENCE_CLI_REL", "sequence-cli.mjs")

# Sequence reads its provider config from the environment when no
# .sequence/ai.json exists. These are forwarded so a run can target a local
# Ollama on the host (via host.docker.internal, which workspace.py already
# maps with --add-host) or any hosted provider.
FORWARDED_ENV_VARS = (
    "SEQUENCE_AI_PROVIDER",
    "SEQUENCE_AI_BASE_URL",
    "SEQUENCE_AI_MODEL",
    "SEQUENCE_AI_KEY",
    # Rate-limit resilience on shared free pools (OpenRouter :free): the CLI's
    # retry machinery is reached via this env knob (clamped 0-5 provider-side).
    "SEQUENCE_AI_MAX_RETRIES",
    # pass@1 discipline: pin decoding temperature for benchmark runs.
    "SEQUENCE_AI_TEMPERATURE",
    # The container IS the sandbox: unrestricted shell for repro-first work.
    "SEQUENCE_SANDBOX_EXEC",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENROUTER_API_KEY",
    # Local-model lanes: the env prefill pins OpenRouter's own base URL unless
    # this is set, which made a local relay look like a 401 from OpenRouter.
    "OPENROUTER_BASE_URL",
    "OPENROUTER_MODEL",
    "DEEPSEEK_API_KEY",
)


class SequenceAdapter(BaseClawAdapter):
    """Drives `sequence ask` inside a SWE-bench container.

    The model is selected through SEQUENCE_AI_MODEL rather than a config file,
    so `--model` on the command line both selects the model AND is recorded as
    run metadata — the two cannot drift apart.
    """

    name = "sequence"

    # ------------------------------------------------------------------
    # Container integration
    # ------------------------------------------------------------------

    def prompt_template(self):
        """Sequence-vocabulary prompt (prompts/sequence.txt).

        Measured on mini-50 run v6: the default template teaches `ls`, `cat`,
        `grep` and `sed -i`, and Sequence's run_command jail refuses all of
        them — the model burned its opening rounds on refused shell calls.
        The override names the real tools and the ```diff escape hatch; the
        phase structure is unchanged.
        """
        from claw_swebench.config import PROMPTS_DIR
        return PROMPTS_DIR / "sequence.txt"

    def container_run_args(self, instance_id: str) -> list[str]:
        """Mount the Node runtime and the built app, both read-only.

        Read-only is deliberate: the agent writes to /testbed and nowhere else,
        so a run cannot mutate the harness it is being measured with.
        """
        return [
            "-v", f"{SEQUENCE_NODE_HOST}:{NODE_MOUNT}:ro",
            "-v", f"{SEQUENCE_HOME_HOST}:{SEQ_MOUNT}:ro",
        ]

    def post_container_start(self, workspace) -> None:
        """Fail loudly, and early, if the mounts are not usable.

        A missing Node or a checkout that was never built otherwise surfaces as
        an empty patch on every instance — indistinguishable from an agent that
        simply could not solve anything, which is the worst way for a benchmark
        to be wrong.
        """
        node_bin = f"{NODE_MOUNT}/bin/node"
        cli = f"{SEQ_MOUNT}/{SEQUENCE_CLI_REL}"
        probe = subprocess.run(
            ["docker", "exec", workspace.container_name, "bash", "-c",
             f"test -x {node_bin} && test -f {cli} && {node_bin} --version"],
            capture_output=True, text=True,
        )
        if probe.returncode != 0:
            raise RuntimeError(
                f"sequence claw: runtime not usable in container. "
                f"Checked {node_bin} (executable) and {cli} (present). "
                f"stderr: {probe.stderr.strip()[:400]}"
            )
        logger.info("sequence claw: node %s in container", probe.stdout.strip())

    # ------------------------------------------------------------------
    # Task execution
    # ------------------------------------------------------------------

    def send_task(
        self,
        prompt: str,
        agent_id: str,
        container_name: str,
        artifact_dir: Path | None = None,
        instance_id: str | None = None,
    ) -> AgentResult:
        """Run one `sequence ask` turn against /testbed."""
        if artifact_dir:
            artifact_dir.mkdir(parents=True, exist_ok=True)

        stdout_path = artifact_dir / "agent_stdout.log" if artifact_dir else None
        stderr_path = artifact_dir / "agent_stderr.log" if artifact_dir else None

        node_bin = f"{NODE_MOUNT}/bin/node"
        cli = f"{SEQ_MOUNT}/{SEQUENCE_CLI_REL}"

        cmd = [
            "docker", "exec",
            "-w", "/testbed",
            # Sequence writes its scan cache under the repo; HOME keeps any
            # user-level config lookup inside the container rather than at /.
            "-e", "HOME=/root",
            "-e", f"SEQUENCE_AI_MODEL={self.model}",
        ]
        for env_name in FORWARDED_ENV_VARS:
            if env_name == "SEQUENCE_AI_MODEL":
                continue  # already set from --model above; do not let it be overridden
            val = os.environ.get(env_name)
            if val:
                cmd.extend(["-e", f"{env_name}={val}"])
        cmd.extend([
            container_name,
            node_bin, cli, "ask", prompt,
            "--repo", "/testbed",
            # The whole reason this claw can score at all: proposals are WRITTEN.
            "--permission", "full",
            # The interactive default (8 rounds) is a chat-UX budget; measured
            # on SWE-bench it cut a competent model off mid-investigation with
            # the fix identified and no round left to make it. Benchmark turns
            # get the pipeline's own ceiling.
            "--rounds", "32",
            "--json",
            # Sequence's own budget, just inside the harness budget, so the CLI
            # exits on its own terms and we still capture its JSON rather than
            # killing it mid-write.
            "--timeout", str(max(1, (self.timeout - 30)) * 1000),
        ])

        start = time.time()
        timed_out = False
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                timeout=self.timeout,
            )
            stdout_text = decode_output(proc.stdout)
            stderr_text = decode_output(proc.stderr)
            exit_code = proc.returncode
        except subprocess.TimeoutExpired as e:
            timed_out = True
            stdout_text = decode_output(e.stdout)
            stderr_text = decode_output(e.stderr)
            exit_code = -1

        duration = time.time() - start

        # THE AGENT'S OWN LEAVINGS ARE NOT PART OF ITS PATCH.
        #
        # Sequence caches its scan under <repo>/.sequence — graph.json, functions.json,
        # the trajectory. On this instance that was a 160,815-line graph.json, and the
        # runner's `git diff /testbed` swept it straight into the patch, so a "solution"
        # would have been a six-figure junk diff that no evaluator could apply.
        #
        # Removed here rather than filtered later: the runner is claw-agnostic by design
        # and should not have to know what any particular agent scribbles. Only Sequence's
        # own cache directory is touched; anything the agent wrote to the source tree is
        # left exactly as it is, which is the whole thing being measured.
        # Save the agent's own trajectory before the cache is destroyed — it is
        # the only record of which tools ran and what each round returned, and
        # an empty patch is undiagnosable without it.
        if artifact_dir:
            subprocess.run(
                ["docker", "cp", f"{container_name}:/testbed/.sequence/ask-turns",
                 str(artifact_dir / "ask-turns")],
                capture_output=True,
            )
        subprocess.run(
            ["docker", "exec", container_name, "rm", "-rf", "/testbed/.sequence"],
            capture_output=True,
        )

        if stdout_path:
            stdout_path.write_text(stdout_text or "", encoding="utf-8")
        if stderr_path:
            stderr_path.write_text(stderr_text or "", encoding="utf-8")

        usage = _parse_usage(stdout_text)

        # `sequence ask` exits 0 only when it produced an answer; every other
        # code is documented in its ASK_EXIT table. A non-zero exit still leaves
        # whatever it wrote to /testbed in place, and the runner will collect
        # that diff — so a partial run is reported as an error, not discarded.
        if timed_out:
            finish_reason = "timeout"
        elif exit_code == 0:
            finish_reason = "stop"
        else:
            finish_reason = "error"

        return AgentResult(
            success=finish_reason == "stop",
            timeout=timed_out,
            exit_code=exit_code,
            finish_reason=finish_reason,
            stdout_path=stdout_path,
            stderr_path=stderr_path,
            session_id=None,
            duration_seconds=round(duration, 1),
            usage=usage,
        )


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------


def _parse_usage(stdout_text: str) -> dict:
    """Pull token usage out of `--json` stdout.

    `sequence ask --json` prints exactly one object, and only that object, on
    stdout: {"text": ..., "coverage": ..., "usage": {"inputTokens", "outputTokens",
    "estimated"}}. `estimated` is carried through rather than dropped — a
    chars/4 estimate and a provider-reported count must not be summed as if
    they were the same measurement.
    """
    total = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "estimated": None}
    if not stdout_text:
        return total
    try:
        # Be forgiving about a stray line: take the last JSON object on stdout.
        blob = None
        for line in reversed(stdout_text.strip().splitlines()):
            line = line.strip()
            if line.startswith("{") and line.endswith("}"):
                blob = json.loads(line)
                break
        if blob is None:
            blob = json.loads(stdout_text)
    except (ValueError, TypeError):
        return total

    usage = blob.get("usage") or {}
    total["input"] = int(usage.get("inputTokens") or 0)
    total["output"] = int(usage.get("outputTokens") or 0)
    total["estimated"] = usage.get("estimated")
    return total
