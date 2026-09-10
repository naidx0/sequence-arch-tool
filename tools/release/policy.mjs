/**
 * WHAT SHIPS IN THE PUBLIC MIRROR — the decision, on its own, so it can be tested.
 *
 * This lives apart from `mirror.mjs` for one reason: the highest-consequence
 * failure in the whole release path is `decide()` quietly starting to say `keep`
 * for something under `docs/`. That publishes a private note permanently, and it
 * would look exactly like a successful release. A rule that important should not
 * be reachable only by running the tool.
 */

/** Whole trees that never ship, whatever they contain. */
export const EXCLUDE_DIRS = [
  '.claude/',
  '.agents/',
  '.cursor/',
  '.sequence/', // workspace state; the shipped program templates are re-added below
  'docs/', // deny-by-default — see DOC_ALLOW
  'tools/bench/out/', // run reports; they name models, machines and timings
  'tools/qa-loop/out/',
  /*
   * `tools/ci/out/` was NOT here, and its run report shipped while every sibling
   * class was held. Found by asking the policy about each of a night's new paths
   * one at a time rather than reading the totals — 1,481 shipped and 0 refusals
   * says nothing about whether the right 1,481 shipped.
   *
   * A run report is not source: it is a snapshot of one machine's last run, it
   * rots the moment anything changes, and a public tree carrying one invites a
   * reader to treat it as current.
   */
  'tools/ci/out/',
  'site/', // the retired marketing site
];

/** Individual files that never ship. */
export const EXCLUDE_FILES = new Set([
  'CLAUDE.md', // agent instructions, and it points at every internal doc
  'ARCHITECTURE_VIZ_RESEARCH_AND_SPEC.md',
  'skills-lock.json',
  'tools/release/identifiers.json', // the denylist is itself the private data it protects
  'render.yaml', // deploy target for private hosting
  '.cursorignore',
]);

/** Exceptions punched back through EXCLUDE_DIRS, in order. */
export const FORCE_INCLUDE = [
  '.sequence/programs/', // shipped program templates are source
  'docs/journeys/', // the journey page, its screenshots and its recording
];

/**
 * The docs that ship. Deny-by-default: anything under `docs/` not matched here
 * stays private, **including every file added after this list was written**.
 *
 * An exclusion list only protects you from the private files you thought of. A
 * doc tree that grows a new owner plan next week would ship it by default, and
 * that failure is silent and permanent. The reverse mistake — a public doc
 * missing for one release — is fixable in a minute.
 */
export const DOC_ALLOW = [
  'docs/README.md',
  'docs/vision.md',
  'docs/teach-mode.md',
  'docs/TEACH-MODE-GOAL.md',
  'docs/how-to-verify.md',
  'docs/release-gate.md',
  'docs/usability-standard.md',
  'docs/product-principles.md',
  'docs/feature-honesty.md',
  'docs/build-guide.md',
  'docs/THIRD-PARTY-NOTICES.md',
  'docs/TLDRAW_LICENSE.md',
  'docs/adr/', // architecture decision records — written to be read by strangers
  'docs/journeys/',
];

/** Sections cut out of AGENTS.md; the rest is ordinary contributor guidance. */
export const AGENTS_DROP_SECTIONS = [
  'Read first',
  'Working as an agent here',
  'Cursor Cloud — environment',
];

/** `{ keep }` or `{ keep: false, why }` for one repo-relative path. */
export function decide(file) {
  for (const inc of FORCE_INCLUDE) if (file.startsWith(inc)) return { keep: true };
  if (EXCLUDE_FILES.has(file)) return { keep: false, why: 'internal file' };
  for (const dir of EXCLUDE_DIRS) {
    if (!file.startsWith(dir)) continue;
    if (dir === 'docs/') {
      const allowed = DOC_ALLOW.some((a) => (a.endsWith('/') ? file.startsWith(a) : file === a));
      return allowed ? { keep: true } : { keep: false, why: 'docs deny-by-default' };
    }
    return { keep: false, why: `excluded tree ${dir}` };
  }
  return { keep: true };
}

/** Drop the named `##` sections from AGENTS.md, keeping everything else. */
export function stripAgentsSections(text) {
  const lines = text.split('\n');
  const out = [];
  let dropping = false;
  for (const line of lines) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) dropping = AGENTS_DROP_SECTIONS.some((s) => heading[1].trim().startsWith(s));
    if (!dropping) out.push(line);
  }
  return out.join('\n');
}
