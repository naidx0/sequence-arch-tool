/* ══════════════════════════════════════════════════════════════════════════
   AN AGENT-WRITTEN .svg / .html FILE, SHOWN WHERE THE AGENT NAMED IT
   packages/web2/src/chat/VisualFile.tsx

   A paragraph that links a file on this machine ending in .svg, .html or .htm
   gets that file drawn under it, through the same blocks as a fenced answer
   (sanitised svg inline; html in the sandboxed frame; same cap). The text comes
   from the repository server's jailed `GET /api/file` by its PROJECT-RELATIVE
   path (the jail refuses absolute ones); a path outside the project draws nothing. A failed fetch
   draws nothing: the sentence already says where the file is.
   ══════════════════════════════════════════════════════════════════════════ */

import { useContext, useEffect, useState } from 'react';

import { DiagramBlock, StreamingContext } from './DiagramBlock';
import { DrawingContext, repoRelative } from './drawingContext';
import type { ProseSpan } from './proseBlocks';
import { isLocalPath } from './proseBlocks';
import { HtmlBlock } from './VisualBlock';

const FILE = /\.(svg|html?)$/i;
const MAX_FILES_PER_PARAGRAPH = 2;

/** The drawable files a paragraph links, in order, without repeats. */
export function visualFilesIn(spans: ProseSpan[]): { path: string; kind: 'svg' | 'html' }[] {
  const seen = new Set<string>();
  const out: { path: string; kind: 'svg' | 'html' }[] = [];
  for (const s of spans) {
    const link = s.link;
    if (link === undefined || !FILE.test(link) || seen.has(link)) continue;
    /* A path on this machine, or a relative one; never a web address or another scheme. */
    if (!isLocalPath(link) && /^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
    seen.add(link);
    out.push({ path: link, kind: /\.svg$/i.test(link) ? 'svg' : 'html' });
    if (out.length === MAX_FILES_PER_PARAGRAPH) break;
  }
  return out;
}

/** An svg file's text without its xml prolog, doctype or leading comments (the sanitiser wants `<svg` first). */
export function svgBody(text: string): string {
  return text.replace(/^\s*(?:<\?xml[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*/i, '');
}

export function VisualFile({ path, kind }: { path: string; kind: 'svg' | 'html' }) {
  const streaming = useContext(StreamingContext);
  const [text, setText] = useState<string | null>(null);
  const origin = useContext(DrawingContext);
  const root = origin?.repoRoot ?? null;
  const chat = origin?.chat ?? null;
  /* The file API's jail refuses absolute paths: ask for the project-relative one. A chat in its own worktree
     links absolute paths that live there: those go with `chat=`, and the server cuts them to the worktree
     (or refuses them) itself. */
  const inRepo = repoRelative(path, root);
  const rel = inRepo ?? (chat && /^(?:[A-Za-z]:[\\/]|\/)/.test(path) ? path : null);
  useEffect(() => {
    if (streaming || rel === null || typeof fetch !== 'function') return undefined;
    let live = true;
    void (async () => {
      try {
        const res = await fetch(`/api/file?path=${encodeURIComponent(rel)}${chat ? `&chat=${encodeURIComponent(chat)}` : ''}`);
        if (!res.ok) return;
        const body = await res.text();
        if (live) setText(body);
      } catch {
        /* nothing to draw */
      }
    })();
    return () => {
      live = false;
    };
  }, [rel, chat, streaming]);
  if (text === null) return null;
  return kind === 'svg' ? <DiagramBlock kind="svg" source={svgBody(text)} /> : <HtmlBlock source={text} />;
}
