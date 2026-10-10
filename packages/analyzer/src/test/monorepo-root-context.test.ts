import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanRepo } from '../scan.js';

/**
 * A monorepo whose compose builds from the REPO ROOT must not collapse into one
 * service.
 *
 * Reported from real use on a 12-app product repo. Its compose builds the API
 * with `context: .` (so the image can COPY shared packages) and
 * `dockerfile: backend/Dockerfile`. Taken literally, `context: .` made the
 * scanner walk the ENTIRE repository into that single service: the graph showed
 * two services — both rooted at `.` — and every sibling app (the marketing site,
 * the learning platform, the admin console, the CRM, the forms system) was
 * demoted to a `module` under each of them, with the same files attributed twice.
 *
 * Everything downstream then inherited the damage: the Architecture board had two
 * meaningless cards, the Task Board had nothing real to import, the MADR pop-up
 * read "Core — a group of 4 related files" twenty times over, and the Process
 * rail showed one bucket for the whole system.
 *
 * Two grounded fixes are locked here:
 *  1. the compose file's own `dockerfile:` path says where the service lives, so
 *     a root context narrows to that directory;
 *  2. `context: .` is compose ADMITTING the repo is bigger than what it deploys,
 *     so app roots compose does not cover are surfaced instead of vanishing.
 *
 * Both are scoped to that admission — an ordinary compose repo, where each
 * service has its own build directory, is untouched. That is asserted too, since
 * the six reference gates depend on it.
 */

function write(p: string, body: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

function pyApp(root: string, dir: string): void {
  write(path.join(root, dir, 'requirements.txt'), 'fastapi\nuvicorn\nredis\n');
  write(
    path.join(root, dir, 'app', 'main.py'),
    'from fastapi import FastAPI\napp = FastAPI()\n\n@app.get("/health")\ndef health():\n    return {"ok": True}\n',
  );
  write(path.join(root, dir, 'Dockerfile'), 'FROM python:3.11\n');
}

function webApp(root: string, dir: string): void {
  write(
    path.join(root, dir, 'package.json'),
    JSON.stringify({ name: path.basename(dir), private: true, dependencies: { react: '^18.0.0' } }),
  );
  write(path.join(root, dir, 'src', 'App.tsx'), 'export function App() { return null; }\n');
}

/** The reported shape: compose builds api + worker from the repo root; four
 *  front-ends and a shared lib live beside them and are deployed elsewhere. */
function monorepoWithRootContext(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-monorepo-'));
  pyApp(root, 'backend');
  pyApp(root, 'books_worker');
  for (const w of ['frontend-marketing', 'frontend-brain', 'frontend-forms', 'frontend-shared']) {
    webApp(root, w);
  }
  write(
    path.join(root, 'docker-compose.yml'),
    [
      'services:',
      '  api:',
      '    build:',
      '      context: .',
      '      dockerfile: backend/Dockerfile',
      '    environment:',
      '      REDIS_URL: redis://redis:6379/0',
      '  arq_worker:',
      '    build:',
      '      context: .',
      '      dockerfile: books_worker/Dockerfile',
      '  redis:',
      '    image: redis:7',
      '',
    ].join('\n'),
  );
  return root;
}

/** Control: an ordinary compose repo — each service has its OWN build context. */
function ordinaryComposeRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ordinary-'));
  pyApp(root, 'api');
  pyApp(root, 'worker');
  webApp(root, 'not-deployed'); // a package compose does not mention
  write(
    path.join(root, 'docker-compose.yml'),
    [
      'services:',
      '  api:',
      '    build: ./api',
      '  worker:',
      '    build: ./worker',
      '  redis:',
      '    image: redis:7',
      '',
    ].join('\n'),
  );
  return root;
}

