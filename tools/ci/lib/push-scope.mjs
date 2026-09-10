/**
 * WHICH DIRTY FILES ACTUALLY THREATEN THIS PUSH.
 *
 * The pre-push guard exists so the counting gate's verdict transfers to the
 * commits being pushed. Its first version refused on ANY modified tracked file,
 * which quietly assumed one lane per tree.
 *
 * On 2026-09-09 two lanes shared this tree and a docs-only push was refused
 * because the other lane had `packages/web2` canvas work in flight. Every way
 * out was wrong: committing another lane's files, stashing work out from under a
 * running session, or `--no-verify` past the gate that proves the push green.
 *
 * A file that is not in the push cannot make the pushed commits differ from what
 * was tested. A file that IS in the push and is also dirty is the 2026-09-07
 * failure — origin went red while the fix sat uncommitted — and still refuses.
 *
 * Pure so it can be made to fail: `pre-push.mjs` CALLS this rather than
 * restating it, because a rule in two handlers is one rule until measured.
 */

/** The path a `git status --porcelain` line refers to, following a rename. */
export function pathOfStatusLine(line) {
  const p = String(line).slice(2).trim();
  const arrow = p.indexOf(' -> ');
  return arrow >= 0 ? p.slice(arrow + 4) : p;
}

/**
 * The dirty lines whose file is also part of this push.
 *
 * `dirtyLines` are `git status --porcelain --untracked-files=no` lines;
 * `pushedFiles` are the paths changed between the upstream and HEAD.
 */
export function dirtyFilesInPush(dirtyLines, pushedFiles) {
  const pushed = new Set(pushedFiles ?? []);
  return (dirtyLines ?? []).filter((l) => pushed.has(pathOfStatusLine(l)));
}
