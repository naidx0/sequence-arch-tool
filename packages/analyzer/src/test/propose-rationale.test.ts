import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { executeAskTool } from '../server/askTools.js';

/**
 * A PROPOSED CODE CHANGE MUST BE ABLE TO SAY WHY.
 *
 * `TopologyProposal` carries a `rationale` and the board renders it, so a
 * proposed change to the ARCHITECTURE explains itself. A proposed change to
 * the CODE could not: `propose_files` accepted `title` and `files` and nothing
 * else, so the most consequential thing this product does — rewriting a
 * reader's files — arrived as a title and a diff.
 *
 * A title names the change. A rationale says why it is the right one, which is
 * the thing a reviewer needs in order to disagree.
 */

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-rationale-'));
  fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;\n');
  return dir;
}

function ctx(root: string) {
  return {
    repoRoot: root,
    resolveReadable: (rel: string) => {
      const abs = path.resolve(root, rel);
      return abs.startsWith(root) ? abs : null;
    },
  } as never;
}

describe('propose_files', () => {
  it('CARRIES THE RATIONALE the model supplied', async () => {
    const root = repo();
    const result = await executeAskTool(
      'propose_files',
      {
        title: 'Guard the token check',
        rationale:
          'The token is compared with == so a null token passes; switching to a constant-time compare closes it.',
        files: [{ path: 'a.ts', content: 'export const a = 2;\n' }],
      },
      ctx(root),
    );

    assert.equal(result.ok, true, result.evidence);
    assert.equal(
      result.proposal?.rationale,
      'The token is compared with == so a null token passes; switching to a constant-time compare closes it.',
    );
  });

  it('is OPTIONAL — a proposal without one is still a proposal', async () => {
    /* The model may have nothing worth saying beyond the title, and refusing
       the edit for want of prose would lose the work to a formatting rule. */
    const root = repo();
    const result = await executeAskTool(
      'propose_files',
      { title: 'Rename it', files: [{ path: 'a.ts', content: 'export const b = 1;\n' }] },
      ctx(root),
    );

    assert.equal(result.ok, true, result.evidence);
    assert.equal(result.proposal?.rationale, undefined);
  });

  it('ignores a rationale that is not a string, rather than rendering junk', async () => {
    const root = repo();
    const result = await executeAskTool(
      'propose_files',
      { rationale: { why: 'nope' }, files: [{ path: 'a.ts', content: 'export const c = 1;\n' }] },
      ctx(root),
    );
    assert.equal(result.ok, true, result.evidence);
    assert.equal(result.proposal?.rationale, undefined);
  });

  it('THE MODEL IS TOLD IT CAN SEND ONE', async () => {
    /*
     * A field the prompt never mentions is a field no model fills. The hint is
     * the whole reason this arrives at all - `askTools` already makes this
     * argument for the belt itself: "a hint that advertises a refused tool is
     * worse than no hint", and its converse holds too.
     */
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, '..', '..', 'src', 'server', 'askTools.ts'), 'utf8');
    /* The HINT BLOCK, not the first mention of the name - which is a comment
       at the top of the file and nowhere near the prompt text. */
    const at = src.indexOf('"name":"propose_files"');
    assert.ok(at !== -1, 'the prompt shows the model a propose_files call');
    const hint = src.slice(at, at + 400);
    assert.match(hint, /rationale/, 'the propose_files hint must advertise rationale');
  });
});
