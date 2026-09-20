import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  ensureWorkspace,
  listWorkspace,
  renderWorkspaceSection,
  workspaceRoot,
  MAX_WORKSPACE_ENTRIES,
} from '../server/workspace.js';
import { executeAskTool, WORKSPACE_TOOLS, renderWorkspaceToolHintSection } from '../server/askTools.js';

/*
 * "IT SHOULD DEFAULT TO A WORKSPACE WHEREVER IT'S INSTALLED, OR MAKE ONE …
 *  THEN WE KNOW WHERE IT'S WRITING FILES, ITS CACHE, ALL OF THAT."
 *                                                  — the owner, 2026-09-13
 *
 * Measured before this existed: with no repository attached, `activeRoot()`
 * throws and every file tool answers `refused: <name> needs an attached repo`.
 * A General chat could not read a file, could not write one, and could not say
 * where it would have put one — in a product whose first law is local-first.
 */

function tempStore(): string {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'seq-ws-'));
}

/** The tool context a repo-less turn actually gets. */
function repolessCtx(ws: string) {
  return {
    repoRoot: null,
    designMode: true,
    workspaceRoot: ws,
    resolveReadable: () => null,
  } as never;
}

describe('where the workspace is', () => {
  it('sits under the user store, and resolving it touches NOTHING', () => {
    const store = tempStore();
    const root = workspaceRoot(store);
    assert.equal(root, path.join(store, 'workspace'));
    // Reading where it WILL be must not create it: `GET /api/workspace` on a
    // fresh machine should say "here is the path" and leave the disk alone.
    assert.equal(fs.existsSync(root), false);
  });

  it('ensureWorkspace makes it, and returns the REAL path', () => {
    const store = tempStore();
    const real = ensureWorkspace(store);
    assert.equal(fs.existsSync(real), true);
    // Real, because `resolveInRepo` canonicalises through realpath and compares
    // against the root it was handed. A non-canonical root makes the jail
    // reject every path inside it — a refusal that looks like a security check
    // and is a path-spelling bug.
    assert.equal(real, fs.realpathSync(real));
    for (const name of ['charts', 'drawings', 'memory', 'context'] as const) {
      assert.ok(fs.statSync(path.join(real, name)).isDirectory(), name);
      assert.ok(fs.existsSync(path.join(real, name, 'README.md')), `${name}/README.md`);
    }
  });

  it('an absolute SEQUENCE_WORKSPACE moves it; a relative one is ignored', () => {
    const store = tempStore();
    const elsewhere = tempStore();
    const prior = process.env.SEQUENCE_WORKSPACE;
    try {
      process.env.SEQUENCE_WORKSPACE = elsewhere;
      assert.equal(workspaceRoot(store), elsewhere);
      // A relative value would resolve against an incidental cwd and silently
      // keep the user's work somewhere new — the same rule SEQUENCE_USER_DIR has.
      process.env.SEQUENCE_WORKSPACE = './work';
      assert.equal(workspaceRoot(store), path.join(store, 'workspace'));
    } finally {
      if (prior === undefined) delete process.env.SEQUENCE_WORKSPACE;
      else process.env.SEQUENCE_WORKSPACE = prior;
    }
  });
});

describe('what the listing says', () => {
  it('a workspace that has never existed says so, and still names the path', () => {
    const store = tempStore();
    const l = listWorkspace(store);
    assert.equal(l.exists, false);
    assert.equal(l.entries.length, 0);
    assert.ok(l.root.endsWith('workspace'));
  });

  it('lists files with size, and nests directories', () => {
    const store = tempStore();
    const ws = ensureWorkspace(store);
    fs.writeFileSync(path.join(ws, 'notes.md'), '# hello\n');
    fs.mkdirSync(path.join(ws, 'drafts'));
    fs.writeFileSync(path.join(ws, 'drafts', 'one.txt'), 'x');
    const l = listWorkspace(store);
    assert.equal(l.exists, true);
    const paths = l.entries.map((e) => e.path);
    assert.ok(paths.includes('notes.md'));
    assert.ok(paths.includes('drafts'));
    assert.ok(paths.includes('drafts/one.txt'));
    for (const name of ['charts', 'drawings', 'memory', 'context'] as const) {
      assert.ok(paths.includes(name), name);
    }
    assert.equal(l.entries.find((e) => e.path === 'notes.md')?.bytes, 8);
    // A directory has no honest size.
    assert.equal(l.entries.find((e) => e.path === 'drafts')?.bytes, undefined);
  });

  it('skips build and vcs directories rather than paginating through them', () => {
    const store = tempStore();
    const ws = ensureWorkspace(store);
    fs.mkdirSync(path.join(ws, 'node_modules', 'x'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'node_modules', 'x', 'y.js'), '1');
    fs.writeFileSync(path.join(ws, 'kept.txt'), '1');
    const paths = listWorkspace(store).entries.map((e) => e.path);
    assert.ok(paths.includes('kept.txt'));
    assert.ok(!paths.some((p) => p.includes('node_modules')));
  });

  it('caps the listing and REPORTS the overflow', () => {
    const store = tempStore();
    const ws = ensureWorkspace(store);
    for (let i = 0; i < MAX_WORKSPACE_ENTRIES + 12; i++) {
      fs.writeFileSync(path.join(ws, `f${String(i).padStart(4, '0')}.txt`), 'x');
    }
    const l = listWorkspace(store);
    assert.equal(l.entries.length, MAX_WORKSPACE_ENTRIES);
    // Seed dirs + READMEs (8) sit beside the synthetic files, so overflow is
    // 12 extras plus those seeds that did not fit under the cap.
    assert.ok(l.omitted >= 12, `omitted=${l.omitted}`);
  });
});

