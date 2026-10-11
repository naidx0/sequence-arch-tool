# lab

The Sequence lane's lab record: experiments, patches and measurements. It lived in the separate
naidx0/sequence-lab repo until 2026-09-26 and was merged here with its full history (last
commit there: 495e952). New lab entries go in this folder; nothing writes to sequence-lab now.

- `cloud/` is a mirror of the cloud lab's report files: 21 patches against the 0.1.2 mirror,
  the tools they ship, the A/B summaries (Claude Haiku 4.5 standing in for MiniCPM5), the
  accessibility audit and the lean-belt draft. `cloud/handoff.md` is its resume list.
- `gpu/` holds what ran on the RTX 2060 SUPER with MiniCPM5 through Ollama: the patched kit as
  `git format-patch` files against Sequence main, raw answers, scored summaries and the dry-run
  of every cloud patch at the machine's head.
- `log.md` is every hypothesis with its numbers, kept or discarded.
- `handoff.md` is where the lane stands and what runs next.
