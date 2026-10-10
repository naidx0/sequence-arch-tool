import assert from 'node:assert';
import { test } from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRepoServer } from '../server/repoServer.js';

import { readAgentRuns, readArchivePage } from '../server/agentChatStore.js';
import { claudeSlug, cliHomes, cwdBelongsTo, humanPrompt, importSession, listImportable, parseClaudeSession, parseCodexSession } from '../server/importHistory.js';
import { ensureSessionsMigrated, readAgentThread, readSessionIndex } from '../server/sessionsStore.js';

/* T3 gap G11: Claude Code and Codex CLI sessions become Sequence chats, read-only. */

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(here, '..', '..', 'src', 'test', 'fixtures', 'import');
const CLAUDE_ID = '11111111-2222-3333-4444-555555555555';
const CODEX_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/** A repo plus fake CLI homes holding the fixtures, their paths rewritten to the repo. */
function world() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-import-')));
  const repo = path.join(dir, 'demo');
  fs.mkdirSync(repo, { recursive: true });
  const claudeDir = path.join(dir, 'home', '.claude');
  const codexDir = path.join(dir, 'home', '.codex');
  const put = (name: string, to: string): void => {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const text = fs.readFileSync(path.join(FIX, name), 'utf8').split('/work/demo').join(JSON.stringify(repo).slice(1, -1));
    fs.writeFileSync(to, text);
  };
  const proj = path.join(claudeDir, 'projects', claudeSlug(repo));
  put(`${CLAUDE_ID}.jsonl`, path.join(proj, `${CLAUDE_ID}.jsonl`));
  put('99999999-0000-0000-0000-000000000000.jsonl', path.join(proj, '99999999-0000-0000-0000-000000000000.jsonl'));
  const day = path.join(codexDir, 'sessions', '2026', '10', '03');
  put(`rollout-2026-10-03T09-00-00-${CODEX_ID}.jsonl`, path.join(day, `rollout-2026-10-03T09-00-00-${CODEX_ID}.jsonl`));
  put('rollout-2026-10-03T10-00-00-bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl', path.join(day, 'rollout-2026-10-03T10-00-00-bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'));
  ensureSessionsMigrated(repo);
  return { dir, repo, homes: { claudeDir, codexDir } };
}

/** Every file under a folder with its size, mtime and hash: proves nothing was written. */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(`${p}|${fs.statSync(p).mtimeMs}|${crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex')}`);
    }
  };
  walk(dir);
  return out.sort();
}

test('lists the Claude and Codex sessions of the opened repo, not other repos', async () => {
  const w = world();
  const list = await listImportable(w.repo, w.homes);
  assert.deepStrictEqual(list.map((s) => [s.source, s.providerSessionId]).sort(), [['claude', CLAUDE_ID], ['codex', CODEX_ID]]);
  const claude = list.find((s) => s.source === 'claude')!;
  assert.strictEqual(claude.title, 'Parser comment handling');
  assert.strictEqual(claude.firstPrompt, 'Please explain how the parser handles comments');
  assert.strictEqual(claude.imported, false);
  const codex = list.find((s) => s.source === 'codex')!;
  assert.strictEqual(codex.firstPrompt, 'Rename the helper to parseToken');
  assert.strictEqual(codex.cwd, w.repo);
});

test('a Claude session parses into one turn per question, with tools; sidechains and wrappers are dropped', async () => {
  const w = world();
  const text = fs.readFileSync(path.join(w.homes.claudeDir, 'projects', claudeSlug(w.repo), `${CLAUDE_ID}.jsonl`), 'utf8');
  const { turns, model } = parseClaudeSession(text);
  assert.strictEqual(model, 'claude-sonnet-4-5');
  assert.deepStrictEqual(turns.map((t) => t.prompt), ['Please explain how the parser handles comments', 'Now add a test for it']);
  assert.strictEqual(turns[0]!.text, 'Let me look.\n\nComments are skipped in the lexer.');
  assert.ok(!turns[0]!.text.includes('SIDECHAIN'));
  assert.deepStrictEqual(turns[0]!.tools.map((t) => [t.title, t.toolKind, t.status]), [
    ['Read /work/demo/src/parser.ts'.replace('/work/demo', w.repo), 'read', 'done'],
    ['Bash grep -n comment src/lexer.ts', 'execute', 'failed'],
  ]);
  assert.strictEqual(turns[1]!.text, 'Added lexer.comments.test.ts.');
  assert.ok(turns[0]!.endedAt > turns[0]!.startedAt);
});