test('a repo-root build context narrows to the service\'s own directory', async () => {
  const root = monorepoWithRootContext();
  const g = await scanRepo(root);
  const api = g.nodes.find((n) => n.id === 'svc:api');
  const worker = g.nodes.find((n) => n.id === 'svc:arq_worker');
  assert.ok(api, 'api service must exist');
  // Before: both were `.` — the whole repo.
  assert.strictEqual(api!.path, 'backend', 'api must be scoped to its Dockerfile dir');
  assert.strictEqual(worker!.path, 'books_worker', 'worker must be scoped to its Dockerfile dir');
  assert.ok(
    g.warnings.some((w) => /narrowed to backend from its Dockerfile path/.test(w)),
    'the narrowing must be stated, not silent',
  );
});

test('no service swallows the repo: sibling apps are never demoted to modules', async () => {
  const root = monorepoWithRootContext();
  const g = await scanRepo(root);
  // The exact symptom: a front-end appearing as a `module` under a service.
  const modules = g.nodes.filter((n) => n.kind === 'module').map((n) => n.label.toLowerCase());
  for (const fe of ['frontend-marketing', 'frontend-brain', 'frontend-forms']) {
    assert.ok(!modules.includes(fe), `${fe} must not be a module of another service`);
  }
  assert.ok(
    !g.nodes.some((n) => n.kind === 'service' && n.path === '.'),
    'no service may be rooted at the repo itself',
  );
});

test('apps compose does not deploy are surfaced, not made invisible', async () => {
  const root = monorepoWithRootContext();
  const g = await scanRepo(root);
  const services = g.nodes.filter((n) => n.kind === 'service').map((n) => n.id);
  for (const fe of ['frontend-marketing', 'frontend-brain', 'frontend-forms', 'frontend-shared']) {
    assert.ok(services.includes(`svc:${fe}`), `${fe} must appear as its own service`);
  }
  // The compose services survive alongside them, and redis is still a datastore.
  assert.ok(services.includes('svc:api') && services.includes('svc:arq_worker'));
  assert.ok(g.nodes.some((n) => n.id === 'ds:redis' && n.kind === 'datastore'));
  assert.ok(
    g.warnings.some((w) => /also mapped 4 app root\(s\) it does not deploy/.test(w)),
    'the extra roots must be stated',
  );
});

/**
 * The SAME repo, written the way it actually was: plain `build: .`, no
 * `dockerfile:` key at all, one root Dockerfile shared by both services, and the
 * worker distinguished only by its own `command:`.
 *
 * r81 narrowed only from a `dockerfile:` path, so this form — the common one —
 * slipped straight through and the reported symptom survived the fix. Reported
 * again from the same repo: "still i see these following issues of functions and
 * brain not looking correct".
 */
function monorepoWithSharedRootDockerfile(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-shared-df-'));
  pyApp(root, 'backend');
  pyApp(root, 'books_worker');
  for (const w of ['frontend-marketing', 'frontend-brain', 'frontend-shared']) webApp(root, w);
  write(path.join(root, 'Dockerfile'), 'FROM python:3.11\nWORKDIR /app\nCOPY backend /app\n');
  write(
    path.join(root, 'docker-compose.yml'),
    [
      'services:',
      '  api:',
      '    build: .',
      '    environment:',
      '      REDIS_URL: redis://redis:6379/0',
      '  arq_worker:',
      '    build: .',
      '    command: arq books_worker.worker.WorkerSettings',
      '  redis:',
      '    image: redis:7',
      '',
    ].join('\n'),
  );
  return root;
}

test('a shared root Dockerfile narrows a plain `build: .` service to what it COPYs', async () => {
  const root = monorepoWithSharedRootDockerfile();
  const g = await scanRepo(root);
  const api = g.nodes.find((n) => n.id === 'svc:api');
  assert.ok(api, 'api service must exist');
  assert.strictEqual(api!.path, 'backend', 'the root Dockerfile COPYs backend — that is the API');
  assert.ok(
    !g.nodes.some((n) => n.kind === 'service' && n.path === '.'),
    'no service may be rooted at the repo itself',
  );
  assert.ok(
    g.warnings.some((w) => /narrowed to backend from the root Dockerfile COPY/.test(w)),
    'the warning must name the evidence, not just the outcome',
  );
});

