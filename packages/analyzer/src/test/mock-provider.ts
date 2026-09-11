import http from 'node:http';

/**
 * A local HTTP server speaking the Anthropic Messages wire shape, for the
 * end-to-end generate gate. No real provider key exists in this build
 * environment, so the "attach your AI subscription" loop is proven against this
 * mock — the real-key path is the identical provider code with the mock
 * `baseUrl` omitted. This boundary is a real HTTP hop (ephemeral localhost
 * port), so it exercises fetch, headers, JSON encode/decode, and error status
 * handling exactly as the live path would.
 */

export interface CapturedRequest {
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

/**
 * Decide the reply for one request. Return `{ text }` for a normal success (it
 * is wrapped in the Anthropic `content:[{type:'text'}]` envelope), or
 * `{ status, rawBody }` to simulate a provider error (e.g. HTTP 500).
 */
export type MockResponder = (body: unknown) => { text?: string; status?: number; rawBody?: string };

export interface MockProvider {
  baseUrl: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}

/**
 * Which wire shape the mock speaks in its SUCCESS envelope:
 *   - `'anthropic'` (default) ⇒ `{ content:[{type:'text', text}] }` (the existing
 *     BYO-key generate/ask gate — unchanged for every current caller).
 *   - `'openai'` ⇒ `{ choices:[{message:{content:text}}] }` (the OpenAI-compatible
 *     `/v1/chat/completions` shape spoken by the FREE default's hosted gateway
 *     AND any openai-compatible BYO key). Used to mock-verify the v9 gateway.
 */
export type MockWire = 'anthropic' | 'openai';

export async function startMockProvider(
  responder: MockResponder,
  wire: MockWire = 'anthropic'
): Promise<MockProvider> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let body: unknown = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        /* leave null */
      }
      requests.push({ headers: req.headers, body });
      const r = responder(body);
      if (r.status && r.status >= 400) {
        res.statusCode = r.status;
        res.setHeader('content-type', 'application/json');
        res.end(r.rawBody ?? JSON.stringify({ error: { message: 'mock provider error' } }));
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(
        wire === 'openai'
          ? JSON.stringify({
              choices: [{ message: { role: 'assistant', content: r.text ?? '' } }],
              usage: { prompt_tokens: 120, completion_tokens: 40 },
            })
          : JSON.stringify({
              content: [{ type: 'text', text: r.text ?? '' }],
              usage: { input_tokens: 120, output_tokens: 40 },
            })
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
