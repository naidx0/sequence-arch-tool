import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { listDrawings, readDrawing } from '@sequence/analyzer';
import { findComponent } from '@sequence/schema/dist/visual/index.js';
import { createServer } from '../index.js';
import { visualTool } from '../visualTools.js';

const mk = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'seq-visual-'));
const text = (r: { content: { type: string; text?: string }[] }): string => (r.content[0] as { text: string }).text;

async function connect(repo: string): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createServer({ tools: 'core', repo });
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'visual-test', version: '0.0.0' });
  await Promise.all([server.connect(s), client.connect(c)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

test('round trip over MCP: list, help, draw, saved as a drawing, redraw by id is v2, errors name the problem', async () => {
  const repo = mk();
  const { client, close } = await connect(repo);
  try {
    const call = async (args: Record<string, unknown>) => client.callTool({ name: 'visual', arguments: { repoPath: repo, ...args } }) as Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
    const list = await call({ list: true });
    assert.match(text(list), /^line: Line or area chart/m);
    assert.match(text(list), /^capacity: Capacity and load forecast/m);
    assert.equal(text(list).split('\n').length, 13, 'twelve components, one line each, and the usage line');
    const help = await call({ help: 'line' });
    assert.match(text(help), /line \{title\?, subtitle\?, x:\[labels\]/);
    assert.match(text(help), /example: \{"title":"Requests per second"/);
    assert.equal((await call({ help: 'nope' })).isError, true);

    const spec = { x: ['Mon', 'Tue', 'Wed', 'Thu'], series: [{ name: 'rps', values: [10, 14, 19, 25] }], forecast: { periods: 3 }, unit: 'rps' };
    const r = await call({ component: 'line', spec, title: 'Gateway load' });
    assert.ok(!r.isError, text(r));
    assert.match(text(r), /^d1 v1 "Gateway load" saved \(line, 440x240\)\. Line chart: rps; rps goes 10 rps to 25 rps over 4 points, forecast reaches/);
    assert.match(text(r), /write this block:\n```visual\n\{"id":"d1"\}\n```$/);
    const rows = listDrawings(repo);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.kind, 'svg');
    const got = readDrawing(repo, 'd1')!;
    assert.ok(got.source.startsWith('<svg ') && got.source.includes('<title>Gateway load</title>'));
    assert.equal(got.drawing.versions.length, 1);

    const again = await call({ component: 'line', spec, title: 'Gateway load' });
    assert.match(text(again), /^d1 v1 /, 'the same drawing text is the same drawing, no copy');
    const v2 = await call({ id: 'd1', component: 'line', spec: { ...spec, forecast: { periods: 5 } }, title: 'Gateway load' });
    assert.match(text(v2), /^d1 v2 /);
    assert.equal(listDrawings(repo).length, 1);
    assert.equal(readDrawing(repo, 'd1')!.drawing.versions.length, 2);
    assert.ok(readDrawing(repo, 'd1', 1)!.source !== readDrawing(repo, 'd1', 2)!.source);

    const bad = await call({ component: 'line', spec: { x: ['a', 'b'], series: [{ name: 's', values: [1, 'n/a'] }] } });
    assert.equal(bad.isError, true);
    assert.match(text(bad), /visual line: spec\.series\[0\]\.values\[1\]: expected a number, got "n\/a"\. visual\(\{help:"line"\}\) shows the shape\./);
    assert.equal(listDrawings(repo).length, 1, 'nothing saved on a bad spec');
    assert.match(text(await call({ component: 'zzz', spec: {} })), /unknown component "zzz"; choose one of: line, bar/);
    assert.match(text(await call({ component: 'line' })), /needs a spec/);
    assert.match(text(await call({ id: 'd1', component: 'bar', spec: findComponent('bar')!.example as Record<string, unknown> })), /stay svg|drawing not saved|d1 v3/);
    assert.equal((await call({})).isError, true);
  } finally {
    await close();
  }
});

test('a session in a chat worktree saves where the app reads, under its chat; the id is stable across turns', () => {
  const project = mk();
  const worktree = mk();
  const env = { SEQUENCE_DRAWINGS_ROOT: project, SEQUENCE_CHAT: 'chat-7' };
  const r = visualTool({ repoPath: worktree, component: 'kpi', spec: { tiles: [{ label: 'Users', value: 1000 }] } }, env);
  assert.ok(!r.isError, text(r));
  const [row] = listDrawings(project);
  assert.equal(row!.chat, 'chat-7');
  assert.equal(listDrawings(worktree).length, 0, 'not in the throwaway worktree');
  assert.equal(text(visualTool({ repoPath: worktree, component: 'kpi', spec: { tiles: [{ label: 'Users', value: 1000 }] } }, env)).slice(0, 5), 'd1 v1');
});

test('a version of another chat\'s drawing needs the turn to have referenced it (SEQUENCE_REFERENCED, set by the app)', () => {
  const repo = mk();
  const spec = findComponent('line')!.example as Record<string, unknown>;
  const a = visualTool({ repoPath: repo, component: 'line', spec }, { SEQUENCE_CHAT: 'chat-a' });
  const id = /^(d\d+)/.exec(text(a))![1]!;
  const other = { ...spec, subtitle: 'changed' };
  const refused = visualTool({ repoPath: repo, component: 'line', spec: other, id }, { SEQUENCE_CHAT: 'chat-b' });
  assert.equal(refused.isError, true);
  assert.match(text(refused), /belongs to another chat/);
  assert.equal(listDrawings(repo)[0]!.versions.length, 1);
  const wrongRef = visualTool({ repoPath: repo, component: 'line', spec: other, id }, { SEQUENCE_CHAT: 'chat-b', SEQUENCE_REFERENCED: 'd99' });
  assert.equal(wrongRef.isError, true);
  const ok = visualTool({ repoPath: repo, component: 'line', spec: other, id }, { SEQUENCE_CHAT: 'chat-b', SEQUENCE_REFERENCED: `d98,${id}` });
  assert.notEqual(ok.isError, true);
  assert.match(text(ok), new RegExp(`^${id} v2`));
  const own = visualTool({ repoPath: repo, component: 'line', spec: { ...spec, subtitle: 'again' }, id }, { SEQUENCE_CHAT: 'chat-a' });
  assert.notEqual(own.isError, true);
});

test('the tool\'s own errors read as sentences that name the next call (no sliced listing, no guessed component)', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'vis-err-'));
  const none = visualTool({ repoPath: repo } as Parameters<typeof visualTool>[0], {});
  assert.equal(none.isError, true);
  assert.equal(text(none), 'visual needs component and spec (or list:true, or help:"<component>"). visual({list:true}) names the components.');
  const unknown = visualTool({ repoPath: repo, help: 'piechart3d' }, {});
  assert.equal(unknown.isError, true);
  assert.equal(text(unknown), 'no component "piechart3d". visual({list:true}) names them.');
});