test('a Codex rollout parses by its user_message events; the environment block is not a question', async () => {
  const w = world();
  const dir = path.join(w.homes.codexDir, 'sessions', '2026', '10', '03');
  const text = fs.readFileSync(path.join(dir, `rollout-2026-10-03T09-00-00-${CODEX_ID}.jsonl`), 'utf8');
  const { turns, model } = parseCodexSession(text);
  assert.strictEqual(model, 'gpt-5-codex');
  assert.deepStrictEqual(turns.map((t) => t.prompt), ['Rename the helper to parseToken', 'Run the tests']);
  assert.strictEqual(turns[0]!.text, 'Renamed in 3 files.');
  assert.strictEqual(turns[0]!.tools[0]!.title, 'shell bash -lc grep -rn helper src');
  assert.strictEqual(turns[1]!.text, 'All tests pass.', 'the answer comes from agent_message when no response_item carries it');
});

test('importing makes a read-only-history chat that resumes the CLI session, and never touches the CLI folders', async () => {
  const w = world();
  const before = [...snapshot(w.homes.claudeDir), ...snapshot(w.homes.codexDir)];
  const a = await importSession(w.repo, 'claude', CLAUDE_ID, w.homes);
  const b = await importSession(w.repo, 'codex', CODEX_ID, w.homes);
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.strictEqual(a.turns, 2);
  const runs = readAgentRuns(w.repo, a.chatId);
  assert.deepStrictEqual(runs.map((r) => [r.agentRef, r.prompt, r.status, r.stopReason]), [
    ['claude', 'Please explain how the parser handles comments', 'done', 'end_turn'],
    ['claude', 'Now add a test for it', 'done', 'end_turn'],
  ]);
  /* The chat's agent thread is the CLI's session: the next message rejoins it. */
  assert.strictEqual(readAgentThread(w.repo, a.chatId, 'claude')!.id, CLAUDE_ID);
  assert.strictEqual(readAgentThread(w.repo, b.chatId, 'codex')!.id, CODEX_ID);
  assert.strictEqual(readAgentThread(w.repo, b.chatId, 'codex')!.kind, 'codex');
  const entry = readSessionIndex(w.repo)!.sessions.find((s) => s.id === a.chatId)!;
  assert.strictEqual(entry.title, 'Parser comment handling');
  assert.deepStrictEqual(entry.importedFrom && [entry.importedFrom.source, entry.importedFrom.id], ['claude', CLAUDE_ID]);
  assert.deepStrictEqual([...snapshot(w.homes.claudeDir), ...snapshot(w.homes.codexDir)], before, 'the CLI folders are byte-for-byte unchanged');

  /* Importing twice opens the same chat; the list marks it. */
  const again = await importSession(w.repo, 'claude', CLAUDE_ID, w.homes);
  assert.ok(again.ok && again.already && again.chatId === a.chatId);
  assert.strictEqual(await (await listImportable(w.repo, w.homes)).find((s) => s.providerSessionId === CLAUDE_ID)!.chatId, a.chatId);
  assert.strictEqual(readSessionIndex(w.repo)!.sessions.filter((s) => s.importedFrom).length, 2);
});

