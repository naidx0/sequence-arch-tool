/**
 * A JSON POST to THIS server's own loopback port, over `node:http`.
 *
 * WHY NOT `fetch`. Node's `fetch` (undici) enforces the Fetch spec's "bad port" list, so a request to 127.0.0.1 on
 * 4190, 6000, 6665-6669, 10080 and the other blocked ports rejects with `TypeError: fetch failed` / `bad port`
 * before a byte is sent. The app can be started on any of them (`--port`), and a goal run that called itself over
 * `fetch` ended `provider_failed` in about 8 ms with a sentence about a connection that was never tried.
 * `node:http` has no such list. (Reviewer, 2026-10-15.)
 */
import http from 'node:http';

export interface LocalPostResult {
  status: number;
  /** The body, parsed; `{}` when it was empty or not JSON. */
  json: unknown;
}

export function postLocalJson(
  port: number,
  pathname: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<LocalPostResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('the agent turn was cancelled'));
      return;
    }
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json', 'content-length': String(payload.length) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('error', reject);
        res.on('end', () => {
          let json: unknown = {};
          try {
            const text = Buffer.concat(chunks).toString('utf8');
            if (text.trim() !== '') json = JSON.parse(text);
          } catch {
            json = {};
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    const onAbort = (): void => {
      req.destroy(new Error('the agent turn was cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('error', (e) => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error(signal?.aborted ? 'the agent turn was cancelled' : `could not reach Sequence's own server on port ${port}: ${e.message}`));
    });
    req.on('close', () => signal?.removeEventListener('abort', onAbort));
    req.end(payload);
  });
}
