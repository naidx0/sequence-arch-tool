/**
 * THE MATH KIND: a function plot the product computes, not one the model draws.
 *
 * docs/research/lesson-kinds.md sets the rule this file implements: the model
 * names a structure, the product renders it mechanically and refuses what it
 * cannot render, and the model never hands over pixels.
 *
 * THE PROMISE IS DIFFERENT HERE, AND IT IS SAID OUT LOUD.
 *
 * A code chart is GROUNDED: every node and edge is checked against a scanned
 * graph that exists independently of the model, and validateChart refuses
 * anything invented. A plot cannot be grounded, because there is no artifact to
 * check. What it can be is FAITHFUL: the points are evaluated here, so the
 * curve cannot lie about the expression — but the expression is the model's
 * claim, and if it names the wrong function the picture is a faithful drawing
 * of a wrong claim.
 *
 * Every caption therefore says which promise it is making. A kind that inherits
 * "grounded" by association spends the one thing this product has.
 */
import type { SeqChart } from '@sequence/schema';

/*
 * THE GRAMMAR: deliberately small, and hand-written rather than a regex. One
 * variable, the arithmetic a person types, and a closed list of named
 * functions. Anything else is REFUSED, which is the half that matters — a
 * parser that guesses produces a confident plot of something nobody asked for.
 */
type Node =
  | { t: 'num'; v: number }
  | { t: 'var' }
  | { t: 'neg'; a: Node }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { t: 'call'; name: keyof typeof FUNCTIONS; a: Node };

const FUNCTIONS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  exp: Math.exp,
  log: Math.log,
  sqrt: Math.sqrt,
  abs: Math.abs,
} as const;

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isAlpha = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');

function tokenize(src: string): string[] | undefined {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ') {
      i += 1;
      continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && (isDigit(src[j]!) || src[j] === '.')) j += 1;
      out.push(src.slice(i, j));
      i = j;
      continue;
    }
    if (isAlpha(c)) {
      let j = i;
      while (j < src.length && isAlpha(src[j]!)) j += 1;
      out.push(src.slice(i, j).toLowerCase());
      i = j;
      continue;
    }
    if ('+-*/^()'.includes(c)) {
      out.push(c);
      i += 1;
      continue;
    }
    /* An unknown character is a REFUSAL, not something to skip past: skipping
       is how a parser ends up plotting half an expression. */
    return undefined;
  }
  return out.length > 0 ? out : undefined;
}

