# Owner references — what "good" looks like, and where the ideas came from

Context Max handed over on 2026-08-21, recorded here so it can be cited rather than remembered.
Nothing on this page is a decision; decisions live in [`CANON.md`](CANON.md) and the rulings in
[`brand/GRAPHITE-DECISIONS.md`](brand/GRAPHITE-DECISIONS.md). This is the evidence behind them.

---

## 1. Coding Canvas — the visual and structural reference

`https://coding-canvas-demo.vercel.app/` — a live architecture canvas OF Codex itself. Read in the
browser on 2026-08-21; everything below is from the rendered page, not from a description of it.

**What it is:** ~30 nodes on a dark canvas (`oklch(0.16 0.004 260)`, Inter), 265 SVG edge paths,
grouped into three bands — **SESSION CORE**, **SAFETY**, **TOOL PIPELINE** — with a `PULL REQUESTS`
panel and an `Ask or instruct… [cmd K]` composer.

### THE LEVELS — and Max's ruling on them

The canvas offers three **semantic layers** of the same system:

| | layer | Max |
| --- | --- | --- |
| **L1** | Business | **not wanted** |
| **L2** | **Systems** | **this is the one.** *"I just like the systems aspect of it, and I think that looks really good throughout the whole thing."* |
| **L3** | Contracts | **not wanted** |

> *"i dont think im a fan — in the last build i had them pretty much taken out, since the only
> levels that worked good was L3 systems, so i think we harness that aspect and keep it like that
> as is."*

He named it "L3" and the canvas labels Systems as L2; the intent is unambiguous because the same
message says *"I don't like the contacts, contracts, business."* **Sequence draws the SYSTEMS layer
and only the systems layer.**

**This is NOT the same thing as containment depth or the LOD rungs**, and an earlier draft of
`BUILD-PLAN.md` conflated it with the first. Three distinct ideas, kept apart:

1. **Semantic layer** — Business / Systems / Contracts. *Ruled: Systems only.*
2. **Containment depth** — boxes nested inside boxes (Wave 6). *Cut, on separate reasoning: the
   module level is currently mislabelled, and the rail already drills down.*
3. **LOD rungs** — zoom-driven rendering detail in `packages/web2/src/canvas/lod.ts`. *Kept.*

### THE NATIVE ENGLISH — the bar our `whatItIs` does not clear

Max: *"their services and their flows and their native English was really awesome to look at."*
This is the specific thing to steal, and it lands on a field we have already measured as empty.

Every node carries a one-line description that says what the thing IS:

| node | its line |
| --- | --- |
| CLI Entry | *codex and its subcommand router* |
| Interactive TUI | *The default full-screen session* |
| `codex exec` | *Non-interactive one-shot runs* |
| Compactor | *Summarizes history under pressure* |
| Guardian | *Reviews risky commands* |
| Turn Loop | *One request through reasoning and tools* |
| File Search | *Fuzzy search and coalesced watch events* |
| Exec Policy | *Allow, prompt, or forbid decisions* |

And several EDGES carry a sentence about the relationship — which we do not do at all:

- *A final response closes the active task.*
- *Agent names come from `agent_names.txt`.*
- *Process output streams back to the caller.*
- *Watch bursts emit at most once per interval.*
- *Prefix rules classify each command.*

**Measured against ours:** on ml-harness, of 300 `whatItIs` summaries, **293 were an exact echo of
the label** (`db.py` → "db.py"), 7 re-cased it ("tests" → "Tests"), and **none said anything new**.
The field the card renders as its one line of summary carries zero information on a real
repository. The reference is what that field is for.

### Node kinds — theirs and ours

Theirs: **Entry · Agent · Model · Tool · Service · Store**.
Ours (GRAPHITE-DECISIONS Decision 2): service · module · datastore · topic · agent · entry.

Close enough to be worth noting: they have **Model** and **Tool** as first-class kinds and we do
not, and we have **module** and **topic** and they do not. Their set is agent-shaped; ours is
deployment-shaped. Not a decision — an observation for when the kind list is next revisited.

### The directory lineage

Max: *"I like the directory world more, but just as a reference point to where it originally came
from and the index ideas and so on."* Recorded as provenance for the rail's index, not as a target.

---

## 2. The architect-agent thread — the sharpest statement of our thesis so far

A public thread Max forwarded, *"why is no one building an architect agent?"*, with replies that
are better articulated than anything currently in CANON.

**The hook:**
> *"the killer feature would be an agent that looks at your architecture and says: 'you have 12
> users. you do not need Kubernetes.' We don't need more code. We need an AI willing to tell us no."*

**The strongest objection, and it is correct:**
> *"infrastructure decisions require knowing what the product will become, not just what it is now.
> A coding agent can be right about today. An architect agent has to be right about six months from
> now. That's a much harder target to hit without the human in the loop."*

