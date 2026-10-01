/**
 * ITEM 2.4 — PATH ARITHMETIC FOR THE CRUMBS. Pure, and separate so it is
 * testable without a dialog around it.
 *
 * THE ONE RULE: THE CRUMBS START AT THE BROWSE ROOT AND NEVER ABOVE IT.
 *
 * `GET /api/browse` is jailed — `browse.ts` is explicit that the boundary is
 * enforced in three layers (NUL rejection, lexical containment, and a realpath
 * check against a symlink escape) and that `parent` is `null` at the root
 * because "nothing above it is reachable". A crumb rendered for `/` or for
 * `home` is therefore a control that navigates somewhere the server will refuse
 * with a 403. Offering it is worse than not showing the ancestry at all: the
 * user learns the app is unreliable rather than that a boundary exists.
 *
 * SEPARATORS. Paths here are SERVER-SIDE and absolute, and the server may be on
 * Windows — the analyzer joins with `path.sep`. So both separators are treated
 * as separators for splitting, and neither is ever printed: the crumb list
 * draws its own chevron between segments, which also means a directory whose
 * name contains a slash cannot forge one.
 */

export interface Crumb {
  /** What the user reads: the segment's own name. */
  label: string;
  /** Where clicking it goes: the absolute path of that segment. */
  path: string;
}

const SEPARATORS = /[/\\]+/;

/** Split a path into its segments, dropping the empties a leading or doubled
 *  separator produces. */
function segments(value: string): string[] {
  return value.split(SEPARATORS).filter((part) => part.length > 0);
}

/** The separator this path is written with, so re-joining a prefix produces a
 *  path the same server will accept back. */
function separatorOf(value: string): string {
  return value.includes('\\') && !value.includes('/') ? '\\' : '/';
}

/**
 * The crumbs from `root` to `cursor`, inclusive of both.
 *
 * The first crumb is always the root itself, labelled with its own last
 * segment (`max` for `/home/max`) so the trail reads as a place rather than as
 * a full path repeated in every crumb. When the cursor IS the root there is
 * exactly one crumb, and it is the current one.
 *
 * Total: a cursor that does not sit under the root — which the server should
 * never produce — degrades to a single crumb for the root rather than throwing
 * or inventing a trail.
 */
export function pathCrumbs(root: string, cursor: string): Crumb[] {
  const sep = separatorOf(root);
  const rootParts = segments(root);
  const cursorParts = segments(cursor);

  const rootLabel = rootParts.length > 0 ? rootParts[rootParts.length - 1] : root;
  const head: Crumb = { label: rootLabel, path: root };

  const contained =
    cursorParts.length >= rootParts.length &&
    rootParts.every((part, index) => part === cursorParts[index]);
  if (!contained) return [head];

  const crumbs = [head];
  let walked = root;
  for (const part of cursorParts.slice(rootParts.length)) {
    walked = walked.endsWith(sep) ? walked + part : walked + sep + part;
    crumbs.push({ label: part, path: walked });
  }
  return crumbs;
}
