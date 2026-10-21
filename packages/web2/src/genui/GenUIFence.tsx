/* ══════════════════════════════════════════════════════════════════════════
   A ```genui FENCE IN A CHAT MESSAGE
   packages/web2/src/genui/GenUIFence.tsx

   For an agent that only writes text (any CLI agent through ACP): the message's
   fence is the op stream. As the message grows, the new text is fed to the same
   session pipeline the tool path uses (stream, lossless fixes, validation,
   motion); when the fence closes, the pass is settled. There is no one to ask
   mid-message, so the repair goes straight from lossless to the fallback, and
   the diagnostics are offered back to the agent with the action events.

   A click becomes a ui.action. The chat that owns the agent listens for the
   `sequence:genui-action` window event (detail: { action, prompt, whileBusy }) and sends
   the prompt as the next turn or steers it into a running one (chatActions.ts); the chat
   announces its turns with `sequence:genui-turn`. See docs/genui/README.md.
   ══════════════════════════════════════════════════════════════════════════ */
import { useContext, useEffect, useMemo, useRef } from 'react';
import { actionToPrompt, type UIAction } from '@sequence/genui';

import { StreamingContext } from '../chat/DiagramBlock';
import { Emitter, type GenUIAgent } from './agent';
import { GENUI_ACTION_EVENT, GENUI_TURN_EVENT, type GenUIActionDetail } from './chatActions';
import { GenUISurface } from './GenUISurface';
import { useGenUISession } from './useGenUISession';

class FenceAgent extends Emitter implements GenUIAgent {
  constructor(private surfaceId: string) {
    super();
  }
  start(): void {}
  sendAction(a: UIAction): void {
    const label = this.labelOf?.(a.elementId);
    const detail: GenUIActionDetail = { action: a, prompt: actionToPrompt(a, label), whileBusy: this.whileBusyOf?.(a.name) === true };
    window.dispatchEvent(new CustomEvent(GENUI_ACTION_EVENT, { detail }));
  }
  labelOf?: (elementId: string) => string | undefined;
  whileBusyOf?: (actionName: string) => boolean | undefined;
  async repair(): Promise<null> {
    return null;
  }
  feed(chunk: string): void {
    if (chunk) this.emit({ kind: 'ui.text', surfaceId: this.surfaceId, chunk });
  }
  end(): void {
    this.emit({ kind: 'ui.end', surfaceId: this.surfaceId });
  }
}

export function GenUIFence({ source, open = false, surfaceId = 'fence' }: { source: string; open?: boolean; surfaceId?: string }): JSX.Element {
  const streaming = useContext(StreamingContext);
  const live = streaming && open;
  const agent = useMemo(() => new FenceAgent(surfaceId), [surfaceId]);
  const [view, session] = useGenUISession(agent);
  const fed = useRef(0);
  const ended = useRef(false);
  /* The chat says when its turn starts and ends (chatActions.ts announceGenUITurn): the session reads it as `turn`,
     which disables controls while the agent works and clears a clicked button's spinner when the turn is over. */
  useEffect(() => {
    const on = (e: Event): void => agent.emit({ kind: 'turn', busy: (e as CustomEvent<{ busy?: boolean }>).detail?.busy === true });
    window.addEventListener(GENUI_TURN_EVENT, on);
    return () => window.removeEventListener(GENUI_TURN_EVENT, on);
  }, [agent]);
  useEffect(() => {
    /* The message only grows while it streams; a replaced message starts over. */
    if (source.length < fed.current) fed.current = 0;
    agent.feed(source.slice(fed.current));
    fed.current = source.length;
    if (!live && !ended.current) {
      ended.current = true;
      agent.feed('\n');
      agent.end();
    }
  }, [source, live, agent]);
  const surface = view.surfaces[0];
  agent.labelOf = (id) => String(surface?.spec.elements[id]?.props.label ?? '') || undefined;
  agent.whileBusyOf = (name) => surface?.spec.actions[name]?.whileBusy;
  if (!surface) return <div className="gu-skel" aria-busy="true" />;
  return <GenUISurface view={surface} busy={live} onClick={(sid, eid) => session.click(sid, eid)} />;
}

export default GenUIFence;
