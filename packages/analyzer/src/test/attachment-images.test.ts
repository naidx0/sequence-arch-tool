import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { IMAGE_CAP_BYTES, ImageRefused, imageAttachmentFile, imageInfo, putImageAttachment } from '../server/attachmentStore.js';

/* S2a: images in the attachment store. Type and size are read from the
   bytes' own header, never from a name or a claim; a store refuses rather
   than repairs. */

const pngOf = (w: number, h: number): Buffer => {
  const png = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(png);
  png.writeUInt32BE(w, 16);
  png.writeUInt32BE(h, 20);
  return png;
};

describe('images: type and size from their own bytes', () => {
  it('reads PNG, JPEG (SOF0) and WebP (VP8, VP8L, VP8X) headers; anything else is not an image', () => {
    assert.deepEqual(imageInfo(pngOf(1200, 800)), { mimeType: 'image/png', width: 1200, height: 800 });
    /* SOI, an APP0 segment of 16 bytes, then SOF0 (len 17, precision 8, height 600, width 900). */
    const jpeg = Buffer.concat([Buffer.from('ffd8ffe00010', 'hex'), Buffer.alloc(14), Buffer.from('ffc0001108025803840301220002110103110100', 'hex')]);
    assert.deepEqual(imageInfo(jpeg), { mimeType: 'image/jpeg', width: 900, height: 600 });
    const riff = (chunk: string, body: Buffer) => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from(chunk, 'latin1'), Buffer.alloc(4), body]);
    const vp8 = Buffer.alloc(14);
    vp8.writeUInt16LE(640, 6);
    vp8.writeUInt16LE(480, 8);
    assert.deepEqual(imageInfo(riff('VP8 ', vp8)), { mimeType: 'image/webp', width: 640, height: 480 });
    const vp8l = Buffer.alloc(10);
    vp8l[0] = 0x2f;
    vp8l.writeUInt32LE((320 - 1) | ((240 - 1) << 14), 1);
    assert.deepEqual(imageInfo(riff('VP8L', vp8l)), { mimeType: 'image/webp', width: 320, height: 240 });
    const vp8x = Buffer.alloc(10);
    vp8x.writeUIntLE(1567, 4, 3);
    vp8x.writeUIntLE(99, 7, 3);
    assert.deepEqual(imageInfo(riff('VP8X', vp8x)), { mimeType: 'image/webp', width: 1568, height: 100 });
    assert.equal(imageInfo(Buffer.from('GIF89a........................')), null);
  });

  it("stores an image in its chat's folder, content-addressed; refuses one too wide or too big; the chat id and the image id are jails", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-attach-img-'));
    try {
      const png = pngOf(1568, 10);
      const rec = putImageAttachment(root, 'chat-1', 'board.png', png, 'image/png');
      assert.deepEqual([rec.kind, rec.width, rec.height], ['image', 1568, 10]);
      assert.equal(putImageAttachment(root, 'chat-1', 'again.png', png).id, rec.id, 'same bytes, one blob');
      const file = imageAttachmentFile(root, 'chat-1', rec.id)!;
      assert.equal(file.path, path.join(root, '.sequence', 'sessions', 'chat-1', 'attachments', `${rec.id}.png`));
      assert.equal(file.mimeType, 'image/png');
      assert.ok(fs.readFileSync(file.path).equals(png));
      /* Another chat does not see it. */
      assert.equal(imageAttachmentFile(root, 'chat-2', rec.id), null);
      assert.throws(() => putImageAttachment(root, 'chat-1', 'w', pngOf(1569, 10)), ImageRefused);
      assert.throws(() => putImageAttachment(root, 'chat-1', 'big', Buffer.concat([png, Buffer.alloc(IMAGE_CAP_BYTES)])), ImageRefused);
      assert.throws(() => putImageAttachment(root, 'chat-1', 'claim', png, 'image/webp'), /bytes are image\/png/);
      for (const bad of ['../x', 'a/b', '..', '']) assert.throws(() => putImageAttachment(root, bad, 'x', png), ImageRefused, bad);
      assert.equal(imageAttachmentFile(root, 'chat-1', 'f'.repeat(64)), null);
      assert.equal(imageAttachmentFile(root, 'chat-1', '../x'), null);
      assert.equal(imageAttachmentFile(root, '../chat-1', rec.id), null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
