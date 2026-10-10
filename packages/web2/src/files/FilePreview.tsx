/* ══════════════════════════════════════════════════════════════════════════
   THE FILE, RENDERED (round 7, B8)
   packages/web2/src/files/FilePreview.tsx

   Jaden, on the installed app: "opening things and HTMLs, they show just the
   code". A file that has a rendered form shows it: HTML in a sandboxed frame,
   Markdown as prose, an image as the image. Everything else keeps the code
   view, and the header's Preview / Code control switches between the two.

   ── THE HTML FRAME IS SHUT BY DEFAULT ──────────────────────────────────────

   A repository's HTML is somebody else's code. The frame is `sandbox` with no
   allowances at all (no scripts, no forms, no popups, no same-origin, so it
   cannot read this app's storage or call its API), and the document carries a
   Content-Security-Policy that refuses every network fetch: `default-src
   'none'`, inline styles and data: images only. "Run scripts" adds exactly
   `allow-scripts` and lets inline scripts run; it never adds same-origin, and
   the network stays refused either way. The choice is per file and is not
   remembered.

   ── ROUND 8: A PAGE IN A FRAME, NOT A BLACK SLAB ────────────────────────────

   Jaden: "I don't like how it's random black HTML preview. It looks a little
   weird." The page sits in a rounded framed card on the theme's ground, with
   a small header (the file's name, Preview / Code, a Scripts chip). A page
   with no styles of its own (no <style>, no stylesheet <link>) gets the
   theme's reading defaults, a style block put in ahead of it, so an unstyled
   page reads like a page in this room and not a stark slab; a styled page
   renders as its author wrote it.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';

import { FRAME_STOPPED_NOTE, useFrameGuard } from '../chat/frameGuard';

import { FilesIcon } from './FilesIcon';

import { ProseMessage } from '../chat/ProseMessage';
import { FILES } from './anchors';
import type { RepoPath } from './filesModel';
import type { PreviewKind } from './previewKind';

export { previewKind, type PreviewKind } from './previewKind';

/** Where a raster image's own bytes come from (GET /api/file?raw=1). */
export function rawFileUrl(path: RepoPath): string {
  return `/api/file?path=${encodeURIComponent(path)}&raw=1`;
}

/**
 * The policy the frame's document carries. Network refused in both modes;
 * scripts only when the reader asked for them.
 */
export function previewPolicy(scripts: boolean): string {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    'media-src data: blob:',
    scripts ? "script-src 'unsafe-inline'" : "script-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/** The document, with the policy as the very first thing the parser meets; then the reading defaults, if any. */
export function previewDocument(html: string, scripts: boolean, defaults = ''): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${previewPolicy(scripts)}">`;
  return `<!doctype html>${meta}${defaults}${html.replace(/^\s*<!doctype[^>]*>/i, '')}`;
}

