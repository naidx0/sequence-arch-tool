import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { parseScutilProxy, parseWindowsInternetSettings, proxyEnvFromResolve, systemProxyEnv } from '../proxyEnv';

/* Stubbed command output: nothing here runs reg, scutil or touches the machine's real proxy setting. */

const REG_STATIC = [
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
  '    ProxyEnable    REG_DWORD    0x1',
  '    ProxyServer    REG_SZ    127.0.0.1:8888',
  '    ProxyOverride    REG_SZ    localhost;127.*;*.corp.example;<local>',
  '',
].join('\r\n');

const REG_PER_PROTOCOL = REG_STATIC.replace('127.0.0.1:8888', 'http=h1:80;https=h2:443;socks=s:1080');
const REG_OFF = REG_STATIC.replace('0x1', '0x0');
const REG_PAC = REG_OFF + '    AutoConfigURL    REG_SZ    http://wpad/proxy.pac\r\n';
const REG_SOCKS = REG_STATIC.replace('127.0.0.1:8888', 'socks=s:1080');

const SCUTIL = `<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
  }
  HTTPEnable : 1
  HTTPPort : 3128
  HTTPProxy : p.example
  HTTPSEnable : 1
  HTTPSPort : 8888
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 0
}
`;

test('proxyEnvFromResolve: the five Chromium answers', () => {
  const logs: string[] = [];
  assert.deepEqual(proxyEnvFromResolve('PROXY h:8080; DIRECT'), { HTTPS_PROXY: 'http://h:8080', HTTP_PROXY: 'http://h:8080' });
  assert.deepEqual(proxyEnvFromResolve('HTTPS h:443'), { HTTPS_PROXY: 'https://h:443', HTTP_PROXY: 'https://h:443' });
  assert.deepEqual(proxyEnvFromResolve('SOCKS5 s:1080', (l) => logs.push(l)), {});
  assert.match(logs[0] ?? '', /SOCKS/);
  assert.deepEqual(proxyEnvFromResolve('DIRECT'), {});
  assert.deepEqual(proxyEnvFromResolve(''), {});
});

test('Windows registry: a static proxy, per-protocol entries, off, PAC and SOCKS-only', () => {
  const s = parseWindowsInternetSettings(REG_STATIC);
  assert.equal(s.env?.HTTPS_PROXY, 'http://127.0.0.1:8888');
  assert.equal(s.env?.HTTP_PROXY, 'http://127.0.0.1:8888');
  assert.equal(s.env?.NO_PROXY, 'localhost,127.0.0.1,::1,*.corp.example', '<local> and 127.* are not expressible and are dropped; loopback stays');
  const pp = parseWindowsInternetSettings(REG_PER_PROTOCOL);
  assert.equal(pp.env?.HTTPS_PROXY, 'http://h2:443');
  assert.equal(pp.env?.HTTP_PROXY, 'http://h1:80');
  assert.equal(parseWindowsInternetSettings(REG_OFF).env, null);
  assert.equal(parseWindowsInternetSettings(REG_PAC).pac, 'http://wpad/proxy.pac');
  const so = parseWindowsInternetSettings(REG_SOCKS);
  assert.equal(so.env, null);
  assert.equal(so.socksOnly, true);
});

test('macOS scutil: HTTPS and HTTP entries, exceptions, and a disabled setting', () => {
  const s = parseScutilProxy(SCUTIL);
  assert.equal(s.env?.HTTPS_PROXY, 'http://127.0.0.1:8888');
  assert.equal(s.env?.HTTP_PROXY, 'http://p.example:3128');
  assert.equal(s.env?.NO_PROXY, 'localhost,127.0.0.1,::1,*.local');
  assert.equal(parseScutilProxy(SCUTIL.replace('HTTPSEnable : 1', 'HTTPSEnable : 0').replace('HTTPEnable : 1', 'HTTPEnable : 0')).env, null);
  assert.equal(parseScutilProxy('<dictionary> {\n  ProxyAutoConfigEnable : 1\n}\n').pac, true);
});

