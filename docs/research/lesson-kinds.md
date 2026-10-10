# Lesson kinds — the contract, and the first experiment

**One page, written 2026-09-05 after the derived visual worked on code. Nothing here is built. The
seat read on `/api/ask/stream` comes first and this waits behind it.**

## What actually generalises, stated precisely

The thing that worked tonight was not "draw a picture". It was:

> **The product derives the visual from a structure it can check, and the model writes the sentence
> beside it.**

Fourteen runs said the model does not draw — 182 of 188 turns attempted no visual in any form — and
three belts and a length control failed to change that. Moving the *decision* out of the prompt took
the substantive visual from 0/23 and 0/25 to 14/21 and 20/26. The decision moved; the drawing was
never the hard part.

## What does NOT generalise, and this is the crux

For code the structure is the **scanned graph**, and the product can do something it cannot do
anywhere else: **refuse**. `buildConceptChart` draws nothing for a concept with no node, and
`validateChart` refuses an arrow between two real nodes the scan does not connect. The picture is
true because it was checked against an artifact that exists independently of the model.

**A subject with no scanned artifact has nothing to check against.** For "teach me about
polynomials" the structure comes from the model's own statement, so the product can render it
faithfully and still render a false claim. The guarantee changes category:

| kind | structure | guarantee |
|---|---|---|
| **code** | the scanned graph | **grounded** — checked against the repository, refused when it disagrees |
| **math** | an expression the model states | **faithful** — the plot cannot lie about the expression, but the expression is the model's claim |
| **science** | a model the model names | **faithful, and only as good as the named model** |

Any kind beyond code ships a weaker promise, and the product must say which promise it is making.
That is not a caveat to add later: grounded-not-guessed is a product law in `docs/CANON.md`, and a
kind that silently degrades it spends the one thing this product has.

## The kinds

| | code | math | science |
|---|---|---|---|
| visual derives from | concept, node, one-hop neighbours, direction preserved | a stated expression, parsed and plotted; or a stated proof step | a named model rendered as a labelled diagram |
| a check-in is | predict which component is called next, graded against the graph | solve one instance and predict the result, graded by evaluating the expression | predict what the model implies, graded against the model as stated |
| the model MAY author | the concept, the sentence, the choice of node | the expression, the interval, the question | the model, its parts, the question |
| the model MAY NOT author | any node or edge the scan does not have | the plotted points, which the product evaluates | the rendered geometry |
| what refuses | a concept naming no node; an edge that does not exist | an expression that does not parse; a domain that does not evaluate | a model with no stated parts |

The last two rows are the whole contract: **the model names a structure; the product renders it
mechanically and refuses what it cannot render.** The model never hands over pixels.

## Classification

Deterministic where possible, and biased toward code:

1. **A repository is attached and the ask names anything in it, then `code` by construction.** No
   classifier runs. This is the case the product exists for and the one with the strong guarantee.
2. **A repository is attached and the ask names nothing in it**, still `code`; the lesson may end up
   with no chartable concept, which the existing refusal already handles honestly.
3. **No repository attached**, classify, and only here. One cheap call, or a keyword prior if that
   proves sufficient.

A misclassification must fail toward `code` or toward no visual, never toward a confident diagram of
a subject nobody checked.

## The first kind, and the measurement gap that has to close first

**Build `math`, function-plot only** — one expression, one interval, evaluated by the product. It is
the smallest kind that tests whether the principle survives losing the scanned artifact, and a plot
is mechanically checkable in a way a science diagram is not.

**But the bench cannot measure it yet, and that is the first finding of this page.** Every math
conversation in the bank, `math-01` to `math-06`, is *"teach me the math as used in this repo"*,
attached to `makemore` with a document. Measured just now, they already carry visuals at **8 of 13**
in the derived-visual runs against **0 of 13** before, because the derived CODE chart is firing for
them. Registering a math-kind prediction against those conversations would credit the new kind with a
gain the code path already produced — the same contamination that made the `[4, 12]` chart-call range
unusable this morning.

**So the experiment needs a new bench condition first:** N subject-only asks with **no repository
attached**, whose baseline today is necessarily **0 visuals of N**, because with no graph
`buildConceptChart` returns nothing, which the existing code correctly does.

**Registered prediction, to be read only against that new condition:** with the math kind in, the
substantive visual on no-repo subject asks rises above 0 on both of two runs, and no visual appears
on a turn whose expression did not parse. **Refuted** if the visual stays at 0 on either run, or if
any plotted visual carries points the product did not evaluate.

## What would kill this before it is built

- **The no-repo condition shows the model does not state a plottable expression.** Then the structure
  it is supposed to name never arrives, and no rendering work helps.
- **A plotted lesson reads worse than prose at the seat.** The code chart has not been looked at on a
  screen yet either; if the derived picture turns out to be noise there, this direction is premature
  and the honest move is to fix the code kind first.

## Scope note, recorded because it is a real risk

