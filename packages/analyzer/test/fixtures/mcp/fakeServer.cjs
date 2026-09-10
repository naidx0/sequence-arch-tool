#!/usr/bin/env node
/**
 * Fake MCP stdio server for the consume tests (Wave 5).
 *
 * Speaks just enough JSON-RPC 2.0 over newline-delimited stdio to satisfy the
 * analyzer's `mcpClient` handshake + `tools/list` + `tools/call`. No deps.
 *
 * Tool surface:
 *   - `echo` { text } → echoes the text back as a text content block.
 *
 * Reads `FAKE_MCP_NAME` env to vary the declared tool description (so tests can
 * assert the description round-trips).
 */
'use strict';

const readline = require('node:readline');

const rl = readline.createInterface({ input: process.stdin, terminal: false });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

let initialized = false;

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // ignore malformed
  }
  if (!msg || msg.jsonrpc !== '2.0') return;

  // notifications have no id
  if (msg.id === undefined) {
    if (msg.method === 'notifications/initialized') initialized = true;
    return;
  }

  switch (msg.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'fake-mcp', version: '0.0.1' },
        },
      });
      break;
    case 'tools/list':
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [
            {
              name: 'echo',
              description: process.env.FAKE_MCP_DESC || 'Echo the text back',
              inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
            },
          ],
        },
      });
      break;
    case 'tools/call': {
      const name = msg.params && msg.params.name;
      const args = (msg.params && msg.params.arguments) || {};
      if (name === 'echo') {
        const text = typeof args.text === 'string' ? args.text : '';
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text }] },
        });
      } else if (name === 'boom') {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text: 'boom' }], isError: true },
        });
      } else {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32602, message: `unknown tool: ${name}` },
        });
      }
      break;
    }
    default:
      send({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: `method not found: ${msg.method}` },
      });
  }
});

rl.on('close', () => {
  // stdin closed — exit cleanly so the child reaps.
  process.exit(0);
});

process.stderr.write('fake-mcp: ready\n');
