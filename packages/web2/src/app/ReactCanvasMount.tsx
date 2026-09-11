import { useEffect, useRef, useState } from 'react';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { extractStaticPreviewFromReact, htmlSandboxDocument } from './aiCanvasViewers';

/**
 * BABEL IS LOADED WHEN A JSX BLOCK IS ACTUALLY MOUNTED, NOT AT BOOT.
 *
 * `import { transform } from '@babel/standalone'` at the top of this file was
 * a static edge, so rollup put the whole compiler in the one entry chunk that
 * every cold open downloads and V8 parses before anything renders. Measured on
 * this tree: the main chunk was 3,161,162 bytes, and rebuilding with
 * `@babel/standalone` aliased to a stub dropped it to 797,521 — 2.36 MB, 74.8%
 * of the bundle, for a JSX compiler that runs only when the agent has drawn a
 * `canvas.write_react` block and the reader is looking at it.
 *
 * `await import(...)` makes it its own chunk. The cost is that compiling is now
 * asynchronous, which the caller already tolerated: the mount happens in an
 * effect that has always had an error state and has never been synchronous
 * from the reader's side.
 */
async function compileReactSource(source: string): Promise<string> {
  const { transform } = await import('@babel/standalone');
  const trimmed = source.trim();
  const wrapped = trimmed.startsWith('import') || trimmed.includes('export')
    ? trimmed
    : `export default function Preview() {\n${trimmed.includes('return') ? trimmed : `return (${trimmed});`}\n}`;
  const out = transform(wrapped, {
    presets: ['react', 'typescript'],
    filename: 'canvas-block.tsx',
  });
  if (!out.code) throw new Error('Compile produced no output');
  return out.code;
}

function mountComponent(compiled: string, container: HTMLElement): Root {
  const module = { exports: {} as { default?: React.ComponentType } };
  const fn = new Function(
    'React',
    'exports',
    'module',
    `${compiled}\n;return module.exports.default ?? exports.default;`,
  ) as (react: typeof React, exports: object, module: { exports: { default?: React.ComponentType } }) => unknown;
  const Comp = fn(React, module.exports, module);
  if (typeof Comp !== 'function') {
    throw new Error('No default export component found');
  }
  const root = createRoot(container);
  root.render(React.createElement(Comp as React.ComponentType));
  return root;
}

export interface ReactCanvasMountProps {
  source: string;
}

/** Full React mount for canvas.write_react blocks — Babel transform + createRoot. */
export function ReactCanvasMount({ source }: ReactCanvasMountProps) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const staticMarkup = extractStaticPreviewFromReact(source);

  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    setError(null);
    let root: Root | null = null;
    /* `cancelled` is what makes the await safe: a source change or an unmount
       between the import and the mount must not paint into a dead node or
       report an error into a tree that is gone. */
    let cancelled = false;

    void (async () => {
      try {
        const compiled = await compileReactSource(source);
        if (cancelled) return;
        root = mountComponent(compiled, el);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Mount failed');
      }
    })();

    return () => {
      cancelled = true;
      /* The inner root is its own React tree. Tearing it down synchronously
         from THIS tree's cleanup is an unmount inside a render, which React
         warns about and which can race the inner render that is still in
         flight; a microtask puts it after both. */
      const mounted = root;
      root = null;
      if (mounted) queueMicrotask(() => mounted.unmount());
    };
  }, [source]);

  if (error && staticMarkup) {
    const doc = htmlSandboxDocument(staticMarkup);
    return (
      <div className="ai-canvas-react" data-testid="ai-canvas-react-fallback">
        <p className="ai-canvas-react-note">Live mount failed — static preview shown.</p>
        <iframe className="ai-canvas-html-frame ai-canvas-react-frame" title="React fallback" sandbox="" srcDoc={doc} />
        <pre className="ai-canvas-react-src" data-testid="ai-canvas-react-src">{source}</pre>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ai-canvas-react" data-testid="ai-canvas-react-error">
        <p className="ai-canvas-react-note">{error}</p>
        <pre className="ai-canvas-react-src" data-testid="ai-canvas-react-src">{source}</pre>
      </div>
    );
  }

  return (
    <div className="ai-canvas-react" data-testid="ai-canvas-react-mount">
      <div ref={host} className="ai-canvas-react-host" />
      <pre className="ai-canvas-react-src" data-testid="ai-canvas-react-src">
        {source}
      </pre>
    </div>
  );
}
