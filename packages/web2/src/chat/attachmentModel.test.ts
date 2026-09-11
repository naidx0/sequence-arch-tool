import { describe, expect, it } from 'vitest';

import {
  PASTE_AS_ATTACHMENT_CHARS,
  PASTE_AS_ATTACHMENT_LINES,
  attachmentLabel,
  isAttachableFile,
  nameForPaste,
  refusalFor,
  shouldAttachPaste,
  sizeLabel,
} from './attachmentModel';

describe('when a paste stops being typing', () => {
  it('leaves ordinary typing alone', () => {
    /* Pasting a path, a function name or a sentence is typing. A chip
       appearing for it is the tool getting in the way. */
    expect(shouldAttachPaste('packages/web2/src/chat/Composer.tsx')).toBe(false);
    expect(shouldAttachPaste('why does the rail re-sort here?')).toBe(false);
    expect(shouldAttachPaste('')).toBe(false);
  });

  it('attaches a paste that is simply long', () => {
    expect(shouldAttachPaste('x'.repeat(PASTE_AS_ATTACHMENT_CHARS))).toBe(true);
    expect(shouldAttachPaste('x'.repeat(PASTE_AS_ATTACHMENT_CHARS - 1))).toBe(false);
  });

  it('attaches a paste that is TALL even when it is short', () => {
    /* A forty-line stack trace can be well under the character threshold and
       is still unmistakably a document. Height is what breaks the composer. */
    const tall = Array.from({ length: PASTE_AS_ATTACHMENT_LINES + 1 }, (_, i) => `at frame ${i}`).join('\n');
    expect(tall.length).toBeLessThan(PASTE_AS_ATTACHMENT_CHARS);
    expect(shouldAttachPaste(tall)).toBe(true);
  });

  it('does not count a trailing newline as another line', () => {
    const exact = Array.from({ length: PASTE_AS_ATTACHMENT_LINES }, (_, i) => `line ${i}`).join('\n');
    expect(shouldAttachPaste(exact)).toBe(false);
    expect(shouldAttachPaste(`${exact}\n`)).toBe(false);
  });
});

describe('naming something that arrived with no name', () => {
  it('takes the name from the content, not from a counter', () => {
    /* "Pasted 3" tells a reader nothing about which of their three pastes
       this is. */
    expect(nameForPaste('Traceback (most recent call last):\n  at x')).toBe('Traceback (most recent call last):');
  });

  it('skips leading blank lines rather than naming it nothing', () => {
    expect(nameForPaste('\n\n   \nERROR: connection refused')).toBe('ERROR: connection refused');
  });

  it('has a fallback for content with no line to take', () => {
    expect(nameForPaste('   \n  \n')).toBe('Pasted text');
  });

  it('bounds a runaway first line', () => {
    expect(nameForPaste('z'.repeat(400)).length).toBeLessThanOrEqual(60);
  });
});

describe('the chip a reader sees', () => {
  it('shows a size the way a file manager would', () => {
    expect(sizeLabel(80)).toBe('80 B');
    expect(sizeLabel(2048)).toBe('2 KB');
    expect(sizeLabel(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('SAYS WHEN THE CONTENT WAS CUT, on the chip itself', () => {
    /* A user whose 4MB log became 128KB has to see that here. Finding out
       from the answer, or not at all, is the tool appearing to have read
       something it did not. */
    expect(attachmentLabel({ id: 'a', name: 'huge.log', bytes: 128_000, truncated: true })).toMatch(/cut short/);
    expect(attachmentLabel({ id: 'a', name: 'small.log', bytes: 12 })).not.toMatch(/cut short/);
  });

  it('reads as name then size', () => {
    expect(attachmentLabel({ id: 'a', name: 'crash.log', bytes: 80 })).toBe('crash.log · 80 B');
  });
});

describe('what can be dropped', () => {
  it('takes text', () => {
    expect(isAttachableFile({ name: 'a.log', type: 'text/plain' })).toBe(true);
    expect(isAttachableFile({ name: 'a.json', type: 'application/json' })).toBe(true);
  });

  it('takes a file the browser could not type, rather than refusing it', () => {
    /* Browsers leave `type` empty for .log, .env and extensionless files. An
       empty type is "unknown, try it" — the read either produces text or it
       does not. */
    expect(isAttachableFile({ name: 'Dockerfile', type: '' })).toBe(true);
    expect(isAttachableFile({ name: '.env', type: '' })).toBe(true);
  });

  it('REFUSES an image, and says why in those words', () => {
    /* The honest answer today: the provider path takes `content` as a plain
       string and ACP sends a hardcoded text-only block, so an image cannot be
       sent. Accepting one and silently attaching its filename would be worse
       than saying no. */
    const png = { name: 'screenshot.png', type: 'image/png' };
    expect(isAttachableFile(png)).toBe(false);
    expect(refusalFor(png)).toMatch(/cannot send images yet/);
    expect(refusalFor(png)).toContain('screenshot.png');
  });

  it('refuses other binaries with a different sentence', () => {
    const zip = { name: 'bundle.zip', type: 'application/zip' };
    expect(isAttachableFile(zip)).toBe(false);
    expect(refusalFor(zip)).toMatch(/not text/);
  });

  it('has no refusal for a file it accepts', () => {
    expect(refusalFor({ name: 'a.log', type: 'text/plain' })).toBeNull();
  });
});
