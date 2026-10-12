/**
 * A FAKE OPENAI-COMPATIBLE SERVER, for proving a driver end to end with no card.
 *
 *   import { startFakeOpenAI } from './fake-openai.mjs';
 *   const fake = await startFakeOpenAI(({ system, user, body }) => 'the answer');
 *   // fake.baseUrl is http://127.0.0.1:<port>/v1; fake.calls lists every request
 *   await fake.close();
 *
 * Serves `POST /v1/chat/completions` both ways a local runtime does: one JSON
 * body, or Server-Sent Events when `stream: true` (content deltas, then a
 * usage chunk when `stream_options.include_usage` asks for one, then
 * `[DONE]`). `GET /api/ps` answers like Ollama with no model resident, so
 * gpu-lock's release probe reads `models=0` instead of timing out.
 *
 * Usage counts are the word-and-punctuation count of the text, not a real
 * tokenizer: the point is that the field is present and plausible.
 */
import http from 'node:http';

const rough = (s) => (String(s).match(/[A-Za-z]+|\d+|\S/g) ?? []).length;

/**
 * @param {(req: {system: string, user: string, body: any}) => string | Promise<string>} answer
 * @param {{ delayMs?: number, chunkChars?: number }} [opts]
 */
export async function startFakeOpenAI(answer, opts = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/ps') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: [] }));
      return;
    }
    if (req.method !== 'POST' || !/\/v1\/chat\/completions$/.test(req.url ?? '')) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400);
        res.end('bad json');
        return;
      }
      const msgs = Array.isArray(body.messages) ? body.messages : [];
      const system = msgs.find((m) => m.role === 'system')?.content ?? '';
      const user = msgs.find((m) => m.role === 'user')?.content ?? '';
      calls.push({ system, user, body, at: Date.now() });
      let text;
      try {
        text = String(await answer({ system, user, body }));
      } catch (e) {
        res.writeHead(500);
        res.end(String(e));
        return;
      }
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      const usage = {
        prompt_tokens: rough(system) + rough(user),
        completion_tokens: rough(text),
        total_tokens: rough(system) + rough(user) + rough(text),
      };
      if (!body.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'fake',
            object: 'chat.completion',
            model: body.model,
            choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
            usage,
          }),
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const size = opts.chunkChars ?? 7;
      for (let i = 0; i < text.length; i += size) {
        const chunk = { choices: [{ index: 0, delta: { content: text.slice(i, i + size) }, finish_reason: null }] };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      if (body.stream_options?.include_usage) res.write(`data: ${JSON.stringify({ choices: [], usage })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    calls,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
