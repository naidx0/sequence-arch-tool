/* ══════════════════════════════════════════════════════════════════════════
   THINGS THE USER BRINGS THAT ARE NOT IN THE REPOSITORY
   packages/analyzer/src/server/attachmentStore.ts

   A user with a stack trace, a log excerpt or a config dump from somewhere
   else had no way to show it. The `@` picker resolves against the scanned
   graph and, by design, offers NO free-text fallback — so the only referable
   things were repository things.

   ── WHY THIS IS NOT A CONTEXT CHIP ───────────────────────────────────────

   `state/types.ts` records the ruling in as many words: a chip always carries
   a `ref` that exists in the attached repo, "there is no `kind: 'text'`
   member, and adding one would be the product lying about grounding in the one
   place it promises not to."

   That ruling is right and this does not touch it. An attachment is a
   different KIND of thing from a mention: a mention is a claim about the
   repository, and an attachment is evidence the user supplied. Both are real;
   only one of them is grounded in the scan. Keeping them separate types is
   what lets a surface show the difference — which is the whole point, because
   a pasted log that rendered identically to a scanned file would quietly
   borrow the scan's authority.

   ── LOCAL-FIRST, AND ON DISK ─────────────────────────────────────────────

   Content-addressed under `.sequence/attachments/`, the same shape the
   checkpoint store uses for blobs. Nothing leaves the machine, nothing needs
   a network, and pasting the same log twice costs one copy.

   ── AND BOUNDED, LOUDLY ──────────────────────────────────────────────────

   A pasted file can be any size and the prompt cannot. So there is a cap, and
   when it bites the TEXT SAYS SO — a silently halved log is how an assistant
   appears to ignore the second half of the evidence, with nothing on screen to
   explain why.
   ══════════════════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SEQUENCE_DIR = '.sequence';
const ATTACHMENTS_DIR = 'attachments';

/** Bytes. Generous for a stack trace or a log excerpt; hard against a dump. */
export const ATTACHMENT_CAP_BYTES = 128_000;

/** How many an attachment store keeps. Older ones are swept. */
export const ATTACHMENT_KEEP = 200;

export interface Attachment {
  /** sha256 of the content — the id AND the filename. */
  id: string;
  /** What the user called it: a dropped file's name, or a generated one. */
  name: string;
  /** Bytes stored, after any truncation. */
  bytes: number;
  /** True when the cap bit and `text` is not the whole thing. */
  truncated: boolean;
  at: number;
  /** S2a: an image (pasted, dropped, the board PNG) rather than text. Absent on text. */
  kind?: 'image';
  mimeType?: ImageMime;
  width?: number;
  height?: number;
}

/* ── S2a: IMAGES ─────────────────────────────────────────────────────────
   A pasted screenshot, a dropped file or the board PNG, for an agent that
   reads images (ACP image block, codex localImage). Stored as the bytes,
   content-addressed like text, and REFUSED (not repaired) when it is not
   what it says it is, too big, or wider than the agents take: the page
   scales to {@link IMAGE_MAX_EDGE} before it sends, so a larger one here is
   a client that skipped that, and silently passing it on would spend the
   agent's context on pixels it downsamples anyway. */

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';
const IMAGE_EXT: Record<ImageMime, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

/** Long edge, in pixels, the agents take without downsampling. */
export const IMAGE_MAX_EDGE = 1568;
/** Bytes; the per-image limit agents accept. */
export const IMAGE_CAP_BYTES = 5_000_000;

export class ImageRefused extends Error {}

/** What the bytes are (by their own header, never by name or claim), with their size, or null. */
export function imageInfo(b: Buffer): { mimeType: ImageMime; width: number; height: number } | null {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a && b.toString('latin1', 12, 16) === 'IHDR') {
    return { mimeType: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let at = 2;
    while (at + 9 < b.length) {
      if (b[at] !== 0xff) return null;
      const marker = b[at + 1]!;
      const len = b.readUInt16BE(at + 2);
      /* SOF0-3, 5-7, 9-11, 13-15 carry the frame size. */
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mimeType: 'image/jpeg', height: b.readUInt16BE(at + 5), width: b.readUInt16BE(at + 7) };
      }
      at += 2 + len;
    }
    return null;
  }
  if (b.length >= 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = b.toString('latin1', 12, 16);
    if (chunk === 'VP8 ') return { mimeType: 'image/webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { mimeType: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { mimeType: 'image/webp', width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  return null;
}

/**
 * WITH THE CHAT, NOT IN THE SHARED STORE. An image is sent to the agent by its
 * path (codex localImage), so it must be there when the chat resumes and gone
 * when the chat is deleted: it lives in the chat's own folder,
 * `.sequence/sessions/<id>/attachments/`, which deleting the chat removes
 * (sessionsStore deleteSession) and moving the chat to another repo copies.
 * The id is a jail as everywhere here: a session id that is not one plain
 * path segment names nothing.
 */
function sessionImageDir(repoRoot: string, sessionId: string): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sessionId) || sessionId.includes('..')) return null;
  return path.join(repoRoot, SEQUENCE_DIR, 'sessions', sessionId, ATTACHMENTS_DIR);
}

