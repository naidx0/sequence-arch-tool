import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { putAttachment } from '../server/attachmentStore.js';
import { MAX_TURN_ATTACHMENTS, resolveRunNodeAttachments } from '../server/runNodeAttachments.js';

/* S2a: run-node `attachments` resolved against what the server holds. The
   image, file and node kinds are played through the real server in
   acp-s2a-server.test.ts; these are the text kind and the limits. */

test('a stored text attachment goes inline, named as the user\'s and never as the repository\'s', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-rna-'));
  try {
    const rec = putAttachment(root, 'trace.log', 'Error: boom\n  at main.py:41');
    const r = resolveRunNodeAttachments([{ kind: 'text', id: rec.id }], { repoRoot: root, turnRoot: root, graph: null });
    assert.ok('attachments' in r);
    assert.deepEqual(r.attachments, [
      { kind: 'context', name: 'trace.log', uri: `sequence://attachment/${rec.id}`, text: '[trace.log, supplied by the user; not read from this repository]\nError: boom\n  at main.py:41' },
    ]);
    assert.ok('error' in resolveRunNodeAttachments([{ kind: 'text', id: 'f'.repeat(64) }], { repoRoot: root, turnRoot: root, graph: null }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test(`no attachments is an empty list; more than ${MAX_TURN_ATTACHMENTS}, or not a list, is refused`, () => {
  assert.deepEqual(resolveRunNodeAttachments(undefined, { repoRoot: null, turnRoot: null, graph: null }), { attachments: [] });
  assert.ok('error' in resolveRunNodeAttachments({}, { repoRoot: null, turnRoot: null, graph: null }));
  const many = Array.from({ length: MAX_TURN_ATTACHMENTS + 1 }, () => ({ kind: 'node', nodeId: 'x' }));
  assert.match((resolveRunNodeAttachments(many, { repoRoot: null, turnRoot: null, graph: null }) as { error: string }).error, /at most/);
});
