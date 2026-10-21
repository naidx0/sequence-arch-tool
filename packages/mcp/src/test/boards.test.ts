/**
 * Round 8 — THE AGENT'S PEN: list_boards, create_board, draw.
 *
 * Driven through a real MCP client (in-memory transport), so what is tested
 * is what an agent sends: the zod schema, the handler, and the files the app's
 * /api/boards routes read. Each test owns a temp copy of shopfront.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readBoard } from '@sequence/analyzer';
import { createServer } from '../index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.resolve(HERE, '../../../..', 'packages/analyzer/test/fixtures/shopfront');

function specimen(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-mcp-boards-'));
  fs.cpSync(SHOPFRONT, dir, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git|\.sequence)([\\/]|$)/.test(p.slice(SHOPFRONT.length)) });
  return dir;
}

async function connect(repo: string) {
  const server = createServer({ tools: 'all', repo });
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'boards-test', version: '0.0.0' });
  await Promise.all([server.connect(s), client.connect(c)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { text: r.content[0]!.text, isError: r.isError === true };
  };
  return { client, call, close: async () => { await client.close(); await server.close(); } };
}

test('the tools are listed, write-annotated, and their descriptions say which board to choose', async () => {
  const repo = specimen();
  const { client, close } = await connect(repo);
  try {
    const { tools } = await client.listTools();
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const name of ['list_boards', 'create_board', 'draw']) assert.ok(by[name], name);
    assert.equal(by.draw!.annotations?.readOnlyHint, false);
    assert.equal(by.create_board!.annotations?.readOnlyHint, false);
    assert.equal(by.list_boards!.annotations?.readOnlyHint, true);
    assert.match(by.draw!.description!, /ARCHITECTURE board .* explains the real system/);
    assert.match(by.draw!.description!, /WHITEBOARD .* free sketch/);
  } finally {
    await close();
  }
});

test('create a board, draw a labelled diagram on it, and the app\'s store reads it back', async () => {
  const repo = specimen();
  const { call, close } = await connect(repo);
  try {
    const made = await call('create_board', { name: 'Checkout plan' });
    assert.equal(made.isError, false, made.text);
    assert.equal(JSON.parse(made.text).created.id, 'checkout-plan');
    const drawn = await call('draw', {
      board: 'Checkout plan',
      ops: [
        { op: 'add', id: 'cart', type: 'rect', x: 0, y: 0, text: 'Cart' },
        { op: 'add', id: 'pay', type: 'ellipse', x: 300, y: 0, text: 'Pay' },
        { op: 'add', type: 'arrow', from: 'cart', to: 'pay', text: 'submit' },
        { op: 'add', type: 'sticky', x: 0, y: 120, text: 'retry on 502?' },
      ],
    });
    assert.equal(drawn.isError, false, drawn.text);
    const out = JSON.parse(drawn.text);
    assert.deepEqual(out.added, ['cart', 'pay', 'arrow-1', 'sticky-1']);
    const doc = readBoard(repo, 'checkout-plan')!;
    assert.equal(doc.items.length, 4);
    const arrow = doc.items.find((i) => i.id === 'arrow-1')!;
    assert.equal(arrow.kind === 'shape' && arrow.fromId === 'cart' && arrow.toId === 'pay' && arrow.label === 'submit', true);
    assert.equal(doc.items.every((i) => i.by === 'agent'), true, 'agent marks say so');
    /* update and remove */
    const upd = await call('draw', { board: 'checkout-plan', ops: [{ op: 'update', id: 'cart', text: 'Basket' }, { op: 'remove', id: 'sticky-1' }] });
    assert.equal(upd.isError, false, upd.text);
    const after = readBoard(repo, 'checkout-plan')!;
    const cart = after.items.find((i) => i.id === 'cart')!;
    assert.equal(cart.kind === 'shape' && cart.label === 'Basket' && cart.from.x === 0 && cart.to.x === 160, true);
    assert.equal(after.items.some((i) => i.id === 'sticky-1'), false);
    const listed = JSON.parse((await call('list_boards', {})).text).boards;
    assert.deepEqual(listed.map((b: { id: string; items: number }) => [b.id, b.items]), [['architecture', 0], ['whiteboard', 0], ['checkout-plan', 3]]);
  } finally {
    await close();
  }
});

test('an anchored note is stored against the real node id (resolved from its name), and its arrow binds to the node', async () => {
  const repo = specimen();
  const { call, close } = await connect(repo);
  try {
    const r = await call('draw', {
      ops: [
        { op: 'add', id: 'why', type: 'sticky', anchor: 'payments', text: 'Calls Stripe synchronously' },
        { op: 'add', id: 'link', type: 'arrow', from: 'why', to: 'svc:payments' },
      ],
    });
    assert.equal(r.isError, false, r.text);
    const doc = readBoard(repo, 'architecture')!;
    const note = doc.items.find((i) => i.id === 'why')!;
    /* Anchored: offsets from the node, defaulted to just right of the card. */
    assert.equal(note.anchor, 'svc:payments');
    assert.equal(note.kind === 'text' && note.sticky === true && note.at.x === 184 && note.at.y === 0, true);
    const link = doc.items.find((i) => i.id === 'link')!;
    assert.equal(link.kind === 'shape' && link.toId === 'svc:payments' && link.fromId === 'why', true);
  } finally {
    await close();
  }
});

