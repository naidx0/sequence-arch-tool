# Owner review, second pass — the plan

Max ran the app against the MLH repository and reported. This is that report turned into ordered
work. Findings marked **DIAGNOSED** were reproduced in the code before this file was written;
the rest are taken at face value and say so.

---

## T1 — broken, and blocking the product's own claim

### 1.1 Drawing on the architecture board shows nothing — **DIAGNOSED**

> "drawing on the actual architecture board doesn't work. On the whiteboard, it works fine."

`Board.tsx:StrokeLayer` is an `<svg className="strokelayer" …/>` **with no children**. It records
`clientX/clientY` on pointer move and renders no ink whatsoever. On pointer-up the stroke IS
recognised and can become a real edge — so it is not inert — but from the reader's seat you drag
across the board, nothing appears under the cursor, and the feature is dead.

The whiteboard does it correctly two files away: it renders a live `draftPath` while the pointer is
down (`Whiteboard.tsx:563`) and persists each stroke as a `<path>`.

**Fix:** render the in-progress stroke, and show what the recogniser made of it. Same idiom as the
whiteboard so the two surfaces do not teach different lessons.

### 1.2 Nothing reaches the board, because the model never calls the tool — **DIAGNOSED TWICE**

Max asked *"show me a change on the board you might offer"* and got an essay proposing a
"DecisionPoint" node type — as documentation advice, with nothing drawn.

The benchmark says the same thing independently. `tools/bench/weak-model.mjs` against
granite-4b on a hard task:

```
TOOLS      0 calls, 0 REFUSED
TOPOLOGY   0 proposal(s) reached the board
```

Two runs, two different tasks, zero tool calls. `ASK_ATTACHED_PROPOSAL_DIRECTIVE` fires only "when
the user asks to add topology nodes or edges", and a weak model does not classify "show me a change
on the board" as that. **This is the single biggest functional gap in the product**: the board is
the thing Sequence is for, and the assistant does not put anything on it.

**Fix:** make `propose_topology` the obvious move — widen the trigger, name the tool in the
answer-shape instruction, and give the model the node-id vocabulary up front rather than only in a
refusal. Measurable: re-run the bench and count proposals that survive.

### 1.3 There is no way out of a repository — **DIAGNOSED**

> "how do I exit the project? That's a very simple one."

There is none. A new session starts in the same repo. `POST /api/detach` **already exists, is
tested, and no client has ever called it** — it is one of the 21 GAP routes.

**Fix:** wire it. A command, and a way back to the unattached state.

### 1.4 The model still emits markdown the transcript refuses

The pasted answer is full of `###` and `**`. The format clause shipped earlier today and the same
build is running (his context meter reads `27,640 of 1,048,576`, which only exists in that build) —
so the clause is present and granite ignored it. A prompt instruction alone is not enough for a weak
model.

**Fix:** stop treating it as advisory. Either strip the decoration on the way out, or render the
subset the model insists on producing. Decide with a measurement, not a preference.

---

## T2 — the shape of the app

> "when you open the app, it's like Claude Code or Codex. You open it in the middle of your screen,
> and you see a chat box. We see an architecture board on the right. If there's no architecture
> board … it'll open to the whiteboard. The chat box is still your main form of communication. After
> you ask the chat box something, I can map it onto the board … You can see old sessions in the left
> sidebar. Simple settings, bottom left."

This is a different frame from the one the substrate draws (chat LEFT, one canvas CENTRE, index rail
RIGHT). It is the owner's call and it overrides the book — but it is a **numbered decision**, not a
patch, because `_core.html`'s `.win` chassis is what every surface is built against.

| | row |
| --- | --- |
| 2.1 | Chat centre, board right, sessions in a LEFT sidebar, settings bottom-left |
| 2.2 | No board yet → open on the whiteboard, ready to draw |
| 2.3 | Asking a question can map the answer onto the board; board and chat side by side |

**Sequencing note:** 2.1 moves three panes at once. It should land as one change with the e2e
geometry suites rewritten in the same commit, or the shell will be half-moved and nothing will hold
it.

---

## T3 — the things called "very important"

| | row | why |
| --- | --- | --- |
| 3.1 | Whiteboard toolbar becomes ICONS, not words | "Some of the buttons are very similar … I like using icons more than text, very important." Ten of fourteen controls are currently words |
| 3.2 | An ARROW tool on the whiteboard | asked for directly; the board has directed edges and the whiteboard has only a plain line |
| 3.3 | The running/loading treatment | "the on-screen animations where it says loading tools and so on are really off." The caret shipped today; the TOOL ROWS are what he is describing |
| 3.4 | An expanded work row "design's really off" | needs a look with real content, not a fixture |
| 3.5 | Context read-out in Codex's exact format | he liked seeing used-of-total; wants the same shape |

