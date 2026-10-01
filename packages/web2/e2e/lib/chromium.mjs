import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * FIND A CHROMIUM, OR SAY SO.
 *
 * Authored fresh rather than imported. packages/web ships a findChromium.mjs
 * that does the same job, and packages/web2 may not import from packages/web —
 * docs/PIVOT-V2.md, enforced by test/firewall.test.ts. The RULE it embodies is
 * inherited (system Chrome first, then the caches, skip cleanly when there is
 * none); the file is not.
 *
 * WHY "SKIP CLEANLY" IS THE RIGHT FAILURE and not a hole in the gate: a
 * missing browser is a fact about the machine, not about the product, and a
 * suite that reports a machine fact as a product failure gets ignored within a
 * week. The skip is LOUD — it prints the reason and the directories it
 * searched — and exit 0 is reserved for it precisely so a real failure can own
 * exit 1 unambiguously.
 */

/** What Playwright and Chrome-for-Testing call the executable, on every OS. */
const CHROMIUM_NAMES = new Set([
  'chrome',
  'chrome.exe',
  'headless_shell',
  'headless_shell.exe',
  'Google Chrome for Testing',
]);

/** A real Chrome, preferred over a cache download: it is the browser the
 *  product will actually be looked at in. */
function systemCandidates() {
  if (process.platform === 'win32') {
    const roots = [
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
      process.env.LOCALAPPDATA,
    ].filter(Boolean);
    return roots.map((root) => path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  return [
    '/usr/local/bin/google-chrome',
    '/usr/local/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
}

/** Every place a Playwright install puts its browsers, in the order the docs
 *  say they are consulted. PLAYWRIGHT_BROWSERS_PATH wins because it is the one
 *  a CI image sets deliberately. */
export function cacheRoots() {
  return [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    '/opt/pw-browsers',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : null,
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
  ].filter(Boolean);
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function walk(dir, depth, found) {
  if (depth > 6) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, depth + 1, found);
    else if (CHROMIUM_NAMES.has(entry.name)) found.push(full);
  }
}

/**
 * Resolve a Chromium binary, or null.
 *
 * The full browser is preferred over headless_shell. The shell is smaller and
 * faster and it is the WRONG tool here: this suite measures a rendered layout,
 * and every difference between the two is a difference in what gets rendered.
 */
export function findChromium() {
  for (const candidate of systemCandidates()) {
    if (isExecutable(candidate)) return candidate;
  }

  const found = [];
  for (const root of cacheRoots()) {
    if (!fs.existsSync(root)) continue;
    walk(root, 0, found);
    if (found.length) break;
  }

  found.sort((a, b) => Number(a.includes('headless')) - Number(b.includes('headless')));
  return found.find(isExecutable) ?? null;
}

/**
 * Launch options.
 *
 * --no-sandbox is for containerised CI, where the sandbox needs privileges the
 * image does not grant. --disable-dev-shm-usage is for the same machines,
 * whose /dev/shm is 64MB and which crash the tab rather than reporting it.
 *
 * --force-device-scale-factor=1 is NOT boilerplate and is the reason this
 * function exists at all: every assertion in this suite is a measurement in CSS
 * pixels, and a host at 125% display scaling (the Windows default on a laptop)
 * changes what a box measures without changing anything about the product. One
 * flag, and the numbers mean the same thing on every machine.
 */
export function launchOptions(executablePath) {
  return {
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
  };
}

/**
 * Import playwright-core, or null if it is not installed.
 *
 * PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is set first because playwright-core's
 * registry will otherwise try to fetch a browser on a machine that already has
 * one, which turns a local-first repo's test run into a network call.
 */
export async function loadPlaywright() {
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';
  try {
    const mod = await import('playwright-core');
    return mod.chromium;
  } catch {
    return null;
  }
}
