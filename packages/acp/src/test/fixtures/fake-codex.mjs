#!/usr/bin/env node
/* A fake `codex` with the real 0.153.4 argument grammar, and nothing else.
 *
 * Measured on the real binary, 2026-10-05: `codex exec <prompt> --ask-for-approval
 * on-request --sandbox read-only` exits 2 with
 *   error: unexpected argument '--ask-for-approval' found
 * because `-a/--ask-for-approval` is a TOP-LEVEL option only. `exec` accepts
 * `-c/--config <key=value>` and `-s/--sandbox <mode>` (plus flags this fake
 * does not need). This fake applies the same rule: a flag `exec` does not know
 * is rejected the way the real parser rejects it, with exit 2.
 *
 * On success it prints the effective policy as one JSON line and exits 0.
 */
const TOP = new Set(['-c', '--config', '-s', '--sandbox', '-a', '--ask-for-approval']);
const EXEC = new Set(['-c', '--config', '-s', '--sandbox']);

const argv = process.argv.slice(2);
const out = { subcommand: null, approval_policy: null, sandbox_mode: null, prompt: null };
let known = TOP;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('-')) {
    if (!known.has(a)) {
      process.stderr.write(`error: unexpected argument '${a}' found\n`);
      process.exit(2);
    }
    const v = argv[++i];
    if (v === undefined) {
      process.stderr.write(`error: a value is required for '${a}' but none was supplied\n`);
      process.exit(2);
    }
    if (a === '-s' || a === '--sandbox') out.sandbox_mode = v;
    else if (a === '-a' || a === '--ask-for-approval') out.approval_policy = v;
    else {
      const eq = v.indexOf('=');
      const key = v.slice(0, eq);
      if (key === 'approval_policy' || key === 'sandbox_mode') out[key] = v.slice(eq + 1);
    }
  } else if (out.subcommand === null && a === 'exec') {
    out.subcommand = 'exec';
    known = EXEC;
  } else if (out.prompt === null) {
    out.prompt = a;
  } else {
    process.stderr.write(`error: unexpected argument '${a}' found\n`);
    process.exit(2);
  }
}

process.stdout.write(JSON.stringify(out) + '\n');