**The reply that is our product, almost verbatim:**
> *"The opportunity is less 'draw an architecture' and more **keep architecture honest as the code
> changes**: constraints, cost estimates, threat models, migration paths, and checks that detect
> drift from the intended design."*

### Why this matters to the plan

The objection dissolves the moment you stop predicting. *"Right about six months from now"* is a
forecast and we would lose that bet. **"Keep architecture honest as the code changes" is a
measurement**, and it is the one thing a parsed graph with `file:line` can do that an LLM-authored
map structurally cannot.

That sentence maps onto work already ranked in [`BUILD-PLAN.md`](BUILD-PLAN.md):

| the thread's words | ours |
| --- | --- |
| *checks that detect drift from the intended design* | Phase 6 — the fitness gate over two real scans, with `.sequence/policy-baseline.json` as the ratchet |
| *keep it honest as the code changes* | Phase 5 — the lie detector: a post-edit rescan that checks the CLAIM |
| *constraints* | `packages/schema/src/policy.ts` — three committed rule kinds, already shipped |
| *migration paths* | Phase 4 — paths with a witness |
| *an AI willing to tell us no* | already the posture: *agents propose, code decides, no model judges a model* |
| *cost estimates, threat models* | **not ours.** No grounding for either. Do not claim them. |

**ADOPTED, 2026-08-21.** Put to Max as a positioning change rather than made unilaterally, and he
ruled *"yes — make it the headline."* CANON §1 now opens with **"Sequence keeps your architecture
honest as the code changes."** The old line — *"a local-first, visual-first AI code editor"* —
described the shape; this one describes the job, and visual-first becomes the *how*.

It also reorders what counts as core: Phases 5 and 6 (the lie detector, the drift gate) stop being
late additions and become the thing the headline promises.

---

## 3. Ontology — noted, not scoped

Max: *"I don't know how relevant it is to what we're building at all, but ontology. I just overall
like how ontology works on all that and how we can track it."*

Recorded honestly as an interest without a decision. The nearest thing we already have is the kind
system in Decision 2 (six kinds, four non-chromatic channels) and `packages/schema`'s node/edge
vocabulary — a small fixed ontology, deliberately closed. The open question, unanswered: whether a
user should be able to extend it for their own repo, or whether a closed vocabulary is exactly what
makes the board readable. **No work is scheduled from this line.**

---

## 4. The editing model — owner ruling, 2026-08-21

Asked whether "editing" meant editing the diagram so it proposes code, or sketching only, Max
described a third thing that is better than either option offered. Recorded close to verbatim,
because the mechanism is the part that matters.

**The mechanism first, and it is the whole reason this is tractable:**

> *"The thing I tried to do was create this platform, or this drawing architecture, which is
> `.seqd`, which is JSON native, which is also text the LLM can comprehend and understand: how that
> text is written, the architecture behind the text."*

`.seqd` is JSON. A diagram is therefore **text a model can read and write directly** — so "edit the
diagram with AI" is not a special visual capability that has to be invented, it is the model doing
the thing it is already good at, over a format we already validate
(`packages/schema/src/seqdiagram.ts`, `validateSeqDiagram`). The canvas is a view of that text.

**The loop he described:**

1. Edit through the agent chat box.
2. Or draw on the diagram directly — *"say you want to draw a new service, and you draw a new
   service in the shopfront called Franchise Store 1."*
3. **Click Generate.** The AI may pop a tool asking questions about it, or ask for a description of
   what you want built in it.
4. Either auto-generate the description and hand it back as a note, **or** let a strong architect
   scaffold it themselves — *"create the systems they want, not just by prompting."*
5. The AI reads what the human built and **why they built it that way**.
6. It may ask whether they want a better version, if one exists.
7. It understands what the user wrote.

**THE GATE, and it is the sharpest constraint here:**

> *"you can do agentic coding with drawing, editing the diagram, and proposing code as well, **but
> not at every junction**. If somebody does something, it doesn't automatically have to propose
> code."*

Drawing a box must NOT fire a code proposal. Generate is an explicit act with a confirmation step.
This is the difference between a canvas that thinks with you and one that panics at every stroke,
and it is the rule any implementation of steps 2-3 must hold.

**Not "sketch only" and not "auto-propose".** Free drawing is real editing of a real artifact
(`.seqd`), and code proposal is a separate, deliberate, confirmable step downstream of it.

### What this changes in the plan

The heavy part was never the drawing — `packages/ink` already has stroke recognition with passing
tests and nothing imports it. The heavy part is steps 5 and 6: reading intent out of what a human
drew. That needs the diagram to be a first-class text artifact (it is), and it needs the canvas
reducer to have create / rename / delete at all (**it does not** — the reducer is layout-only, which
is outstanding item 17).
