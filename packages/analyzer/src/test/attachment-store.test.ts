import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  ATTACHMENT_CAP_BYTES,
  ATTACHMENT_PROMPT_CAP,
  isAttachmentId,
  listAttachments,
  putAttachment,
  readAttachment,
  readAttachmentText,
  renderAttachmentSection,
  safeName,
} from '../server/attachmentStore.js';

function tmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'seq-attach-'));
}

describe('storing what the user brought', () => {
  it('round-trips the text', () => {
    const repo = tmpRepo();
    const rec = putAttachment(repo, 'crash.log', 'Traceback\n  line 1\n');
    assert.equal(readAttachmentText(repo, rec.id), 'Traceback\n  line 1\n');
    assert.equal(readAttachment(repo, rec.id)?.name, 'crash.log');
  });

  it('is content-addressed, so the same paste twice is one file', () => {
    const repo = tmpRepo();
    const a = putAttachment(repo, 'one.log', 'same bytes');
    const b = putAttachment(repo, 'two.log', 'same bytes');
    assert.equal(a.id, b.id);
    const blobs = fs.readdirSync(path.join(repo, '.sequence', 'attachments')).filter((f) => f.endsWith('.txt'));
    assert.equal(blobs.length, 1);
  });

  it('refuses an empty attachment rather than storing a blank one', () => {
    assert.throws(() => putAttachment(tmpRepo(), 'x', ''));
  });

  it('DECLARES truncation instead of silently halving the evidence', () => {
    /* A silently cut log is how an assistant appears to ignore the second half
       of what it was shown, with nothing on screen to explain why. */
    const repo = tmpRepo();
    const rec = putAttachment(repo, 'huge.log', 'x'.repeat(ATTACHMENT_CAP_BYTES + 500));
    assert.equal(rec.truncated, true);
    assert.ok(rec.bytes <= ATTACHMENT_CAP_BYTES);
  });

  it('does not cut in the middle of a character', () => {
    /* Slicing bytes mid code-point puts replacement characters inside the
       user's evidence, which reads as corruption rather than as truncation. */
    const repo = tmpRepo();
    const rec = putAttachment(repo, 'emoji.log', '🙂'.repeat(ATTACHMENT_CAP_BYTES));
    const text = readAttachmentText(repo, rec.id) ?? '';
    assert.ok(!text.includes('\uFFFD'), 'no replacement characters');
  });

  it('lists newest first', () => {
    const repo = tmpRepo();
    putAttachment(repo, 'first', 'a');
    putAttachment(repo, 'second', 'b');
    const names = listAttachments(repo).map((a) => a.name);
    assert.deepEqual(names.slice(0, 2).sort(), ['first', 'second']);
    assert.equal(listAttachments(repo).length, 2);
  });

  it('answers an empty list for a repo that has never stored one', () => {
    assert.deepEqual(listAttachments(tmpRepo()), []);
  });
});

describe('the id is a filename, so it is the jail', () => {
  it('accepts only a sha256 hex string', () => {
    assert.equal(isAttachmentId('a'.repeat(64)), true);
    assert.equal(isAttachmentId('A'.repeat(64)), false, 'uppercase is not the hash form we write');
    assert.equal(isAttachmentId('a'.repeat(63)), false);
  });

  it('REFUSES a traversal rather than stripping it', () => {
    /* Stripping turns a hostile id into a plausible one and the caller can no
       longer tell it was ever hostile. */
    for (const hostile of ['../../etc/passwd', 'a/../../b', 'C:\\Windows\\system32', '..']) {
      assert.equal(isAttachmentId(hostile), false, hostile);
      assert.equal(readAttachmentText(tmpRepo(), hostile), null);
      assert.equal(readAttachment(tmpRepo(), hostile), null);
    }
  });

  it('reads nothing for an id that names nothing', () => {
    assert.equal(readAttachmentText(tmpRepo(), 'b'.repeat(64)), null);
  });
});