test("a service's OWN command outranks the Dockerfile every other service shares", async () => {
  // PRECEDENCE LOCK. Both services build from `.` off ONE root Dockerfile that
  // COPYs `backend`. Reading that shared file first resolved the worker to
  // `backend` too — silently attributing the API's source to a worker that runs
  // none of it. `command: arq books_worker.worker…` is written for this service
  // alone, so it must win. Swap the two rules back and this test fails.
  const root = monorepoWithSharedRootDockerfile();
  const g = await scanRepo(root);
  const worker = g.nodes.find((n) => n.id === 'svc:arq_worker');
  assert.ok(worker, 'worker service must exist');
  assert.strictEqual(worker!.path, 'books_worker', 'the worker runs books_worker, not backend');
  assert.ok(
    g.warnings.some((w) => /arq_worker.*narrowed to books_worker from its own command/.test(w)),
    'the warning must say the command was what grounded it',
  );
  // And the two services must not share a single file between them.
  const filesOf = (svc: string) =>
    g.nodes.filter((n) => n.parentId === svc && n.kind === 'file').map((n) => n.id);
  const apiFiles = new Set(filesOf('svc:api'));
  assert.ok(apiFiles.size > 0, 'the api must own files');
  for (const f of filesOf('svc:arq_worker')) {
    assert.ok(!apiFiles.has(f), `${f} must belong to exactly one service`);
  }
});

test('a `command:` naming a build-output directory never becomes a source root', async () => {
  // `serve dist` names a directory that really exists and holds no source. Rooting
  // the service there would produce a real-looking card with nothing inside it.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-dist-cmd-'));
  pyApp(root, 'backend');
  write(path.join(root, 'dist', 'bundle.js'), '// built\n');
  write(path.join(root, 'Dockerfile'), 'FROM python:3.11\nCOPY backend /app\n');
  write(
    path.join(root, 'docker-compose.yml'),
    ['services:', '  web:', '    build: .', '    command: serve dist', ''].join('\n'),
  );
  const g = await scanRepo(root);
  const web = g.nodes.find((n) => n.id === 'svc:web');
  assert.ok(web, 'web service must exist');
  assert.notStrictEqual(web!.path, 'dist', 'a build output is never a service source root');
  assert.strictEqual(web!.path, 'backend', 'it falls through to the Dockerfile COPY instead');
});

test('an ORDINARY compose repo is untouched — no narrowing, no extra services', async () => {
  // This is what keeps the six reference gates byte-identical: they all have
  // per-service build directories, so neither behaviour may fire for them.
  const root = ordinaryComposeRepo();
  const g = await scanRepo(root);
  const services = g.nodes.filter((n) => n.kind === 'service').map((n) => n.id).sort();
  assert.deepStrictEqual(services, ['svc:api', 'svc:worker'], 'only the compose services');
  assert.ok(
    !services.includes('svc:not-deployed'),
    'a package compose does not mention must NOT be adopted when nothing admitted the repo is bigger',
  );
  assert.ok(
    !g.warnings.some((w) => /narrowed to|does not deploy/.test(w)),
    'neither behaviour may fire for an ordinary compose repo',
  );
});

test('the repo root is never adopted as a service of its own', async () => {
  // The failure mode this whole fix exists to prevent: re-adopting '.' would
  // recreate the swallowing. A root manifest must not become a service here.
  const root = monorepoWithRootContext();
  write(path.join(root, 'package.json'), JSON.stringify({ name: 'the-monorepo', private: true }));
  const g = await scanRepo(root);
  assert.ok(
    !g.nodes.some((n) => n.kind === 'service' && (n.path === '.' || n.path === '')),
    'the repo root must never become a service',
  );
});

test('scanning is deterministic for the same monorepo', async () => {
  const root = monorepoWithRootContext();
  const a = await scanRepo(root);
  const b = await scanRepo(root);
  assert.deepStrictEqual(
    a.nodes.map((n) => n.id),
    b.nodes.map((n) => n.id),
  );
});

