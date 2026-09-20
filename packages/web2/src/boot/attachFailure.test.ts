import { describe, expect, it } from 'vitest';

import { ATTACH_FAILURE_KINDS, attachFailureCopy, classifyAttachFailure } from './attachFailure';

/**
 * ITEM 2.4 OWNS THE ATTACH-ERROR MAPPING, AND THIS IS WHERE IT IS PROVED.
 *
 * The state contract says it in one line: "Classification happens once, at the
 * client boundary (2.4 owns it), and every surface downstream reads this union
 * instead of re-deciding from a status code." Every one of the five §3.2 attach
 * errors reaches the user as words, and the difference between them matters to
 * a person: "that folder is above the boundary you may browse" and "that folder
 * is not there" are different instructions, and only the HTTP status separates
 * them on the wire.
 *
 * The 422 is the case with a ruling attached to it. `repoServer.ts` says so at
 * the throw site: a repo with no manifests is "out of v1 scope, not a failure:
 * surface it as a calm 422 carrying a distinct `code` so the home screen
 * renders an informational note, never the red error wall." So the test asserts
 * the TONE, not just the classification — a note that renders as a wall has
 * been classified correctly and shown dishonestly.
 */

describe('item 2.4 — the five attach errors, classified once', () => {
  it('classifies the calm 422 as a note that keeps the repo name', () => {
    const failure = classifyAttachFailure(422, {
      error: 'no deployment manifests found',
      code: 'no-manifests',
      repoName: 'notes',
    });

    expect(failure.kind).toBe('no-manifests');
    if (failure.kind !== 'no-manifests') return;
    expect(failure.repoName).toBe('notes');
    expect(attachFailureCopy(failure).tone).toBe('note');
  });

  it('does not treat a 422 without the code as the calm case', () => {
    // `code` is the stable discriminator. A 422 that does not carry it is some
    // other refusal, and dressing it up as the friendly note would tell the
    // user their repo simply has no manifests when the server said nothing of
    // the kind.
    expect(classifyAttachFailure(422, { error: 'unprocessable' }).kind).toBe('transport');
  });

  it('classifies the jail escape', () => {
    expect(classifyAttachFailure(403, { error: 'path escapes the browse root' }).kind).toBe(
      'outside-browse-root',
    );
  });

  it('classifies the home-directory refusal off the sentence the server sends', () => {
    const failure = classifyAttachFailure(400, {
      error:
        'Pick a project folder inside your home directory, not the home directory itself.',
    });
    expect(failure.kind).toBe('home-directory-itself');
  });

  it('classifies "not a directory"', () => {
    expect(classifyAttachFailure(400, { error: 'path is not a directory' }).kind).toBe(
      'not-a-directory',
    );
  });

  it('falls back to transport — carrying the server’s own words — on an unrecognised 400', () => {
    // The two 400s above are separated by message text because the server gives
    // no code for them. That is fragile by construction, so the FALLBACK has to
    // be the honest one: an unrecognised 400 is reported verbatim rather than
    // guessed into one of the two named cases.
    const failure = classifyAttachFailure(400, { error: 'body must include a string "path"' });
    expect(failure.kind).toBe('transport');
    expect(failure.message).toContain('body must include a string');
  });

  it('classifies the missing directory', () => {
    expect(classifyAttachFailure(404, { error: 'directory not found' }).kind).toBe('not-found');
  });

  it('classifies a scan that threw', () => {
    const failure = classifyAttachFailure(500, { error: 'scan failed: ENOENT' });
    expect(failure.kind).toBe('scan-threw');
    expect(failure.message).toContain('ENOENT');
  });

  it('classifies a dead server as transport with no status', () => {
    const failure = classifyAttachFailure(null, null, 'Failed to fetch');
    expect(failure.kind).toBe('transport');
    if (failure.kind !== 'transport') return;
    expect(failure.status).toBeNull();
  });

  it('never invents a message when the body carries none', () => {
    const failure = classifyAttachFailure(503, {});
    expect(failure.message.length).toBeGreaterThan(0);
    // The status is the only fact available, so the message must be about the
    // status rather than a sentence describing a cause nobody reported.
    expect(failure.message).toContain('503');
  });
});