export function parseExpression(src: string): Node | undefined {
  const tokens = tokenize(src);
  if (tokens === undefined) return undefined;
  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  const eat = (t: string): boolean => {
    if (tokens[pos] !== t) return false;
    pos += 1;
    return true;
  };

  const atom = (): Node | undefined => {
    const t = peek();
    if (t === undefined) return undefined;
    if (eat('(')) {
      const inner = expr();
      if (inner === undefined || !eat(')')) return undefined;
      return inner;
    }
    if (isDigit(t[0]!) || t[0] === '.') {
      pos += 1;
      const v = Number(t);
      return Number.isFinite(v) ? { t: 'num', v } : undefined;
    }
    if (isAlpha(t[0]!)) {
      pos += 1;
      if (t === 'x') return { t: 'var' };
      if (Object.hasOwn(FUNCTIONS, t)) {
        if (!eat('(')) return undefined;
        const a = expr();
        if (a === undefined || !eat(')')) return undefined;
        return { t: 'call', name: t as keyof typeof FUNCTIONS, a };
      }
      /* `pi` and `e` are the only bare names allowed. Anything else is a word
         in a sentence rather than a variable, and a second variable is out of
         scope for a one-variable plot. */
      if (t === 'pi') return { t: 'num', v: Math.PI };
      if (t === 'e') return { t: 'num', v: Math.E };
      return undefined;
    }
    return undefined;
  };

  /*
   * PRECEDENCE: `^` BINDS TIGHTER THAN UNARY MINUS.
   *
   * The first version had `unary` inside `power`, so `-x^2` parsed as `(-x)^2`
   * and evaluated to +4 at x = 2 instead of -4. It parsed, it plotted, and it
   * drew a confident picture of the wrong curve -- which is why the expression
   * corpus counts WRONG separately from REFUSED. A refusal is honest; a wrong
   * number wearing a chart is not.
   *
   * So unary wraps power, and the exponent is itself a unary so `2^-1` works.
   */
  const power = (): Node | undefined => {
    const a = atom();
    if (a === undefined) return undefined;
    if (eat('^')) {
      const b = unary();
      return b === undefined ? undefined : { t: 'bin', op: '^', a, b };
    }
    return a;
  };

  function unary(): Node | undefined {
    if (eat('-')) {
      const a = unary();
      return a === undefined ? undefined : { t: 'neg', a };
    }
    return power();
  }

  const term = (): Node | undefined => {
    let a = unary();
    if (a === undefined) return undefined;
    for (;;) {
      const t = peek();
      if (t === '*' || t === '/') {
        pos += 1;
        const b = unary();
        if (b === undefined) return undefined;
        a = { t: 'bin', op: t, a, b };
        continue;
      }
      /* IMPLICIT MULTIPLICATION, because people write `3x` and `2sin(x)`, and a
         parser that refuses those refuses most of what a learner types. */
      if (t !== undefined && (isDigit(t[0]!) || isAlpha(t[0]!) || t === '(')) {
        const b = unary();
        if (b === undefined) return undefined;
        a = { t: 'bin', op: '*', a, b };
        continue;
      }
      return a;
    }
  };

  function expr(): Node | undefined {
    let a = term();
    if (a === undefined) return undefined;
    for (;;) {
      const t = peek();
      if (t === '+' || t === '-') {
        pos += 1;
        const b = term();
        if (b === undefined) return undefined;
        a = { t: 'bin', op: t, a, b };
        continue;
      }
      return a;
    }
  }

  const out = expr();
  /* Trailing tokens mean the parse did not consume the input, and half an
     expression plotted is worse than none. */
  return out !== undefined && pos === tokens.length ? out : undefined;
}

export function evaluate(node: Node, x: number): number {
  switch (node.t) {
    case 'num':
      return node.v;
    case 'var':
      return x;
    case 'neg':
      return -evaluate(node.a, x);
    case 'call':
      return FUNCTIONS[node.name](evaluate(node.a, x));
    case 'bin': {
      const a = evaluate(node.a, x);
      const b = evaluate(node.b, x);
      if (node.op === '+') return a + b;
      if (node.op === '-') return a - b;
      if (node.op === '*') return a * b;
      if (node.op === '/') return a / b;
      return a ** b;
    }
  }
}

/**
 * Find a plottable expression in a piece of text.
 *
 * Looks after an equals sign first, because that is how a lesson states one,
 * then at the line itself. It returns the SOURCE AS WRITTEN so the caption can
 * quote it: a reader has to be able to compare the curve against the claim.
 */
export function findExpression(text: string): { source: string; node: Node } | undefined {
  const candidates: string[] = [];
  /* Commas split too: a lesson writes "Consider y = x^3 - 3x, which has two
     turning points", and without the comma the candidate carries the clause
     after it and refuses. Safe here because no expression in this grammar
     contains one -- every function takes a single argument. */
  for (const line of text.split(/[\n.;,]/)) {
    const eq = line.lastIndexOf('=');
    if (eq >= 0) candidates.push(line.slice(eq + 1));
    candidates.push(line);
  }
  for (const raw of candidates) {
    const trimmed = raw.trim().replace(/^`+|`+$/g, '');
    if (trimmed.length === 0 || trimmed.length > 60) continue;
    if (!trimmed.includes('x')) continue;
    const node = parseExpression(trimmed);
    if (node !== undefined) return { source: trimmed, node };
  }
  return undefined;
}

