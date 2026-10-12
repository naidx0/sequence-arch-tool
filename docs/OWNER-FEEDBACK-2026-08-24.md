# Owner feedback, 2026-08-24 — the phase plan

Max ran the app himself against `localhost:4173`, asked it to design a local Codex/Claude-Code/Cursor
harness, and reported what he saw. This is that list turned into ordered work.

**Every row says whether the diagnosis is VERIFIED or still TO DIAGNOSE.** Three of the reported
symptoms are not what they look like, and building the obvious fix for those would make the product
worse. Those are called out first because they change what gets built.

---

## Three reports whose diagnosis inverts the fix

### 1. "It said the repository has been scanned" — while the footer said *no repo attached*

The screenshot shows `no repo attached` and `No graph yet`, and the answer says
*"answered from 300 of 1,743 edges"*. That reads as fabricated grounding, which would be the
product's first non-negotiable broken.

**It is not fabrication.** `1,743 edges` is the exact figure this monorepo's real graph produces —
the same number my own attached session reported minutes earlier, against the same server on 4173.
The engine's citation is true. **The CLIENT is stale:** that tab booted before the repo was
attached, `GET /api/status` and `GET /api/ai-config` are read once at boot, and nothing revalidates.
So the UI kept asserting a state the engine had already left.

Same root cause explains **"I can't see which model I have on, even though I clicked Granite"** —
the composer shows `Choose a model in Settings` from a boot-time read, while `~/.sequence/ai.json`
has held the granite config since 11:32.

`activeRoot()` throws `no repo attached` when `repoRoot` is null, so the engine cannot have answered
from nothing — which is what makes the stale-client reading the only one that fits.

> **TO DIAGNOSE (small):** confirm by reloading a stale tab and watching the footer correct itself.
> If it does not correct, the diagnosis is wrong and this becomes a much bigger row.

**Fix:** revalidate `status` and `ai-config` on focus/visibility change and after any attach, and
make the footer's "no repo attached" a *read* of engine state rather than a boot-time snapshot. A
surface that states a fact must keep it true or stop stating it.

### 2. The `####` and `**` in the answers — the renderer is right, the prompt is wrong

`src/chat/proseBlocks.ts` refuses headings, bold, and lists **deliberately**, and argues it well:

> `**` appears in globs, in diffs and in shell. A markdown bullet is `- ` and a diff removal line is
> `- ` just as often. This product's answers are full of diffs, so a list pass would turn deleted
> code into bullets — silently, and in the one surface whose job is fidelity.

That reasoning holds. Turning on a markdown renderer would trade ugly output for **wrong** output in
the one place fidelity is the product.

**So the defect is upstream: the model is emitting decorative markdown into a surface that has
promised not to interpret it.** Fix it at the prompt — instruct plain prose, short paragraphs, and
fenced code for anything structural (fences and inline code ARE rendered today). This also takes a
bite out of "the answers are very long".

**VERIFIED** by reading the renderer and its contract.

### 3. "There's nothing drawn on the board"

In the reported session the board could not draw anything: the client believed no repo was attached,
so there was no board to put a proposal on — the same staleness as row 1. The proposal chips
("Proposed architecture · Add rate limiter · 1 nodes") rendered in the transcript because that path
does not need the graph.

There is a second, independent problem in the same transcript, and this one is real:

```
Called propose_topology
refused: propose_topology edge "e2" endpoint "svc:api" is not present in the proposal or attached graph
```

That refusal is the grounding guard working — it is what stops a proposal inventing an endpoint.
But the model keeps producing dangling endpoints because **nothing tells it which node ids exist**.
A guard that refuses without teaching produces a loop where half of every proposal is discarded.

**Fix:** put the attached graph's node-id vocabulary in the tool schema description, and make the
refusal name the nearest valid ids. **TO DIAGNOSE:** re-run with a repo attached and count how many
proposals survive.

---

## Phase A — the client stops lying about the engine

| | row | why |
| --- | --- | --- |
| A1 | revalidate `status` / `ai-config` on focus and after attach | row 1 above |
| A2 | the model name is read state, not a boot snapshot | "I can't see which model I have on" |
| A3 | one live "attached to X" fact, sourced in one place | the footer and the board disagreed |

## Phase B — the answer surface

| | row | why |
| --- | --- | --- |
| B1 | prompt the model to plain prose + fences, never headings/bold/bullets | row 2 |
| B2 | length discipline in the prompt — answer first, detail on request | "designs are very long" |
| B3 | a real thinking/loading treatment while a turn streams | `data-streaming` already exists on `chat-prose`; it has no visible state |
| B4 | fold the tool trail inline rather than as a standalone block | "instead of having it be a standalone thing, because it can be confusing" |

## Phase C — the composer becomes the control surface

| | row | why |
| --- | --- | --- |
| C1 | `+` becomes the skills / tools module | "the plus is kind of your skills module" |
| C2 | Plan becomes a first-class toggle; Propose moves under `+` as a tool | `PERMISSION_MODES` is already `['plan','propose','autoEdit','full']` — plan exists, it is just not surfaced as the mode it is |
| C3 | slash commands (`/skills`, `/plan`) | `composerModel.ts:96` states outright: "this composer has no slash commands". This row REVERSES a written decision, so it needs a ruling, not just code |
| C4 | context-window meter, not just tokens spent | "I can see many tokens were used but can't see my context window" |

## Phase D — layout

