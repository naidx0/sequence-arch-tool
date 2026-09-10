#!/usr/bin/env node
// Break the product on purpose and find out whether anything notices.
//
// A test suite tells you it passed. It does not tell you it would have failed. This asks the
// second question: for each entry in `mutants.json`, damage the product in that exact way, run the
// suite that claims to cover it, and record whether the suite went red.
//
//   KILLED    the suite noticed. That coverage is real.
//   SURVIVED  the product is broken and every test still passes. That is a hole, and the exit
//             code is non-zero because a hole is a failure, not an observation.
//
// Two honesty rules are built in, both learned the hard way in this repository:
//
// 1. EVERY SUITE IS RUN CLEAN FIRST. If a suite is already red, its mutants are reported as
//    INCONCLUSIVE and not as kills - a broken suite kills every mutant for free and would report
//    perfect coverage while proving nothing.
//
// 2. A MUTATION THAT DOES NOT APPLY IS NOT A PASS. If the `find` text is missing, or appears more
//    than once, that mutant is an ERROR. Silently skipping it is how a catalogue rots into
//    decoration. `tools/ci/mutants.test.mjs` checks the same thing in a second and runs in CI.
//
// Usage:
//   node tools/ci/mutate.mjs                 every mutant
//   node tools/ci/mutate.mjs --only <id>     one, by id
//   node tools/ci/mutate.mjs --suite <name>  every mutant covered by one suite
//   node tools/ci/mutate.mjs --list          print the catalogue and exit
//   node tools/ci/mutate.mjs --dry           prove each mutation applies; run nothing

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

export function loadCatalogue(file = path.join(HERE, 'mutants.json')) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

// The one place a mutation is applied, so the runner and the CI check agree on what "applies"
// means. Returns the mutated text, or throws with the reason it could not be applied.
export function applyMutation(source, mutant) {
  // Files arrive from git with CRLF (core.autocrlf=true) but the catalogue is authored with LF.
  // Compare in LF and write back in the file's own ending, or every multi-line `find` fails on
  // Windows for a reason that looks like a missing string.
  const crlf = source.includes('\r\n');
  const text = crlf ? source.split('\r\n').join('\n') : source;
  const find = mutant.find;

  const first = text.indexOf(find);
  if (first === -1) throw new Error('find text is not present in the file');
  if (text.indexOf(find, first + find.length) !== -1) {
    throw new Error('find text appears more than once - it does not name one site');
  }
  if (find === mutant.replace) throw new Error('find and replace are identical - mutates nothing');

  const out = text.slice(0, first) + mutant.replace + text.slice(first + find.length);
  return crlf ? out.split('\n').join('\r\n') : out;
}

function run(suite, label) {
  const cwd = path.join(REPO, suite.cwd);
  const [cmd, ...args] = suite.cmd;
  const win = process.platform === 'win32';
  // On Windows a .bin entry is a .CMD shim, which is not directly executable by spawn.
  const spawned = win
    ? spawnSync([cmd, ...args].map((a) => (/[\s&|<>^"()%!]/.test(a) ? `"${a}"` : a)).join(' '), [], {
        cwd,
        shell: true,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      })
    : spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  if (spawned.error) {
    return { ok: false, ran: false, why: `${label}: could not start - ${spawned.error.message}` };
  }
  return {
    ok: spawned.status === 0,
    ran: true,
    status: spawned.status,
    output: `${spawned.stdout ?? ''}${spawned.stderr ?? ''}`,
  };
}

function tail(output, lines = 12) {
  return (output ?? '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .slice(-lines)
    .map((l) => `      ${l}`)
    .join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const catalogue = loadCatalogue();
  const only = flag('--only');
  const suiteOnly = flag('--suite');

  let mutants = catalogue.mutants;
  if (only) mutants = mutants.filter((m) => m.id === only);
  if (suiteOnly) mutants = mutants.filter((m) => m.suite === suiteOnly);

  if (argv.includes('--list')) {
    for (const m of catalogue.mutants) console.log(`${m.suite.padEnd(20)} ${m.id}\n    ${m.why}`);
    return 0;
  }

  if (mutants.length === 0) {
    console.error(`no mutants matched (--only ${only ?? '-'} --suite ${suiteOnly ?? '-'})`);
    return 1;
  }

  // Pass 0 - prove every mutation still applies. This is the cheap check and it runs first,
  // because a catalogue whose find-strings have drifted tells you nothing at any price.
  const applicable = [];
  const errors = [];
  for (const m of mutants) {
    const file = path.join(REPO, m.file);
    let original;
    try {
      original = readFileSync(file, 'utf8');
    } catch {
      errors.push({ m, why: `file not found: ${m.file}` });
      continue;
    }
    try {
      applyMutation(original, m);
      applicable.push(m);
    } catch (err) {
      errors.push({ m, why: err.message });
    }
  }

  for (const e of errors) console.log(`  ERROR      ${e.m.id}\n             ${e.why}`);
  if (argv.includes('--dry')) {
    console.log(`\n${applicable.length} applicable · ${errors.length} error`);
    return errors.length === 0 ? 0 : 1;
  }

  // Pass 1 - every suite clean. A red suite cannot be used to judge a mutation.
  const needed = [...new Set(applicable.map((m) => m.suite))];
  const green = new Set();
  console.log(`\nbaseline · ${needed.length} suite${needed.length === 1 ? '' : 's'}`);
  for (const name of needed) {
    const suite = catalogue.suites[name];
    if (!suite) {
      console.log(`  MISSING    ${name} is named by a mutant but not defined`);
      continue;
    }
    const r = run(suite, name);
    if (r.ok) {
      green.add(name);
      console.log(`  green      ${name}`);
    } else {
      console.log(`  RED        ${name} - its mutants cannot be judged`);
      console.log(tail(r.output ?? r.why));
    }
  }

  // Pass 2 - one mutation at a time.
  console.log(`\nmutants · ${applicable.length}`);
  const survived = [];
  const inconclusive = [];
  let killed = 0;

  for (const m of applicable) {
    if (!green.has(m.suite)) {
      inconclusive.push(m);
      console.log(`  SKIP       ${m.id} (${m.suite} was already red)`);
      continue;
    }
    const file = path.join(REPO, m.file);
    const original = readFileSync(file, 'utf8');
    let result;
    try {
      writeFileSync(file, applyMutation(original, m));
      result = run(catalogue.suites[m.suite], m.suite);
    } finally {
      // Restore unconditionally. A crashed run must never leave the tree mutated.
      writeFileSync(file, original);
    }
    if (!result.ran) {
      inconclusive.push(m);
      console.log(`  ERROR      ${m.id} - ${result.why}`);
    } else if (result.ok) {
      survived.push(m);
      console.log(`  SURVIVED   ${m.id}`);
      console.log(`             ${m.why}`);
    } else {
      killed += 1;
      console.log(`  killed     ${m.id}`);
    }
  }

  console.log(
    `\n${killed} killed · ${survived.length} survived · ${inconclusive.length} inconclusive · ${errors.length} error`,
  );
  if (survived.length > 0) {
    console.log('\nSURVIVING MUTANTS - the product is broken and nothing turned red:');
    for (const m of survived) console.log(`  ${m.file}\n    ${m.id} · ${m.why}`);
  }
  return survived.length === 0 && errors.length === 0 && inconclusive.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().then((code) => process.exit(code));
}
