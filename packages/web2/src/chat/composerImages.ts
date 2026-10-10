/* ══════════════════════════════════════════════════════════════════════════
   IMAGES INTO THE COMPOSER (S2a): paste, drop, the board
   packages/web2/src/chat/composerImages.ts

   Loaded when an image arrives, not at boot (v3/V3Chat.tsx imports it on the
   paste, the drop or the menu row). Each image is checked (attachmentModel
   refusalFor: only a chat that talks to an agent takes images), scaled to a
   1568 px long edge and stored (imageAttach.ts), then shown as a chip the
   next agent turn sends. A refusal or a failure is said through the one
   failure line the strip reads.
   ══════════════════════════════════════════════════════════════════════════ */

import type { Action } from '../state/store';
import { refusalFor } from './attachmentModel';
import { requestBoardPng } from './boardPngBus';
import { scaleImage, uploadImage, type StoredImage } from './imageAttach';

type Dispatch = (action: Action) => void;

const fail = (dispatch: Dispatch, message: string, route: string): void =>
  dispatch({ type: 'net/failed', failure: { status: null, message, route, at: Date.now() } } as Action);

const add = (dispatch: Dispatch, img: StoredImage): void =>
  dispatch({ type: 'composer/attachment-add', attachment: { id: img.id, name: img.name, bytes: img.bytes, kind: 'image', width: img.width, height: img.height } } as Action);

/** Pasted or dropped images. Resolves once each is stored or refused. */
export async function takeImageFiles(files: readonly File[], ctx: { agent: boolean; dispatch: Dispatch; sessionId: string }): Promise<void> {
  await Promise.all(
    files.map(async (file) => {
      const refusal = refusalFor(file, { images: ctx.agent });
      if (refusal) return fail(ctx.dispatch, refusal, 'paste');
      try {
        add(ctx.dispatch, await uploadImage(await scaleImage(file), file.name || 'pasted image.png', ctx.sessionId));
      } catch (e) {
        fail(ctx.dispatch, e instanceof Error ? e.message : String(e), 'POST /api/attachment/image');
      }
    }),
  );
}

/** A drop: images as above; text files attach as text; anything else is refused by name. */
export async function takeDroppedFiles(files: readonly File[], ctx: { agent: boolean; dispatch: Dispatch; sessionId: string; attachText?: (name: string, text: string) => void }): Promise<void> {
  const images = files.filter((f) => f.type.startsWith('image/'));
  const rest = files.filter((f) => !f.type.startsWith('image/'));
  for (const f of rest) {
    const refusal = refusalFor(f);
    if (refusal) fail(ctx.dispatch, refusal, 'drop');
    else
      await f
        .text()
        .then((text) => ctx.attachText?.(f.name, text))
        .catch(() => fail(ctx.dispatch, `${f.name} could not be read.`, 'drop'));
  }
  await takeImageFiles(images, ctx);
}

/** "Send the board to the agent": the board's own PNG export, scaled and stored. */
export async function takeBoardImage(dispatch: Dispatch, sessionId: string): Promise<void> {
  try {
    const png = await requestBoardPng();
    const blob = await (await fetch(png.dataUrl)).blob();
    add(dispatch, await uploadImage(await scaleImage(blob), 'board.png', sessionId));
  } catch (e) {
    fail(dispatch, e instanceof Error ? e.message : String(e), 'board');
  }
}
