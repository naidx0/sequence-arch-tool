# Port kit: the cloud patches at your real head (599b1c35)

At 599b1c35, `apply-all.sh` found 4 of the 21 patches clean and 17 in conflict. `git apply` needs three unchanged lines around every change. Some patches also build on earlier ones (0014 before 0016, 0018 and 0020; 0011 before 0016 and 0018), so some of the 17 are knock-on conflicts: they fail only because an earlier patch did not land.

`port.mjs` finds each change by what it changes, not by the three lines around it. It needs only Node, with no install step. Tested on the 0.1.2 mirror (log.md H12, H13):

| test tree (built from 515eb86) | git apply + --3way | port.mjs |
|---|---|---|
| unchanged | 21 | 21, byte-identical to git's result |
| Windows checkout (autocrlf) | 21 | 21 |
| three touched files moved | 13 | 21 |
| a different `flowLines.ts` already there | 16 | 18 (clash reported, your file kept) |
| lines inserted 1-3 lines from every change (6 seeds) | 3 to 4 | 9 to 12 |
| all of the above together (6 seeds) | 2 to 3 | 9 to 12 |

It wrote 0 wrong files in every test. When a line sits between two lines a patch removes, it refuses rather than guesses. That is most of what it did not land in the drift tests, and it is the right call. 7 unit tests: `node --test port.test.mjs`.

## Take first: 0018a

`0018a-drop-invented-links-app.patch` is the app half of 0018 on its own: the askTools.ts change behind `SEQUENCE_CHART_DROP_INVENTED_LINKS=1` and its 3 tests, with no need for 0014 or 0016. The live MiniCPM5 A/B shows the drawing languages beat JSON only with this repair on. `git apply` fails on it because a context line changed; `port.mjs` lands it (12 of 12 drifted copies, git 0 of 12; analyzer 2879/2880 with the 1 being web2 not built).

```
node <kit>\port.mjs --root ..\sequence-port --write <kit>\0018a-drop-invented-links-app.patch
```
Then add your own zero-link refusal commit (sequence-lab aed53a3) on top.

## Steps on the machine (never in your own checkout)

```
cd <repo>
git worktree add ..\sequence-port 599b1c35 -b lab/cloud-patches
node <kit>\port.mjs --root ..\sequence-port <kit>\patches            # dry run: port-out\report.md
node <kit>\port.mjs --root ..\sequence-port --write <kit>\patches    # writes every patch that fully lands
cd ..\sequence-port
pnpm install; pnpm -r build; pnpm -r test                            # the gates
```

- `<kit>` is a folder holding `port.mjs` and `patches\`, fetched from the report page (artifact 3eRG27QvdFgvf1MQSA3szE, files `port/port.mjs` and `patches/00NN-*.patch`).
- A patch lands whole or not at all. Hunks that did not land go to `port-out\00NN-name.rej`, with the file each one belongs to. Row N of handoff.md section 1 says what the patch is for, so a hand port or a model can redo it at your head. `--partial` writes the hunks that did land anyway.
- One commit per patch, as maxnaid1 with no trailer (the loop below). Leave `.agents/skills/sequence-design/SKILL.md` unstaged.

```powershell
cd ..\sequence-port
foreach ($n in 1..21) {
  node <kit>\port.mjs --root . --out ..\port-out --only $n --write <kit>\patches
  if ($LASTEXITCODE -eq 0) {
    $files = Get-Content ..\port-out\written.txt
    if ($files) { git add -- $files; git -c user.name=maxnaid1 -c user.email=maxnaid41@gmail.com commit -qm "cloud patch $n" }
  }
}
```
Files are staged by name from `written.txt`, never with `add -A`. Run the gates after the loop, or inside it for a bisectable history.

## Which patches are ready

Every patch has a port path. The "expect" column is a forecast from what the cloud knows about your Slices 10-12 and the canvas branch. It is not a measurement, and the machine's dry run replaces it.

| patch | what it does | files it edits | expect at 599b1c35 |
|---|---|---|---|
| 0001 | lesson-quality tools (new files) | tools only | likely lands |
| 0002 | plain-words stop note | askPipeline.ts | Slices 10-12 changed askPipeline.ts; likely lands, or a .rej for one hunk |
| 0003 | teach: point at the picture (flagged) | askPipeline.ts, conceptChart.ts | as 0002 |
| 0004 | worked example (flagged) | askPipeline.ts, conceptChart.ts | as 0002 |
| 0005 | gpu-lock signal race | tools/ci/gpu-lock.mjs | likely lands unless your gpu-lock changed |
| 0006 | plan turns: before/after chart (flagged) | askPipeline.ts, conceptChart.ts | as 0002 |
| 0007 | one request, one frame | askPipeline.ts, conceptChart.ts, api-types ask.ts, web2 store.ts | as 0002 |
| 0008 | chat write names its thread | web2 sessions, connect.tsx | likely lands |
| 0009 | Files header fit | FilesPanel.tsx, files.css | likely lands |
| 0010 | deflection floor | askPipeline.ts, conceptChart.ts | overlaps your Slice 10 floor; review the .rej by hand |
| 0011 | flow lines (canvas Slice 1) | new flowLines.ts, askTools.ts | skip if your own flowLines.ts is in main; keep one |
| 0012 | /api/sessions read once | web2 sessions, v3 rail and shell | likely lands |
| 0013 | shared GET | web2 api, connect.tsx and clients | likely lands |
| 0014 | drawing-language A/B kit | new schema files, schema index.ts | likely lands (your lab/draw-lang-ab-gpu branch already has it) |
| 0015 | canvas doc read once | connect.tsx | likely lands |
| 0016 | subscriptions in data-flow direction | askTools.ts, chart.ts, drawLanguages.ts | needs 0014; the askTools hunk needs 0011 or a hand port |
| 0017 | terminal keyboard exit | TerminalPane.tsx | likely lands |
| 0018a | drop invented links, app half only | askTools.ts | **ready: take first** |
| 0018 | drop invented links (flagged), full | askTools.ts, chart.ts | kit half needs 0014; use 0018a for the app |
| 0019 | a11y nesting and focus | NodeCard.tsx, css, V3SessionsRail.tsx | likely lands |
| 0020 | D2 and states arms | drawLanguages.ts, draw-lang-ab.mjs | needs 0014 |
| 0021 | contrast | board.css, v3.css, V3Chat.tsx | likely lands |
