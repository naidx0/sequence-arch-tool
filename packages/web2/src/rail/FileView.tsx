/* ══════════════════════════════════════════════════════════════════════════
   READING A FILE
   packages/web2/src/rail/FileView.tsx

   The rail lists every file in the repository and clicking one grounded the
   composer on it. There was no way to READ it. A product whose whole claim is
   "every edge cites a file and a line" could show you the citation and not the
   line — the reader had to leave and open their editor, which is the moment a
   tool stops being where the work happens.

   `GET /api/file?path=` has served the text the whole time. `ConnectedReview`
   calls it to apply edits; nothing ever asked it for something to look at.

   ── IT REUSES THE DIFF'S HIGHLIGHTER ─────────────────────────────────────

   `review/syntax.ts` already ships `languageOf` and `highlight`, already
   Graphite-compliant and already tested. A second highlighter would be a
   second answer to "what colour is a keyword", and the two would drift.

   ── AND IT SHOWS LINE NUMBERS, WHICH IS THE POINT ────────────────────────

   Evidence in this product is `file:line`. A viewer without a gutter makes the
   reader count, which is exactly the work the citation was supposed to save.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';

import { highlight, languageOf } from '../review/syntax';

export interface FileViewProps {
  /** Repo-relative path, or null when nothing is open. */
  path: string | null;
  /** The line to scroll to and mark, when one was cited. */
  line?: number | null;
  onClose: () => void;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

type Load =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ok'; text: string }
  /** The server's own words. A viewer that rewrote them would hide the fix. */
  | { state: 'failed'; message: string };

export function FileView({ path, line = null, onClose, fetchImpl }: FileViewProps) {
  const [load, setLoad] = useState<Load>({ state: 'idle' });

  useEffect(() => {
    if (path === null) {
      setLoad({ state: 'idle' });
      return undefined;
    }
    const controller = new AbortController();
    const go = fetchImpl ?? fetch;
    setLoad({ state: 'loading' });

    void go(`/api/file?path=${encodeURIComponent(path)}`, { signal: controller.signal })
      .then(async (res) => {
        if (controller.signal.aborted) return;
        const body = await res.text();
        if (controller.signal.aborted) return;
        if (!res.ok) {
          /* The server says why — too large, outside the repo, unreadable. Each
             is a different fix and the reader can only act on the difference. */
          setLoad({ state: 'failed', message: body.trim() || `could not read this file (${res.status})` });
          return;
        }
        setLoad({ state: 'ok', text: body });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setLoad({ state: 'failed', message: 'the engine did not answer' });
      });

    return () => controller.abort();
  }, [path, fetchImpl]);

  if (path === null) return null;

  return (
    <div className="rail-scope fileview" data-testid="file-view" role="region" aria-label={`Source of ${path}`}>
      <div className="fileview-hd">
        <span className="fileview-path mono" data-testid="file-view-path">
          {path}
        </span>
        <button type="button" className="ghost" data-testid="file-view-close" onClick={onClose}>
          Close
        </button>
      </div>

      {load.state === 'loading' ? (
        <p className="fileview-note" data-testid="file-view-loading">
          Reading {path}…
        </p>
      ) : null}

      {load.state === 'failed' ? (
        /* THE SERVER'S OWN SENTENCE. Rewriting it would hide the one line that
           says what to fix — the same rule SettingsPanel follows. */
        <p className="fileview-note" data-testid="file-view-failed" role="alert">
          {load.message}
        </p>
      ) : null}

      {load.state === 'ok' ? (
        <pre className="fileview-body" data-testid="file-view-body">
          {load.text.split(/\r?\n/).map((text, index) => {
            const number = index + 1;
            return (
              <span
                key={number}
                className="fileview-line"
                data-testid="file-view-line"
                data-cited={line === number ? 'true' : undefined}
              >
                {/* THE GUTTER IS THE POINT. Evidence here is `file:line`, and a
                    viewer without line numbers makes the reader count — which
                    is exactly the work the citation was supposed to save. */}
                <span className="fileview-n">{number}</span>
                <code>
                  {/* `rv-t-*`, the SAME classes DiffView uses. A second set of
                      token class names would be a second answer to "what
                      colour is a keyword", and the two would drift. */}
                  {highlight(text, languageOf(path)).map((span, i) =>
                    span.cls === null ? (
                      <span key={i}>{span.text}</span>
                    ) : (
                      <span key={i} className={`rv-t-${span.cls}`}>
                        {span.text}
                      </span>
                    ),
                  )}
                </code>
              </span>
            );
          })}
        </pre>
      ) : null}
    </div>
  );
}
