/* ══════════════════════════════════════════════════════════════════════════
   THE QUEUE, DRAWN ABOVE THE COMPOSER (S5)
   packages/web2/src/composer/PromptQueueList.tsx

   One row per queued prompt, in send order: edit it in place, move it up or
   down, or take it back. Renders nothing when the queue is empty, so the
   composer is unchanged for everyone not using it.

   The composer (chat/** or v3/V3Chat.tsx) mounts it with the chat's key, and
   calls `useQueueDrain` with whether a turn is running and how to send: the
   exact lines are in the S5 report.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';

import './promptQueue.css';
import { promptQueue, type PromptQueue, type QueuedPrompt } from './promptQueue';
import { useQueueHeld, useQueuedPrompts } from './useQueue';

/* The hooks live in useQueue.ts (on the boot path); re-exported for the callers that import them from here. */
export { useQueueDrain, useQueueHeld, useQueuedPrompts } from './useQueue';

function Row({ item, index, count, queueKey, queue }: { item: QueuedPrompt; index: number; count: number; queueKey: string; queue: PromptQueue }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) fieldRef.current?.focus();
  }, [editing]);

  const save = (): void => {
    queue.edit(queueKey, item.id, text);
    setEditing(false);
  };

  return (
    <li className="pq-row" data-testid="prompt-queue-item" data-queue-id={item.id}>
      <span className="pq-n" aria-hidden="true">{index + 1}</span>
      {editing ? (
        <textarea
          ref={fieldRef}
          className="pq-edit"
          aria-label={`Edit queued prompt ${index + 1}`}
          value={text}
          rows={2}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              save();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setText(item.text);
              setEditing(false);
            }
          }}
        />
      ) : (
        <span className="pq-text" title={item.text}>
          {item.text}
        </span>
      )}
      <span className="pq-actions">
        {editing ? (
          <button type="button" className="pq-btn" onClick={save} aria-label={`Save queued prompt ${index + 1}`}>
            Save
          </button>
        ) : (
          <button type="button" className="pq-btn" onClick={() => (setText(item.text), setEditing(true))} aria-label={`Edit queued prompt ${index + 1}`} title="Edit">
            Edit
          </button>
        )}
        <button type="button" className="pq-btn" disabled={index === 0} onClick={() => queue.move(queueKey, item.id, -1)} aria-label={`Move queued prompt ${index + 1} up`} title="Move up">
          ↑
        </button>
        <button type="button" className="pq-btn" disabled={index === count - 1} onClick={() => queue.move(queueKey, item.id, 1)} aria-label={`Move queued prompt ${index + 1} down`} title="Move down">
          ↓
        </button>
        <button type="button" className="pq-btn" onClick={() => queue.remove(queueKey, item.id)} aria-label={`Remove queued prompt ${index + 1}`} title="Remove">
          ×
        </button>
      </span>
    </li>
  );
}

/** Whether the server has a turn running for this chat (this window's or another's). Any doubt counts as busy. */
export async function chatHasRunningTurn(queueKey: string, f: (u: string) => Promise<Response> = (u) => fetch(u)): Promise<boolean> {
  const chatId = queueKey.slice(queueKey.lastIndexOf('::') + 2);
  if (!chatId || chatId === 'none') return false;
  try {
    const r = await f(`/api/acp/runs?chatId=${encodeURIComponent(chatId)}`);
    if (!r.ok) return true;
    const body = (await r.json()) as { runs?: { status?: string }[] };
    return (body.runs ?? []).some((x) => x.status === 'running');
  } catch {
    return true;
  }
}

export function PromptQueueList({ queueKey, queue = promptQueue, isBusy = chatHasRunningTurn }: { queueKey: string; queue?: PromptQueue; isBusy?: (queueKey: string) => Promise<boolean> }) {
  const items = useQueuedPrompts(queueKey, queue);
  const held = useQueueHeld(queueKey, queue);
  const [note, setNote] = useState<string | null>(null);
  if (items.length === 0) return null;
  return (
    <section className="pq" data-testid="prompt-queue" data-held={held ? 'true' : 'false'} aria-label="Queued prompts">
      <p className="pq-head">
        {held ? (
          <>
            Held ({items.length}) <span className="pq-sub">not sent yet: queued before a restart or in another window</span>
            <button
              type="button"
              className="pq-btn"
              data-testid="prompt-queue-resume"
              onClick={() => {
                /* The server decides: nothing is sent into a chat while a turn is running in it. */
                void isBusy(queueKey).then((busy) => {
                  if (busy) setNote('A turn is still running in this chat. Resume when it ends.');
                  else {
                    setNote(null);
                    queue.release(queueKey);
                  }
                });
              }}
            >
              Resume
            </button>
          </>
        ) : (
          <>
            Queued ({items.length}) <span className="pq-sub">sends in order when this turn ends</span>
          </>
        )}
      </p>
      {note ? <p className="pq-sub" role="status" data-testid="prompt-queue-note">{note}</p> : null}
      <ol className="pq-list">
        {items.map((item, i) => (
          <Row key={item.id} item={item} index={i} count={items.length} queueKey={queueKey} queue={queue} />
        ))}
      </ol>
    </section>
  );
}