test('invalid input is refused and nothing is drawn: unknown node, whiteboard anchor, missing position, unknown board, schema', async () => {
  const repo = specimen();
  const { call, close } = await connect(repo);
  try {
    const bad = await call('draw', {
      ops: [
        { op: 'add', id: 'ok', type: 'rect', x: 0, y: 0 },
        { op: 'add', type: 'sticky', anchor: 'no-such-service', text: 'x' },
        { op: 'add', type: 'text', text: 'floating' },
        { op: 'remove', id: 'ghost' },
      ],
    });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /nothing was drawn/);
    assert.match(bad.text, /no architecture node matches "no-such-service"/);
    assert.match(bad.text, /x and y are required/);
    assert.match(bad.text, /no item "ghost"/);
    assert.equal(readBoard(repo, 'architecture')!.items.length, 0, 'all or nothing: the good op did not land');

    const wbAnchor = await call('draw', { board: 'whiteboard', ops: [{ op: 'add', type: 'sticky', anchor: 'payments', text: 'x' }] });
    assert.equal(wbAnchor.isError, true);
    assert.match(wbAnchor.text, /node anchors are for the architecture board/);

    const noBoard = await call('draw', { board: 'Nope', ops: [{ op: 'add', type: 'rect', x: 0, y: 0 }] });
    assert.equal(noBoard.isError, true);
    assert.match(noBoard.text, /no board "Nope"/);

    const arch = await call('create_board', { name: 'Second', kind: 'architecture' });
    assert.equal(arch.isError, true);
    assert.match(arch.text, /one architecture board/);

    /* The schema: an unknown type and too long a text never reach the handler. */
    const schema = await call('draw', { ops: [{ op: 'add', type: 'hexagon', x: 0, y: 0 }] });
    assert.equal(schema.isError, true);
    const long = await call('draw', { ops: [{ op: 'add', type: 'text', x: 0, y: 0, text: 'x'.repeat(501) }] });
    assert.equal(long.isError, true);
    const far = await call('draw', { ops: [{ op: 'add', type: 'rect', x: 5e6, y: 0 }] });
    assert.equal(far.isError, true);
    assert.match(far.text, /outside/);
    assert.equal(readBoard(repo, 'architecture')!.items.length, 0);
  } finally {
    await close();
  }
});

/* ── B2/B5: an agent draws in colour, with lines, connectors, text and grouped diagrams ───────────────────────── */

test('colour is a palette NAME: draw stores stroke/fill/group on the kinds that take them, and a hex or an unknown name is refused', async () => {
  const repo = specimen();
  const { call, close } = await connect(repo);
  try {
    const drawn = await call('draw', {
      board: 'whiteboard',
      ops: [
        { op: 'add', id: 'api', type: 'rect', x: 0, y: 0, text: 'API', stroke: 'chart2', group: 'flow' },
        { op: 'add', id: 'db', type: 'ellipse', x: 300, y: 0, text: 'DB', stroke: 'chart4', group: 'flow' },
        { op: 'add', id: 'conn', type: 'arrow', from: 'api', to: 'db', text: 'reads', stroke: 'warning', group: 'flow' },
        { op: 'add', id: 'rule', type: 'line', x: 0, y: 140, w: 300, h: 0, stroke: 'danger' },
        { op: 'add', id: 'title', type: 'text', x: 0, y: -20, text: 'Read path', stroke: 'info' },
        { op: 'add', id: 'note', type: 'sticky', x: 0, y: 160, text: 'cache?', stroke: 'chart5' },
      ],
    });
    assert.equal(drawn.isError, false, drawn.text);
    const byId = new Map(readBoard(repo, 'whiteboard')!.items.map((i) => [i.id, i]));
    assert.deepEqual([(byId.get('api') as { stroke?: string }).stroke, byId.get('api')?.group], ['chart2', 'flow']);
    assert.equal((byId.get('conn') as { stroke?: string }).stroke, 'warning');
    assert.equal(byId.get('conn')?.group, 'flow');
    assert.equal((byId.get('rule') as { stroke?: string }).stroke, 'danger');
    assert.equal((byId.get('title') as { color?: string }).color ?? (byId.get('title') as { stroke?: string }).stroke, 'info');
    assert.equal((byId.get('note') as { color?: string }).color ?? (byId.get('note') as { stroke?: string }).stroke, 'chart5');
    /* update keeps the group and colour it was not told to change, and recolours what it was */
    const upd = await call('draw', { board: 'whiteboard', ops: [{ op: 'update', id: 'api', stroke: 'danger' }] });
    assert.equal(upd.isError, false, upd.text);
    const api = readBoard(repo, 'whiteboard')!.items.find((i) => i.id === 'api')!;
    assert.deepEqual([(api as { stroke?: string }).stroke, api.group], ['danger', 'flow']);
  } finally {
    await close();
  }
});