/** Does the page bring its own styles? A <style> block or a stylesheet <link>. */
export function hasOwnStyles(html: string): boolean {
  return /<style[\s>]/i.test(html) || /<link\b[^>]*\brel\s*=\s*["']?[^"'>]*\bstylesheet/i.test(html);
}

export interface ReadingDefaults {
  scheme: 'light' | 'dark';
  ground: string;
  ink: string;
  muted: string;
  edge: string;
  link: string;
  font: string;
  mono: string;
}

/** The theme's reading defaults as one style block (no network: system fonts stand in for the app's own). */
export function readingStyle(d: ReadingDefaults): string {
  return (
    '<style data-sequence-defaults>' +
    `:root{color-scheme:${d.scheme}}` +
    `html{background:${d.ground};color:${d.ink}}` +
    `body{margin:0 auto;max-width:720px;padding:28px 32px;font:0.9375rem/1.6 ${d.font};}` +
    `h1,h2,h3,h4{line-height:1.25;margin:1.2em 0 .5em}h1{font-size:1.7em}h2{font-size:1.35em}` +
    `p,ul,ol{margin:0 0 .9em}a{color:${d.link}}small,figcaption{color:${d.muted}}` +
    `code,pre,kbd{font-family:${d.mono};font-size:.9em}pre{padding:12px 14px;border:1px solid ${d.edge};border-radius:10px;overflow:auto}` +
    `hr{border:0;border-top:1px solid ${d.edge}}table{border-collapse:collapse}td,th{border:1px solid ${d.edge};padding:6px 10px}` +
    `img{max-width:100%}button,input,select,textarea{font:inherit}` +
    '</style>'
  );
}

/** The room's tokens, read off the root as the page paints. */
function readDefaults(): ReadingDefaults {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const light = root.getAttribute('data-theme') === 'light';
  return {
    scheme: light ? 'light' : 'dark',
    ground: v('--surface-2', 'Canvas'),
    ink: v('--ink-1', 'CanvasText'),
    muted: v('--ink-3', 'GrayText'),
    edge: v('--edge-strong', 'GrayText'),
    link: v('--accent', 'LinkText'),
    font: `${v('--font-sans', 'system-ui')}, system-ui, sans-serif`,
    mono: `${v('--font-mono', 'ui-monospace')}, ui-monospace, monospace`,
  };
}

/** The room's theme, re-read when it changes, so the defaults follow it. */
function useRoom(): string {
  const [room, setRoom] = useState(() => (typeof document === 'undefined' ? 'dark' : document.documentElement.getAttribute('data-theme') ?? 'dark'));
  useEffect(() => {
    const mo = new MutationObserver(() => setRoom(document.documentElement.getAttribute('data-theme') ?? 'dark'));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return room;
}

export default FilePreview;

export function FilePreview({ kind, path, text, onCode }: { kind: PreviewKind; path: RepoPath; text: string | null; onCode?: () => void }) {
  const [scripts, setScripts] = useState(false);
  const room = useRoom();
  /* A drawn diagram's intrinsic width, onto the svg as `--dgm-w`, so files.css can
     draw it at a fixed multiple of its own size (CSS cannot read a viewBox). The
     diagram is drawn after this mounts and re-fitted on resize, so watch for both. */
  const mdRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = mdRef.current;
    if (!host || typeof MutationObserver === 'undefined') return undefined;
    const stamp = () => {
      host.querySelectorAll<SVGSVGElement>('.dgm-art svg').forEach((svg) => {
        const w = svg.viewBox?.baseVal?.width ?? 0;
        if (w > 0 && svg.style.getPropertyValue('--dgm-w') !== String(Math.round(w))) svg.style.setProperty('--dgm-w', String(Math.round(w)));
      });
    };
    stamp();
    const mo = new MutationObserver(stamp);
    mo.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['viewBox'] });
    return () => mo.disconnect();
  }, [kind, text]);
  const guard = useFrameGuard(`${scripts}|${room}|${text ?? ''}`);
  /* Per file: opening another file shuts the scripts again. */
  useEffect(() => setScripts(false), [path]);

  if (kind === 'image') {
    return (
      <div className="files-preview files-preview-img" data-testid={FILES.preview} data-kind={kind}>
        <img src={rawFileUrl(path)} alt={path} data-testid={FILES.previewImage} />
      </div>
    );
  }
  if (text === null) return null;
  if (kind === 'svg') {
    /* As an <img>: an SVG drawn this way runs no script and fetches nothing. */
    return (
      <div className="files-preview files-preview-img" data-testid={FILES.preview} data-kind={kind}>
        <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`} alt={path} data-testid={FILES.previewImage} />
      </div>
    );
  }
  if (kind === 'markdown') {
    return (
      <div className="files-preview files-preview-md" data-testid={FILES.preview} data-kind={kind} ref={mdRef}>
        <ProseMessage text={text} className="files-md" />
      </div>
    );
  }
  const styled = hasOwnStyles(text);
  const defaults = styled ? '' : readingStyle(readDefaults());
  const name = path.split('/').pop() ?? path;
  return (
    <div className="files-preview files-preview-html" data-testid={FILES.preview} data-kind={kind} data-styled={styled ? 'own' : 'theme'}>
      <div className="files-pv-card">
        <div className="files-pv-head">
          <FilesIcon name="file" size={14} />
          <span className="files-pv-name" title={path}>
            {name}
          </span>
          {onCode ? (
            <span className="files-pv-seg" role="group" aria-label="Show">
              <button type="button" className="files-pv-segb" aria-pressed="true">
                Preview
              </button>
              <button type="button" className="files-pv-segb" aria-pressed="false" data-testid="files-preview-to-code" onClick={onCode}>
                Edit
              </button>
            </span>
          ) : null}
          <span className="files-pv-grow" />
          <span className="files-pv-chip" data-on={scripts ? 'true' : 'false'} title="The page cannot reach the network either way">
            {scripts ? 'Scripts on' : 'Scripts off'}
          </span>
          <button
            type="button"
            className="files-btn"
            aria-pressed={scripts}
            data-testid={FILES.previewScripts}
            onClick={() => setScripts((v) => !v)}
          >
            {scripts ? 'Stop scripts' : 'Run scripts'}
          </button>
        </div>
        {guard.stopped ? (
          <p className="files-pv-note" role="status" data-testid="files-preview-stopped">
            {FRAME_STOPPED_NOTE}
          </p>
        ) : (
        <iframe
          onLoad={(e) => guard.onLoad(e.currentTarget)}
          key={`${scripts ? 'run' : 'still'}-${styled ? 'own' : room}`}
          className="files-preview-frame"
          title={`Preview of ${path}`}
          data-testid={FILES.previewFrame}
          sandbox={scripts ? 'allow-scripts' : ''}
          referrerPolicy="no-referrer"
          srcDoc={previewDocument(text, scripts, defaults)}
        />
        )}
      </div>
    </div>
  );
}
