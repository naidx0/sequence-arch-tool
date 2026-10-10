# The modes, as the product actually has them

An input for the trysequence.app design copy. Every line marked **CODE** was
read out of the source at the file and line named; every line marked
**INFERRED** is my suggestion for copy and is *not* a fact about the product —
it is the part a designer or the owner should feel free to rewrite. The split
is explicit because the failure this repository keeps paying for is a surface
asserting something the engine never supplied, and marketing copy is a surface.

Read at `d9fd9ed6`, branch `site/redesign-v2`.

---

## The finding that matters most: there are FOUR modes, not five

The menu shows five rows. Four of them are the permission mode; the fifth is a
separate flag that happens to live in the same menu.

```
packages/web2/src/state/types.ts:908
export type PermissionMode = 'plan' | 'propose' | 'autoEdit' | 'full';
```

Teach is not in that union. It travels on the wire as its own boolean
(`askPipeline.ts:526` — `teach?: boolean`), and the control's own comment says
why, quoting the owner:

> `packages/web2/src/chat/PermissionControl.tsx:88`
> "TEACH IS A ROW IN THIS MENU, NOT A SECOND CONTROL. Owner, 2026-09-02: 'The
> teach mode should be part of the same thing as a proposed plan. Auto-edit,
> full access should just be another mode.'" … "On the wire it stays the
> `teach` flag, never a PermissionMode: the server reads `permission` and
> `teach` separately and teach refuses every mutating tool on its own, so no
> permission value has to change for it."

**Consequence for the page.** A five-tab switcher is fine as a *control* — that
is exactly what the product ships. Copy that calls Teach "a mode" alongside the
other four is describing the menu, not the system. Teach is orthogonal: it can
be on while the permission underneath it is any of the four, and it independently
refuses every mutating tool. If the design needs one sentence for this, the
product's own is: **one menu, one question — what will this turn be allowed to
do?**

---

## The five rows

Label and one-liner are **CODE**, verbatim from
`packages/web2/src/chat/PermissionControl.tsx` (`PERMISSION_MODES`, and
`TEACH_ROW` at line 102). Do not paraphrase them on the page: they are the words
the user reads inside the product, and two different sentences for one control
is how a page stops describing its own software.

### Teach — *a flag, not a mode*
- **CODE** one-liner: "One concept per turn, drawn on the board. Reads only."
- **CODE** writes nothing: `askPipeline.ts:669` refuses every
  `ASK_MUTATING_TOOLS` call on a teach turn — `propose_files`, `edit_file`,
  `propose_topology`, `run_command` — "whatever the permission mode says"
  (`askTools.ts:214`).
- **CODE** what it draws: the only mode that emits `teach:step`
  (`askPipeline.ts:894`, gated on `sink.input.teach === true`). The event
  carries a caption and `litNodeIds` the chart validated against the scanned
  graph; the board intersects those with what it actually paints and dims the
  rest. If nothing it names is on the board, the board is left alone.
- **INFERRED** who it is for: someone who has to own a codebase they did not
  write — joining a team, inheriting a service, or handing one over.

### Plan
- **CODE** one-liner: "Reads only. Ends in a written plan."
- **CODE** writes nothing: `askPipeline.ts:669` refuses mutating tools for
  `permission === 'plan'` on the same line that refuses them for teach.
- **CODE** what it draws: nothing of its own. It reads the board; it does not
  add to it.
- **INFERRED** who it is for: deciding what to do, and in what order, before
  anything moves.

### Propose
- **CODE** one-liner: "Changes arrive as proposals you accept."
- **CODE** does not auto-write: `applyAskFileWrites.ts:155` —
  `permissionAutoWrites` is true only for `autoEdit` and `full`.
- **CODE** what it draws: file proposals land in Review as diffs awaiting a
  decision (`edit:proposal`, `applied: false`).
- **INFERRED** who it is for: ordinary work, where you stay the editor.

### Auto-edit
- **CODE** one-liner: "Writes files without asking."
- **CODE** auto-writes: `permissionAutoWrites('autoEdit') === true`.
- **CODE** cannot run commands: `askPipeline.ts:670` — `run_command` is refused
  unless `permission === 'full'`.
- **INFERRED** who it is for: a mechanical sweep already scoped, where reading
  each diff is the slow part.

### Full access
- **CODE** one-liner: "Writes files and runs commands without asking."
- **CODE** the only mode that may run commands (`askPipeline.ts:670`), and the
  only one that reaches the repo-root write path (`askPipeline.ts:860`).
- **INFERRED** who it is for: a machine you are willing to lose — a container, a
  sandbox, a throwaway checkout.

---

## Two more things the copy should not get wrong

**The mode is not the only thing that draws.** `lookup:located` is emitted
whenever `locate_symbol` resolves, in every mode including teach
(`askPipeline.ts`, unconditional) — a symbol lookup lights the part of the board
that holds the declaration and says nothing else. So "only Teach draws" would be
false.

**Teach's refusal is its own, not the permission's.** `mutatingToolRefusal`
(`askPipeline.ts:1600`) takes `teach` as a separate argument from the permission
mode, because the two refusals have different reasons and the message says which
one refused. Copy implying Teach is "Plan with drawings" would be wrong: Plan
ends in prose, Teach ends in a chart, and neither inherits the other's rule.
