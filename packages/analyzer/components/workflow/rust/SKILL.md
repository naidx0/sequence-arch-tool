---
name: rust
description: Change a Rust crate with cargo fmt, clippy, and test on the crate you are changing. Prefer existing workspace members. Optional Rig when the user asked for a Rust LLM agent library.
---

# Rust

Work on the Rust crate the user named. Prefer existing workspace members over a new crate.

## Loop

On the crate you are changing, in this order:

1. `cargo fmt` (or the workspace's fmt command if they wrapped it).
2. `cargo clippy` with the crate's existing flags. Do not disable lints to go green.
3. `cargo test` for that crate. If the workspace already locks tests with `--locked` or a similar flag, keep it.

Report each **command and its exit code**. Keep the whole log. Read the bare exit; do not pipe through `tail`.

## Workspace

- Prefer an existing member of the cargo workspace. Do not add a crate unless the user asked for a new one.
- Use the toolchain the project already pins. Do not install a global rustup target or a new nightly unless the user asked and the crate requires it. If `cargo` is missing, say so; do not install Rust for them.

## Rig (optional)

[Rig](https://github.com/0xPlaygrounds/rig) is a Rust library for LLM agents. Add it only when the user asked for a Rust LLM agent library, and only as a dependency of the crate they named. Do not vendor Rig source into this repo. The catalog pin is link-only.

## Grounding

- Quote compiler and test output. Do not summarise "clippy is clean" without the command and exit 0.
- A test you skipped is not a pass.
- Do not weaken `#[should_panic]`, `assert!`, or clippy allows to make a run green.

## When to stop

fmt, clippy, and test have been run on the crate you changed, with exits reported. If a step could not run (no cargo, no network for crates.io, missing target), say exactly what is missing.
