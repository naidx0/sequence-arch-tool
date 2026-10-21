/**
 * SOFT EDGES (0.1.6 C6; owner: "a long file name doesn't blend between the borders ... same with some of the status
 * bar elements"). A name that does not fit its box fades out at the edge (shell2.css, `[data-cut]`) instead of being
 * cut hard or ended with "...". The fade is drawn only on a name that is actually cut: a mask on a name that fits would
 * fade its own last letters. This marks which ones are; the full text is on the element's (or its row's) `title`.
 */
export const SOFT_EDGE_SELECTOR = ['.s2-sb-state', ".s2-sb-x > span:not(.s2-sb-dot):not(.s2-sb-icon):not(.s2-sb-ring)", '.s2-crumb-p', '.s2-branch-l'].join(', ');

/** Measure every name under `root` first, then write: a write between two reads would force a layout per name. */
function measure(root: ParentNode, selector: string): { el: HTMLElement; cut: boolean }[] {
  const out: { el: HTMLElement; cut: boolean }[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(selector)) out.push({ el, cut: el.scrollWidth > el.clientWidth + 1 });
  return out;
}

function apply(rows: { el: HTMLElement; cut: boolean }[]): void {
  for (const { el, cut } of rows) {
    if (cut) {
      if (el.getAttribute('data-cut') !== 'true') el.setAttribute('data-cut', 'true');
    } else if (el.hasAttribute('data-cut')) el.removeAttribute('data-cut');
  }
}

/** Set `data-cut` on every name under `root` that is wider than its box, and clear it where the name now fits. All reads, then all writes. */
export function markCut(root: ParentNode, selector: string = SOFT_EDGE_SELECTOR): void {
  apply(measure(root, selector));
}

const queued = new Map<ParentNode, Set<string>>();
let frame = 0;

function flush(): void {
  frame = 0;
  const batch = [...queued];
  queued.clear();
  /* One read phase across every queued root, then one write phase: a frame costs one layout however many callers ask. */
  const measured = batch.flatMap(([root, selectors]) => [...selectors].flatMap((sel) => measure(root, sel)));
  apply(measured);
}

/**
 * The same marking as `markCut`, batched: any number of calls in one frame (the top-bar fit pass, the status bar, the
 * model menu) are measured together and written together on the next animation frame, and the same root and selector
 * asked twice in a frame is measured once. Use this where the caller does not need the mark before it returns.
 */
export function queueMarkCut(root: ParentNode, selector: string = SOFT_EDGE_SELECTOR): void {
  let sels = queued.get(root);
  if (!sels) queued.set(root, (sels = new Set()));
  sels.add(selector);
  if (frame) return;
  if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(flush);
  else {
    frame = 1;
    queueMicrotask(flush);
  }
}
