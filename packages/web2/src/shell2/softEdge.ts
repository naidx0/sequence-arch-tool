/**
 * SOFT EDGES (0.1.6 C6; owner: "a long file name doesn't blend between the borders ... same with some of the status
 * bar elements"). A name that does not fit its box fades out at the edge (shell2.css, `[data-cut]`) instead of being
 * cut hard or ended with "...". The fade is drawn only on a name that is actually cut: a mask on a name that fits would
 * fade its own last letters. This marks which ones are; the full text is on the element's (or its row's) `title`.
 */
export const SOFT_EDGE_SELECTOR = ['.s2-sb-state', ".s2-sb-x > span:not(.s2-sb-dot):not(.s2-sb-icon):not(.s2-sb-ring)", '.s2-crumb-p', '.s2-branch-l'].join(', ');

/** Set `data-cut` on every name under `root` that is wider than its box, and clear it where the name now fits. */
export function markCut(root: ParentNode, selector: string = SOFT_EDGE_SELECTOR): void {
  for (const el of root.querySelectorAll<HTMLElement>(selector)) {
    if (el.scrollWidth > el.clientWidth + 1) {
      if (el.getAttribute('data-cut') !== 'true') el.setAttribute('data-cut', 'true');
    } else if (el.hasAttribute('data-cut')) el.removeAttribute('data-cut');
  }
}