/** Store one image in the chat's folder; refuses a type it is not, more than {@link IMAGE_CAP_BYTES}, or a long edge past {@link IMAGE_MAX_EDGE}. */
export function putImageAttachment(repoRoot: string, sessionId: string, name: unknown, bytes: Buffer, declared?: string): Attachment {
  const dir = sessionImageDir(repoRoot, sessionId);
  if (!dir) throw new ImageRefused('an image belongs to a chat: no such chat id');
  if (bytes.byteLength === 0) throw new ImageRefused('an image needs bytes');
  if (bytes.byteLength > IMAGE_CAP_BYTES) throw new ImageRefused(`the image is ${bytes.byteLength} bytes; the limit is ${IMAGE_CAP_BYTES}`);
  const info = imageInfo(bytes);
  if (!info) throw new ImageRefused('not a PNG, JPEG or WebP image');
  if (declared && declared !== info.mimeType) throw new ImageRefused(`sent as ${declared}, but the bytes are ${info.mimeType}`);
  const edge = Math.max(info.width, info.height);
  if (edge > IMAGE_MAX_EDGE) throw new ImageRefused(`the image is ${info.width}x${info.height}; scale its long edge to ${IMAGE_MAX_EDGE} px first`);
  const id = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.mkdirSync(dir, { recursive: true });
  const blob = path.join(dir, `${id}${IMAGE_EXT[info.mimeType]}`);
  if (!fs.existsSync(blob)) fs.writeFileSync(blob, bytes);
  const record: Attachment = { id, name: safeName(name === undefined ? 'pasted image' : name), bytes: bytes.byteLength, truncated: false, at: Date.now(), kind: 'image', ...info };
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(record));
  return record;
}

/** A chat's stored image: its file and type, or null when the chat holds no image by that id. */
export function imageAttachmentFile(repoRoot: string, sessionId: string, id: string): { path: string; mimeType: ImageMime } | null {
  const dir = sessionImageDir(repoRoot, sessionId);
  if (!dir || !isAttachmentId(id)) return null;
  try {
    const rec: unknown = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));
    const mime = (rec as Partial<Attachment>)?.mimeType;
    if (!isAttachment(rec) || rec.kind !== 'image' || !mime || !(mime in IMAGE_EXT)) return null;
    const file = path.join(dir, `${id}${IMAGE_EXT[mime]}`);
    return fs.existsSync(file) ? { path: file, mimeType: mime } : null;
  } catch {
    return null;
  }
}

function storeDir(repoRoot: string): string {
  return path.join(repoRoot, SEQUENCE_DIR, ATTACHMENTS_DIR);
}

/**
 * A name safe to put in a prompt and show on screen.
 *
 * NEVER used as a filename — the id is the filename — so this is about
 * legibility, not path safety. Path safety is not delegated to a sanitiser:
 * the store simply never joins a user string onto a path.
 */
export function safeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'pasted text';
  const oneLine = raw.replace(/[\r\n\t]+/g, ' ').trim();
  if (oneLine === '') return 'pasted text';
  return oneLine.length > 120 ? `${oneLine.slice(0, 117)}…` : oneLine;
}

/**
 * Store one text attachment and answer its record.
 *
 * CONTENT-ADDRESSED, so the same paste twice is one file. The name is stored
 * beside it rather than in it, because two different pastes of the same log
 * under different names are the same bytes and should stay one blob.
 */