describe('item 2.4 — every classified failure is renderable, and only one is a fault', () => {
  it('gives every member of the union a title, a body and a tone', () => {
    // The union has seven members and a switch over it is total, so the copy
    // table cannot quietly lose one. Without this, a member added later renders
    // as an empty box that looks like a layout bug.
    expect(ATTACH_FAILURE_KINDS).toHaveLength(7);

    for (const kind of ATTACH_FAILURE_KINDS) {
      const copy = attachFailureCopy(sample(kind));
      expect(copy.title.length, kind).toBeGreaterThan(0);
      expect(copy.body.length, kind).toBeGreaterThan(0);
      expect(['note', 'plain', 'fault']).toContain(copy.tone);
    }
  });

  it('spends a hue on the one case where something actually broke', () => {
    // Graphite law 1: every hue on screen is a claim about the world, and there
    // are never more hues than there are claims. A folder the user may not open
    // is a refusal — the app is working exactly as designed and nothing is
    // wrong. An engine that is not running is the local-first case and a red
    // wall there is the precise defect this lane exists to prevent. A scan that
    // THREW is the one attach outcome that is a fault about the world, and it
    // is the only one allowed to carry --wont.
    const faults = ATTACH_FAILURE_KINDS.filter((k) => attachFailureCopy(sample(k)).tone === 'fault');
    expect(faults).toEqual(['scan-threw']);
  });

  it('never discards the words that were actually reported', () => {
    // The copy table writes OUR sentence for each failure. The server's own
    // words — "path escapes the browse root", "scan failed: EACCES", whatever a
    // browser put in a TypeError — are the only part of a failure that is
    // evidence rather than authorship, and they are what a user can quote and a
    // maintainer can grep. Discarding them to make the strip tidy was a real
    // defect here: a transport that threw with "boom" rendered as the generic
    // "the engine is not running", which was both a lie and unfixable.
    for (const kind of ATTACH_FAILURE_KINDS) {
      const failure = sample(kind);
      const copy = attachFailureCopy(failure);
      const shown = `${copy.body} ${copy.detail ?? ''}`;
      expect(shown, kind).toContain(failure.message);
    }
  });

  it('offers a way forward on every failure', () => {
    for (const kind of ATTACH_FAILURE_KINDS) {
      const copy = attachFailureCopy(sample(kind));
      // Sheet 08.5's law, applied to a failure rather than an empty board:
      // what is not here, why it is not here, and ONE THING TO DO about it.
      // The third part is the one that gets dropped.
      expect(copy.action, kind).toBeTruthy();
    }
  });
});

/** One instance of each union member, so the copy table can be walked. Written
 *  as an exhaustive switch with one literal per arm rather than a clever
 *  default: a spread over a narrowed union does not produce a member of that
 *  union, and the compiler is the thing keeping this table complete. */
function sample(kind: (typeof ATTACH_FAILURE_KINDS)[number]) {
  const message = 'because the server said so';
  switch (kind) {
    case 'no-manifests':
      return { kind: 'no-manifests', repoName: 'notes', message } as const;
    case 'outside-browse-root':
      return { kind: 'outside-browse-root', message } as const;
    case 'home-directory-itself':
      return { kind: 'home-directory-itself', message } as const;
    case 'not-found':
      return { kind: 'not-found', message } as const;
    case 'not-a-directory':
      return { kind: 'not-a-directory', message } as const;
    case 'scan-threw':
      return { kind: 'scan-threw', message } as const;
    case 'transport':
      return { kind: 'transport', message, status: null } as const;
  }
}
