/* ══════════════════════════════════════════════════════════════════════════
   WHEN A PASTE STOPS BEING TYPING
   packages/web2/src/chat/attachmentModel.ts

   A user with a stack trace, a log excerpt or a config dump had no way to show
   it. The `@` picker resolves against the scan and offers no free-text
   fallback by design, so the only referable things were repository things.

   ── AN ATTACHMENT IS NOT A CONTEXT CHIP, AND THAT IS DELIBERATE ──────────

   `state/types.ts` rules that a chip always carries a `ref` that exists in the
   attached repo, and that adding a text member "would be the product lying
   about grounding in the one place it promises not to". That ruling is right
   and nothing here touches it.

   A mention is a CLAIM ABOUT THE REPOSITORY; an attachment is EVIDENCE THE
   USER SUPPLIED. Both are real, only one is grounded in the scan, and keeping
   them separate types is what lets a surface show the difference. A pasted log
   rendered identically to a scanned file would quietly borrow the scan's
   authority — which is the exact failure the chip ruling exists to prevent,
   arriving by a different road.

   ── WHY A THRESHOLD AT ALL ───────────────────────────────────────────────

   Turning EVERY paste into an attachment would be maddening: pasting a
   function name, a path or a sentence is ordinary typing, and a chip appearing
   for it is the tool getting in the way. Turning NO paste into one leaves a
   four-hundred-line log inside a one-line composer, where it cannot be read,
   edited or removed without selecting all of it.

   So there is a line, and the line is drawn where a paste stops being
   something you would have typed.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Characters past which a paste becomes an attachment.
 *
 * NOT tuned to a model's context window — that is the server's cap, and it is
 * a different question. This one is about the COMPOSER: roughly the point at
 * which the pasted text stops fitting somewhere a person can still read the
 * sentence they were writing.
 */
export const PASTE_AS_ATTACHMENT_CHARS = 2_000;

/**
 * Lines past which a paste becomes an attachment regardless of length.
 *
 * A forty-line stack trace can be well under the character threshold and is
 * still unmistakably a document rather than a phrase. Height is what makes the
 * composer unusable, so height gets its own test.
 */
export const PASTE_AS_ATTACHMENT_LINES = 20;

/** Whether this paste should become an attachment rather than inline text. */
export function shouldAttachPaste(text: string): boolean {
  if (typeof text !== 'string' || text === '') return false;
  if (text.length >= PASTE_AS_ATTACHMENT_CHARS) return true;
  /* `split` counts the segments between newlines, which is the number of
     lines a reader sees — a trailing newline does not add one. */
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return body.split('\n').length > PASTE_AS_ATTACHMENT_LINES;
}

/**
 * A name for something pasted, which arrives with none.
 *
 * TAKEN FROM THE CONTENT, because a counter ("Pasted 3") tells the reader
 * nothing about which of their three pastes this is. The first non-empty line
 * is what a person would call it themselves.
 */
export function nameForPaste(text: string): string {
  const first = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '');
  if (first === undefined) return 'Pasted text';
  return first.length > 60 ? `${first.slice(0, 57)}…` : first;
}

/** Bytes, rendered the way a file manager would. Never a bare number. */
export function sizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface AttachmentView {
  id: string;
  name: string;
  bytes: number;
  truncated?: boolean;
}

/**
 * The one line an attachment chip shows.
 *
 * THE TRUNCATION IS PART OF THE LABEL. A user whose 4MB log was cut to 128KB
 * has to be able to see that from the chip — finding out only from the
 * assistant's answer, or not at all, is how the tool appears to have read
 * something it did not.
 */
export function attachmentLabel(a: AttachmentView): string {
  const size = sizeLabel(a.bytes);
  const base = size === '' ? a.name : `${a.name} · ${size}`;
  return a.truncated ? `${base} · cut short` : base;
}

/**
 * Whether a dropped file is text this product can attach.
 *
 * TYPE FIRST, EXTENSION SECOND. Browsers leave `type` empty for plenty of
 * ordinary text files (`.log`, `.env`, files with no extension at all), so an
 * empty type is treated as "unknown, try it" rather than as a refusal — the
 * read either produces text or it does not.
 *
 * An IMAGE IS REFUSED HERE, explicitly and by name, because the honest answer
 * today is that this product cannot send one: the provider path takes `content`
 * as a plain string and the ACP client sends a hardcoded text-only block.
 * Accepting an image and silently attaching its filename would be worse than
 * saying no.
 */
export function isAttachableFile(file: { name: string; type: string }): boolean {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/')) return false;
  if (type.startsWith('text/')) return true;
  if (type === 'application/json' || type === 'application/xml' || type === 'application/yaml') return true;
  if (type !== '') return false;
  /* No type. Judge by extension, and when there is none, allow it: a file
     called `Dockerfile` or `.env` is text far more often than it is not. */
  return true;
}

/** Why a file was refused, in the reader's terms. Null when it was not. */
export function refusalFor(file: { name: string; type: string }): string | null {
  if (isAttachableFile(file)) return null;
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/')) {
    /* Named precisely, because "unsupported file" would leave the user
       guessing whether to try a different image. */
    return `Sequence cannot send images yet — ${file.name} was not attached.`;
  }
  return `${file.name} is not text, so it was not attached.`;
}
