// A scripted OpenAI-compatible streaming mock (loopback, keyless, no account, no cost) for e2e/agent-turn-journey.mjs.
// It answers /v1/models and /v1/chat/completions, and appends one JSON line per request to the log file named on the
// command line (node mock-llm.mjs <port> <log>): a test reads that file to learn whether a chat's own model was asked.
// The keyword in the question steers it: EDITME walks a read_file then an edit_file; anything else is a plain answer.
import http from 'node:http';
import fs from 'node:fs';
const port = Number(process.argv[2] || 4191);
const logFile = process.argv[3] || 'mockllm.log';
let n = 0;
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p?.text ?? '').join('') : '');
const rounds = new Map();
function questionOf(all) { const m = /--- QUESTION ---\n([\s\S]*?)\n--- /.exec(all); return m ? m[1] : null; }
function decide(body) {
  const msgs = body?.messages ?? [];
  const all = JSON.stringify(body);
  const users = msgs.filter((m) => m.role === 'user');
  const last = textOf(users.at(-1)?.content ?? '');
  const sys = msgs.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n');
  const q = questionOf(last);
  const tail = q ?? (body?.stream ? last.slice(-600) : "");
  if (q && body?.stream) { const k=q; rounds.set(k,(rounds.get(k)??-1)+1); }
  const round = q ? rounds.get(q) : 0;
  const results = last.includes("--- TOOL RESULTS") ? last.slice(last.indexOf("--- TOOL RESULTS")) : "";
  const codeword = /codeword is ([A-Z]+-\d+)/.exec(all)?.[1];
  if (/Reply with the name only/.test(last)) return { text: "Mock chat " + (n % 100) };
  if (!q && /summar/i.test(sys + last.slice(0, 800))) {
    return { text: `Summary of earlier turns: the user and assistant discussed the repo.${codeword ? ` The user said the codeword is ${codeword}.` : ''}` };
  }
  if (/CODEWORD\?/.test(tail)) return { text: codeword ? `The codeword you gave me is ${codeword}.` : 'I do not know any codeword.' };
  if (/EDITME/.test(tail)) {
    if (round >= 2) return { text: 'I changed README.md: added a line "Edited by mock". Review the proposal and apply it.' };
    if (round >= 1)
      return {
        text:
          'Now the edit.\n```sequence-tool\n{"id":"t-edit-1","name":"edit_file","args":{"path":"README.md","title":"Add a mock line","edits":[{"oldString":"# ticketing-scaffold","newString":"Edited by mock\\n\\n# ticketing-scaffold"}]}}\n```\n',
      };
    return { text: 'Let me read the file first.\n```sequence-tool\n{"id":"t-read-1","name":"read_file","args":{"path":"README.md"}}\n```\n' };
  }
  const m = /TURN(\d+)/.exec(tail);
  const filler = ' This is padding text so that the history grows and must be summarized eventually.'.repeat(14);
  return { text: `Answer for ${m ? `turn ${m[1]}` : 'your question'}: here is a grounded reply with evidence api/README.md.${filler}` };
}
http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try { body = JSON.parse(raw); } catch {}
      const id = ++n;
      if (req.method === 'GET' && /\/models/.test(req.url)) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] }));
        fs.appendFileSync(logFile, JSON.stringify({ id, url: req.url, method: req.method }) + '\n');
        return;
      }
      if (!/chat\/completions/.test(req.url)) {
        fs.appendFileSync(logFile, JSON.stringify({ id, url: req.url, method: req.method, status: 404 }) + '\n');
        res.statusCode = 404; res.end('{}'); return;
      }
      const r = decide(body);
      fs.appendFileSync(logFile, JSON.stringify({ id, url: req.url, stream: body?.stream, tools: (body?.tools ?? []).length, nmsg: body?.messages?.length, chars: raw.length, reply: r.text.slice(0, 120), lastUserTail: textOf(body?.messages?.filter((m) => m.role === 'user').at(-1)?.content ?? '').slice(-300) }) + '\n');
      if (!body?.stream) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: r.text } }], usage: { prompt_tokens: Math.round(raw.length / 4), completion_tokens: 40 } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const parts = r.text.match(/[\s\S]{1,24}/g) ?? [''];
      for (const p of parts) {
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: p } }] })}\n\n`);
        await new Promise((ok) => setTimeout(ok, 25));
      }
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: Math.round(raw.length / 4), completion_tokens: 60 } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  })
  .listen(port, '127.0.0.1', () => console.log('mockllm on', port));
