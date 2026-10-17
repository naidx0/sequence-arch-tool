#!/usr/bin/env node
/*
 * download-smoke — download this platform's builds FROM THE LIVE SITE and run them.
 *
 * Owner, 2026-09-30: "make sure it can be downloaded and run on each system we
 * implement it on." Every other smoke in this repository runs a build this
 * machine made. This one starts where a stranger starts: the download page. It
 * reads the links the page actually serves, fetches them, checks each file
 * against the release's SHASUMS256.txt, installs or unpacks it the way a person
 * would, and launches the app under SEQUENCE_DESKTOP_SMOKE=1, which prints one
 * `SEQUENCE_DESKTOP_SMOKE PASS|FAIL {...}` line and exits. No line is a failure.
 *
 *   node tools/release/download-smoke.mjs [--site https://trysequence.app]
 *
 * Windows: the installer (silent, per-user) and the portable zip.
 * macOS:   the disk image for this machine's architecture.
 * Exit 0 all passed, 1 something failed, 2 the page served no links for this platform.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const i = process.argv.indexOf('--site');
const SITE = (i === -1 ? 'https://trysequence.app' : process.argv[i + 1]).replace(/\/+$/, '');
/* A space in the name is part of the test: real download folders have them. */
const WORK = path.join(os.tmpdir(), 'Sequence Download Smoke');

async function text(url) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

/*
 * The links come from the RENDERED page, not from release.ts and not from the
 * bundle: the page builds its hrefs at run time, so the only honest source is
 * the DOM a browser ends up with. Headless Chrome is on every GitHub runner and
 * on the owner's machine.
 */
function chrome() {
  const c = [
    process.env.CHROME_BIN,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const hit = c.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('no Chrome found; set CHROME_BIN');
  return hit;
}

async function siteLinks() {
  const r = spawnSync(chrome(), ['--headless=new', '--disable-gpu', '--virtual-time-budget=10000', '--dump-dom', SITE + '/'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120000,
  });
  const dom = r.stdout || '';
  const links = new Set();
  for (const m of dom.matchAll(/href="(https:\/\/github\.com\/[^"]+\/releases\/download\/[^"]+)"/g)) {
    links.add(m[1].replace(/&amp;/g, '&'));
  }
  return [...links];
}

function wanted(links) {
  const name = (u) => decodeURIComponent(u.split('/').pop());
  if (process.platform === 'win32') {
    return links.filter((u) => /\.exe$/i.test(name(u)) || /-win\.zip$/i.test(name(u)));
  }
  if (process.platform === 'darwin') {
    const arm = process.arch === 'arm64';
    return links.filter((u) => /\.dmg$/i.test(name(u)) && /-arm64\.dmg$/i.test(name(u)) === arm);
  }
  return [];
}

async function download(url) {
  const r = await fetch(url, { redirect: 'follow' });
  const file = path.join(WORK, decodeURIComponent(url.split('/').pop()));
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(file, buf);
  return { status: r.status, file, bytes: buf.length, sha: createHash('sha256').update(buf).digest('hex') };
}

/* GitHub serves "Sequence Setup 0.1.3.exe" as Sequence.Setup.0.1.3.exe; SHASUMS names the original. */
const sumKey = (f) => path.basename(f).replace(/\./g, ' ');

function run(bin, cwd) {
  return new Promise((resolve) => {
    const child = spawn(bin, [], { cwd, env: { ...process.env, SEQUENCE_DESKTOP_SMOKE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (b) => (out += b));
    child.stderr.on('data', (b) => (out += b));
    const kill = setTimeout(() => child.kill('SIGKILL'), 150000);
    child.on('exit', (code) => {
      clearTimeout(kill);
      const line = out.split(/\r?\n/).find((l) => l.startsWith('SEQUENCE_DESKTOP_SMOKE '));
      resolve({ ok: code === 0 && !!line && line.startsWith('SEQUENCE_DESKTOP_SMOKE PASS'), code, line, tail: out.split(/\r?\n/).slice(-15).join('\n') });
    });
  });
}

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}: ${r.stderr || r.stdout}`);
  return r.stdout;
}

async function launch(file) {
  const base = path.basename(file);
  if (/\.exe$/i.test(base)) {
    sh(file, ['/S']); // per-user NSIS install, the path a person takes after double-clicking
    const dir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Sequence');
    return run(path.join(dir, 'Sequence.exe'), dir);
  }
  if (/-win\.zip$/i.test(base)) {
    const dir = path.join(WORK, 'Portable Sequence');
    fs.mkdirSync(dir, { recursive: true });
    /* Windows' own bsdtar by full path: a Git Bash tar earlier on PATH reads C: as a remote host. */
    sh(path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe'), ['-xf', file, '-C', dir]);
    return run(path.join(dir, 'Sequence.exe'), dir);
  }
  if (/\.dmg$/i.test(base)) {
    const mnt = path.join(WORK, 'mnt');
    const apps = path.join(WORK, 'Applications Test');
    fs.mkdirSync(apps, { recursive: true });
    sh('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mnt, file]);
    try {
      const app = fs.readdirSync(mnt).find((n) => n.endsWith('.app'));
      if (!app) throw new Error('no .app inside the disk image');
      sh('ditto', [path.join(mnt, app), path.join(apps, app)]);
    } finally {
      spawnSync('hdiutil', ['detach', mnt, '-force']);
    }
    const app = path.join(apps, fs.readdirSync(apps).find((n) => n.endsWith('.app')));
    /* Recorded, not asserted: an unsigned build is a decision. What matters is
       that it carries a signature at all, because on Apple silicon an unsigned
       binary is "damaged" rather than "unverified", and Open Anyway cannot fix that. */
    const sig = spawnSync('codesign', ['-dv', app], { encoding: 'utf8' });
    console.log(`      codesign   ${(sig.stderr || '').split('\n').filter((l) => /Signature|Format|flags/.test(l)).join(' | ') || 'none'}`);
    const bin = path.join(app, 'Contents', 'MacOS', fs.readdirSync(path.join(app, 'Contents', 'MacOS'))[0]);
    return run(bin, apps);
  }
  throw new Error(`no launcher for ${base}`);
}

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
const links = await siteLinks();
const mine = wanted(links);
console.log(`site ${SITE}: ${links.length} release links, ${mine.length} for ${process.platform}/${process.arch}`);
if (mine.length === 0) process.exit(2);

const sumsUrl = links.find((u) => u.endsWith('/SHASUMS256.txt'));
const sums = new Map();
if (sumsUrl) {
  for (const l of (await text(sumsUrl)).split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(l.trim());
    if (m) sums.set(m[2].replace(/\./g, ' '), m[1]);
  }
}

let failed = 0;
for (const url of mine) {
  const d = await download(url);
  const expected = sums.get(sumKey(d.file));
  const hashOk = expected === d.sha;
  console.log(`${d.status === 200 && hashOk ? 'ok  ' : 'FAIL'}  download   ${path.basename(d.file)}  ${d.status}  ${(d.bytes / 1048576).toFixed(1)} MiB  sha256 ${hashOk ? 'matches SHASUMS256' : `MISMATCH (expected ${expected ?? 'none listed'})`}`);
  if (d.status !== 200 || !hashOk) { failed++; continue; }
  try {
    const r = await launch(d.file);
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  launch     ${path.basename(d.file)}  exit ${r.code}  ${r.line ?? '(no smoke line)'}`);
    if (!r.ok) { failed++; console.log(r.tail); }
  } catch (e) {
    failed++;
    console.log(`FAIL  launch     ${path.basename(d.file)}  ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
