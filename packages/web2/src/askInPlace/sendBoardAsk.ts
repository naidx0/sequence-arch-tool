/* ══════════════════════════════════════════════════════════════════════════
   SEND WHAT WAS TYPED ON THE BOARD, AS A MESSAGE IN THE MAIN CHAT
   packages/web2/src/askInPlace/sendBoardAsk.ts

   The popover's words become a NORMAL user message in the active chat, with
   three things riding on it:

     the chip         `board-ref`: its label is what the transcript shows on the
                      message, its `detail` is the structured block (ids, kinds,
                      labels, connections or file paths) the agent prompt gets
     the image        the cropped PNG (snapshot.ts), through the same attachment
                      pipeline a pasted screenshot uses (chat/imageAttach.ts).
                      Best effort: a refusal or failure sends without it, and
                      the message still carries the block.
     the focus        the chat is brought forward (host command) and the
                      composer takes focus

   The send itself is the mounted chat's (boardAskBus.ts), so it goes to the
   coding agent when the chat talks to one and to the engine's ask otherwise,
   with the composer's chips and attachments, exactly like typing in the chat.
   A draft the reader had half-typed in the composer is put back afterwards.
   ══════════════════════════════════════════════════════════════════════════ */

import { requestHostCommand } from '../app/hostCommands';
import { scaleImage, uploadImage, type StoredImage } from '../chat/imageAttach';
import type { Store } from '../state/store';
import { sendThroughChat } from './boardAskBus';
import { referenceChip } from './askReference';
import type { AskPayload } from './useAskInPlace';

export interface SendBoardAskDeps {
  upload?: (blob: Blob, name: string, sessionId: string) => Promise<StoredImage>;
  send?: (text: string) => boolean;
}

export interface SendBoardAskResult {
  /** The message went out through a mounted chat (false: it was left in the composer). */
  sent: boolean;
  image: 'attached' | 'none' | 'failed';
}

export async function sendBoardAsk(store: Store, payload: AskPayload, deps: SendBoardAskDeps = {}): Promise<SendBoardAskResult> {
  const { dispatch } = store;
  const prior = store.getState().composer.draft;
  dispatch({ type: 'composer/chip-add', chip: referenceChip(payload.reference) });

  let image: SendBoardAskResult['image'] = 'none';
  if (payload.image) {
    try {
      const sessionId = store.getState().session.activeId ?? '';
      const stored = await (deps.upload ?? (async (b: Blob, n: string, s: string) => uploadImage(await scaleImage(b), n, s)))(
        payload.image,
        'board-selection.png',
        sessionId,
      );
      dispatch({
        type: 'composer/attachment-add',
        attachment: { id: stored.id, name: stored.name, bytes: stored.bytes, kind: 'image', width: stored.width, height: stored.height },
      });
      image = 'attached';
    } catch {
      image = 'failed';
    }
  }

  /* The chat comes forward first, so the message lands where the reader is looking. */
  requestHostCommand('chat.show');
  dispatch({ type: 'composer/focus' });

  const sent = (deps.send ?? sendThroughChat)(payload.text);
  if (!sent) {
    /* No chat mounted: leave the words in the composer, chip and image beside them. */
    dispatch({ type: 'composer/draft', text: payload.text });
  } else if (prior !== '') {
    dispatch({ type: 'composer/draft', text: prior });
  }
  return { sent, image };
}
