/* ══════════════════════════════════════════════════════════════════════════
   PULL REQUEST FROM A WORKTREE CHAT
   packages/analyzer/src/server/prFlow.ts

   T3 Code: "Commit, push, PR with generated messages". Here, from the chat
   that owns a worktree: one confirmed click commits what the agent wrote on
   the chat's branch, pushes that branch (never forced, never anywhere the
   user did not configure), opens the pull request with `gh pr create`, and
   links it to the chat.

     previewPullRequest   the generated commit message, title and body, and
                          what will happen (files, remote, base); changes
                          nothing, so the person can edit before confirming.
     openPullRequest      commit (when dirty), push, `gh pr create`, link.

   Messages are generated from the chat (its title, what the first message
   asked, the files and commits on the branch), not by a model call: nothing
   leaves the machine to write them.

   `gh` is found as $SEQUENCE_GH (a script path runs under this node, which is
   how tests stub it), else `gh` on PATH. If it is missing the branch is still
   pushed and the answer says so, with the compare URL when the remote is
   GitHub, rather than failing after the work is done.
   ══════════════════════════════════════════════════════════════════════════ */

import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { readAgentRuns } from './agentChatStore.js';
import { gitWhy, runGit, type ChangedFile, type ChatWorktreeRef, type Refusal } from './chatWorktree.js';
import { launchTool, projectRootOf, resolveTool } from './toolPath.js';
import { readSessionIndex, writeSessionPr, type ChatPullRequest, type SessionIndexEntry } from './sessionsStore.js';

const oneLine = (s: string, n: number): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/** "Add a ping route · Claude" is a rail label; the pull request is about the work. */
export function workTitle(chatTitle: string): string {
  return chatTitle.replace(/\s·\s[^·]+$/, '').trim() || 'Changes from a Sequence chat';
}

const STATUS_WORD: Record<ChangedFile['status'], string> = { added: 'added', modified: 'changed', deleted: 'removed' };

export interface PrDraft {
  commitMessage: string;
  title: string;
  body: string;
}

