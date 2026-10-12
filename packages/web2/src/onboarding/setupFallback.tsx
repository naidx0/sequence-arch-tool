/* ══════════════════════════════════════════════════════════════════════════
   SETUP WITH NOTHING TO ANSWER IT
   packages/web2/src/onboarding/setupFallback.tsx

   "Set up in chat" drafts a prompt into the chat composer for an agent or a
   model to answer. With no agent and no model connected nobody answers it, so
   the draft is a dead end. In that one case the surface offers the same prompt
   to copy (to paste into Claude Code or Codex in the person's own terminal) and
   a way to connect a model instead.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';

import type { ModelSelection } from '../state/types';
import './onboarding.css';

/** True when the composer names a model that can answer (the same test the status bar uses). */
export function modelConfigured(sel: ModelSelection | undefined): boolean {
  return !!sel && sel.origin !== 'unconfigured' && sel.model !== '';
}

/** Nothing can answer a drafted prompt: no agent is connected and no model is. */
export function nothingCanAnswer(agentCount: number, sel: ModelSelection | undefined): boolean {
  return agentCount === 0 && !modelConfigured(sel);
}

/** Copies to the clipboard. False when the browser refuses or has no clipboard. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export interface CopyPromptButtonProps {
  text: string;
  className: string;
  testid: string;
  label?: string;
  /** `menuitem` inside a menu. */
  role?: string;
}

/**
 * "Copy setup prompt": copies the text and says "Copied". If the clipboard is
 * unavailable the prompt is shown selected in a read-only box, so it can be
 * copied by hand.
 */
export function CopyPromptButton({ text, className, testid, label = 'Copy setup prompt', role }: CopyPromptButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'select'>('idle');
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (state === 'select') {
      box.current?.focus();
      box.current?.select();
    }
    if (state !== 'copied') return undefined;
    const t = setTimeout(() => setState('idle'), 2500);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <>
      <button
        type="button"
        {...(role ? { role } : {})}
        className={className}
        data-testid={testid}
        onClick={() => {
          void copyToClipboard(text).then((ok) => setState(ok ? 'copied' : 'select'));
        }}
      >
        {state === 'copied' ? 'Copied' : label}
      </button>
      {state === 'select' ? (
        <textarea
          ref={box}
          readOnly
          rows={6}
          className="setup-prompt-box"
          aria-label="Setup prompt, select and copy"
          data-testid={`${testid}-text`}
          value={text}
          onFocus={(e) => e.currentTarget.select()}
        />
      ) : null}
    </>
  );
}
