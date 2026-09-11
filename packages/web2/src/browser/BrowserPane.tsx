/* ══════════════════════════════════════════════════════════════════════════
   BROWSER PANE — C2.5
   packages/web2/src/browser/BrowserPane.tsx

   Owner quote: allowlisted browse tool + panel showing measured response —
   not embedded Chromium pretending to be a full browser.
   User-seat Done when: URL field, Fetch, rows cite URL/status/truncated body.
   Inverted-fix ban: do not fake DOM/title without fetch evidence.
   ══════════════════════════════════════════════════════════════════════════ */

import { useState, type FormEvent } from 'react';

import { netFetch } from './browserClient';

export function BrowserPane() {
  const [url, setUrl] = useState('https://example.com');
  const [statusLine, setStatusLine] = useState('Enter a public https URL and fetch.');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setStatusLine('URL is required.');
      setBody('');
      return;
    }
    setLoading(true);
    setStatusLine('Fetching…');
    setBody('');
    const result = await netFetch(trimmed);
    setLoading(false);
    if (result.outcome === 'error') {
      setStatusLine(result.message);
      return;
    }
    const row = result.body;
    if (!row.ok) {
      const bits = [row.url];
      if (row.status != null) bits.push(`HTTP ${row.status}`);
      if (row.error) bits.push(row.error);
      setStatusLine(bits.join(' · '));
      setBody('');
      return;
    }
    const meta = [row.url, row.status != null ? `HTTP ${row.status}` : null, row.title ? `title: ${row.title}` : null]
      .filter(Boolean)
      .join(' · ');
    setStatusLine(meta);
    setBody(row.text ?? '(empty body after fetch)');
  };

  return (
    <div className="browser-pane" data-testid="browser-pane">
      <form className="browser-pane-chrome" data-testid="browser-pane-chrome" onSubmit={onSubmit}>
        <span className="browser-pane-title">Browser</span>
        <input
          className="browser-pane-url"
          data-testid="browser-pane-url"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="URL to fetch"
        />
        <button
          type="submit"
          className="browser-pane-fetch"
          data-testid="browser-pane-fetch"
          disabled={loading}
        >
          {loading ? 'Fetching…' : 'Fetch'}
        </button>
      </form>
      <div className="browser-pane-meta" data-testid="browser-pane-status">
        {statusLine}
      </div>
      <pre className="browser-pane-body" data-testid="browser-pane-body" role="log" aria-label="Fetched page text">
        {body}
      </pre>
    </div>
  );
}