export function draftMessages(input: { chatTitle: string; firstAsk: string | null; files: readonly ChangedFile[]; commits: readonly string[] }): PrDraft {
  const title = oneLine(workTitle(input.chatTitle), 72);
  const list = input.files.slice(0, 30).map((f) => `- ${STATUS_WORD[f.status]} \`${f.path}\``);
  if (input.files.length > 30) list.push(`- and ${input.files.length - 30} more`);
  const lines = [`${title}`, ''];
  if (input.files.length) lines.push(...list.map((l) => l.replace(/`/g, '')));
  const body: string[] = [];
  if (input.firstAsk) body.push('## What was asked', '', oneLine(input.firstAsk, 600), '');
  body.push('## Changes', '', ...(list.length ? list : ['- no file changes']), '');
  if (input.commits.length) body.push('## Commits', '', ...input.commits.slice(0, 20).map((c) => `- ${c}`), '');
  body.push('Opened from a Sequence chat.');
  return { commitMessage: lines.join('\n').trimEnd(), title, body: body.join('\n') };
}

/* ── the commands ───────────────────────────────────────────────────────── */

interface Proc {
  code: number | null;
  stdout: string;
  stderr: string;
  /** The program was not found. */
  missing?: boolean;
  /** The program was found inside the project and not run. */
  refused?: boolean;
}

/**
 * `gh` by absolute path: $SEQUENCE_GH when set (a script path runs under this
 * node, which is how tests stub it), else resolved from PATH and the usual
 * install folders. A `gh` inside the repository or the worktree is refused.
 */
function runGh(args: string[], cwd: string, repoRoot: string): Promise<Proc> {
  const custom = process.env.SEQUENCE_GH;
  let cmd: string;
  let argv: string[];
  let verbatim = false;
  if (custom && /\.(?:mjs|cjs|js)$/i.test(custom)) {
    cmd = process.execPath;
    argv = [path.resolve(custom), ...args];
  } else {
    const tool = custom && path.isAbsolute(custom) ? { ok: true as const, path: custom } : resolveTool('gh', [cwd, repoRoot, projectRootOf(cwd)]);
    if (!tool.ok) return Promise.resolve({ code: -1, stdout: '', stderr: tool.error, missing: !/Refusing/.test(tool.error), refused: /Refusing/.test(tool.error) });
    const l = launchTool(tool.path, args);
    cmd = l.command;
    argv = l.args;
    verbatim = l.verbatim;
  }
  return new Promise((resolve) => {
    let child: childProcess.ChildProcess;
    try {
      child = childProcess.spawn(cmd, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...(verbatim ? { windowsVerbatimArguments: true } : {}), env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' } });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: (e as Error).message, missing: true });
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.stdout!.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    child.stderr!.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + e.message, missing: (e as NodeJS.ErrnoException).code === 'ENOENT' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function remoteFor(wt: string): Promise<string | null> {
  const r = await runGit(wt, ['remote']);
  const names = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return names.includes('origin') ? 'origin' : (names[0] ?? null);
}

async function baseFor(wt: string, ref: ChatWorktreeRef, remote: string): Promise<string> {
  if (ref.baseBranch) return ref.baseBranch;
  const head = await runGit(wt, ['symbolic-ref', '--short', '-q', `refs/remotes/${remote}/HEAD`]);
  const name = head.stdout.trim().replace(new RegExp(`^${remote}/`), '');
  return head.code === 0 && name ? name : 'main';
}

function entryOf(root: string, chatId: string): SessionIndexEntry | undefined {
  return readSessionIndex(root)?.sessions.find((s) => s.id === chatId);
}

/* ── what would be committed ────────────────────────────────────────────── */

const EXAMPLE_ENV = /^\.env\.(?:example|sample|template|dist|defaults)$/i;

/** Why a path looks like a secret, from its name alone, or null. */
export function secretReason(file: string): string | null {
  const name = file.split('/').pop() ?? file;
  if (EXAMPLE_ENV.test(name)) return null;
  if (/^\.env(?:\..+)?$/i.test(name) || /\.env$/i.test(name) || /^\.envrc$/i.test(name)) return 'an environment file';
  if (/\.(?:pem|key|p12|pfx|jks|keystore|kdbx)$/i.test(name)) return 'a key or certificate';
  if (/^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/i.test(name)) return 'an SSH key';
  if (/^credentials(?:\..+)?$/i.test(name) || /^(?:secrets?|service-account.*)\.(?:json|ya?ml|toml)$/i.test(name) || /^secrets?[._-].+\.(?:json|ya?ml|toml)$/i.test(name) || /\.tfvars$/i.test(name)) return 'a credentials file';
  if (/^\.(?:npmrc|pypirc|netrc|pgpass|git-credentials)$/i.test(name)) return 'a tool login file';
  return null;
}

/** Why the text of a file looks like it holds a secret (a private key header, a well-known token shape), or null. */
export function contentReason(text: string): string | null {
  if (/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY(?: BLOCK)?-----/.test(text)) return 'holds a private key';
  if (/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bsk-ant-[A-Za-z0-9_-]{20,}|\bsk-[A-Za-z0-9]{32,}\b|\bAIza[0-9A-Za-z_-]{35}\b|\bglpat-[A-Za-z0-9_-]{20}\b/.test(text)) return 'holds an access token';
  return null;
}

const CONTENT_LIMIT = 256 * 1024;
const CONTENT_CHECKS = 300;

export interface PendingFile {
  path: string;
  status: ChangedFile['status'];
  /** Why it looks like a secret; it is left out unless the person ticks it. */
  flagged: string | null;
  /** git-ignored, yet in the index (force-added): sent only if ticked. */
  ignored?: boolean;
}

/** Paths git would ignore (`check-ignore --no-index`, so a force-added file still counts). */
async function ignoredPaths(wt: string, paths: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < paths.length; i += 100) {
    const r = await runGit(wt, ['-c', 'core.quotePath=false', 'check-ignore', '--no-index', '--', ...paths.slice(i, i + 100)]);
    for (const p of r.stdout.split(/\r?\n/)) if (p) out.add(p);
  }
  return out;
}

/** Name, then ignore rules, then content. `read` gives a file's text (or null when it is binary or too big). */
async function flagAll(wt: string, files: readonly { path: string; deleted: boolean }[], read: (p: string) => Promise<string | null>): Promise<Map<string, { flagged: string | null; ignored: boolean }>> {
  const live = files.filter((f) => !f.deleted).map((f) => f.path);
  const ignored = await ignoredPaths(wt, live);
  const out = new Map<string, { flagged: string | null; ignored: boolean }>();
  let checks = 0;
  for (const f of files) {
    let flagged = secretReason(f.path);
    const isIgnored = ignored.has(f.path);
    if (!flagged && isIgnored) flagged = 'ignored by .gitignore';
    if (!flagged && !f.deleted && checks < CONTENT_CHECKS) {
      checks++;
      const text = await read(f.path);
      if (text) flagged = contentReason(text);
    }
    out.set(f.path, { flagged, ignored: isIgnored });
  }
  return out;
}

const textOf = (buf: Buffer): string | null => (buf.length > CONTENT_LIMIT || buf.includes(0) ? null : buf.toString('utf8'));

/** Uncommitted paths in the worktree (untracked included; `.sequence/` excluded; git-ignored ones only when force-added). */
export async function pendingFiles(wt: string): Promise<PendingFile[] | Refusal> {
  const r = await runGit(wt, ['-c', 'status.renames=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (r.code !== 0) return { ok: false, status: 500, error: gitWhy(r, 'git status failed') };
  const raw: { path: string; status: ChangedFile['status'] }[] = [];
  for (const rec of r.stdout.split('\0')) {
    if (rec.length < 4) continue;
    const xy = rec.slice(0, 2);
    const file = rec.slice(3);
    if (file === '.sequence' || file.startsWith('.sequence/')) continue;
    raw.push({ path: file, status: xy === '??' || xy.includes('A') ? 'added' : xy.includes('D') ? 'deleted' : 'modified' });
  }
  const flags = await flagAll(wt, raw.map((f) => ({ path: f.path, deleted: f.status === 'deleted' })), async (p) => {
    try {
      return textOf(await fs.promises.readFile(path.join(wt, p)));
    } catch {
      return null;
    }
  });
  return raw
    .map((f) => ({ ...f, flagged: flags.get(f.path)!.flagged, ...(flags.get(f.path)!.ignored ? { ignored: true } : {}) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Files already committed on the branch since it began, each with whether it looks like a secret. */
async function committedFiles(wt: string, baseCommit: string): Promise<PendingFile[] | Refusal> {
  const d = await runGit(wt, ['diff', '--name-status', '--no-renames', baseCommit, 'HEAD']);
  if (d.code !== 0) return { ok: false, status: 500, error: gitWhy(d, 'git diff failed') };
  const names = parseNames(d.stdout);
  const flags = await flagAll(wt, names.map((f) => ({ path: f.path, deleted: f.status === 'deleted' })), async (p) => {
    const g = await runGit(wt, ['show', `HEAD:${p}`]);
    return g.code === 0 ? textOf(Buffer.from(g.stdout, 'utf8')) : null;
  });
  return names.map((f) => ({ path: f.path, status: f.status, flagged: flags.get(f.path)!.flagged, ...(flags.get(f.path)!.ignored ? { ignored: true } : {}) })).sort((a, b) => a.path.localeCompare(b.path));
}

/** Stage exactly these paths (and nothing the agent staged on its own). */
async function stageOnly(wt: string, files: readonly PendingFile[]): Promise<Proc> {
  const reset = await runGit(wt, ['reset', '-q']);
  if (reset.code !== 0) return reset;
  for (let i = 0; i < files.length; i += 100) {
    const batch = files.slice(i, i + 100);
    const add = await runGit(wt, ['add', '-A', ...(batch.some((f) => f.ignored) ? ['-f'] : []), '--', ...batch.map((f) => `:(literal)${f.path}`)]);
    if (add.code !== 0) return add;
  }
  return { code: 0, stdout: '', stderr: '' };
}

export interface PrPreview extends PrDraft {
  /** Every file the pull request carries: already committed on the branch, then the uncommitted ones that will be committed. */
  files: ChangedFile[];
  /** The uncommitted files, each with whether it looks like a secret (left out unless ticked). */
  pending: PendingFile[];
  /** Every file already committed on the branch, each flagged when it looks like a secret (pushing the branch sends them). */
  committed: PendingFile[];
  dirty: boolean;
  remote: string | null;
  base: string;
  branch: string;
  /** The pull request already linked to this chat, if any. */
  pr: ChatPullRequest | null;
}

function parseNames(out: string): ChangedFile[] {
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const [st, ...rest] = l.split('\t');
      return { path: rest.join('\t'), status: (st === 'A' ? 'added' : st === 'D' ? 'deleted' : 'modified') as ChangedFile['status'] };
    });
}

export async function previewPullRequest(root: string, chatId: string, ref: ChatWorktreeRef, include: readonly string[] = []): Promise<{ ok: true; preview: PrPreview } | Refusal> {
  const entry = entryOf(root, chatId);
  if (!entry) return { ok: false, status: 404, error: 'session not found' };
  const pending = await pendingFiles(ref.path);
  if (!Array.isArray(pending)) return pending;
  const committed = await committedFiles(ref.path, ref.baseCommit);
  if (!Array.isArray(committed)) return committed;
  const byPath = new Map<string, ChangedFile>(committed.map((f) => [f.path, { path: f.path, status: f.status }]));
  for (const f of pending) if (!f.flagged || include.includes(f.path)) byPath.set(f.path, { path: f.path, status: f.status });
  const files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  const remote = await remoteFor(ref.path);
  const log = await runGit(ref.path, ['log', '--format=%s', `${ref.baseCommit}..HEAD`]);
  const firstAsk = readAgentRuns(root, chatId)[0]?.prompt ?? null;
  const draft = draftMessages({ chatTitle: entry.title, firstAsk, files, commits: log.stdout.split(/\r?\n/).filter(Boolean) });
  return {
    ok: true,
    preview: { ...draft, files, pending, committed, dirty: pending.length > 0, remote, base: await baseFor(ref.path, ref, remote ?? 'origin'), branch: ref.branch, pr: entry.pr ?? null },
  };
}

export interface OpenInput {
  /** Flagged (secret-shaped) uncommitted paths the person ticked. Anything flagged and not listed stays uncommitted. */
  includeFlagged?: string[];
  /** The agent is mid-turn in this chat (the server knows). */
  busy?: boolean;
  title?: string;
  body?: string;
  commitMessage?: string;
}

export type OpenResult =
  | { ok: true; pr: ChatPullRequest; committed: string | null; pushed: { remote: string; branch: string }; existing: boolean }
  | (Refusal & { pushed?: { remote: string; branch: string }; compareUrl?: string | null });

const URL_RE = /https?:\/\/\S+/g;

/** The compare URL for a GitHub remote, so a missing `gh` still leaves a one-click next step. */
async function compareUrl(wt: string, remote: string, base: string, branch: string): Promise<string | null> {
  const u = (await runGit(wt, ['remote', 'get-url', remote])).stdout.trim();
  const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(u);
  return m ? `https://github.com/${m[1]}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?expand=1` : null;
}

export async function openPullRequest(root: string, chatId: string, ref: ChatWorktreeRef, input: OpenInput = {}): Promise<OpenResult> {
  if (input.busy) return { ok: false, status: 409, error: 'The agent is still working in this chat. Wait for it, or stop it, then open the pull request.' };
  const include = input.includeFlagged ?? [];
  const pv = await previewPullRequest(root, chatId, ref, include);
  if (!pv.ok) return pv;
  const p = pv.preview;
  /* The branch's own commits go with the push, and a commit cannot be unticked: refuse until each flagged one is sent on purpose or taken out of the branch. */
  const heldCommitted = p.committed.filter((f) => f.flagged && !include.includes(f.path));
  if (heldCommitted.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `Already committed on ${ref.branch}, and ${heldCommitted.length === 1 ? 'it looks' : 'they look'} like ${heldCommitted.length === 1 ? 'a secret' : 'secrets'}: ${heldCommitted.map((f) => `${f.path} (${f.flagged})`).join(', ')}. Pushing the branch would send ${heldCommitted.length === 1 ? 'it' : 'them'}. Take ${heldCommitted.length === 1 ? 'it' : 'them'} out of the branch (git rm, then commit), or tick ${heldCommitted.length === 1 ? 'it' : 'them'} to send anyway. Nothing was committed or pushed.`,
    };
  }
  const toCommit = p.pending.filter((f) => !f.flagged || include.includes(f.path));
  const title = (input.title ?? '').trim() || p.title;
  const body = input.body ?? p.body;
  if (!p.remote) return { ok: false, status: 409, error: 'This repository has no remote to push to. Add one (git remote add origin <url>), then try again.' };

  /* 1. Commit what the agent wrote on the chat's branch. */
  let committed: string | null = null;
  if (toCommit.length > 0) {
    const staged = await stageOnly(ref.path, toCommit);
    if (staged.code !== 0) return { ok: false, status: 500, error: gitWhy(staged, 'git add failed') };
    const who = await runGit(ref.path, ['config', 'user.email']);
    const identity: Record<string, string> = who.stdout.trim() ? {} : { GIT_AUTHOR_NAME: 'Sequence', GIT_AUTHOR_EMAIL: 'sequence@users.noreply.invalid', GIT_COMMITTER_NAME: 'Sequence', GIT_COMMITTER_EMAIL: 'sequence@users.noreply.invalid' };
    const c = await runGit(ref.path, ['commit', '-q', '-m', (input.commitMessage ?? '').trim() || p.commitMessage], identity);
    if (c.code !== 0) return { ok: false, status: 409, error: `git could not commit: ${gitWhy(c, 'git commit failed')}` };
    committed = (await runGit(ref.path, ['rev-parse', 'HEAD'])).stdout.trim();
  } else if (p.files.length === 0 && !p.pr) {
    const held = p.pending.filter((f) => f.flagged).length;
    return {
      ok: false,
      status: 409,
      error: held ? `Only ${held} ${held === 1 ? 'file' : 'files'} changed, and ${held === 1 ? 'it looks' : 'they look'} like secrets, so nothing was committed. Tick ${held === 1 ? 'it' : 'them'} to include.` : 'This chat has changed no files, so there is nothing to open a pull request for.',
    };
  }

  /* 2. Push the branch. Never forced. */
  const push = await runGit(ref.path, ['push', '--set-upstream', p.remote, `${ref.branch}:${ref.branch}`]);
  if (push.code !== 0) return { ok: false, status: 502, error: `git could not push ${ref.branch} to ${p.remote}: ${gitWhy(push, 'git push failed')}` };
  const pushed = { remote: p.remote, branch: ref.branch };

  /* 3. Already linked: the push updated it. */
  if (p.pr) return { ok: true, pr: p.pr, committed, pushed, existing: true };

  /* 4. The pull request. */
  const gh = await runGh(['pr', 'create', '--title', title, '--body', body, '--base', p.base, '--head', ref.branch], ref.path, root);
  if (gh.refused) return { ok: false, status: 409, error: `The branch ${ref.branch} was pushed, but ${gh.stderr}`, pushed, compareUrl: await compareUrl(ref.path, p.remote, p.base, ref.branch) };
  if (gh.missing) {
    return {
      ok: false,
      status: 424,
      error: `The branch ${ref.branch} was pushed to ${p.remote}, but the GitHub CLI (gh) was not found to open the pull request. Install it, or open one from the branch.`,
      pushed,
      compareUrl: await compareUrl(ref.path, p.remote, p.base, ref.branch),
    };
  }
  if (gh.code !== 0) {
    return { ok: false, status: 502, error: `The branch ${ref.branch} was pushed, but gh could not open the pull request: ${gitWhy(gh, 'gh pr create failed')}`, pushed, compareUrl: await compareUrl(ref.path, p.remote, p.base, ref.branch) };
  }
  const url = (gh.stdout.match(URL_RE) ?? []).at(-1)?.replace(/[).,]+$/, '');
  if (!url) return { ok: false, status: 502, error: 'gh opened a pull request but printed no link to it.', pushed };
  const number = /\/pull\/(\d+)/.exec(url)?.[1];
  const pr: ChatPullRequest = { url, number: number ? Number(number) : null, title, branch: ref.branch, base: p.base, at: new Date().toISOString() };
  writeSessionPr(root, chatId, pr);
  return { ok: true, pr, committed, pushed, existing: false };
}