test('draw refuses a hex or an unknown colour name with the palette in the message, and draws nothing', async () => {
  const repo = specimen();
  const { call, close } = await connect(repo);
  try {
    const hex = await call('draw', { board: 'whiteboard', ops: [{ op: 'add', id: 'a', type: 'rect', x: 0, y: 0, stroke: '#ff0000' }] });
    assert.equal(hex.isError, true);
    const nope = await call('draw', { board: 'whiteboard', ops: [{ op: 'add', id: 'a', type: 'rect', x: 0, y: 0, stroke: 'chartreuse' }] });
    assert.equal(nope.isError, true);
    assert.equal(readBoard(repo, 'whiteboard')!.items.length, 0);
    /* the store refuses it too, for a writer that skips the schema (the app's routes, another process) */
    const { applyBoardOps } = await import('@sequence/analyzer');
    assert.throws(
      () => applyBoardOps(repo, 'whiteboard', [{ op: 'put', item: { kind: 'shape', id: 'a', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, stroke: '#ff0000' } }]),
      /ownTheme|palette/,
    );
  } finally {
    await close();
  }
});

test('the draw tool says how to colour, connect and group, and offers svg', async () => {
  const repo = specimen();
  const { client, close } = await connect(repo);
  try {
    const { tools } = await client.listTools();
    const draw = tools.find((t) => t.name === 'draw')!;
    assert.match(draw.description!, /palette names/);
    assert.match(draw.description!, /ownTheme/);
    const ops = (draw.inputSchema.properties as { ops: { items: { properties: Record<string, { enum?: string[] }> } } }).ops.items.properties;
    assert.ok(ops.stroke && ops.fill && ops.group);
    assert.ok(ops.type!.enum!.includes('svg'));
  } finally {
    await close();
  }
});

/* ── B6: an agent hosts an SVG on a Space ─────────────────────────────────────────────────────────────────────── */

test('draw hosts an svg as one item, stored as written, and update moves it without losing the markup', async () => {
  const repo = specimen();
  const { call, close } = await connect(repo);
  try {
    const svg = '<svg viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg"><polygon points="50,5 95,30 50,55 5,30" fill="none" stroke="currentColor"/></svg>';
    const drawn = await call('draw', { board: 'whiteboard', ops: [{ op: 'add', id: 'anatomy', type: 'svg', x: 40, y: 50, w: 400, h: 240, svg, group: 'body' }] });
    assert.equal(drawn.isError, false, drawn.text);
    const item = readBoard(repo, 'whiteboard')!.items.find((i) => i.id === 'anatomy')!;
    assert.equal(item.kind, 'svg');
    assert.equal(item.kind === 'svg' && item.svg === svg && item.w === 400 && item.h === 240 && item.at.x === 40, true);
    assert.equal(item.group, 'body');
    const moved = await call('draw', { board: 'whiteboard', ops: [{ op: 'update', id: 'anatomy', x: 100, w: 200 }] });
    assert.equal(moved.isError, false, moved.text);
    const after = readBoard(repo, 'whiteboard')!.items.find((i) => i.id === 'anatomy')!;
    assert.equal(after.kind === 'svg' && after.svg === svg && after.at.x === 100 && after.w === 200 && after.h === 240, true);
  } finally {
    await close();
  }
});

test('an svg op without markup, or with markup that is not an svg, or oversize, is refused and draws nothing', async () => {
  const repo = specimen();
  const { call, close } = await connect(repo);
  try {
    const none = await call('draw', { board: 'whiteboard', ops: [{ op: 'add', type: 'svg', x: 0, y: 0 }] });
    assert.equal(none.isError, true);
    assert.match(none.text, /svg needs svg markup|needs svg markup/);
    const notSvg = await call('draw', { board: 'whiteboard', ops: [{ op: 'add', type: 'svg', x: 0, y: 0, svg: '<div>hi</div>' }] });
    assert.equal(notSvg.isError, true);
    assert.match(notSvg.text, /<svg> root/);
    const huge = await call('draw', { board: 'whiteboard', ops: [{ op: 'add', type: 'svg', x: 0, y: 0, svg: `<svg>${'x'.repeat(300_000)}</svg>` }] });
    assert.equal(huge.isError, true);
    assert.equal(readBoard(repo, 'whiteboard')!.items.length, 0);
  } finally {
    await close();
  }
});
