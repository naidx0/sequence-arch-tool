/**
 * The system proxy, as environment variables for the server child.
 *
 * The server (and every CLI it starts) reads HTTPS_PROXY / HTTP_PROXY / NO_PROXY. A person whose Windows or macOS
 * settings name a proxy but who never set those variables would otherwise download the Claude bridge, run the agent
 * CLIs and check for updates direct, and fail on a proxy-only network. So the desktop reads the system setting once
 * before it starts the server and passes it down. Variables the person set always win.
 *
 * Windows: `reg query` of HKCU Internet Settings. macOS: `scutil --proxy`. A PAC script cannot be read from either, so
 * for that case Electron's own resolver (session.resolveProxy, which runs PAC) is asked and its answer parsed.
 * SOCKS is not supported by the download code; it is reported, not applied.
 */

export interface ProxyEnv {
  HTTPS_PROXY?: string;
  HTTP_PROXY?: string;
  NO_PROXY?: string;
}

/** Loopback is never proxied: the server, the CLIs' callbacks and the health check all live there. */
export const LOOPBACK_NO_PROXY = 'localhost,127.0.0.1,::1';

/**
 * Chromium's resolveProxy answer: "PROXY h:p; DIRECT" is http://h:p, "HTTPS h:p" is https://h:p, SOCKS/DIRECT are none.
 * Only the first usable entry counts. `log` hears about SOCKS.
 */
export function proxyEnvFromResolve(result: string, log: (line: string) => void = () => undefined): { HTTPS_PROXY?: string; HTTP_PROXY?: string } {
  for (const raw of result.split(';')) {
    const entry = raw.trim();
    if (!entry) continue;
    const m = /^(\w+)\s+(\S+)$/.exec(entry);
    const kind = (m?.[1] ?? entry).toUpperCase();
    if (kind === 'DIRECT') return {};
    if (!m) continue;
    const hostport = m[2]!;
    if (kind === 'PROXY' || kind === 'HTTP') return { HTTPS_PROXY: `http://${hostport}`, HTTP_PROXY: `http://${hostport}` };
    if (kind === 'HTTPS') return { HTTPS_PROXY: `https://${hostport}`, HTTP_PROXY: `https://${hostport}` };
    if (kind.startsWith('SOCKS')) {
      log(`system proxy is ${kind} (${hostport}); SOCKS is not supported, so no proxy is applied`);
      return {};
    }
  }
  return {};
}

function both(proxy: string): ProxyEnv {
  return { HTTPS_PROXY: proxy, HTTP_PROXY: proxy };
}

