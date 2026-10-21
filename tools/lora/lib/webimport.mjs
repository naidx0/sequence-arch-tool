/**
 * Load a TypeScript module out of `packages/web/src` from plain `.mjs`.
 *
 * WHY THIS EXISTS. The Phase 0 filter must run the REAL validator —
 * `extractArchProposalFromAnswer` in `packages/web/src/graph/archProposal.ts`.
 * Re-implementing it here would defeat the entire point of the experiment: the
 * whole premise of `docs/lora-operator-guide.md` §2 is that *we own the grader*,
 * and a second copy of the grader is not the grader. There is no compiled copy
 * of the web package (it ships through Vite, not `tsc`), so the source is loaded
 * directly via Node's type stripping — the same trick `tools/qa-loop/run.mjs`
 * already uses for `stemFlow.ts`.
 *
 * `archProposal.ts` is one step harder than `stemFlow.ts`: it has a RUNTIME
 * import (`../canvas/breakoutFraming.js` → `overlapArea`), and TypeScript's
 * "write the .js you will emit" specifier style does not resolve on disk, where
 * only the `.ts` exists. Node's type stripping deliberately does NOT rewrite
 * specifiers. So we install a synchronous module hook (`module.registerHooks`,
 * Node >= 22.15) that maps `./x.js` → `./x.ts` for imports whose PARENT lives
 * under `packages/web/src` and only when the `.ts` file actually exists.
 *
 * Deliberately narrow: it never touches specifiers from anywhere else in the
 * tree, never invents a file, and falls straight through to the default
 * resolver otherwise.
 */
import fs from 'node:fs';
import module from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { REPO_ROOT } from './paths.mjs';

const WEB_SRC_URL = pathToFileURL(path.join(REPO_ROOT, 'packages/web/src') + path.sep).href;

let installed = false;

/** Install the `.js` → `.ts` resolve hook for `packages/web/src`. Idempotent. */
export function installWebTsResolver() {
  if (installed) return;
  if (typeof module.registerHooks !== 'function') {
    throw new Error(
      'node:module.registerHooks is unavailable — Node >= 22.15 is required to load ' +
        'packages/web/src/graph/archProposal.ts (there is no compiled copy of the web package). ' +
        `This process is ${process.version}.`
    );
  }
  module.registerHooks({
    resolve(specifier, context, nextResolve) {
      const parent = context?.parentURL;
      if (
        parent &&
        parent.startsWith(WEB_SRC_URL) &&
        (specifier.startsWith('./') || specifier.startsWith('../')) &&
        specifier.endsWith('.js')
      ) {
        const asTs = new URL(specifier, parent).href.replace(/\.js$/, '.ts');
        if (fs.existsSync(new URL(asTs))) return nextResolve(asTs, context);
      }
      return nextResolve(specifier, context);
    },
  });
  installed = true;
}
