---
name: swe
description: Long-running coding loop: reproduce the failure, write a locking test that fails for the right reason, smallest patch, re-run. Never weaken assertions. One change at a time.
---

# SWE

A Sequence-native software-engineering loop for long-running coding work.

Public loops this follows (link only; do not copy their prompts, ACI text, or tool schemas): [SWE-agent](https://github.com/SWE-agent/SWE-agent), [OpenHands](https://github.com/OpenHands/OpenHands), [Aider](https://github.com/Aider-AI/aider), [smolagents](https://github.com/huggingface/smolagents). LangGraph and CrewAI are orchestration references in the same catalog; they are not this skill's runtime.

## Loop

1. **Reproduce the failure.** Run the command or open the file that shows it. If you cannot reproduce, stop and say what you tried (command, exit, output).
2. **Write or run a test that fails for the right reason.** A locking test that fails before the fix. If a test already exists, run it; do not skip it. Show the failure.
3. **Smallest patch** that makes that test pass. One change at a time. No drive-by refactors, no extra files, no "while we are here".
4. **Re-run** the same test, then the suite around it. Report commands and exits.
5. **Do not weaken assertions** to go green. If the contract changed, rewrite the test so it still locks the behaviour.

## Grounding

- The first run of the locking test must fail. If it passed before the patch, it is not a lock.
- Quote the failure and the later pass. "Should work" is not a result.
- If a tool or test runner is missing, say so. Do not install a global CLI or create a CI account.

## When to stop

The locking test failed, then passed, with the same command. Nearby tests still pass, or you have named the ones that failed and why. Do not open a second change until this one is done.