/**
 * How many points a curve carries.
 *
 * THIRTY-NINE, NOT FORTY-ONE: `validateChart` caps a chart at 40 items and
 * refused the product's own plot on the first dry run — the same rule that
 * refuses a model's invented node, applied to a chart this repository wrote.
 * The cap was not raised to fit the plot; the plot was made to fit the cap,
 * because a validator the product can talk its way around is not a validator.
 *
 * TWENTY-ONE, so the step over the default interval is exactly 0.5 and every
 * label is a number a reader can check by hand. At 39 the step was 0.263… and
 * the labels were rounded to two places, so recomputing y from the x on the
 * screen disagreed with the plotted y by up to 0.044 — small, invisible, and
 * exactly the kind of quiet inconsistency this product exists to not have.
 *
 * Odd, so x = 0 is one of the points on a symmetric interval: a curve that
 * skips the origin reads as though it avoids it.
 */
const PLOT_POINTS = 21;

export interface PlotResult {
  chart: SeqChart;
  /** Whether the curve crosses zero — the check-in asks about it when it does. */
  crossesZero: boolean;
  source: string;
}

/**
 * Plot an expression the model stated, or refuse.
 *
 * Refuses when nothing parses, and when too few points evaluate finitely: a
 * curve with holes in it is a picture of an evaluation failure rather than of a
 * function.
 */
export function buildPlot(text: string, from = -5, to = 5): PlotResult | undefined {
  const found = findExpression(text);
  if (found === undefined) return undefined;

  const items: { id: string; label: string; value: number; group: string }[] = [];
  let finite = 0;
  let sawNegative = false;
  let sawPositive = false;
  for (let i = 0; i < PLOT_POINTS; i += 1) {
    const x = from + ((to - from) * i) / (PLOT_POINTS - 1);
    const y = evaluate(found.node, x);
    if (!Number.isFinite(y)) continue;
    finite += 1;
    if (y < 0) sawNegative = true;
    if (y > 0) sawPositive = true;
    items.push({
      id: `p${i}`,
      label: String(Math.round(x * 100) / 100),
      value: Math.round(y * 1000) / 1000,
      group: found.source,
    });
  }
  if (finite < PLOT_POINTS * 0.8) return undefined;

  return {
    source: found.source,
    crossesZero: sawNegative && sawPositive,
    chart: {
      version: 1,
      kind: 'line',
      title: found.source,
      /*
       * THE PROMISE, NAMED. A code chart says "from the scanned graph" because
       * it was checked against one. This says what it actually did: the points
       * were computed here from the expression as written, which makes the
       * curve faithful to that expression and says nothing about whether the
       * expression is the right one.
       */
      caption:
        `Plotted from ${found.source} as written. The points are computed here, so the curve ` +
        `is faithful to the expression; whether the expression is the right one is the lesson's ` +
        `claim, not the picture's.`,
      items,
      axes: { x: 'x', y: found.source },
    },
  };
}

/**
 * THE PRODUCT'S OWN EXAMPLE, so the picture does not wait on the model's habit.
 *
 * The math kind as first built fired only on an expression THE MODEL STATED,
 * and measured on the twenty subject asks, zero of them name one: they are
 * prose questions. So the whole kind rested on whether a 4B-class model happens
 * to write `y = x^2 - 3x + 2` in its answer -- the prompt-side dependence that
 * every belt arm of this night failed to remove.
 *
 * A topic therefore maps to ONE canonical example, chosen here. Eight rows, and
 * the twenty asks decided them: the topics that actually have a curve.
 *
 * THIS IS NOT FABRICATION, AND THE LABEL IS WHAT MAKES THAT TRUE. The plot is
 * captioned as the PRODUCT's example, never as the learner's expression and
 * never as the only one that would do -- the same choice a textbook makes when
 * it draws one parabola. What would be fabrication is presenting it as though
 * the learner or the model had named it, which is exactly what the caption
 * refuses to do.
 *
 * A topic with no curve gets NOTHING. Precision and recall, a hash table, a
 * race condition: eleven of the twenty, and drawing a plot for them would be
 * inventing a picture for a subject that has none.
 */
