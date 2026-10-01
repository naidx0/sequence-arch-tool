/**
 * CI must not grow a GitHub Actions `schedule:` / `cron:` timer again.
 *
 * Owner Max: no crons, CI/CD honest. A previous nightly-health workflow ran on
 * a `schedule:` trigger and drifted from the live repo; resurrecting it (or
 * adding any new timer) silently burns runners and re-introduces a cron the
 * owner can no longer see. This test locks the invariant: every workflow under
 * `.github/workflows/` must be event-driven (push / pull_request / workflow_run
 * / etc.), never time-driven.
 *
 * Scope is `.github/workflows/**.yml` only — product code that detects cron in
 * *user* repos is out of scope and must not be flagged.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOWS_DIR = path.join(ROOT, '.github', 'workflows');

/**
 * Strip YAML comments from a line so a comment like `# do not add cron` does
 * not trip the detector. A `#` starts a comment when it is at the start of the
 * line (after whitespace) or preceded by whitespace and not inside a quoted
 * string.
 */
function stripComment(line) {
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const prev = line[i - 1];
    if (quote) {
      out += ch;
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(prev))) {
      break;
    }
    out += ch;
  }
  return out;
}

function listWorkflows() {
  if (!fs.existsSync(WORKFLOWS_DIR)) return [];
  return fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => path.join(WORKFLOWS_DIR, f));
}

/**
 * A `schedule:` trigger key. In a GitHub Actions workflow the only meaningful
 * occurrence of `schedule:` is the trigger under `on:`; treat any
 * `schedule:` mapping key as a violation.
 */
const SCHEDULE_KEY = /^\s*schedule\s*:/;

/**
 * A `cron:` entry under a `schedule:` block — written either as a list item
 * (`- cron: "..."`) or, less commonly, as a mapping key. A bare `cron:` key
 * only appears in schedule triggers inside workflow YAML.
 */
const CRON_KEY = /^\s*-?\s*cron\s*:/;

function scanFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const hits = [];
  lines.forEach((raw, idx) => {
    const line = stripComment(raw);
    if (SCHEDULE_KEY.test(line)) {
      hits.push({ line: idx + 1, kind: 'schedule', text: raw.trim() });
    }
    if (CRON_KEY.test(line)) {
      hits.push({ line: idx + 1, kind: 'cron', text: raw.trim() });
    }
  });
  return hits;
}

test('no workflow under .github/workflows defines a schedule: or cron: trigger', () => {
  const files = listWorkflows();
  assert.ok(
    files.length > 0,
    '.github/workflows/ has no workflow files — ci.yml is missing, CI cannot run',
  );
  const offenders = [];
  for (const file of files) {
    const hits = scanFile(file);
    if (hits.length > 0) {
      const rel = path.relative(ROOT, file);
      for (const h of hits) {
        offenders.push(`${rel}:${h.line} (${h.kind}): ${h.text}`);
      }
    }
  }
  assert.equal(
    offenders.length,
    0,
    'GitHub Actions `schedule:` / `cron:` timers are banned in this repo. ' +
      'Offending lines:\n  ' +
      offenders.join('\n  ') +
      '\nMove the work to an event-driven workflow (push / pull_request / ' +
      'workflow_run) or run it from the owner seat. See docs/nightly-ops.md.',
  );
});

test('stripComment keeps "do not add cron" comments from tripping the detector', () => {
  assert.equal(stripComment('# do not add cron'), '');
  assert.equal(stripComment('  # schedule: never'), '  ');
  assert.equal(stripComment('on: [push] # cron: not allowed'), 'on: [push] ');
  assert.equal(stripComment("cron: '0 0 * * *' # comment"), "cron: '0 0 * * *' ");
});

test('detector flags a synthetic schedule + cron block', () => {
  const tmpDir = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'no-cron-'));
  const tmp = path.join(tmpDir, 'bad.yml');
  fs.writeFileSync(
    tmp,
    [
      'name: bad',
      'on:',
      '  schedule:',
      '    - cron: "0 0 * * *"',
      '  # do not add cron here either',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo hi',
    ].join('\n'),
  );
  try {
    const hits = scanFile(tmp);
    assert.ok(
      hits.some((h) => h.kind === 'schedule'),
      'schedule: line must be flagged',
    );
    assert.ok(hits.some((h) => h.kind === 'cron'), 'cron: line must be flagged');
    assert.ok(
      !hits.some((h) => /do not add cron/.test(h.text)),
      'comment lines must not be flagged',
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