test('systemProxyEnv: variables win; otherwise the platform command is read; failures give {}', async () => {
  const calls: string[][] = [];
  const run = async (cmd: string, args: string[]): Promise<string> => {
    calls.push([cmd, ...args]);
    return cmd === 'reg' ? REG_STATIC : SCUTIL;
  };
  assert.deepEqual(await systemProxyEnv({ platform: 'win32', env: { HTTPS_PROXY: 'http://mine:1' }, run }), {});
  assert.deepEqual(await systemProxyEnv({ platform: 'win32', env: { http_proxy: 'http://mine:1' }, run }), {});
  assert.equal(calls.length, 0, 'nothing is read when the person set a variable');
  const win = await systemProxyEnv({ platform: 'win32', env: {}, run });
  assert.equal(win.HTTPS_PROXY, 'http://127.0.0.1:8888');
  assert.deepEqual(calls[0]?.slice(0, 2), ['reg', 'query']);
  assert.match(calls[0]![2]!, /Internet Settings$/);
  const mac = await systemProxyEnv({ platform: 'darwin', env: {}, run });
  assert.equal(mac.HTTPS_PROXY, 'http://127.0.0.1:8888');
  assert.deepEqual(calls[1], ['scutil', '--proxy']);
  assert.deepEqual(await systemProxyEnv({ platform: 'linux', env: {}, run }), {});
  const logs: string[] = [];
  assert.deepEqual(await systemProxyEnv({ platform: 'win32', env: {}, run: async () => { throw new Error('boom'); }, log: (l) => logs.push(l) }), {});
  assert.match(logs[0] ?? '', /boom/);
});

test('systemProxyEnv: a PAC script is resolved through Electron for the registry host', async () => {
  const asked: string[] = [];
  const out = await systemProxyEnv({
    platform: 'win32',
    env: {},
    run: async () => REG_PAC,
    resolveProxy: async (u) => (asked.push(u), 'PROXY pac-proxy:3128; DIRECT'),
  });
  assert.deepEqual(asked, ['https://registry.npmjs.org']);
  assert.equal(out.HTTPS_PROXY, 'http://pac-proxy:3128');
  assert.equal(out.NO_PROXY, 'localhost,127.0.0.1,::1');
});

test('main.ts reads the system proxy before the server is first started, hidden, and merges it into the child env', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'main.ts'), 'utf8').replace(/\r\n/g, '\n');
  const at = main.indexOf('await systemProxyEnv(');
  const start = main.indexOf('await controller.start(');
  assert.ok(at > 0 && start > at, 'systemProxyEnv is awaited before controller.start');
  assert.match(main, /env: serverEnv,/);
  assert.match(main, /Object\.assign\(\s*serverEnv,/);
  assert.match(main, /execFile\(cmd, args, \{ windowsHide: true/, 'reg and scutil run hidden');
  assert.match(main, /session\.defaultSession\.resolveProxy/);
});

test('F5: a blank registry value stays blank; it does not swallow the next line', () => {
  const blank = [
    'HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings',
    '    ProxyEnable    REG_DWORD    0x1',
    '    ProxyServer    REG_SZ    ',
    '    ProxyOverride    REG_SZ    localhost',
    '',
  ].join('\r\n');
  const p = parseWindowsInternetSettings(blank);
  assert.equal(p.env, null, 'enabled with an empty server is no proxy, not "ProxyOverride REG_SZ localhost" read as the server');
  const justAuto = blank.replace('ProxyServer    REG_SZ    ', 'AutoConfigURL    REG_SZ    ');
  assert.equal(parseWindowsInternetSettings(justAuto).pac, null);
});

test('F6: a NO_PROXY the person set is kept and merged with the system list', async () => {
  const run = async (): Promise<string> => REG_STATIC;
  const out = await systemProxyEnv({ platform: 'win32', env: { NO_PROXY: 'intranet.example,10.0.0.0/8' }, run });
  assert.equal(out.HTTPS_PROXY, 'http://127.0.0.1:8888');
  const list = (out.NO_PROXY ?? '').split(',');
  for (const want of ['intranet.example', '10.0.0.0/8', 'localhost', '127.0.0.1', '::1', '*.corp.example']) assert.ok(list.includes(want), `${want} in ${out.NO_PROXY}`);
  assert.equal(new Set(list).size, list.length, 'no duplicates');
  const lower = await systemProxyEnv({ platform: 'win32', env: { no_proxy: 'only-lower.example' }, run });
  assert.ok((lower.NO_PROXY ?? '').split(',').includes('only-lower.example'));
});

test('a PAC script that never answers is given up on after the timeout and applies no proxy', async () => {
  const logs: string[] = [];
  const t0 = Date.now();
  const out = await systemProxyEnv({ platform: 'win32', env: {}, run: async () => REG_PAC, resolveProxy: () => new Promise<string>(() => undefined), pacTimeoutMs: 50, log: (l) => logs.push(l) });
  assert.deepEqual(out, {});
  assert.ok(Date.now() - t0 < 2000);
  assert.match(logs.join('\n'), /did not answer in time/);
});
