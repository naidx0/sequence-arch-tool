import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import url from 'node:url';

/**
 * HIDING A BADGE AND CARRYING ITS NOTICE ARE ONE DECISION, NOT TWO.
 *
 * The board turns off React Flow's on-canvas attribution with
 * `proOptions={{ hideAttribution: true }}`. That is permitted: `@xyflow/react`
 * is MIT, and MIT's one condition is that the copyright and permission notice
 * "be included in all copies or substantial portions of the Software" — a
 * condition on what is DISTRIBUTED, not on what is painted in the interface.
 *
 * The half that IS required is the notice, and a notice is exactly the kind of
 * thing that gets dropped in a refactor by someone who never knew it was load-
 * bearing. So the two are tied together here: hide the badge and this test
 * demands the notice; delete the notice and it demands the badge back.
 *
 * Note what this does NOT do. It does not police the licence text against
 * `node_modules`, because that would fail on a clean checkout with no install
 * and turn a legal obligation into a flaky gate. It asserts the notice exists,
 * names the package, and carries the two clauses that make it a notice.
 */

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const NOTICES = path.join(REPO, 'docs', 'THIRD-PARTY-NOTICES.md');
const BOARD = path.join(REPO, 'packages', 'web2', 'src', 'canvas', 'Board.tsx');

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

test('the notices file exists and is a notice, not a stub', () => {
  assert.ok(fs.existsSync(NOTICES), 'docs/THIRD-PARTY-NOTICES.md is missing');
  const text = read(NOTICES);

  assert.match(text, /@xyflow\/react/, 'the renderer must be named');
  assert.match(text, /MIT/, 'the licence must be named');
  // The two clauses that make MIT text a NOTICE rather than a mention of one.
  assert.match(text, /Copyright \(c\) 2019-2025 webkid GmbH/, 'the copyright line must be verbatim');
  assert.match(
    text,
    /included in all\s*\n?\s*copies or substantial portions of the Software/,
    'the permission notice must be present — this is the clause MIT actually requires',
  );
});

test('the badge is hidden and the notice is carried, or neither is', () => {
  const board = read(BOARD);
  const hidden = /hideAttribution:\s*true/.test(board);
  const notice = fs.existsSync(NOTICES);

  assert.equal(
    hidden,
    notice,
    hidden
      ? 'Board.tsx hides the React Flow attribution but docs/THIRD-PARTY-NOTICES.md is gone. ' +
          'MIT requires the notice to ship; the on-canvas badge is optional and the notice is not.'
      : 'docs/THIRD-PARTY-NOTICES.md exists but Board.tsx no longer hides the attribution. ' +
          'If the badge is back on purpose, that is fine — remove the notice entry too, or ' +
          'delete this assertion deliberately rather than leaving the pair inconsistent.',
  );
});