---

## T4 — bigger, and worth doing properly

| | row | note |
| --- | --- | --- |
| 4.1 | **Skills** — a real registry | `/` exists and reaches eight built-ins. A user-defined skill has no definition, no storage and no loader. This is a design question first |
| 4.2 | Modes vs tools, told apart | Owner: auto-edit / full access / propose are MODES; plan and break-it-down are TOOLS. "Plan is first class. Propose is first class." Plan carries more research; Propose is minimal |
| 4.3 | Agents that work *well* | "make sure agents work, not just work, but really well." Also "Run: I don't really understand at the moment" — the surface does not say what it is for |
| 4.4 | File-to-file relationships on the board | "it didn't show how the files are connected or which file communicates or calls another one." The function graph is built; the board does not draw calls |
| 4.5 | The MLH board "looks a little dry" | worth a look once 4.4 lands — it may be the same gap |

---

## Order

**T1 first, in the order written.** 1.1 is a visible dead feature, 1.2 is the product's central
claim not firing, 1.3 is a one-route fix for a real trap. T3.1/3.2 are cheap and were called very
important, so they ride along. T2 is one deliberate change with a decision attached. T4 needs
rulings before code.


---

## T1.2, measured — and the prompt was NOT the lever

The trigger was widened and the real node ids are now handed over before the model can invent one.
Both are defensible on their own terms. **Neither changed the outcome.**

```
before   TOOLS 0 calls, 0 REFUSED   TOPOLOGY 0 proposal(s) reached the board
after    TOOLS 0 calls, 0 REFUSED   TOPOLOGY 0 proposal(s) reached the board
```

**And I over-claimed when I called it "confirmed twice".** Chasing it properly:

- Nothing in production supplies a structured `toolRequests` channel. Both the app and the CLI get
  tool calls from one place — a ```sequence-tool fence the model writes by hand.
- The hint that teaches that fence is rendered for the benchmark's mode, and it already carries a
  **full worked example** for `propose_topology`: correct arg shape, node kinds, edge families, and
  the evidenceRef rule.
- So the model had everything it needed on both runs and chose prose anyway.

Meanwhile the app **does** call it — the owner's own earlier transcripts show
`Called propose_topology · proposed 1 node, 1 edge — Add rate limiter`, twice, and a third call
refused for a dangling endpoint. So this is not a broken wire. It is model behaviour that varies by
question, and a broad "add security and CI/CD" prompt is one where a weak model writes an essay.

**Which moves the fix.** Hoping the model picks the tool is not a mechanism. The lever is to make
"show me this on the board" a **deterministic act the product takes**, not a decision the model may
decline — the same argument the repo already made when it moved proposals off a ```seqd fence and
onto a tool call, and the same shape as the board's Generate gate. That is a design change, and it
is the honest next step rather than another prompt adjustment.


---

## Status

| row | state |
| --- | --- |
| 1.1 board drawing shows nothing | **DONE** — and it exposed a second bug: the edge path threw where `elementFromPoint` is absent |
| 1.2 nothing reaches the board | **CHANGED, DID NOT WORK** — see the section above. The lever is a deterministic act, not a prompt |
| 1.3 no way out of a repository | **DONE** — `/api/detach` wired, its register row deleted, 20 GAP routes left |
| 1.4 markdown still emitted | open — needs the measurement, not a preference |
| 3.1 icons on the whiteboard | **DONE for six of ten.** The book has no oval/text/link/eraser symbol; those stay words |
| 3.2 arrow tool | **DONE** |
| 2.x the app's shape | needs a numbered decision — it overrides the substrate's chassis |
| 3.3 loading treatment · 3.4 expanded work row | **BLOCKED ON EYES.** "really off" is a visual judgement and the browser pane cannot screenshot here |
| 3.5 Codex's exact context view | **BLOCKED ON A REFERENCE.** Used-of-total already ships; copying Codex's shape needs to see Codex's shape |
| 4.x skills, modes vs tools, agents, call graph | rulings first |

### What is worth knowing before the next round

**The icon vocabulary is 40% transcribed.** The book defines 70 symbols; the code exposed 28. That
single fact explains most of "the buttons are very similar" — including `ic-skill`, which the skills
work will want, and `ic-newthread`, `ic-panelleft`, `ic-sliders`, `ic-gear`, which the T2 shape will.
Transcribing is mechanical and needs no decision.

**Three things now need you rather than more code:** the app's shape (2.x), a look at the loading
and expanded-row design (3.3/3.4), and a reference for the context read-out (3.5).