interface Example {
  /** The expression, in the grammar above. */
  expression: string;
  /** What to call it in the caption: "an example quadratic". */
  noun: string;
  /** Where to draw it, when the default interval hides the point. */
  from?: number;
  to?: number;
}

const EXAMPLES: { match: RegExp; example: Example }[] = [
  /* Order matters: the first row whose words appear wins, so the more specific
     topics sit above the general ones. */
  { match: /logarithm|log scale/i, example: { expression: 'log(x)', noun: 'the logarithm', from: 0.1, to: 10 } },
  { match: /exponential|compound|growth rate/i, example: { expression: 'exp(x)', noun: 'an exponential', from: -3, to: 3 } },
  { match: /sine|cosine|trigonometr|wave|oscillat/i, example: { expression: 'sin(x)', noun: 'a sine wave', from: -6, to: 6 } },
  { match: /absolute value|modulus/i, example: { expression: 'abs(x)', noun: 'the absolute value' } },
  { match: /divid\w* by zero|asymptot|reciprocal|undefined at/i, example: { expression: '1/x', noun: 'the reciprocal', from: -5, to: 5 } },
  { match: /cubic|inflection/i, example: { expression: 'x^3 - 3x', noun: 'a cubic' } },
  /* CONTINUITY IS TAUGHT BY ITS FAILURE. This row was `abs(x)` labelled "a
     function with a corner", and abs(x) IS continuous everywhere -- a learner
     asking what makes a function continuous could read the corner as the thing
     that breaks it, which is the opposite of the lesson. 1/x has a real break,
     and the picture shows what continuity is by showing where it stops. */
  { match: /continuous|continuity|discontinu/i, example: { expression: '1/x', noun: 'a function with a break at zero' } },
  /* The parabola stands for four different lessons -- a polynomial, completing
     the square, a loss surface, and the slope a derivative measures -- because
     it is the curve each of them is actually about. */
  { match: /polynomial|quadratic|complete the square|parabola|derivative|slope|tangent|gradient descent|loss function|minimi[sz]/i, example: { expression: 'x^2 - 3x + 2', noun: 'an example quadratic' } },
];

/** The canonical example for a topic, or nothing when the topic has no curve. */
export function exampleFor(ask: string): Example | undefined {
  for (const row of EXAMPLES) if (row.match.test(ask)) return row.example;
  return undefined;
}

/**
 * Plot the product's example for a topic that names no expression.
 *
 * Separate from `buildPlot` on purpose: that one draws what the MODEL said, and
 * this one draws what the PRODUCT chose. Two different promises, two different
 * captions, and no path where one is quietly served as the other.
 */
export function buildExamplePlot(ask: string): PlotResult | undefined {
  const example = exampleFor(ask);
  if (example === undefined) return undefined;
  const plot = buildPlot(example.expression, example.from ?? -5, example.to ?? 5);
  if (plot === undefined) return undefined;
  return {
    ...plot,
    chart: {
      ...plot.chart,
      title: `${example.noun}: ${example.expression}`,
      caption:
        `${example.noun}, chosen by Sequence to show the shape -- you did not ask for this ` +
        `particular one. The points are computed here, so the curve is faithful to ` +
        `${example.expression}; the lesson beside it is the model's.`,
    },
  };
}

/**
 * The check-in for a plotted lesson: a prediction about the picture.
 *
 * Same rule as the code kind's. It asks the learner to READ the drawing rather
 * than recall a fact, and it names only what is on the screen.
 */
export function derivePlotCheckIn(plot: PlotResult): string {
  return plot.crossesZero
    ? `Looking at the plot of ${plot.source}: where do you think it crosses zero, and what does that value mean here?`
    : `Looking at the plot of ${plot.source}: what do you think happens to it as x grows, and why?`;
}
