/* ══════════════════════════════════════════════════════════════════════════
   A ```visual BLOCK: A KIT COMPONENT FILLED IN WITH DATA (lane components)
   packages/web2/src/chat/VisualKitBlock.tsx

   The agent writes the JSON the `visual` tool takes,
       ```visual
       {"component":"line","spec":{...}}
       ```
   or, for a drawing the tool already saved, {"id":"d5"}. The kit (schema/visual)
   validates and draws deterministic svg; that svg goes through the same card
   as an agent's ```svg block (sanitiser, saved as a drawing with an id, Copy,
   Reference, Open), so the result is the same drawing either way.

     - Drawn once the fence is closed; "Drawing…" while it streams.
     - A spec the kit refuses shows the problem (path and what was found) above the JSON.
     - `visual id=d5` with a spec saves a new version of d5, like ```svg id=d5.
   The kit is imported on use (a dynamic import), so it is not in the boot chunk.
   ══════════════════════════════════════════════════════════════════════════ */

import { useContext, useEffect, useRef, useState } from 'react';

import { CodeBlock } from './CodeBlock';
import { DiagramBlock, StreamingContext } from './DiagramBlock';
import type { SavedDrawing } from './drawingContext';

import './diagramBlock.css';

type View = { kind: 'pending' } | { kind: 'svg'; svg: string; saved: SavedDrawing | null } | { kind: 'error'; message: string };

export async function resolveVisual(source: string, fetchImpl: typeof fetch = fetch, columnWidth?: number): Promise<View> {
  const kit = await import('@sequence/schema/dist/visual/index.js');
  const f = kit.parseVisualFence(source);
  if (f.kind === 'error') return { kind: 'error', message: f.message };
  if (f.kind === 'spec') {
    try {
      return { kind: 'svg', svg: kit.renderVisual(f.component, f.spec, { title: f.title, width: f.width ?? columnWidth }).svg, saved: null };
    } catch (e) {
      return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  }
  try {
    const res = await fetchImpl(`/api/drawings/${encodeURIComponent(f.id)}`);
    if (!res.ok) return { kind: 'error', message: `no drawing "${f.id}" in this project` };
    const d = (await res.json()) as { id: string; name: string; version: number; kind: string; source: string; title?: string };
    if (d.kind !== 'svg') return { kind: 'error', message: `"${f.id}" is a ${d.kind} page, not a kit drawing` };
    return { kind: 'svg', svg: d.source, saved: { id: d.id, name: d.name, version: d.version, title: d.title } };
  } catch {
    return { kind: 'error', message: `could not read drawing "${f.id}"` };
  }
}

export function VisualKitBlock({ source, open = false, drawingId }: { source: string; open?: boolean; drawingId?: string }) {
  const streaming = useContext(StreamingContext);
  const incomplete = streaming && open;
  const [view, setView] = useState<View>({ kind: 'pending' });
  /* The kit draws at the column's width (text stays at its drawn size, 11px and up) instead of at a fixed width scaled down to fit. */
  const probe = useRef<HTMLDivElement | null>(null);
  const [column, setColumn] = useState<number | undefined>(undefined);
  useEffect(() => {
    const el = probe.current;
    if (!el) return undefined;
    const read = (): void => {
      const w = el.clientWidth - 18;
      setColumn(w >= 280 ? Math.min(760, Math.floor(w / 20) * 20) : undefined);
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (incomplete) return undefined;
    let live = true;
    void resolveVisual(source, undefined, column).then((v) => live && setView(v));
    return () => {
      live = false;
    };
  }, [incomplete, source, column]);

  let content: React.ReactNode;
  if (view.kind === 'svg' && !incomplete) {
    content = <DiagramBlock kind="svg" source={view.svg} drawingId={drawingId} codeText={source} fixedSaved={view.saved} />;
  } else if (view.kind === 'error' && !incomplete) {
    content = (
      <figure className="dgm" data-testid="chat-diagram" data-kind="visual" data-state="failed">
        <figcaption className="dgm-bar">
          <span className="dgm-label">Drawing</span>
        </figcaption>
        <p className="dgm-note" role="status" data-testid="chat-visual-error">
          Couldn't draw this: {view.message}
        </p>
        <CodeBlock text={source} language="json" />
      </figure>
    );
  } else {
    content = (
      <figure className="dgm" data-testid="chat-diagram" data-kind="visual" data-state="pending">
        <figcaption className="dgm-bar">
          <span className="dgm-label">Drawing</span>
        </figcaption>
        <p className="dgm-note" role="status" data-testid="chat-visual-pending">
          Drawing…
        </p>
      </figure>
    );
  }
  return (
    <>
      <div ref={probe} aria-hidden="true" style={{ height: 0 }} />
      {content}
    </>
  );
}

export default VisualKitBlock;
