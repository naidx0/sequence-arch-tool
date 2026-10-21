import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const launcher = fileURLToPath(new URL('../../start.ps1', import.meta.url));
const ps = (script, env = process.env) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', env, timeout: 30000 });
const quote = (s) => `'${s.replaceAll("'", "''")}'`;
const windows = process.platform === 'win32';

test('Windows PowerShell parses the shipped launcher, and rejects a broken control', { skip: !windows }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-finish-parser-'));
  try {
    const broken = path.join(dir, 'broken.ps1');
    fs.writeFileSync(broken, 'Write-Host "unfinished');
    for (const [file, expected] of [[launcher, 0], [broken, 1]]) {
      const result = ps(`$t=$null; $e=$null; [System.Management.Automation.Language.Parser]::ParseFile(${quote(file)},[ref]$t,[ref]$e) > $null; $e | ForEach-Object { Write-Output $_.Message }; if ($e.Count) { exit 1 }; exit 0`);
      assert.equal(result.status, expected, `${file}: ${result.stdout}\n${result.stderr}`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('warm Windows launcher reaches node without installing or rebuilding', { skip: !windows }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-finish-warm-'));
  try {
    for (const d of ['node_modules', 'packages/web2/node_modules', 'packages/web2/src', 'packages/analyzer/dist', 'packages/web2/dist']) fs.mkdirSync(path.join(dir, d), { recursive: true });
    fs.copyFileSync(launcher, path.join(dir, 'start.ps1'));
    for (const file of ['package.json', 'pnpm-lock.yaml', 'packages/web2/package.json', 'packages/web2/src/index.ts']) fs.writeFileSync(path.join(dir, file), '');
    for (const file of ['node_modules/.modules.yaml', 'packages/analyzer/dist/cli.js', 'packages/web2/dist/index.html']) {
      fs.writeFileSync(path.join(dir, file), '');
      fs.utimesSync(path.join(dir, file), new Date(Date.now() + 10000), new Date(Date.now() + 10000));
    }
    const result = ps(`function pnpm { throw 'unexpected install or build' }; function node { Write-Output ('NODE_ARGS=' + ($args -join '|')); $global:LASTEXITCODE=0 }; & ${quote(path.join(dir, 'start.ps1'))} --no-open --port 4398`);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /NODE_ARGS=packages\/analyzer\/dist\/cli\.js\|app\|--no-open\|--port\|4398/);
    assert.doesNotMatch(result.stdout, /> (installing|building)/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
