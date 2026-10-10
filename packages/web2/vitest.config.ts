import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config';

/**
 * The v2 test configuration, written against the plan's §4.6 tiers rather than
 * inherited.
 *
 * IT MERGES THE REAL VITE CONFIG RATHER THAN RESTATING IT. A second standalone
 * config is a second build, and the tests would then be asserting against a
 * bundle the app never ships: the react plugin, the worker format and the
 * `define` block would all have to be kept in sync by hand, and the first thing
 * to drift silently is whichever one no test happens to touch. (This is not
 * hypothetical — the first run here failed with `__SEQUENCE_COMMIT__ is not
 * defined`, because a standalone config had exactly that gap.)
 *
 * Three things this config sets that v1's does not, each fixing a named defect:
 *
 *   environment: 'jsdom'  Tier 2 is render tests, and a node environment cannot
 *                         host one. v1 sets `environment: 'node'`, which is why
 *                         it has 0 `.test.tsx` files and why the "cream canvas"
 *                         defect shipped through two full rounds with every
 *                         gate green — only a screenshot ever showed it.
 *
 *   include .tsx          v1's include glob is `src/**\/*.test.ts`, so a render
 *                         test would not have run even if somebody wrote one.
 *
 *   css: true             Vitest processes real CSS through the Vite pipeline
 *                         and injects it into jsdom. WITHOUT IT EVERY
 *                         STYLESHEET IMPORT IS A NO-OP and a test that reads a
 *                         computed style asserts against an empty cascade while
 *                         looking like it passes — the most expensive kind of
 *                         green. Items 0.1 and 0.6 both depend on this being on.
 *
 * `test/` is included alongside `src/` because the item 0.6 firewall lives
 * outside the tree it scans. A scanner inside src/ matches its own regex
 * literals and reports itself, and the only ways out of that are an exclusion
 * list nobody maintains or a weaker pattern. Keeping it out of src/ costs one
 * glob entry and keeps the pattern exact.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      css: true,
      include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
      setupFiles: ['./test/setup.ts'],
    },
  }),
);
