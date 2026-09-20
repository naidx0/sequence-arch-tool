/**
 * A manifest that exists but cannot be parsed must SAY so.
 *
 * Found in the overnight adversarial-repo sweep (objective 3: "find where the scanner
 * lies, crashes, or silently returns nothing"). This is the "lies" case, and it is the
 * quietest kind.
 *
 * `readJson` in discovery/codefirst.ts swallowed every parse failure with a bare
 * `catch { return undefined }`, which made a malformed manifest indistinguishable from
 * an absent one. That is not cosmetic, because workspace globs, app roots and service
 * names all come out of these files. Measured on two otherwise byte-identical repos:
 *
 *   valid  root package.json  ->  3 services (api, web, worker)
 *   broken root package.json  ->  1 service
 *
 * The break was ONE TRAILING COMMA. Both scans emitted the same single warning, so
 * nothing on screen distinguished a healthy three-service monorepo from a silently
 * collapsed one. The user gets a plausible graph that is wrong, which is precisely
 * what "grounded, not guessed" and "honest errors" exist to prevent.
 *
 * scanRepo() is the UNCACHED path — cli.ts picks between it and scanRepoCached()
 * on --no-cache — so these tests always parse for real rather than replaying a
 * persisted <repo>/.sequence/graph.json from an earlier case.
 *
 * A MISSING file stays silent — that is genuinely unremarkable and warning about it
 * would bury the real signal. The distinction this locks is present-and-unreadable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanRepo } from '../scan.js';

/** Build a workspace monorepo whose root manifest is either valid or malformed. */
function makeWorkspaceRepo(rootManifest: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-manifest-'));
  fs.writeFileSync(path.join(dir, 'package.json'), rootManifest);
  for (const name of ['api', 'web', 'worker']) {
    const pkg = path.join(dir, 'packages', name, 'src');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'packages', name, 'package.json'),
      `{"name":"@x/${name}"}\n`,
    );
    fs.writeFileSync(path.join(pkg, 'index.ts'), `export const ${name} = 1;\n`);
  }
  return dir;
}

const VALID = '{"name":"root","workspaces":["packages/*"]}\n';
/** One trailing comma. That is the entire difference. */
const BROKEN = '{"name":"root","workspaces":["packages/*",]}\n';

test('a valid workspace root finds every member service', async () => {
  const dir = makeWorkspaceRepo(VALID);
  try {
    const graph = await scanRepo(dir);
    const services = graph.nodes.filter((n) => n.kind === 'service');
    assert.equal(services.length, 3, 'the healthy case must find api, web and worker');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a malformed workspace root is REPORTED, not silently ignored', async () => {
  const dir = makeWorkspaceRepo(BROKEN);
  try {
    const graph = await scanRepo(dir);
    const complaint = graph.warnings.filter((w) => /could not be parsed/i.test(String(w)));
    assert.ok(
      complaint.length > 0,
      'a present-but-unreadable manifest must produce a warning — without one, a ' +
        'collapsed monorepo is indistinguishable from a healthy single-service repo',
    );
    assert.match(
      String(complaint[0]),
      /package\.json/,
      'the warning must name the file, or it cannot be acted on',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the same broken manifest is reported once, not once per reader', async () => {
  // Discovery reads the root manifest from several call sites (workspace globs, app
  // roots, framework signals). Before deduping, one broken file produced three
  // identical warnings, which reads as three broken files.
  const dir = makeWorkspaceRepo(BROKEN);
  try {
    const graph = await scanRepo(dir);
    const complaints = graph.warnings.filter((w) => /could not be parsed/i.test(String(w)));
    assert.equal(complaints.length, 1, `expected one warning, got ${complaints.length}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an ABSENT manifest stays silent', async () => {
  // The distinction being locked is present-and-unreadable. Warning about every file
  // that merely does not exist would bury the signal this test exists to protect.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-manifest-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"plain"}\n');
    fs.writeFileSync(path.join(dir, 'src', 'index.ts'), 'export const a = 1;\n');
    const graph = await scanRepo(dir);
    const complaints = graph.warnings.filter((w) => /could not be parsed/i.test(String(w)));
    assert.equal(complaints.length, 0, 'a repo with no broken manifest must not complain');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
