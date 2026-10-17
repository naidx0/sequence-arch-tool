/* ══════════════════════════════════════════════════════════════════════════
   DOES THE BOARD SERVER START FROM THE INSTALLED SHAPE?
   packages/analyzer/scripts/check-mcp-bundle.mjs

   Starts the MCP stdio server once (as an agent session would: SEQUENCE_REPO,
   SEQUENCE_MCP_TOOLS=core), speaks newline-delimited JSON-RPC to it
   (initialize, tools/list, one `map` call), and answers what it saw. Used by
   desktop prepare-server's isolation boot, on the bundle copied out of the
   repository, and by server-mcp-bundle.test.ts. No MCP SDK needed here.
   ══════════════════════════════════════════════════════════════════════════ */

import { spawn } from 'node:child_process';

/**
 * @param {{ entry: string, repo: string, nodeBin?: string, env?: Record<string,string>, timeoutMs?: number }} o
 * @returns {Promise<{ ok: boolean, tools: string[], mapText: string, problems: string[], stderr: string }>}
 */
export function checkMcpBundle(o) {
  const child = spawn(o.nodeBin ?? process.execPath, [o.entry], {
    env: { ...process.env, ...(o.env ?? {}), SEQUENCE_REPO: o.repo, SEQUENCE_MCP_TOOLS: 'core' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  let buf = '';
  const waiting = new Map();
  child.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && waiting.has(msg.id)) {
          waiting.get(msg.id)(msg);
          waiting.delete(msg.id);
        }
      } catch {
        /* not ours */
      }
    }
  });
  let next = 1;
  const ask = (method, params) =>
    new Promise((resolve) => {
      const id = next++;
      waiting.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const run = (async () => {
    const problems = [];
    const init = await ask('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'sequence-check', version: '0' } });
    if (init.error) problems.push(`initialize: ${init.error.message}`);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const list = await ask('tools/list', {});
    const tools = (list.result?.tools ?? []).map((t) => t.name).sort();
    if (!tools.includes('map')) problems.push(`tools/list has no map: ${JSON.stringify(list.error ?? tools)}`);
    const call = await ask('tools/call', { name: 'map', arguments: { budget: 400 } });
    const mapText = (call.result?.content ?? []).map((c) => c.text ?? '').join('\n');
    if (call.error || call.result?.isError || !/^# map /.test(mapText)) problems.push(`map: ${JSON.stringify(call.error ?? mapText.slice(0, 300))}`);
    return { ok: problems.length === 0, tools, mapText, problems };
  })();
  /* The timer stays referenced and an early exit answers too. An unreferenced timer and a child that died
     before answering left nothing holding the event loop, so the awaiting caller (prepare-server) quit with
     code 13 and no message: the 0.1.4 macOS release build. */
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, tools: [], mapText: '', problems: [`no answer within ${o.timeoutMs ?? 60_000} ms`] }), o.timeoutMs ?? 60_000);
  });
  const ended = new Promise((resolve) => {
    const early = (why) => resolve({ ok: false, tools: [], mapText: '', problems: [`the server ${why} before answering`] });
    child.once('error', (e) => early(`could not start (${e.message})`));
    child.once('exit', (code, signal) => early(`exited (${signal ?? `code ${code}`})`));
  });
  return Promise.race([run, timeout, ended]).then((r) => {
    clearTimeout(timer);
    child.kill();
    return { ...r, stderr };
  });
}
