# Reproducing the published bench numbers

Handoff item 18 / audit P1-12. One table: each number that is published, the command that reproduces
it, the value to expect, and the hash of the data it depends on. Anything not in the table is not a
published, reproducible number (see "Not reproducible" below). Locked by
`tools/bench/test/reproduce.test.mjs` (`pnpm bench:test`), which fails if a pin here drifts from the
manifests.

## Fresh clone

```bash
pnpm install --frozen-lockfile && pnpm -r build     # packages/ink/dist and packages/analyzer/dist
export SEQUENCE_BENCH_CACHE=~/.cache/sequence-bench # optional; default is <tmpdir>/sequence-bench-heldout
pnpm bench:test                                     # pins, manifests and dry modes (seconds, no network)
```

Needs: git with full history (the `--published` / `--old-model` modes read two older commits from it),
Node 20+. `bench:findfiles` also needs ripgrep 14.x (`rg`) on PATH.

## Published numbers

| Published number | Where it is published | Command | Expect | Tolerance | Data hash |
|---|---|---|---|---|---|
| Shape recognizer, grouped: 93.9 % accuracy, 78.0 % snap recall, 1.62 % wrong snaps, macro-F1 0.8955, on 530 DiDi drawings it had never seen (13,175 scored strokes) | site (`advantages.ts`, `lt/Story.tsx`), `docs/claims.json` V12, `tools/bench/ink-fresh-sealed.txt` | `pnpm bench:ink --published` | accuracy 93.89 %, recall 78.01 %, wrong-snap 1.62 %, macro-F1 0.8955 | +/- 0.0005 absolute on each rate (the scoring is deterministic; this absorbs rounding only) | below |
| Lone-stroke arm of the same run: macro-F1 0.6362, wrong snaps 1.97 % | `ink-fresh-sealed.txt`, claims V14 | `pnpm bench:ink --published` | 0.6362 / 1.97 % | +/- 0.0005 | below |
| Old single-stroke recognizer (the one the architecture board's Draw uses): 88.1 % accuracy, 54.4 % recall, 3.64 % wrong snaps | claims V14, `AdvModels.tsx` | `pnpm bench:ink --old-model` | 88.11 % / 54.43 % / 3.64 %, macro-F1 0.6489 | +/- 0.0005 | below |

Runtime on the reference machine (4 cores, no GPU): `--published` 53 s, `--old-model` 13 s, plain
`pnpm bench:ink` 25 s once the data is cached; the first run adds a 222 MB download and 501 files of
under 2 KB (about 20 s on this machine's connection). No model is trained or downloaded; the shipped trees are
scored.

### The published ink number is the sealed commit's, not today's

The sealed look was taken once, at `d9ee1618e29c0d47fa0de82b7175b67f059cfdff`. Two later commits changed the
grouping and the connector rule (`1b5b5337b`, `a48245782`), tuned on the dev split. Scored on the same sealed
slice, the tree at `634d385cd` gives (`pnpm bench:ink`, no flag):

| | published (sealed commit) | this tree |
|---|---|---|
| grouped accuracy | 93.89 % | 93.68 % |
| grouped snap recall | 78.01 % | 76.93 % |
| grouped macro-F1 | 0.8955 | 0.8919 |
| grouped wrong snaps | 1.62 % | 1.59 % |

So the site's "93.9 %" is true of the sealed commit and reproduces exactly with `--published`; the
shipping code now scores 93.7 % / 76.9 % on that slice. Plain `pnpm bench:ink` prints both and exits 0; the
`--published` and `--old-model` modes exit 1 if a number drifts. This slice has now been looked at more than
once, so it is no longer an unseen test set for later changes.

### Ink data hashes (pinned in `tools/bench/data/ink-didi/manifest.json`)

Source: `https://storage.googleapis.com/digital_ink_diagram_data/diagrams_20200131.ndjson`, bytes
1000000000-1222429135 (the last 222,429,136 bytes of a 1,222,429,136-byte file), plus
`xdot/<label_id>.xdot` for the 501 prompts those drawings copy. Google DiDi, CC BY 4.0
(`docs/THIRD-PARTY-NOTICES.md`); the data is fetched, never committed.

| Artifact | sha256 |
|---|---|
| raw slice (Range request) | `906221bd36f05e2327a7b26521096b3fdc89ba1db3c033effa044b9decfe3e46` |
| 530 test-split drawings (partial first line dropped, joined with LF) | `bba0d85acc81a6f769fbca6d74a8634076bf5d71c6fb5558a2a85d259d45f06c` |
| `tools/bench/data/ink-didi/prompts.json` (501 xdot hashes and PNG sizes, committed) | `974e8959f3cb432a3299abe2eb1d701b9189cc0f5c998ec32a54abfcff552693` |
| `tools/bench/ink-didi-label.mjs`, CR removed | `431bd08836257c0d7e18388ef86e35598dada6a8110cb67d61eaa31de0ee8931` |
| labelled strokes (22,890 rows) | `920be2e22bcaae92b282f32bf31104410e75729dd368aae2f27a6999cfb70956` |

The first two are the sealed record's own hashes (`ink-fresh-sealed.txt`) except the raw slice, which is
new. Every hash is checked on download and again after labelling; a mismatch stops the run with the two
values, and the score is never printed from unverified data.

```bash
node tools/bench/data/ink-didi/download.mjs --check            # verify pins + whatever is cached, download nothing
node tools/bench/data/ink-didi/download.mjs --check --strict   # same, and fail if the cache is empty
pnpm bench:ink --dry                                           # print the plan and prerequisites, run nothing
```

## find_files (bench:findfiles)

| Published number | Status |
|---|---|
| none yet | The v1 question set and every output computed from it are **superseded and must not be quoted** (`report/raw/bench-findfiles-2026-10-14-superseded-v1.json`; `docs/plans/0.1.9/BENCH-PROGRAM.md`). The set was re-sealed as v2 (sampled along the first-parent chain). The v2 full run (A1/A2) has not been done: it needs a quiet machine and is a separate job. When it lands, add its rows here with the command below. |

The v2 inputs are pinned and verifiable now:

```bash
node tools/bench/data/findfiles-heldout/download.mjs --check   # sealed sets vs their sha256; clones, if present, hold the pinned commits
node tools/bench/data/findfiles-heldout/download.mjs           # clone the six repos (full history, so large; size not measured here; idempotent)
pnpm bench:findfiles --dry                                     # print the plan and prerequisites, clone and score nothing
pnpm bench:findfiles                                           # the full run (long; quiet machine; writes report/raw/ and tools/bench/out/)
```

| Input | Pin |
|---|---|
| `questions.json` (v2, 6 repos x 50 questions, seed 20261014) | sha256 `25c98b4152e5b5e7adb48a79e6aa552a2352563a57525e5d0f83de90bb24dde5` (CR-insensitive; `questions.sha256`) |
| `questions.v1.json` (superseded, history only) | sha256 `374a2878be6b62f7793b832ce9ff94e40e3c197ab5c66fda3913086ce796c44f` |
| flask | `https://github.com/pallets/flask.git` @ `d086db856be187255b8ec61ef409357393020f32` |
| sqlfluff | `https://github.com/sqlfluff/sqlfluff.git` @ `467d5927e00faeaaeb9fd73fa68e752d8ca60e7e` |
| express | `https://github.com/expressjs/express.git` @ `a419aa7350389a275ab45fde2e849ed1f02449ef` |
| gin | `https://github.com/gin-gonic/gin.git` @ `0f09c3a9b4626d9fe9979cf4d0521d6ae32ab646` |
| vite | `https://github.com/vitejs/vite.git` @ `c2c9ef4dcd05b3e4d88844ea3a13dc23819ca2a5` |
| excalidraw | `https://github.com/excalidraw/excalidraw.git` @ `4c37956ba5f04ec342a9d9d5891a38f22c5b7b4e` |

`download.mjs` fetches each pinned sha and fails if the commit is absent; `findfiles-bench.mjs` refuses to
run if the question set does not hash to `questions.sha256`. Both previously compared raw bytes, so a Windows
checkout with `core.autocrlf=true` (CRLF working tree) was refused; they now hash with CR removed.

## Not reproducible from this tree (do not quote as reproduced)

- **find_files 84.9 % hit@5 vs grep 51.0 %** (claims F4, `AdvModels.tsx`): computed on eight repos that are
  not in the tree and not pinned; the v1 find_files outputs are superseded. No command reproduces it. It
  stays unverified until the v2 run is published.
- Any other bench number in `docs/` without a row above (teach, agent A/B, closure, find-the-fix): not part
  of this item; none has a pinned dataset and a one-command reproduction yet.