test('only sessions the folders list can be imported: unknown ids and other repos are refused', async () => {
  const w = world();
  assert.deepStrictEqual(await importSession(w.repo, 'claude', '99999999-0000-0000-0000-000000000000', w.homes), { ok: false, reason: 'not-found' });
  assert.deepStrictEqual(await importSession(w.repo, 'codex', '../../etc/passwd', w.homes), { ok: false, reason: 'not-found' });
  assert.deepStrictEqual(await importSession(w.repo, 'codex', 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', w.homes), { ok: false, reason: 'not-found' });
  assert.deepStrictEqual(await listImportable(w.repo, { claudeDir: path.join(w.dir, 'none'), codexDir: path.join(w.dir, 'none2') }), []);
});

test('Windows paths: the Claude folder slug, case-insensitive cwd match, and %USERPROFILE% homes', async () => {
  assert.strictEqual(claudeSlug('C:\\Users\\Ryan Smith\\code\\my.app'), 'C--Users-Ryan-Smith-code-my-app');
  assert.strictEqual(cwdBelongsTo('C:\\Users\\me\\proj', 'c:\\users\\me\\proj'), true);
  assert.strictEqual(cwdBelongsTo('C:\\Users\\me\\proj', 'C:\\Users\\me\\proj\\packages\\a'), true);
  assert.strictEqual(cwdBelongsTo('C:\\Users\\me\\proj', 'C:\\Users\\me\\project2'), false);
  const h = cliHomes({}, path.join('C:', 'Users', 'me'));
  assert.strictEqual(h.claudeDir, path.join('C:', 'Users', 'me', '.claude'));
  assert.strictEqual(cliHomes({ CLAUDE_CONFIG_DIR: 'D:\\cfg\\claude', CODEX_HOME: 'D:\\cfg\\codex' }, 'x').codexDir, 'D:\\cfg\\codex');
});

test('the CLIs\' own wrapper text is not a question', async () => {
  assert.strictEqual(humanPrompt('<command-name>/review</command-name><command-args>main</command-args>'), '/review main');
  assert.strictEqual(humanPrompt('<local-command-stdout>x</local-command-stdout>'), '');
  assert.strictEqual(humanPrompt('[Request interrupted by user]'), '');
  assert.strictEqual(humanPrompt('  fix the build  '), 'fix the build');
});

test('the server lists and imports over HTTP for the opened project', async () => {
  const w = world();
  const store = path.join(w.repo, '.sequence');
  fs.mkdirSync(store, { recursive: true });
  const server = await createRepoServer(null, { webDist: undefined, userConfigDir: store, importHomes: w.homes });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    const list = (await (await fetch(`${base}/api/import/sessions`)).json()) as { sessions: { source: string; providerSessionId: string; imported: boolean }[] };
    assert.deepStrictEqual(list.sessions.map((x) => x.providerSessionId).sort(), [CLAUDE_ID, CODEX_ID]);
    const post = (body: unknown) => fetch(`${base}/api/import/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const ok = await post({ source: 'codex', providerSessionId: CODEX_ID });
    assert.strictEqual(ok.status, 200);
    const { chatId, turns } = (await ok.json()) as { chatId: string; turns: number };
    assert.strictEqual(turns, 2);
    const runs = (await (await fetch(`${base}/api/acp/runs?chatId=${encodeURIComponent(chatId)}`)).json()) as { runs: { prompt: string }[] };
    assert.deepStrictEqual(runs.runs.map((r) => r.prompt), ['Rename the helper to parseToken', 'Run the tests']);
    assert.strictEqual((await post({ source: 'claude', providerSessionId: '../x' })).status, 400);
    assert.strictEqual((await post({ source: 'claude', providerSessionId: 'nope' })).status, 404);
  } finally {
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }
});

test('a large import is written once, fast, off the request thread, and nothing is hidden: older turns page in', async () => {
  const w = world();
  const sid = 'cccccccc-2222-3333-4444-555555555555';
  const lines: string[] = [];
  const filler = 'lorem ipsum dolor sit amet '.repeat(1400); // ~38 KB a turn, ~15 MB for 400
  for (let i = 0; i < 400; i++) {
    const ts = new Date(Date.UTC(2026, 9, 1, 10, 0, i)).toISOString();
    lines.push(JSON.stringify({ type: 'user', cwd: w.repo, sessionId: sid, timestamp: ts, message: { role: 'user', content: `question ${i}` } }));
    lines.push(JSON.stringify({ type: 'assistant', cwd: w.repo, sessionId: sid, timestamp: ts, message: { id: `m${i}`, role: 'assistant', model: 'claude-x', content: [{ type: 'text', text: `answer ${i} ${filler}` }] } }));
  }
  const proj = path.join(w.homes.claudeDir, 'projects', claudeSlug(w.repo));
  fs.writeFileSync(path.join(proj, `${sid}.jsonl`), lines.join('\n') + '\n');
  assert.ok(fs.statSync(path.join(proj, `${sid}.jsonl`)).size > 14 * 1024 * 1024);

  /* The event loop keeps turning while the import runs (largest gap between ticks stays small). */
  let worst = 0;
  let last = Date.now();
  const tick = setInterval(() => {
    worst = Math.max(worst, Date.now() - last);
    last = Date.now();
  }, 10);
  const t0 = Date.now();
  const out = await importSession(w.repo, 'claude', sid, w.homes);
  const took = Date.now() - t0;
  /* The last stall ends when the import's continuation runs, so it counts too (a timer that never got to fire is not a clean gap). */
  worst = Math.max(worst, Date.now() - last);
  clearInterval(tick);
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.strictEqual(out.turns, 400);
  assert.ok(took < 2000, `import took ${took} ms`);
  assert.ok(worst < 50, `event loop stalled ${worst} ms`);
  const runs = readAgentRuns(w.repo, out.chatId);
  assert.strictEqual(runs.length, 200);
  /* The 200 turns not on screen are reachable: 100 a page, newest first. */
  const p1 = readArchivePage(w.repo, out.chatId, 0, 100);
  const p2 = readArchivePage(w.repo, out.chatId, 100, 100);
  assert.deepStrictEqual([p1.runs.length, p1.remaining, p2.runs.length, p2.remaining], [100, 100, 100, 0]);
  assert.strictEqual(p2.runs[0]!.prompt, 'question 0');
  assert.strictEqual(runs[0]!.prompt, 'question 200');
  console.log(`import 400 turns / ${Math.round(fs.statSync(path.join(proj, `${sid}.jsonl`)).size / 1048576)} MB: ${took} ms, worst loop gap ${worst} ms`);
});

test('folder matching is case sensitive on Linux and folded for Windows paths', () => {
  if (process.platform !== 'win32') {
    assert.strictEqual(cwdBelongsTo('/x/Repo', '/x/repo'), false);
    assert.strictEqual(cwdBelongsTo('/x/Repo', '/x/Repo/pkg'), true);
  }
  assert.strictEqual(cwdBelongsTo('C:\\Users\\Me\\Repo', 'c:\\users\\me\\repo\\pkg'), true);
});
