/* ══════════════════════════════════════════════════════════════════════════
   AN AGENT'S ```html BLOCK, SHOWN IN THE CHAT (T3 gap, lane `visual`)
   packages/web2/src/chat/VisualBlock.tsx

   Idea after T3 Code's inline HTML renders (MIT, github.com/pingdotgg/t3code,
   apps/web/src/components/chat/HtmlRenderFrame.tsx, checked at b707eeb): when an
   agent builds a demo, the reader sees it in the thread, not as a wall of tags.

     - Drawn only once the fence is CLOSED. A half-written page is a flicker of
       broken layouts; while the block is open the card says "Drawing…".
     - A sandboxed frame: scripts allowed, `allow-same-origin` never, network
       refused by CSP (visualDoc.ts). Themed with the app's light/dark tokens
       and re-themed when the theme flips.
     - View source / Copy / Open (a larger scratch viewer with an editor).
     - Over the size cap it stays code, with a note and "Open".

   The sibling for ```svg is DiagramBlock.tsx, which shares the actions below.
   ══════════════════════════════════════════════════════════════════════════ */

import { useContext, useEffect, useMemo, useRef, useState } from 'react';

import { CodeBlock } from './CodeBlock';
import { StreamingContext } from './DiagramBlock';
import { FRAME_STOPPED_NOTE, useFrameGuard } from './frameGuard';
import { useSavedDrawing } from './drawingContext';
import { CardAction, VisualActions } from './VisualActions';
import { VisualCard } from './VisualCard';
import {
  clampVisualHeight,
  kb,
  overVisualCap,
  readVisualTheme,
  themeMessage,
  VISUAL_DEFAULT_HEIGHT,
  VISUAL_HEIGHT_MESSAGE,
  VISUAL_MAX_CHARS,
  VISUAL_SANDBOX,
  visualDocument,
  type VisualTheme,
} from './visualDoc';

import './diagramBlock.css';

/** The app theme, re-read when `data-theme` or `data-accent` flips or the system scheme changes. */
function useVisualTheme(host: React.RefObject<Element | null>): VisualTheme {
  const [theme, setTheme] = useState<VisualTheme>(() => readVisualTheme());
  useEffect(() => {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return undefined;
    const update = (): void => {
      const next = readVisualTheme(host.current);
      setTheme((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent', 'class'] });
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    mq?.addEventListener?.('change', update);
    return () => {
      mo.disconnect();
      mq?.removeEventListener?.('change', update);
    };
  }, [host]);
  return theme;
}

/** The last height each page reported, by its source: a remounted frame (a virtualised list scrolling back) starts at it, so nothing jumps. */
const heightCache = new Map<string, number>();
const hashOf = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${h}`;
};

/** True once the element has been near the viewport (always true without IntersectionObserver). */
function useNearViewport(ref: React.RefObject<Element | null>): boolean {
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (near || !ref.current || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '400px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [near, ref]);
  return near;
}

export function HtmlBlock({ source, open = false, drawingId }: { source: string; open?: boolean; drawingId?: string }) {
  const streaming = useContext(StreamingContext);
  const incomplete = streaming && open;
  const [asSource, setAsSource] = useState(false);
  const figure = useRef<HTMLElement | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const theme = useVisualTheme(figure);
  const near = useNearViewport(figure);
  const tooBig = overVisualCap(source);
  const empty = source.trim() === '';
  const key = useMemo(() => hashOf(source), [source]);
  const [height, setHeight] = useState(() => heightCache.get(key) ?? VISUAL_DEFAULT_HEIGHT);
  /* The document keeps the theme it was first drawn in; a flip is posted into the live frame (below), never a reload. */
  const first = useRef(theme);
  const doc = useMemo(() => (incomplete || tooBig || empty ? '' : visualDocument(source, first.current)), [incomplete, tooBig, empty, source]);
  const guard = useFrameGuard(doc);
  const saved = useSavedDrawing('html', source, !incomplete && !tooBig && !empty, drawingId);

  useEffect(() => {
    const on = (e: MessageEvent): void => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data as Record<string, unknown> | null;
      if (d && typeof d === 'object' && VISUAL_HEIGHT_MESSAGE in d) {
        const h = clampVisualHeight(d[VISUAL_HEIGHT_MESSAGE]);
        heightCache.set(key, h);
        setHeight(h);
      }
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [key]);

  /* Theme flip: post the new variables (the page keeps its state). */
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(themeMessage(theme), '*');
  }, [theme]);

  const state = incomplete ? 'pending' : tooBig ? 'capped' : 'drawn';
  const showCode = !incomplete && (asSource || tooBig);
  return (
    <VisualCard
      kind="html"
      state={state}
      label="Page"
      saved={saved}
      source={source}
      figureRef={figure}
      resizable={state === 'drawn' && !showCode && !guard.stopped}
      keepMounted={false}
      actions={
        !incomplete ? (
          <>
            {!tooBig ? (
              <CardAction icon={asSource ? 'eye' : 'code'} testId="chat-diagram-toggle" tip={asSource ? 'View page' : 'View source'} onClick={() => setAsSource((v) => !v)} />
            ) : null}
            <VisualActions kind="html" source={source} saved={saved} />
          </>
        ) : null
      }
    >
      {incomplete ? (
        <p className="dgm-note" role="status" data-testid="chat-visual-pending">
          Drawing…
        </p>
      ) : guard.stopped ? (
        <p className="dgm-note" role="status" data-testid="chat-frame-stopped">
          {FRAME_STOPPED_NOTE}
        </p>
      ) : showCode ? (
        <CodeBlock text={source} language="html" />
      ) : near ? (
        <iframe
          ref={frame}
          className="dgm-frame"
          data-testid="chat-html-frame"
          title="Page drawn by the agent"
          sandbox={VISUAL_SANDBOX}
          referrerPolicy="no-referrer"
          loading="lazy"
          srcDoc={doc}
          onLoad={(e) => {
            guard.onLoad(e.currentTarget);
            e.currentTarget.contentWindow?.postMessage(themeMessage(theme), '*');
          }}
          style={{ height, colorScheme: theme.dark ? 'dark' : 'light' }}
        />
      ) : (
        <div className="dgm-frame" data-testid="chat-html-placeholder" style={{ height }} />
      )}
      {tooBig && !incomplete ? (
        <p className="dgm-note" role="status" data-testid="chat-visual-capped">
          Too large to draw in the chat ({kb(source.length)}; the limit is {kb(VISUAL_MAX_CHARS)}). Use Open to see it.
        </p>
      ) : null}
    </VisualCard>
  );
}

export default HtmlBlock;