describe('what the prompt is told', () => {
  it('names the files AND says they are not a repository', () => {
    const store = tempStore();
    const ws = ensureWorkspace(store);
    fs.writeFileSync(path.join(ws, 'notes.md'), 'hi');
    const text = renderWorkspaceSection(listWorkspace(store)).join('\n');
    assert.match(text, /--- YOUR LOCAL WORKSPACE ---/);
    assert.match(text, /- notes\.md \(2 bytes\)/);
    // The risk of handing file tools to a repo-less turn is a model that reads
    // a file off disk and is one sentence from describing "the repository".
    assert.match(text, /NOT a scanned repository/);
    assert.match(text, /do not call them "the repo"/);
  });

  it('an empty workspace renders NOTHING — a permanent hedge is the defect', () => {
    const store = tempStore();
    ensureWorkspace(store);
    assert.deepEqual(renderWorkspaceSection(listWorkspace(store)), []);
    assert.deepEqual(renderWorkspaceSection(listWorkspace(tempStore())), []);
  });

  it('the belt names only the tools that work, and names the ones that do not', () => {
    const belt = renderWorkspaceToolHintSection();
    // Never under a header that asserts a repository.
    assert.match(belt, /--- TOOLS \(your local workspace — NOT a repository\) ---/);
    for (const t of WORKSPACE_TOOLS) assert.ok(belt.includes(`\`${t}\``), t);
    // A hint that advertises a refused tool is worse than no hint; its converse
    // is that silence about a refused tool costs a round and an apology.
    for (const absent of ['read_topology', 'who_calls', 'git_status', 'run_command']) {
      assert.match(belt, new RegExp(`NOT available[^]*${absent}`), absent);
    }
  });
});

describe('the tools, in a chat with no repository', () => {
  it('WRITES a file — the thing that was refused outright before', async () => {
    const store = tempStore();
    const ws = ensureWorkspace(store);
    const r = await executeAskTool(
      'propose_files',
      { title: 'Save the notes', files: [{ path: 'notes.md', content: '# hello\n' }] },
      repolessCtx(ws),
    );
    assert.equal(r.ok, true, r.evidence);
    assert.equal(r.proposal?.files[0]?.path, 'notes.md');
  });

  it('READS one back', async () => {
    const store = tempStore();
    const ws = ensureWorkspace(store);
    fs.writeFileSync(path.join(ws, 'notes.md'), 'kept across turns\n');
    const r = await executeAskTool('read_file', { path: 'notes.md' }, repolessCtx(ws));
    assert.equal(r.ok, true, r.evidence);
    assert.match(r.content ?? '', /kept across turns/);
  });

  it('the JAIL still holds — the workspace is a root, not an opening', async () => {
    const store = tempStore();
    const ws = ensureWorkspace(store);
    for (const escape of ['../ai.json', '/etc/passwd', '..\\..\\secret']) {
      const r = await executeAskTool('read_file', { path: escape }, repolessCtx(ws));
      assert.equal(r.ok, false, escape);
    }
  });

  it('refuses the tools that need a graph, a repo, or a shell — by name', async () => {
    const store = tempStore();
    const ws = ensureWorkspace(store);
    for (const name of ['read_topology', 'who_calls', 'git_status', 'run_command']) {
      const r = await executeAskTool(name, { cmd: 'ls' }, repolessCtx(ws));
      assert.equal(r.ok, false, name);
      assert.match(r.evidence, /needs an attached repo/);
      // And the refusal says what DOES work, so the next round is not spent guessing.
      assert.match(r.evidence, /the local workspace supports/);
    }
  });

  it('with NO workspace the refusal is exactly what it always was', async () => {
    // Byte-identical for a caller that never supplies one — a read-only home,
    // or any pre-existing caller of this pipeline.
    const r = await executeAskTool(
      'read_file',
      { path: 'notes.md' },
      { repoRoot: null, designMode: true, resolveReadable: () => null } as never,
    );
    assert.equal(r.ok, false);
    assert.equal(r.evidence, 'refused: read_file needs an attached repo');
  });
});

/*
 * THE SPACE IS THERE WHEN THE APP OPENS, not after the first question.
 *
 * Owner, 2026-09-14: Sequence should "load and work inside of a space". The
 * lazy creation in `askWorkspaceRoot()` plus the deliberate no-side-effect
 * rule on `GET /api/workspace` left a freshly launched app showing "Not
 * created yet" — honest, and not a place to work.
 */
describe('a server with no repository opens INTO a workspace', () => {
  it('serving with no repo creates it, and the listing then says it exists', async () => {
    const store = tempStore();
    // Before: nothing on disk, and reading says so without making it.
    assert.equal(listWorkspace(store).exists, false);
    assert.equal(fs.existsSync(workspaceRoot(store)), false);

    // `serveRepo` does this at boot; `ensureWorkspace` is the one function
    // that creates, and this is the call it makes.
    const root = ensureWorkspace(store);

    const after = listWorkspace(store);
    assert.equal(after.exists, true);
    assert.equal(after.root, root);
    // Seeded charts/drawings/memory/context so General Files has a place to
    // work — not "empty disk", not "not created yet".
    for (const name of ['charts', 'drawings', 'memory', 'context'] as const) {
      assert.ok(
        after.entries.some((e) => e.path === name && e.kind === 'dir'),
        name,
      );
    }
  });

  it('is IDEMPOTENT — relaunching does not disturb what is already there', async () => {
    const store = tempStore();
    const root = ensureWorkspace(store);
    fs.writeFileSync(path.join(root, 'notes.md'), 'kept\n');
    assert.equal(ensureWorkspace(store), root);
    assert.equal(fs.readFileSync(path.join(root, 'notes.md'), 'utf8'), 'kept\n');
  });
});
