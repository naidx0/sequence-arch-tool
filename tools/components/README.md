# Components catalog (vendor script)

`vendor.mjs` fetches the pinned upstream agent skills listed in `sources.json` and writes them to
`packages/analyzer/components/<group>/<leaf>/` with a `component.json`, a `LICENSE` and, for
original text, our own `SKILL.md`. Nothing here needs npm packages; fetching uses the authenticated
`gh` CLI.

## Commands

- `node tools/components/vendor.mjs` fetches every pin and rewrites the catalog. Nothing on disk
  changes until every fetch has succeeded.
- `node tools/components/vendor.mjs --check` validates the catalog and `sources.json`. Exit 0 or 1,
  with one line per problem.
- `node --test tools/components/vendor.test.mjs` runs the checker tests, including a check of the
  bundled catalog.

## Updating a pin

1. Get the new head: `gh api repos/<repo>/commits/main --jq .sha`.
2. Put it in `sources.json` as `commit` for that source.
3. Re-run the vendor script, then `--check`, then the tests. Review the diff under
   `packages/analyzer/components` before committing.

## License rule

Every source names its license. A component with no license is link-only: `component.json` and
nothing else, no upstream content copied. Link-only sources use `"kind": "link-only"` and
`"license": "none"`; the checker rejects a `none` license on any source that copies files.

Originals live in `originals/` and are ours: write them fresh, do not copy upstream text into them.

## Path references

`--check` reads every relative path a component's `SKILL.md` names (markdown link targets, and bare
or backticked paths such as `kit/lathe.mjs` or `references/craft.md`). Each one must exist inside the
component folder. A path that is deliberately not bundled goes in that component's `externalRefs`
list in `sources.json` (copied to `component.json`). The check fails on a missing path that is not
listed, and on a listed path that is either present or not referenced. Current `externalRefs` groups:

- Project paths of the upstream repo, which a user has after cloning it (Halo: `src/`, `agent-docs/`,
  `tests/`; RSI-Anything: `docs/`, `configs/`, `tasks/`).
- Example names and output paths in prose (`src/Card.tsx` in the make-interfaces-feel-better examples,
  `shots/lines.png` written by anatomy's scripts).
- One path the upstream SKILL names but the upstream repo does not contain
  (`shared/evals/report/build-report.mjs` in claude-api).

## Size

The catalog total is capped at 7 MB (`MAX_TOTAL_BYTES` in `vendor.mjs`). The cap was raised from
6 MB when anatomy's `kit/`, `scripts/` and `examples/` (sources only, no generated `.html`) and
claude-api's `curl/` and `csharp/` were vendored so the skills work as shipped.

## Patches and preambles

- `patches/<name>.json` holds Sequence edits to one vendored skill (currently `rea.json`, from the
  security review). Each edit is an exact `find`/`replace` pair, and must match exactly once in its
  file, or the vendor run fails. The run writes the component's `MODIFICATIONS.md` from the same file.
  A re-vendor reproduces the edits. Change the pin or the edit list and re-run.
- A source or dir can set `preambleFrom` to a text file under `originals/`. The vendor run copies it
  into the component as `SEQUENCE.md` and sets `"preamble": "SEQUENCE.md"` in `component.json`.
  `--check` fails if a declared preamble file is missing. Halo and RSI-Anything use this to say the
  skill works inside a clone, and to ask before cloning.
