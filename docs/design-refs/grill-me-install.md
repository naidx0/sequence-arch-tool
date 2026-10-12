# Install Matt Pocock `/grill-me` (repo + your machine)

This repo already vendors **grill-me** + **grilling** under:

- `.cursor/skills/grill-me` · `.cursor/skills/grilling` (Cursor)
- `.claude/skills/grill-me` · `.claude/skills/grilling` (Claude Code)
- `.agents/skills/grill-me` · `.agents/skills/grilling` (skills.sh lockfile)

Invoke in a **fresh** chat: `/grill-me` (or say “grill me on …”).

## Global on your own Cursor account / laptop

Cloud agent `~/.agents` / `~/.cursor/skills` do **not** sync to your personal
Cursor account. On your machine:

```bash
npx skills add mattpocock/skills --skill grill-me --skill grilling -y -g
```

That installs into `~/.agents/skills/` and copies into Cursor’s global skill
paths so `/grill-me` works in any project.

Optional (coding sessions that should also update docs/ADRs):

```bash
npx skills add mattpocock/skills --skill grill-with-docs -y -g
```

## Architecture-map grilling

When grilling visual / Architecture board work, the Sequence-local skill points
at `docs/design-refs/isometric-system-maps/` and
`docs/research/isometric-map-competitive-read.md`.
