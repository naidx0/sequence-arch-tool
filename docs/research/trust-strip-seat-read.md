# The trust strip, measured as a stranger — and why it is not a defect

**Measured 2026-09-05T23:15Z against the running app at `6ad90993`, 1280×820.** Raised because a
reader saw *"Sequence is reading sequence but not taking direction from it…"* above the composer on
every screen they opened, and asked whether it must appear on every turn.

## The four questions, answered

**What "Trust this repo" changes.** Three gates, all recorded in `server/repoTrust.ts`: the
repository's instruction file becomes binding standing orders in the prompt; `run_command` turns on
under the repo root; and the repo's own `.sequence/permissions.json` and `.sequence/ai.json` start
being honoured. Until then all three are off.

**What it is protecting against.** Two holes verified in the code before the boundary was built
(`docs/research/trust-boundary-verification.md`): attaching a repository used to be enough for its
`AGENTS.md` to become the assistant's standing orders on the first question, and `pnpm test` is not
a command but a lookup into a `package.json` the repository writes — so nothing hostile ever had to
appear in the command string. **Attaching was being treated as trusting.**

**Every turn, or once per repository?** Once per repository, and the decision is already remembered.
The strip renders only while `trust.root !== null && !trusted` (`state/connect.tsx:285`), and the
answer is stored per canonical root in the **user-level** store `~/.sequence/repo-trust.json` —
user-level precisely so a repository cannot mark itself trusted by committing a file.

So the reader's observation is explained without a defect: **this repository was genuinely untrusted
at the time of those reads.** `~/.sequence/repo-trust.json` records the decision made at **17:20**
today; the reads were at 15:51 and 16:12. The strip stopped on its own the moment the decision
existed, which is the behaviour asked about.

**What it costs, at 1280×820.**

| | px |
|---|---|
| the strip itself | **42** |
| transcript height with it | 564 |
| transcript height without it | 612 |
| **cost to the reply** | **48 px** (the strip plus a 6 px gap) |
| in lines, at the transcript's 16 px line-height | **3 lines** |
| share of the reading area | **7.8%** |

## The record already rules on it, so nothing was changed

**There is a dated owner ruling, not just a code comment.** `trust-boundary-verification.md` records
it verbatim, 2026-09-02 (relayed): close both security criticals *and* add an auto-approve autonomy
mode, **with a hard ordering constraint — auto-approve must not ship before the trust boundary
exists**, because "a hostile repository can run code as the owner the first time he attaches it;
auto-approve before the boundary turns that from dangerous into automatic and silent." The strip is
the visible half of the boundary that ruling requires to exist first. Removing or deferring it is
not a UI call.

The shape of the strip is ruled on separately, in the component's own header (`chat/TrustStrip.tsx:20`): it is *"a
NOTICE, not an interrogation"*, with three consequences — the composer stays fully usable beneath
because it is *"a strip, not a modal"*; **no warning hue**, because Graphite law 1 makes every hue a
claim and an untrusted repository is the ordinary case rather than a verdict about the code; and the
words say what is limited rather than what might happen, because *"its notes are not being followed
and commands are off"* is checkable while *"this repository could be dangerous"* is a mood.

The screenshot matches all three. The strip is two lines of neutral ink with two ghost buttons, and
the composer beneath it takes input.

**And the obvious change would break the thing the strip exists for.** Making it dismissible without
deciding would leave the three gates closed with nothing on screen saying so — a boundary the reader
cannot see, which is worse than no boundary, and which is the failure the whole module was written
against. 48 px is what an undecided decision costs while it is undecided; it is not a recurring tax.

**No change landed.** The measurement is the deliverable.

## The one thing worth a later look, stated and not acted on

The component's header attributes *"a boundary the reader cannot see is worse than no boundary"* to
`docs/vision.md` §5. §5 is the correctness-invariant list — grounded analysis, no silent data loss,
honest AI errors — and it carries that idea in spirit but not in those words. The comment's argument
is sound and its citation is loose. Not worth a commit on its own; worth fixing the next time that
file is opened for another reason.