Sequence teaches a repository. A math kind is defensible as *the mathematics inside the code a person
is reading*, which is what every bench math conversation actually is. A general-subject tutor is a
different product, and this page does not argue for one. It argues for what happens when an ask has
no structure the product can check, and for saying so plainly rather than drawing anyway.

## Hold on launch material

No launch material, site or video until a real user's Teach turn on `/api/ask/stream` completes with
a derived chart **on screen**. That has not happened: the route only got lesson state at `df8a2f23`
and the seat read is still unrun.

---

# The math kind, built — grammar coverage, and what the dry run found

**Built 2026-09-05, dry-run against a canned provider. No card time spent. Not yet run on the
bench.**

## The grammar, counted the way the queue matcher was

| corpus | parsed | refused | **wrong** |
|---|---|---|---|
| 21 expressions a learner types | **21** | 0 | **0** |
| 7 things that are not expressions | — | **7** | 0 |
| **the twenty subject asks** | **0** | **20** | 0 |

**`wrong` is the column that matters** — a refusal draws nothing and says why; a wrong parse plots a
confident curve of a function nobody wrote. It was not zero at first: unary minus sat inside the
power rule, so **`-x^2` parsed as `(-x)^2` and gave +4 at x = 2**. It parsed, it plotted, and only
counting `wrong` separately from `refused` found it.

**0 of 20 on the subject asks is the honest headline and not a failure.** The corpus is prose
questions — *"Teach me about polynomials"* — and none names an expression. The kind fires on an
expression **the model states**, which is what the contract says and what the card run will measure.
It does mean the registered prediction rests entirely on model behaviour: if the model never writes
`y = x^2 - 3x + 2`, nothing is drawn and the prediction is refuted for a reason that has nothing to
do with plotting.

## What the dry run found, none of it visible without running it

- **The plot failed the product's own validator.** 41 points against `validateChart`'s 40-item cap.
  **The cap was not raised to fit the plot — the plot was made to fit the cap**, because a validator
  the product can talk its way around is not a validator.
- **The labels lied slightly.** At 39 points the step was 0.263… and x labels were rounded to two
  places, so a reader recomputing y from the x on the screen disagreed with the plotted y by up to
  **0.044**. Now 21 points, step exactly 0.5, and every plotted value is exactly the value of its own
  label — asserted, not assumed.

## The promise, said on every chart

> *"Plotted from x^2 - 3x + 2 as written. The points are computed here, so the curve is faithful to
> the expression; whether the expression is the right one is the lesson's claim, not the picture's."*

The caption is tested to say **faithful** and tested **not** to say *scanned graph*. That is the
whole distinction the contract draws, and a kind that borrowed the code chart's authority would
spend the one thing this product has.

## The check-in

Derived from the curve rather than the code: a zero crossing when there is one, growth otherwise.
Graded by the same honest grader and it comes out **prediction**, the shape the contract wants.

## The product's own example, so the kind does not rest on the model's habit

The math kind as first built fired only on an expression **the model stated**, and **0 of the 20
subject asks name one**. So the whole kind depended on whether a 4B-class model happens to write
`y = x^2 - 3x + 2` — the prompt-side dependence every belt arm of this night failed to remove.

A topic now maps to one canonical example, chosen by the product. **Eight rows, and the twenty asks
decided them.**

| counted on the twenty subject asks | |
|---|---|
| **mapped to a row** | **8** |
| **refused** | **12** |
| **wrong** (a chart that fails the validator or its own arithmetic) | **0** |

The eight: polynomials, derivative-as-a-limit, logarithm, completing the square, continuity,
dividing by zero, gradient descent, loss function. The twelve refused have no curve — mean versus
median, precision and recall, hash tables, race conditions — and **drawing one for them would be
inventing a picture for a subject that has none.**

### Why eight rows is not fabrication

**The caption says who chose it, and says the reader did not:**

> *"an example quadratic, chosen by Sequence to show the shape — you did not ask for this particular
> one. The points are computed here, so the curve is faithful to x^2 - 3x + 2; the lesson beside it
> is the model's."*

That is a textbook choosing which parabola to draw. What *would* be fabrication is presenting it as
though the learner or the model had named it, and the caption is tested to refuse exactly that. A
model-stated expression still wins where there is one, with its own caption — two promises, two
captions, and no path where one is quietly served as the other.

### Two things reading the eight mappings found

- **Continuity was mapped to `abs(x)`, labelled "a function with a corner" — and `abs(x)` is
  continuous everywhere.** A learner asking what makes a function continuous could read the corner as
  the thing that breaks it, which is the opposite of the lesson. It is `1/x` now: continuity taught
  by its failure, which is where the concept is visible. **Found by reading the mappings, not by a
  test failing.**
- **The extractor refused an expression a lesson would actually write.** *"Consider y = x^3 - 3x,
  which has two turning points"* carried the clause after the comma into the candidate and failed to
  parse. Commas split now, which is safe because no expression in this grammar contains one.
