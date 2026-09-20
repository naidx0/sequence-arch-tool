/**
 * A var() resolver for jsdom.
 *
 * WHY THIS FILE EXISTS, because a helper that stands between a test and its
 * assertion has to justify itself or it becomes the place assertions go to get
 * quietly weakened.
 *
 * jsdom implements the cascade but NOT custom-property substitution. Measured
 * against jsdom 25.0.1, with `:root{--font-sans:"Instrument Sans",…}` and
 * `body{font-family:var(--font-sans)}` both applied:
 *
 *     getComputedStyle(body).fontFamily                       → "var(--font-sans)"
 *     getComputedStyle(root).getPropertyValue('--font-sans')  → '"Instrument Sans", …'
 *
 * So the declared value comes back verbatim, un-substituted. A real browser
 * returns the substituted value. Item 0.1's locking test is specified as
 * `getComputedStyle(body).fontFamily` starts with `Instrument Sans`, and that
 * assertion cannot be evaluated in jsdom without supplying the substitution
 * step the environment is missing.
 *
 * THIS IS NOT A WEAKENING, AND HERE IS THE TEST OF THAT CLAIM: the assertion
 * still fails if body has no font-family rule, if body points at the wrong
 * token, if the token is missing, or if the token names the wrong family.
 * Those are all four ways item 0.1 can regress, and this resolver catches every
 * one of them because it starts from the SAME declaration the browser would
 * and only fills in the substitution. It reads nothing off disk and hardcodes
 * no expected value.
 *
 * What it does NOT cover: whether the font FILE actually loads and paints.
 * jsdom has no font stack at all, so no jsdom test can cover that, and none
 * here pretends to. That is Tier 4's job — the screenshot-vs-sheet pass no
 * wave ships without.
 */

const VAR_CALL = 'var(';
const MAX_DEPTH = 16;

/**
 * Read a custom property, walking up from `el` the way inheritance would.
 *
 * The walk is necessary rather than tidy: jsdom resolves a custom property on
 * the element that declares it, but does not reliably inherit it down to
 * descendants, so asking `body` for `--font-sans` declared on `:root` can come
 * back empty. Walking to the ancestor that declares it reproduces inheritance.
 */
function lookup(el: Element, name: string): string {
  const view = el.ownerDocument.defaultView;
  if (!view) return '';
  let node: Element | null = el;
  while (node) {
    const value = view.getComputedStyle(node).getPropertyValue(name);
    if (value && value.trim()) return value.trim();
    node = node.parentElement;
  }
  return '';
}

/**
 * Find the index just past the `var(` whose open paren is at `open`, matching
 * parens by depth so a nested `var(--a, var(--b))` is split correctly. Returns
 * -1 if the call is unterminated.
 */
function matchParen(input: string, open: number): number {
  let depth = 0;
  for (let i = open; i < input.length; i += 1) {
    if (input[i] === '(') depth += 1;
    else if (input[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split `--name, fallback` at the FIRST top-level comma. A fallback may itself
 *  contain commas — a font stack always does — so this cannot be a plain
 *  split(','). */
function splitArgs(args: string): { name: string; fallback: string | null } {
  let depth = 0;
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      return { name: args.slice(0, i).trim(), fallback: args.slice(i + 1).trim() };
    }
  }
  return { name: args.trim(), fallback: null };
}

/**
 * Substitute every var() in `value` against custom properties visible from
 * `el`. Iterates so a token whose value is itself a var() resolves, and caps
 * the depth so a cyclic token definition fails the test instead of hanging it.
 */
export function substituteVars(value: string, el: Element): string {
  let current = value;
  for (let pass = 0; pass < MAX_DEPTH; pass += 1) {
    const at = current.indexOf(VAR_CALL);
    if (at === -1) return current.trim();

    const open = at + VAR_CALL.length - 1;
    const close = matchParen(current, open);
    if (close === -1) return current.trim();

    const { name, fallback } = splitArgs(current.slice(open + 1, close));
    const declared = name.startsWith('--') ? lookup(el, name) : '';
    const replacement = declared || fallback || '';

    current = current.slice(0, at) + replacement + current.slice(close + 1);
  }
  throw new Error(`var() substitution did not settle in ${MAX_DEPTH} passes: ${value}`);
}

/**
 * `getComputedStyle(el)[prop]` with custom properties substituted — i.e. what
 * a real browser would have returned.
 */
export function resolvedStyle(el: Element, property: string): string {
  const view = el.ownerDocument.defaultView;
  if (!view) throw new Error('element is not in a document with a window');
  const declared = view.getComputedStyle(el).getPropertyValue(property);
  return substituteVars(declared, el);
}

/**
 * Strip the quotes CSS puts around a family name that needs them, so
 * `"Instrument Sans", ui-sans-serif` and `Instrument Sans, ui-sans-serif`
 * compare the same. Quoting is a syntax detail of the stack, not a fact about
 * which typeface is bound, and an assertion that turns on it would fail for
 * the wrong reason.
 */
export function unquoteFontStack(stack: string): string {
  return stack.replace(/["']/g, '');
}
