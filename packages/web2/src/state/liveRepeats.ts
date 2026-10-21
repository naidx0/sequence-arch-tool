/* ══════════════════════════════════════════════════════════════════════════
   THE STREAMING ANSWER NEVER SHOWS A BLOCK OF TEXT TWICE IN A ROW
   packages/web2/src/state/liveRepeats.ts

   The Opus walk of 2026-10-15: "The final answer showed twice for about 1 s while streaming". A turn can run
   several model rounds (the harness asks again after a tool call, or to make the model act on a claim), and the
   streamed text of every round is appended to one live block. A round that says again what the round before it
   said made the final answer appear two and three times until the turn ended and the one committed message
   replaced the block.

   The live block is made of the text as streamed; this reads it for the one thing that is never worth showing,
   a block that repeats the block immediately before it (whole, or so far as it has streamed). Pure: the raw text
   is kept untouched, so a later delta that makes the new block different from the old one shows it in full.
   ══════════════════════════════════════════════════════════════════════════ */

/** A repeat shorter than this is a legitimate echo ("Yes. Yes."), not a round saying itself again. */
export const MIN_REPEAT_CHARS = 24;
/** Only the tail is looked at: the text is re-read on every delta. */
const WINDOW_CHARS = 6000;

const BOUNDARY = /[.!?:;)\]"'`\n]/;

/** `text` without a trailing block that repeats the one before it (applied until none is left). */
export function dropRepeatedTail(text: string): string {
  let out = text;
  for (let guard = 0; guard < 50; guard += 1) {
    const next = dropOnce(out);
    if (next === out) return out;
    out = next;
  }
  return out;
}

function dropOnce(text: string): string {
  const start = Math.max(0, text.length - WINDOW_CHARS);
  /* The cheap way out, taken on nearly every delta: a repeated tail's last words must already be somewhere before it. */
  if (text.length < MIN_REPEAT_CHARS * 2 || text.lastIndexOf(text.slice(-MIN_REPEAT_CHARS), text.length - MIN_REPEAT_CHARS - 1) < start) return text;
  /* A tail begins where a sentence or paragraph ended: the earliest such place where what follows repeats the text just before it. */
  for (let p = start + 1; p <= text.length - MIN_REPEAT_CHARS; p += 1) {
    const before = text[p - 1]!;
    if (!BOUNDARY.test(before) && text[p] !== '\n') continue;
    const tail = text.slice(p);
    const head = tail.slice(0, MIN_REPEAT_CHARS);
    /* The nearest earlier place the same words began, close enough that the block between them is the one repeated. */
    const at = text.lastIndexOf(head, p - 1);
    if (at < start) continue;
    const previous = text.slice(at, p);
    if (previous.length >= tail.length && previous.startsWith(tail)) return text.slice(0, p);
  }
  return text;
}