| | row | why |
| --- | --- | --- |
| D1 | chat takes roughly half the page | "the chatbox should take up a bit more of the page, maybe around half" |
| D2 | chat minimizes, never closes — remove `shell-chat-close` as a close | "you just minimize chat. Chat shouldn't be able to close" |
| D3 | whiteboard reachable at all times, not only as a canvas tab | "there should be a whiteboard applicable and accessible at all times" |

D3 is partly built: `e2e/whiteboard-to-ask.mjs` (added today) proves draw → "Ask about this" → composer
works end to end, including that it never fires a run on its own. What is missing is *reachability* —
it lives behind a canvas tab, so it is unavailable while looking at anything else.

## Phase E — proposals reach the board

| | row | why |
| --- | --- | --- |
| E1 | give `propose_topology` the node-id vocabulary; make refusals name near misses | row 3 |
| E2 | confirm ghosts render on an attached board | blocked on A1 before it can even be judged |

## Not in this plan

- **Settings** — reported fine.
- **"More"** — reported fine, wants a few more hidden settings later. Not specified enough to build.

---

## Ordering

**A first, and alone.** Rows 1 and 3 of the diagnosis both reduce to it, and E2 cannot even be
judged until the client reports engine state truthfully. B1 is the cheapest visible win in the
programme — a prompt change that fixes both the markdown noise and part of the length complaint.
C3 needs a ruling before code, because it reverses a decision that is written down with reasons.

---

## Status, updated as it lands

| row | state |
| --- | --- |
| A1 revalidate on focus / after attach | **DONE** — `useBoot` re-asks when the tab returns and re-runs the ladder only if the answer moved. Covers unattached → attached; NOT attached → detached, because the boot surface unmounts once a board is drawn |
| A2 model name is read state | **DONE by A1** — `/api/ai-config` is fetched gated on attachment, so correcting the attach state is what makes the model label load |
| B1 stop the model emitting markdown the surface refuses | **DONE** — and it was a contradiction, not an omission: the prompt asked for "short bullets" while the renderer refuses bullets on purpose. Both ask paths carry the format clause now |
| B2 length discipline | **PARTLY** — "lead with the answer, stop when it is answered" is in the same clause. Whether that is enough is a judgement to make against real answers |
| E1 refusals that teach | **DONE** — a dangling endpoint now comes back with real ids, ranked by kind then by name: `endpoint "svc:api" is not present … ids that exist: svc:api-types, svc:analyzer, svc:gateway, svc:limiter (6 in all)` |
| A3, B3, B4, C1–C4, D1–D3, E2 | open |

**E2 is now judgeable.** It was blocked on A1: with the client reporting attach
state truthfully, whether a proposal draws on the board can finally be tested
rather than guessed at.


---

## Final status — 2026-08-24

| row | state |
| --- | --- |
| A1 revalidate on focus / after attach | **DONE** |
| A2 model name is read state | **DONE by A1** — `/api/ai-config` is fetched gated on attachment |
| A3 one live "attached to X" fact | **DONE** — `groundedRepoName()` is now one function. It had been the same expression written twice, under a comment warning that two answers in one frame "would be a bug nobody could see". A copy is not a selector |
| B1 stop the model emitting markdown the surface refuses | **DONE** — a contradiction, not an omission |
| B2 length discipline | **DONE** — "lead with the answer, stop when it is answered", in the same clause |
| B3 a loading treatment while a turn streams | **DONE** — a pulsing caret at the end of the text that exists, per 12.5's "a pulse says still true" |
| C1 `+` is the skills module | **DONE via C3** — `/` and `+` are two ways into ONE derived registry |
| C2 Plan a first-class toggle | **PARTLY** — see below |
| C3 slash commands | **DONE** — Decision 4 |
| C4 context-window meter | **DONE** — Ollama reports the real number; every other provider draws nothing |
| D2 chat minimises, never closes | **DONE** |
| D3 whiteboard reachable at all times | **DONE for reachability** — Ctrl+K, locked. It still takes the canvas when it opens |
| E1 refusals that teach | **DONE** |
| E2 proposals reach the board | **ALREADY COVERED** — `topologyReached.test.tsx` asserts the whole chain. It was blocked on A1, never on code |

### The three that need YOUR ruling, not more code

**D1 — the chat at half the page.** Measured: raising the default yields **424px at 1280**, a 32-pixel
gain, because the rail and the canvas floor own those pixels. Real half means raising `--pane-w-max`
above 640, and the canvas stops being exactly half — a property the substrate's three-column chassis
draws and two tests are named for. That trade is yours. One line plus a Decision once you say so.

**B4 — fold the tool trail inline.** `WorkRowLine` is sheeted (12.2, 12.3, 12.7): the verb is
rendered verbatim, the row does not rewrite itself, and 12.7 budgets the whole surface. Rearranging
it is a sheet change, so it needs a numbered decision rather than a patch.

**C2 — Plan as a first-class toggle.** The substance landed with Decision 4: `/plan` and `/propose`
now switch mode by name from the composer, and the slash registry derives from `PERMISSION_MODES`,
so the modes ARE in the skills surface. What is left is where the control sits visually.
`PermissionControl` is UNSHEETED — it appears zero times across all twelve sheets and §5.6 lists it
among the eleven surfaces the book never drew — so this is cheap to change the moment you say which
shape you want. Adding mode rows to the `+` menu is the one variant that is NOT free: sheet 12.4
draws that menu.