/**
 * The form the owner's repo ACTUALLY has, third attempt.
 *
 * `build: .`, no `dockerfile:` key, no per-service `command:` — and a root
 * Dockerfile that copies the app AND its shared libraries. Every previous rule
 * declines: rule 1 has no path, rule 2 has no command, rule 3 saw
 * `copied.size > 1` and gave up. The service stayed rooted at the repository and
 * swallowed every sibling app, which is exactly the screenshot that came back
 * twice: "Api service" containing Core, Prompts, Routers, Brain, Backend Brain,
 * Schwai Shared, Alembic and "+10 more".
 *
 * The Dockerfile's own CMD names which of the copied directories it RUNS. That
 * is a statement by the same file about the same image — as grounded as the COPY
 * lines themselves — and it is what makes this case resolvable.
 */
function monorepoWithMultiCopyDockerfile(cmd?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-multicopy-'));
  pyApp(root, 'backend');
  pyApp(root, 'schwai_shared');
  for (const w of ['frontend-marketing', 'frontend-brain']) webApp(root, w);
  write(
    path.join(root, 'Dockerfile'),
    [
      'FROM python:3.11',
      'WORKDIR /app',
      'COPY schwai_shared /app/schwai_shared',
      'COPY backend /app/backend',
      ...(cmd ? [cmd] : []),
      '',
    ].join('\n'),
  );
  write(
    path.join(root, 'docker-compose.yml'),
    ['services:', '  api:', '    build: .', '  redis:', '    image: redis:7', ''].join('\n'),
  );
  return root;
}

test("the Dockerfile's CMD picks the app when it copies several directories", async () => {
  const root = monorepoWithMultiCopyDockerfile('CMD ["uvicorn", "backend.app.main:app"]');
  const g = await scanRepo(root);
  const api = g.nodes.find((n) => n.id === 'svc:api');
  assert.ok(api, 'api service must exist');
  assert.strictEqual(api!.path, 'backend', 'CMD runs backend — the shared lib is not the app');
  assert.ok(
    !g.nodes.some((n) => n.kind === 'service' && n.path === '.'),
    'no service may be rooted at the repo itself',
  );
  // The exact reported symptom: sibling apps demoted to modules of the mega-service.
  const modules = g.nodes.filter((n) => n.kind === 'module').map((n) => n.label.toLowerCase());
  for (const fe of ['frontend-marketing', 'frontend-brain']) {
    assert.ok(!modules.includes(fe), `${fe} must not be a module of the api service`);
  }
});

test('with NO CMD to disambiguate, the scan says so instead of going quiet', async () => {
  // Honest failure is the requirement here. The scanner cannot know which of two
  // copied directories is the app, and guessing would put real files under the
  // wrong service. What it must NOT do is stay silent — the silence is why this
  // took three rounds to find.
  const root = monorepoWithMultiCopyDockerfile();
  const g = await scanRepo(root);
  assert.ok(
    g.warnings.some((w) => /copies 2 directories \(backend, schwai_shared\)/.test(w)),
    `the ambiguity must be reported. warnings: ${JSON.stringify(g.warnings)}`,
  );
  assert.ok(
    g.warnings.some((w) => /may look larger than it is/.test(w)),
    'the warning must say what the consequence is, not just what happened',
  );
  // And the sibling apps are still surfaced as their own services rather than
  // vanishing into the one that could not be narrowed.
  const services = g.nodes.filter((n) => n.kind === 'service').map((n) => n.id);
  for (const fe of ['frontend-marketing', 'frontend-brain']) {
    assert.ok(services.includes(`svc:${fe}`), `${fe} must still appear as its own service`);
  }
});

test('a CMD naming something that was never copied does not invent a directory', async () => {
  const root = monorepoWithMultiCopyDockerfile('CMD ["uvicorn", "nowhere.app:main"]');
  const g = await scanRepo(root);
  const api = g.nodes.find((n) => n.id === 'svc:api');
  assert.notStrictEqual(api!.path, 'nowhere', 'a CMD token is only usable if it was COPYed');
  assert.ok(
    g.warnings.some((w) => /copies 2 directories/.test(w)),
    'and it falls back to reporting the ambiguity',
  );
});
