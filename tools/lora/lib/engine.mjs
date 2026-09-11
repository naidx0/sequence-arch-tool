/**
 * The SHIPPED engine, loaded exactly as `pnpm grade` and `tools/qa-loop` load it:
 * from `dist/`, never re-implemented here.
 *
 * The one exception is the validator itself. `extractArchProposalFromAnswer`
 * lives in `packages/web/src/graph/archProposal.ts` and the web package has no
 * `tsc` output, so it is loaded from source through Node's type stripping plus
 * the narrow resolver in `webimport.mjs`. That is deliberate and load-bearing:
 * Phase 0's entire premise is that OUR validator is the teacher, so the filter
 * must call the exact function production calls, not a copy of it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { REPO_ROOT } from './paths.mjs';
import { installWebTsResolver } from './webimport.mjs';

const DIST = {
  scan: path.join(REPO_ROOT, 'packages/analyzer/dist/scan.js'),
  explain: path.join(REPO_ROOT, 'packages/analyzer/dist/explain/explain.js'),
  schema: path.join(REPO_ROOT, 'packages/schema/dist/index.js'),
};

const WEB_SRC = {
  archProposal: path.join(REPO_ROOT, 'packages/web/src/graph/archProposal.ts'),
};

let cached = null;

/**
 * @returns {Promise<{
 *   scanRepo: Function,
 *   buildDigest: Function,
 *   buildAskPrompt: Function,
 *   validateGraph: Function,
 *   extractArchProposalFromAnswer: (text: string, graph: object) => object | null,
 * }>}
 */
export async function loadEngine() {
  if (cached) return cached;

  const missing = Object.entries({ ...DIST, ...WEB_SRC })
    .filter(([, p]) => !fs.existsSync(p))
    .map(([k, p]) => `${k}: ${path.relative(REPO_ROOT, p)}`);
  if (missing.length > 0) {
    throw new Error(
      `the engine is not built — run \`pnpm -r build\` first.\nMissing:\n  - ${missing.join('\n  - ')}`
    );
  }

  installWebTsResolver();
  const imp = (p) => import(pathToFileURL(p).href);
  const [scan, explain, schema, archProposal] = await Promise.all([
    imp(DIST.scan),
    imp(DIST.explain),
    imp(DIST.schema),
    imp(WEB_SRC.archProposal),
  ]);

  cached = {
    scanRepo: scan.scanRepo,
    buildDigest: explain.buildDigest,
    buildAskPrompt: explain.buildAskPrompt,
    validateGraph: schema.validateGraph,
    extractArchProposalFromAnswer: archProposal.extractArchProposalFromAnswer,
  };
  return cached;
}

/** Just the validator — what `filter.mjs` and the tests need, with no scanner cost. */
export async function loadValidator() {
  if (!fs.existsSync(WEB_SRC.archProposal)) {
    throw new Error(`validator source missing: ${WEB_SRC.archProposal}`);
  }
  installWebTsResolver();
  const m = await import(pathToFileURL(WEB_SRC.archProposal).href);
  return m.extractArchProposalFromAnswer;
}
