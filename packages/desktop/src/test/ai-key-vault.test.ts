import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractKeys, openVault, type VaultCrypto } from '../aiKeyVault';

/*
 * 0.1.8.1 B3: the desktop seals API keys with safeStorage and hands them to the
 * engine at spawn. A reversible fake stands in for safeStorage here (no
 * Electron under node --test); every key is fake.
 */

const FAKE = 'sk-test-000-vault';
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

/** A stand-in for safeStorage: reversible, and visibly not plaintext. */
function fakeCrypto(available = true): VaultCrypto & { sealedCalls: number } {
  const c = {
    sealedCalls: 0,
    available: () => available,
    encrypt: (plain: string) => {
      c.sealedCalls += 1;
      return Buffer.from(Buffer.from(plain, 'utf8').toString('base64').split('').reverse().join(''), 'utf8');
    },
    decrypt: (sealed: Buffer) => Buffer.from(sealed.toString('utf8').split('').reverse().join(''), 'base64').toString('utf8'),
  };
  return c;
}

function paths(): { aiFile: string; sealedFile: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-vault-'));
  return { dir, aiFile: path.join(dir, 'store', 'ai.json'), sealedFile: path.join(dir, 'userData', 'ai-keys.sealed') };
}

test('B3: a key in the user ai.json is sealed, taken out of the file, and returned for the spawn env', () => {
  const p = paths();
  fs.mkdirSync(path.dirname(p.aiFile), { recursive: true });
  fs.writeFileSync(p.aiFile, JSON.stringify({ provider: 'anthropic', model: 'x', apiKey: FAKE }));
  const crypto = fakeCrypto();
  const keys = openVault(p, crypto);
  assert.deepStrictEqual(keys, { '$|anthropic|': FAKE });
  assert.ok(!fs.readFileSync(p.aiFile, 'utf8').includes(FAKE), 'ai.json no longer holds the key');
  assert.ok(!fs.readFileSync(p.sealedFile).toString('utf8').includes(FAKE), 'the sealed file is not plaintext');
  /* Next launch: nothing new in the file, the sealed key still comes back. */
  assert.deepStrictEqual(openVault(p, crypto), { '$|anthropic|': FAKE });
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(p.sealedFile).mode & 0o777, 0o600);
    assert.strictEqual(fs.statSync(p.aiFile).mode & 0o777, 0o600);
  }
  fs.rmSync(p.dir, { recursive: true, force: true });
});

test('B3: without encryption nothing is sealed and the 0o600 file keeps its key (the fallback)', () => {
  const p = paths();
  fs.mkdirSync(path.dirname(p.aiFile), { recursive: true });
  const original = JSON.stringify({ provider: 'anthropic', model: 'x', apiKey: FAKE });
  fs.writeFileSync(p.aiFile, original);
  const crypto = fakeCrypto(false);
  assert.deepStrictEqual(openVault(p, crypto), {});
  assert.strictEqual(fs.readFileSync(p.aiFile, 'utf8'), original);
  assert.strictEqual(crypto.sealedCalls, 0);
  assert.ok(!fs.existsSync(p.sealedFile));
  fs.rmSync(p.dir, { recursive: true, force: true });
});

test('B3: a failed seal never takes the key out of the file', () => {
  const p = paths();
  fs.mkdirSync(path.dirname(p.aiFile), { recursive: true });
  fs.writeFileSync(p.aiFile, JSON.stringify({ provider: 'anthropic', model: 'x', apiKey: FAKE }));
  const broken: VaultCrypto = { available: () => true, encrypt: () => Buffer.from('x'), decrypt: () => 'not json' };
  assert.deepStrictEqual(openVault(p, broken), {});
  assert.ok(fs.readFileSync(p.aiFile, 'utf8').includes(FAKE), 'the key is still where the engine can read it');
  fs.rmSync(p.dir, { recursive: true, force: true });
});

test('B3: the vault names slots exactly as the engine does', async () => {
  const engine = (await (new Function('u', 'return import(u)') as (u: string) => Promise<{ extractKeys: (r: unknown) => Record<string, string> }>)(
    pathToFileURL(path.join(ROOT, 'packages', 'analyzer', 'dist', 'server', 'aiKeyStore.js')).href,
  ));
  const samples: unknown[] = [
    { provider: 'anthropic', model: 'x', apiKey: FAKE },
    { provider: 'openai-compatible', baseUrl: 'https://h.example/v1/', model: 'm', apiKey: FAKE },
    {
      profiles: [
        { id: 'a', name: 'A', provider: 'anthropic', model: 'x', apiKey: FAKE },
        { id: 'b', name: 'B', provider: 'openai-compatible', model: 'm', baseUrl: 'http://127.0.0.1:11434/v1' },
      ],
      defaultProfileId: 'a',
      roles: { advisor: { model: 'y', provider: 'anthropic', apiKey: 'sk-test-advisor' } },
    },
  ];
  for (const s of samples) assert.deepStrictEqual(extractKeys(s), engine.extractKeys(s));
});

