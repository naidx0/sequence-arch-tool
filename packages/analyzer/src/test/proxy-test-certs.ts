/* Throwaway self-signed certificates for the proxy-tunnel tests: one for registry.npmjs.org, one for evil.example.
   They are made fresh by openssl each time the tests load, so no private key is ever checked in (the public
   export refuses any). openssl ships on the Linux CI runners and with Git for Windows. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function findOpenssl(): string {
  const candidates = ['openssl'];
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles ?? 'C:/Program Files';
    candidates.push(path.join(pf, 'Git', 'mingw64', 'bin', 'openssl.exe'), path.join(pf, 'Git', 'usr', 'bin', 'openssl.exe'));
  }
  for (const c of candidates) {
    try {
      execFileSync(c, ['version'], { stdio: 'ignore' });
      return c;
    } catch {
      /* try the next one */
    }
  }
  throw new Error('proxy-test-certs: openssl was not found; the proxy-tunnel tests need it to make their throwaway certificates');
}

function selfSigned(host: string): { cert: string; key: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-proxy-cert-'));
  try {
    const key = path.join(dir, 'key.pem');
    const cert = path.join(dir, 'cert.pem');
    execFileSync(OPENSSL, [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
      '-keyout', key, '-out', cert, '-subj', `/CN=${host}`,
      '-addext', `subjectAltName=DNS:${host}`,
    ], { stdio: 'ignore' });
    return { cert: fs.readFileSync(cert, 'utf8'), key: fs.readFileSync(key, 'utf8') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const OPENSSL = findOpenssl();
const npm = selfSigned('registry.npmjs.org');
const evil = selfSigned('evil.example');

export const NPM_CERT = npm.cert;
export const NPM_KEY = npm.key;
export const EVIL_CERT = evil.cert;
export const EVIL_KEY = evil.key;
