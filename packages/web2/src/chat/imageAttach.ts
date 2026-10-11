/* ══════════════════════════════════════════════════════════════════════════
   AN IMAGE FOR THE AGENT: PASTE, DROP, OR THE BOARD (S2a)
   packages/web2/src/chat/imageAttach.ts

   A screenshot pasted into the composer, an image dropped on it, or the
   board itself ("Send board PNG to agent", the board's own PNG export) goes
   to the chat's coding agent: Claude as an ACP image block, codex as a
   localImage (acp promptContent.ts).

   SCALED HERE, BEFORE IT IS SENT. The agents downsample anything with a long
   edge past 1568 px, so sending more spends the upload and their context on
   pixels they drop; the board exports at 2x (2058 x 2144 on shopfront). The
   server refuses a larger one (analyzer attachmentStore.ts), so this is the
   one place an image gets smaller.

   Stored through POST /api/attachment/image as its bytes; the chip appears
   once the server has answered an id, as text attachments do.
   ══════════════════════════════════════════════════════════════════════════ */


/** Long edge, in pixels, the agents take without downsampling (analyzer IMAGE_MAX_EDGE). */
export const IMAGE_MAX_EDGE = 1568;

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export function isImageFile(file: { type: string }): boolean {
  return (IMAGE_TYPES as readonly string[]).includes((file.type || '').toLowerCase());
}

/** The size that fits `max` on the long edge, keeping the aspect; unchanged when it already fits. */
export function fitLongEdge(width: number, height: number, max: number = IMAGE_MAX_EDGE): { width: number; height: number; scaled: boolean } {
  const edge = Math.max(width, height);
  if (edge <= max) return { width, height, scaled: false };
  const k = max / edge;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)), scaled: true };
}

/** Decode, scale to the long edge, re-encode (PNG stays PNG; anything else goes as JPEG). */
export async function scaleImage(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  const fit = fitLongEdge(bitmap.width, bitmap.height);
  if (!fit.scaled && isImageFile(source)) {
    bitmap.close?.();
    return source;
  }
  const canvas = document.createElement('canvas');
  canvas.width = fit.width;
  canvas.height = fit.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('this browser cannot scale images');
  ctx.drawImage(bitmap, 0, 0, fit.width, fit.height);
  bitmap.close?.();
  const type = source.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the image could not be encoded'))), type, 0.9));
}

export interface StoredImage {
  id: string;
  name: string;
  bytes: number;
  kind: 'image';
  mimeType: string;
  width: number;
  height: number;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Store the (already scaled) image in its chat (it lives and goes with the chat); the server's own sentence on a refusal. */
export async function uploadImage(blob: Blob, name: string, sessionId: string, f: Fetch = (i, init) => fetch(i, init)): Promise<StoredImage> {
  const res = await f(`/api/attachment/image?session=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': blob.type || 'image/png' }, body: blob });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `the engine refused the image (${res.status})`);
  }
  return ((await res.json()) as { attachment: StoredImage }).attachment;
}

