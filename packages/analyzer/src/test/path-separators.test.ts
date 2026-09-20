import assert from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanRepo } from '../scan.js';

/**
 * THE GRAPH SPEAKS POSIX, ON EVERY PLATFORM.
 *
 * A repo-relative path in an ArchGraph is DATA, not a filesystem argument: it
 * becomes a node id (`file:gateway/src/index.ts`), an evidence ref
 * (`packages/alpha/src/one.ts:3`), a key in an export, and a string a client
 * matches on. So it must not change shape with the OS that produced it.
 *
 * WHAT THIS CAUGHT. On Windows `scanRepo()` returned 142 strings carrying
 * backslash separators — node ids among them, so the SAME repo scanned on
 * Windows and on Linux produced different node identities, and anything joining
 * across that boundary silently missed. It was invisible for two reasons: the
 * persisted `archgraph.json` looked clean because `graphCache` normalises on
 * write, and the failures it caused elsewhere were being filed as "Windows path
 * separator signatures" — environmental noise rather than the one-line bug it
 * was. Six analyzer tests were red because of it.
 *
 * The invariant is asserted on the SCAN's own return value, not on the file it
 * writes, because the ask pipeline, the function graph and the research
 * selector all consume the in-memory graph and never touch the cache.
 *
 * `repoRoot` is exempt and must stay native: it is an absolute path handed to
 * `fs`, not an identifier.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, '..', '..', 'test', 'fixtures');

/* Built rather than typed: a literal backslash in a regex inside a shell
 * heredoc has been eaten eight times in this repo. See CANON. */
const BACKSLASH = String.fromCharCode(92);
const SEPARATOR_IN_A_PATH = new RegExp(
  '[A-Za-z0-9_.-]' + BACKSLASH + BACKSLASH + '[A-Za-z0-9_.-]',
);

/** Every string in the tree, with the JSON-ish path that reaches it. */
function offendingStrings(value: unknown, at = ''): string[] {
  if (typeof value === 'string') {
    return SEPARATOR_IN_A_PATH.test(value) ? [`${at} = ${value.slice(0, 100)}`] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => offendingStrings(v, `${at}[${i}]`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => offendingStrings(v, `${at}.${k}`));
  }
  return [];
}

const REPOS = ['shopfront', 'gomod-root', 'mixed-lang', 'monorepo-apps'];

for (const name of REPOS) {
  test(`scanRepo(${name}) emits no Windows separator in any identifier or path`, async () => {
    const graph = await scanRepo(path.join(FIXTURES, name), { cluster: true });

    const offenders = offendingStrings(graph).filter((s) => !s.startsWith('.repoRoot'));

    assert.deepEqual(
      offenders,
      [],
      `${name}: these graph strings carry a backslash separator, so this repo's node ` +
        `identities differ between Windows and POSIX:\n  ${offenders.join('\n  ')}`,
    );
  });
}

test('clustering does not reintroduce native separators', async () => {
  // Clustering rewrites ids and rebuilds membership, which is exactly the sort
  // of pass that re-derives a path from something native and undoes the fix.
  const clustered = await scanRepo(path.join(FIXTURES, 'shopfront'), { cluster: true });
  const flat = await scanRepo(path.join(FIXTURES, 'shopfront'), { cluster: false });

  for (const [label, graph] of [
    ['clustered', clustered],
    ['flat', flat],
  ] as const) {
    const offenders = offendingStrings(graph).filter((s) => !s.startsWith('.repoRoot'));
    assert.deepEqual(offenders, [], `${label} scan leaked ${offenders.length} native separators`);
  }
});
