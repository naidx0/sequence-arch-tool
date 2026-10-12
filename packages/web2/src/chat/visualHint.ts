/* ══════════════════════════════════════════════════════════════════════════
   THE PRIVATE ONE-LINE HINT: "prefer visual components" (lane components)
   packages/web2/src/chat/visualHint.ts

   The router (schema/visual/router.ts, plain code, no model) reads the
   person's message. When it clearly asks for a chart, a diagram, a forecast
   or a load picture, the agent's copy of the message gets one more line
   naming the kit components to prefer. The transcript is untouched: the
   person sees only what they typed. Silent otherwise.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The prompt the agent gets: `full` (the message with its attached drawings), then, only when the router
 * fires on what the person TYPED (`message`, never the attachments), the hint line.
 */
/* The router is imported when a message is sent, so none of it is in the boot chunk. The hint is optional: when that
   chunk cannot be loaded (a page left open across an update, a file gone from disk) or the router throws, the
   message goes as it is rather than failing the send. */
export async function withVisualHint(message: string, full: string = message): Promise<string> {
  try {
    const { routeVisualIntent } = await import('@sequence/schema/dist/visual/router.js');
    const r = routeVisualIntent(message);
    return r ? `${full}\n\n[${r.hint}]` : full;
  } catch {
    return full;
  }
}