test('B3: main.ts seals with safeStorage before the spawn and passes SEQUENCE_AI_KEYS', () => {
  const main = fs.readFileSync(path.join(ROOT, 'packages', 'desktop', 'src', 'main.ts'), 'utf8').replace(/\r\n/g, '\n');
  /* contract change (0.1.8.4): the spawn is boot.ts startEngine, which runs prepareEnv (the vault) before controller.start. */
  assert.ok(main.indexOf('openVault(') > 0 && main.indexOf('prepareEnv: () => {') > 0, 'main hands the vault to the engine start as prepareEnv');
  const boot = fs.readFileSync(path.join(ROOT, 'packages', 'desktop', 'src', 'boot.ts'), 'utf8').replace(/\r\n/g, '\n');
  const at = boot.indexOf('d.prepareEnv()');
  const start = boot.indexOf('d.controller.start(');
  assert.ok(at > 0 && start > at, 'the vault is opened before the engine is spawned');
  assert.match(main, /safeStorageCrypto\(safeStorage, process\.platform\)/);
  assert.match(main, /serverEnv\.SEQUENCE_AI_KEYS = JSON\.stringify\(vaultKeys\)/);
  /* contract change (APP-11): the safeStorage calls and the Linux basic_text rule moved into aiKeyVault.ts
     (safeStorageCrypto) so the sealing and the sentence Settings shows read the same rule. */
  const vault = fs.readFileSync(path.join(ROOT, 'packages', 'desktop', 'src', 'aiKeyVault.ts'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(vault, /safe\.encryptString\(plain\)/);
  assert.match(vault, /safe\.decryptString\(sealed\)/);
  assert.match(vault, /getSelectedStorageBackend\?\.\(\) === 'basic_text'/);
});

/* ── review B nits ── */

test('review B: a sealed file that cannot be opened is never overwritten, and the file keeps its new key', () => {
  const p = paths();
  fs.mkdirSync(path.dirname(p.aiFile), { recursive: true });
  fs.mkdirSync(path.dirname(p.sealedFile), { recursive: true });
  fs.writeFileSync(p.sealedFile, Buffer.from('sealed by another keyring'));
  fs.writeFileSync(p.aiFile, JSON.stringify({ provider: 'anthropic', model: 'x', apiKey: FAKE }));
  const locked: VaultCrypto = {
    available: () => true,
    encrypt: (s) => Buffer.from(s),
    decrypt: () => {
      throw new Error('keyring locked');
    },
  };
  assert.deepStrictEqual(openVault(p, locked), {});
  assert.strictEqual(fs.readFileSync(p.sealedFile, 'utf8'), 'sealed by another keyring', 'the sealed file is untouched');
  assert.ok(fs.readFileSync(p.aiFile, 'utf8').includes(FAKE), 'the new key stays where the engine reads it');
  fs.rmSync(p.dir, { recursive: true, force: true });
});

test('review B: a sealed key whose profile is gone from ai.json is dropped', () => {
  const p = paths();
  fs.mkdirSync(path.dirname(p.aiFile), { recursive: true });
  const crypto = fakeCrypto();
  fs.writeFileSync(
    p.aiFile,
    JSON.stringify({
      profiles: [
        { id: 'a', name: 'A', provider: 'anthropic', model: 'x', apiKey: 'sk-test-A' },
        { id: 'b', name: 'B', provider: 'anthropic', model: 'x', apiKey: 'sk-test-B' },
      ],
      defaultProfileId: 'a',
    }),
  );
  assert.deepStrictEqual(Object.values(openVault(p, crypto)).sort(), ['sk-test-A', 'sk-test-B']);
  /* The person deletes profile b in Settings (the engine rewrites ai.json without it). */
  fs.writeFileSync(p.aiFile, JSON.stringify({ profiles: [{ id: 'a', name: 'A', provider: 'anthropic', model: 'x' }], defaultProfileId: 'a' }));
  assert.deepStrictEqual(openVault(p, crypto), { 'profile:a|anthropic|': 'sk-test-A' });
  assert.deepStrictEqual(JSON.parse(crypto.decrypt(fs.readFileSync(p.sealedFile))), { 'profile:a|anthropic|': 'sk-test-A' }, 'gone from the sealed file too');
  /* Disconnecting removes ai.json: nothing is carried. */
  fs.rmSync(p.aiFile);
  assert.deepStrictEqual(openVault(p, crypto), {});
  fs.rmSync(p.dir, { recursive: true, force: true });
});