const withHttp = (hostport: string): string => (/^[a-z][a-z0-9+.-]*:\/\//i.test(hostport) ? hostport : `http://${hostport}`);

/** Windows' ProxyOverride ("localhost;127.*;<local>") as a NO_PROXY list; entries NO_PROXY cannot express are dropped. */
function windowsOverride(list: string | undefined): string {
  const out = new Set(LOOPBACK_NO_PROXY.split(','));
  for (const raw of (list ?? '').split(/[;,]/)) {
    const e = raw.trim();
    if (!e) continue;
    if (e.toLowerCase() === '<local>') continue; // plain host names: localhost is already in
    if (/^\*\.[^*]+$/.test(e) || /^[^*]+$/.test(e)) out.add(e); // "*.corp.example" and "host" are understood; "127.*" is not
  }
  return [...out].join(',');
}

export interface WindowsProxy {
  /** The static proxy, when ProxyEnable is on and ProxyServer names one for http(s). */
  env: ProxyEnv | null;
  /** A PAC script address is set (and no static proxy is in use). */
  pac: string | null;
  socksOnly: boolean;
}

/** Parse `reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings"`. */
export function parseWindowsInternetSettings(out: string): WindowsProxy {
  const val = (name: string): string | undefined => new RegExp(`^[ \\t]*${name}[ \\t]+REG_\\w+[ \\t]*(.*?)[ \\t\\r]*$`, 'im').exec(out)?.[1];
  const enabled = /^(0x)?0*1$/i.test((val('ProxyEnable') ?? '').trim());
  const server = val('ProxyServer')?.trim();
  const pac = val('AutoConfigURL')?.trim() || null;
  if (enabled && server) {
    if (!server.includes('=')) return { env: { ...both(withHttp(server)), NO_PROXY: windowsOverride(val('ProxyOverride')) }, pac: null, socksOnly: false };
    const parts = new Map<string, string>();
    for (const p of server.split(';')) {
      const i = p.indexOf('=');
      if (i > 0) parts.set(p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim());
    }
    const https = parts.get('https') ?? parts.get('http');
    if (https) {
      const http = parts.get('http') ?? https;
      return { env: { HTTPS_PROXY: withHttp(https), HTTP_PROXY: withHttp(http), NO_PROXY: windowsOverride(val('ProxyOverride')) }, pac: null, socksOnly: false };
    }
    return { env: null, pac, socksOnly: parts.has('socks') };
  }
  return { env: null, pac, socksOnly: false };
}

export interface MacProxy {
  env: ProxyEnv | null;
  pac: boolean;
  socksOnly: boolean;
}

/** Parse `scutil --proxy`. */
export function parseScutilProxy(out: string): MacProxy {
  const kv = new Map<string, string>();
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\w+)\s*:\s*(.+?)\s*$/.exec(line);
    if (m) kv.set(m[1]!, m[2]!);
  }
  const hostport = (p: 'HTTPS' | 'HTTP'): string | null => {
    if (kv.get(`${p}Enable`) !== '1') return null;
    const host = kv.get(`${p}Proxy`);
    return host ? `${host}:${kv.get(`${p}Port`) ?? (p === 'HTTPS' ? '443' : '80')}` : null;
  };
  const exceptions: string[] = [];
  let inList = false;
  for (const line of out.split(/\r?\n/)) {
    if (/ExceptionsList\s*:/.test(line)) inList = true;
    else if (inList) {
      const m = /^\s*\d+\s*:\s*(.+?)\s*$/.exec(line);
      if (m) exceptions.push(m[1]!);
      else if (/}/.test(line)) inList = false;
    }
  }
  const noProxy = [...new Set([...LOOPBACK_NO_PROXY.split(','), ...exceptions.filter((e) => !/\//.test(e) || /^\d+\.\d+\.\d+\.\d+\/\d+$/.test(e))])].join(',');
  const https = hostport('HTTPS');
  const http = hostport('HTTP');
  const pac = kv.get('ProxyAutoConfigEnable') === '1';
  const socks = kv.get('SOCKSEnable') === '1';
  if (https || http) {
    const s = https ?? http!;
    const h = http ?? s;
    return { env: { HTTPS_PROXY: withHttp(s), HTTP_PROXY: withHttp(h), NO_PROXY: noProxy }, pac: false, socksOnly: false };
  }
  return { env: null, pac, socksOnly: socks };
}

export const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

export interface SystemProxyDeps {
  platform?: string;
  env?: NodeJS.ProcessEnv;
  /** Run a command and return its stdout (rejects on failure). Must start the process hidden. */
  run: (cmd: string, args: string[]) => Promise<string>;
  /** Electron's session.resolveProxy, for a PAC script. */
  resolveProxy?: (url: string) => Promise<string>;
  /** A PAC script can hang on a bad network: give up after this long (default 2000 ms) and apply no proxy. */
  pacTimeoutMs?: number;
  log?: (line: string) => void;
}

const ENV_NAMES = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];

/** True when the person (or the shell) already set a proxy variable. */
export function proxySetInEnv(env: NodeJS.ProcessEnv): boolean {
  return ENV_NAMES.some((n) => (env[n] ?? '').trim() !== '');
}

/** The proxy variables to add to the server's environment: {} when variables are already set, or there is no proxy. */
export async function systemProxyEnv(deps: SystemProxyDeps): Promise<ProxyEnv> {
  const found = await systemProxyEnvRaw(deps);
  if (!found.HTTPS_PROXY) return found;
  /* A NO_PROXY the person set is theirs: keep it, add the system's and loopback. */
  const env = deps.env ?? process.env;
  const mine = [env.NO_PROXY, env.no_proxy].filter((v): v is string => !!v && v.trim() !== '').flatMap((v) => v.split(','));
  const all = [...new Set([...mine.map((x) => x.trim()).filter(Boolean), ...(found.NO_PROXY ?? '').split(',').filter(Boolean)])];
  return { ...found, NO_PROXY: all.join(',') };
}

async function systemProxyEnvRaw(deps: SystemProxyDeps): Promise<ProxyEnv> {
  const platform = deps.platform ?? process.platform;
  const log = deps.log ?? (() => undefined);
  if (proxySetInEnv(deps.env ?? process.env)) return {};
  const viaResolve = async (): Promise<ProxyEnv> => {
    if (!deps.resolveProxy) return {};
    try {
      let timer: NodeJS.Timeout | undefined;
      const answer = await Promise.race([
        deps.resolveProxy('https://registry.npmjs.org'),
        new Promise<string>((_, rej) => (timer = setTimeout(() => rej(new Error('the PAC script did not answer in time')), deps.pacTimeoutMs ?? 2000))),
      ]).finally(() => clearTimeout(timer));
      const r = proxyEnvFromResolve(answer, log);
      return r.HTTPS_PROXY ? { ...r, NO_PROXY: LOOPBACK_NO_PROXY } : {};
    } catch (e) {
      log(`system proxy by PAC skipped: ${(e as Error).message}`);
      return {};
    }
  };
  try {
    if (platform === 'win32') {
      const p = parseWindowsInternetSettings(await deps.run('reg', ['query', REG_KEY]));
      if (p.env) return p.env;
      if (p.socksOnly) log('system proxy is SOCKS only; SOCKS is not supported, so no proxy is applied');
      return p.pac ? await viaResolve() : {};
    }
    if (platform === 'darwin') {
      const p = parseScutilProxy(await deps.run('scutil', ['--proxy']));
      if (p.env) return p.env;
      if (p.socksOnly) log('system proxy is SOCKS only; SOCKS is not supported, so no proxy is applied');
      return p.pac ? await viaResolve() : {};
    }
  } catch (e) {
    log(`could not read the system proxy: ${(e as Error).message}`);
  }
  return {};
}
