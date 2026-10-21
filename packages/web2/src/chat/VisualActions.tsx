/* Copy, Reference and Open for a drawn block (```svg and ```html). packages/web2/src/chat/VisualActions.tsx
   Quiet: each is a 26px icon with its name in a tooltip (hover, keyboard focus) and in its aria-label. They show
   when the card is hovered or holds focus, and always on touch. What a click did ("Copied", "Referenced, adds ~N
   tokens") shows in the tooltip for a moment and is announced. */

import { Fragment, lazy, Suspense, useEffect, useState } from 'react';

import type { SavedDrawing } from './drawingContext';
import { Icon, type IconName } from './Icon';
import { referenceChars, refTokens } from './drawingRefs';
import { useStoreIfAny } from '../state/connect';

const VisualOpenDialog = lazy(() => import('./VisualOpenDialog'));

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A file name with a line-break opportunity after each `-`, `_` and `.`: it wraps between words, never mid-word. */
export function BreakableName({ name }: { name: string }) {
  const parts = name.split(/(?<=[-_.])/);
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? <wbr /> : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}

/** One quiet header action: an icon, its name as the tooltip and the accessible name. `flash` keeps the tooltip shown (a click's result). */
export function CardAction({ icon, tip, testId, flash = false, onClick }: { icon: IconName; tip: string; testId: string; flash?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="s2-ibtn s2-ibtn-sm dgm-act" data-testid={testId} aria-label={tip} data-tip={tip} data-flash={flash ? 'true' : undefined} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

/** "Copy file name": the one place the workspace file name is reachable from the chat. It is never printed there. */
function CopyNameAction({ name }: { name: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  useEffect(() => {
    if (state === 'idle') return undefined;
    const t = setTimeout(() => setState('idle'), 1600);
    return () => clearTimeout(t);
  }, [state]);
  return <CardAction icon={state === 'ok' ? 'check' : 'file'} testId="chat-visual-copy-name" tip={state === 'idle' ? 'Copy file name' : state === 'ok' ? 'File name copied' : 'Copy failed'} flash={state !== 'idle'} onClick={() => void copyText(name).then((ok) => setState(ok ? 'ok' : 'fail'))} />;
}

/** Copy, Reference (inserts @drawing:<id> into the composer) and Open for a drawn block; the view toggle stays with the owner. */
export function VisualActions({ kind, source, saved }: { kind: 'svg' | 'html'; source: string; saved?: SavedDrawing | null }) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [open, setOpen] = useState(false);
  const [referenced, setReferenced] = useState(false);
  const store = useStoreIfAny();
  useEffect(() => {
    if (copied === 'idle') return undefined;
    const t = setTimeout(() => setCopied('idle'), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  useEffect(() => {
    if (!referenced) return undefined;
    const t = setTimeout(() => setReferenced(false), 2400);
    return () => clearTimeout(t);
  }, [referenced]);
  const tokens = refTokens(referenceChars(source));
  const reference = (): void => {
    if (!saved || !store) return;
    const draft = store.getState().composer.draft;
    const ref = `@drawing:${saved.id}`;
    store.dispatch({ type: 'composer/draft', text: draft.trim() === '' ? `${ref} ` : `${draft.replace(/\s*$/, '')} ${ref} ` });
    setReferenced(true);
    /* The draft is re-rendered into the field by the store; once it has, the caret goes after the reference so the
       person keeps typing from there instead of from wherever it was. */
    setTimeout(() => {
      const field = document.querySelector<HTMLTextAreaElement>('[data-testid="composer-field"]');
      if (!field) return;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }, 0);
  };
  const said = copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy failed' : referenced ? `Referenced, adds ~${tokens} tokens` : '';
  return (
    <>
      <CardAction icon={copied === 'ok' ? 'check' : 'copy'} testId="chat-visual-copy" tip={copied === 'idle' ? 'Copy source' : said} flash={copied !== 'idle'} onClick={() => void copyText(source).then((ok) => setCopied(ok ? 'ok' : 'fail'))} />
      {saved ? <CopyNameAction name={saved.name} /> : null}
      {saved && store ? (
        <CardAction
          icon={referenced ? 'check' : 'link'}
          testId="chat-visual-reference"
          tip={referenced ? `Referenced, adds ~${tokens} tokens` : `Reference ${saved.id} in your message, adds about ${tokens} tokens`}
          flash={referenced}
          onClick={reference}
        />
      ) : null}
      <CardAction icon="open" testId="chat-visual-open" tip="Open in the preview and editor" onClick={() => setOpen(true)} />
      <span className="dgm-sr" role="status">
        {said}
      </span>
      {open ? (
        <Suspense fallback={null}>
          <VisualOpenDialog kind={kind} source={source} onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
}