describe('the name shown beside it', () => {
  it('falls back rather than rendering an empty label', () => {
    assert.equal(safeName(''), 'pasted text');
    assert.equal(safeName('   '), 'pasted text');
    assert.equal(safeName(undefined), 'pasted text');
    assert.equal(safeName(42), 'pasted text');
  });

  it('collapses newlines, because a label is one line', () => {
    assert.equal(safeName('one\ntwo\tthree'), 'one two three');
  });

  it('bounds a runaway name', () => {
    assert.ok(safeName('z'.repeat(500)).length <= 120);
  });
});

describe('what the model is told', () => {
  it('says NOTHING when there is nothing attached', () => {
    assert.deepEqual(renderAttachmentSection([]), []);
  });

  it('marks them as the USER\u2019s, not as repository content', () => {
    /* The one thing this section must never let the model do is mistake a
       pasted log for a file it read out of the scan. */
    const lines = renderAttachmentSection([{ name: 'crash.log', text: 'boom' }]);
    const joined = lines.join('\n');
    assert.match(joined, /NOT read from this repository/);
    assert.match(joined, /supplied by the user/);
  });

  it('names each attachment, so the model can cite which one', () => {
    const joined = renderAttachmentSection([
      { name: 'crash.log', text: 'boom' },
      { name: 'config.yml', text: 'k: v' },
    ]).join('\n');
    assert.match(joined, /\[crash\.log\]/);
    assert.match(joined, /\[config\.yml\]/);
    assert.match(joined, /boom/);
    assert.match(joined, /k: v/);
  });

  it('declares a cut made HERE, not only one made on the way in', () => {
    const joined = renderAttachmentSection([{ name: 'big', text: 'y'.repeat(ATTACHMENT_PROMPT_CAP + 10) }]).join('\n');
    assert.match(joined, /cut short/);
  });

  it('declares a cut that was already made on the way in', () => {
    const joined = renderAttachmentSection([{ name: 'big', text: 'short', truncated: true }]).join('\n');
    assert.match(joined, /cut short/);
  });

  it('does not claim a cut when nothing was cut', () => {
    const joined = renderAttachmentSection([{ name: 'small', text: 'fits' }]).join('\n');
    assert.doesNotMatch(joined, /cut short/);
  });
});

/**
 * THE ATTACHMENT REACHES THE PROMPT.
 *
 * The store, the route and the client are each testable alone, and the ask
 * history defect is the standing proof that testing the pieces either side of
 * a seam does not test the seam. This asserts the PROMPT - the artefact the
 * model actually receives.
 */
describe('the prompt the model receives', () => {
  async function promptWith(attachments: { name: string; text: string }[]): Promise<string> {
    const { buildAskPrompt, buildDigest } = await import('../explain/explain.js');
    const { scanRepo } = await import('../scan.js');

    /* A repository small enough to scan in a unit test and real enough to
       produce a digest, which `buildAskPrompt` requires. */
    const repo = tmpRepo();
    fs.mkdirSync(path.join(repo, 'svc', 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, 'svc', 'package.json'),
      JSON.stringify({ name: 'svc', version: '1.0.0' }),
    );
    const src = ['export function go(): number {', '  return 1;', '}', ''].join('\n');
    fs.writeFileSync(path.join(repo, 'svc', 'src', 'index.ts'), src);

    const graph = await scanRepo(repo, { cluster: true });
    return buildAskPrompt(buildDigest(graph), 'why does this crash?', {
      attachmentLines: renderAttachmentSection(attachments),
    });
  }

  it('contains the attached text, under a header that says whose it is', async () => {
    const prompt = await promptWith([{ name: 'crash.log', text: 'ValueError: bad input at line 42' }]);
    assert.match(prompt, /ValueError: bad input at line 42/);
    assert.match(prompt, /ATTACHMENTS/);
    /* The one thing this must never allow: the model taking a pasted log for
       something it read out of the repository. */
    assert.match(prompt, /NOT read from this repository/);
  });

  it('adds nothing at all when the turn attached nothing', async () => {
    assert.doesNotMatch(await promptWith([]), /ATTACHMENTS/);
  });
});
