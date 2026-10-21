/**
 * HANDOFF §5 process failure — after any merge, rebuild before measuring.
 * Locks the orchestration-protocol line so a stale `dist/` cannot re-report
 * numbers for the wrong code.
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * RESOLVED FROM THIS FILE, NOT FROM process.cwd().
 *
 * The cwd form only passed when the runner happened to be started inside
 * `packages/analyzer`. Run from the repository root — which is how you run the
 * whole analyzer suite in one command — it looked two directories ABOVE the
 * repo and died on ENOENT, so the suite reported a failure that had nothing to
 * do with the code under test. The file's own location is the fact that does
 * not move.
 */
const PROTOCOL = readFileSync(
  fileURLToPath(new URL('../../../../docs/orchestration-protocol.md', import.meta.url)),
  'utf8',
);

test('orchestration-protocol §5: rebuild dist after merge before measuring', () => {
  const section = PROTOCOL.slice(PROTOCOL.indexOf('## 5. Gate discipline'));
  assert.ok(
    /rebuild.*dist.*before measuring/i.test(section),
    '§5 must require rebuilding dist/ after merge before QA or e2e measurement',
  );
});