export function putAttachment(repoRoot: string, name: unknown, text: string): Attachment {
  if (typeof text !== 'string' || text === '') {
    throw new Error('an attachment needs text');
  }
  const full = Buffer.from(text, 'utf8');
  const truncated = full.byteLength > ATTACHMENT_CAP_BYTES;
  /* Cut on a CHARACTER boundary, not a byte one: slicing a Buffer mid
     code-point produces replacement characters in the middle of the user's
     evidence, which reads as corruption rather than as truncation. */
  const kept = truncated ? text.slice(0, ATTACHMENT_CAP_BYTES) : text;
  const body = Buffer.from(kept, 'utf8');

  const id = crypto.createHash('sha256').update(body).digest('hex');
  const dir = storeDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  const blob = path.join(dir, `${id}.txt`);
  if (!fs.existsSync(blob)) fs.writeFileSync(blob, body);

  const record: Attachment = {
    id,
    name: safeName(name),
    bytes: body.byteLength,
    truncated,
    at: Date.now(),
  };
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(record));
  sweep(repoRoot);
  return record;
}

/** The stored text, or null when the id names nothing. */
export function readAttachmentText(repoRoot: string, id: string): string | null {
  if (!isAttachmentId(id)) return null;
  try {
    return fs.readFileSync(path.join(storeDir(repoRoot), `${id}.txt`), 'utf8');
  } catch {
    return null;
  }
}

/** The record, or null. */
export function readAttachment(repoRoot: string, id: string): Attachment | null {
  if (!isAttachmentId(id)) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(storeDir(repoRoot), `${id}.json`), 'utf8'));
    return isAttachment(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * THE ID IS A FILENAME, so this is the jail.
 *
 * A sha256 hex string and nothing else. `..`, a separator, or a drive letter
 * all fail here rather than being stripped — stripping turns a hostile id into
 * a plausible one, and the caller can no longer tell it was ever hostile.
 */
export function isAttachmentId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isAttachment(v: unknown): v is Attachment {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Partial<Attachment>;
  return isAttachmentId(a.id) && typeof a.name === 'string' && typeof a.bytes === 'number';
}

/** Every attachment, newest first. Unreadable records are skipped, not faked. */
export function listAttachments(repoRoot: string): Attachment[] {
  let names: string[];
  try {
    names = fs.readdirSync(storeDir(repoRoot));
  } catch {
    return [];
  }
  const out: Attachment[] = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const rec = readAttachment(repoRoot, n.slice(0, -'.json'.length));
    if (rec) out.push(rec);
  }
  out.sort((a, b) => b.at - a.at);
  return out;
}

/** Keep the newest {@link ATTACHMENT_KEEP}; delete the rest with their blobs. */
function sweep(repoRoot: string): void {
  const all = listAttachments(repoRoot);
  if (all.length <= ATTACHMENT_KEEP) return;
  for (const old of all.slice(ATTACHMENT_KEEP)) {
    for (const ext of ['.txt', '.json']) {
      try {
        fs.unlinkSync(path.join(storeDir(repoRoot), `${old.id}${ext}`));
      } catch {
        /* Already gone. */
      }
    }
  }
}

/** Bytes of one attachment's text allowed into a single prompt. */
export const ATTACHMENT_PROMPT_CAP = 24_000;

/**
 * Render attachments as prompt lines.
 *
 * EACH ONE IS NAMED AND MARKED AS THE USER'S, because the model must not
 * mistake a pasted log for something it read out of the repository. The
 * distinction is the same one the type system makes, carried into the prompt
 * where the model can act on it — and it is stated in the section header
 * rather than left implicit.
 *
 * TRUNCATION IS DECLARED, twice over: once for the cap that bit on the way in,
 * once for the cap that bites here.
 */
export function renderAttachmentSection(
  items: readonly { name: string; text: string; truncated?: boolean }[],
): string[] {
  if (items.length === 0) return [];
  const lines = [
    '--- ATTACHMENTS (supplied by the user; NOT read from this repository) ---',
    'These were pasted or dropped in by the user. Treat them as evidence they',
    'provided, and say so when an answer rests on one — they are not part of the',
    'scanned codebase and no file in the repo necessarily matches them.',
  ];
  for (const item of items) {
    const cut = item.text.length > ATTACHMENT_PROMPT_CAP;
    lines.push('');
    lines.push(`[${item.name}]`);
    lines.push(cut ? item.text.slice(0, ATTACHMENT_PROMPT_CAP) : item.text);
    if (cut || item.truncated) {
      lines.push(`[This attachment was cut short. Say so if the answer depends on what follows.]`);
    }
  }
  return lines;
}
