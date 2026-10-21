import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { keyVaultInfo, safeStorageCrypto, vaultState } from '../aiKeyVault';

/*
 * APP-11: the renderer is told whether keys are sealed or stored unencrypted. A faked safeStorage
 * stands in for Electron's. The fake "key" is never printed or returned: only the state and a path.
 */
type FakeSafe = Parameters<typeof safeStorageCrypto>[0];
const fake = (o: Partial<{ avail: boolean; backend: string; throws: boolean }> = {}): FakeSafe => ({
  isEncryptionAvailable: () => {
    if (o.throws) throw new Error('boom');
    return o.avail ?? true;
  },
  getSelectedStorageBackend: o.backend === undefined ? undefined : () => o.backend as string,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString(),
});

test('sealed when safeStorage is available (Windows DPAPI, macOS Keychain, Linux libsecret)', () => {
  assert.equal(vaultState(safeStorageCrypto(fake(), 'win32')), 'sealed');
  assert.equal(vaultState(safeStorageCrypto(fake(), 'darwin')), 'sealed');
  assert.equal(vaultState(safeStorageCrypto(fake({ backend: 'gnome_libsecret' }), 'linux')), 'sealed');
});

test('plain when encryption is unavailable, when Linux only has basic_text, and when the probe throws', () => {
  assert.equal(vaultState(safeStorageCrypto(fake({ avail: false }), 'win32')), 'plain');
  assert.equal(vaultState(safeStorageCrypto(fake({ backend: 'basic_text' }), 'linux')), 'plain');
  assert.equal(vaultState(safeStorageCrypto(fake({ throws: true }), 'darwin')), 'plain');
  /* the Linux rule is Linux's only: basic_text on another platform is not a thing, and does not downgrade it */
  assert.equal(vaultState(safeStorageCrypto(fake({ backend: 'basic_text' }), 'win32')), 'sealed');
});

test('the info carries the REAL ai.json path only when plain, and never a key', () => {
  const aiFile = path.join('C:', 'Users', 'max', '.sequence', 'ai.json');
  const plain = keyVaultInfo(safeStorageCrypto(fake({ avail: false }), 'linux'), aiFile);
  assert.deepEqual(plain, { state: 'plain', path: aiFile });
  const sealed = keyVaultInfo(safeStorageCrypto(fake(), 'win32'), aiFile);
  assert.deepEqual(sealed, { state: 'sealed', path: null });
  assert.ok(!JSON.stringify([plain, sealed]).includes('sk-'));
});

test('main.ts answers the preload channel from the same crypto the vault opens with; preload exposes it as a key, not a global', () => {
  const root = path.resolve(__dirname, '..', '..');
  const read = (f: string): string => fs.readFileSync(path.join(root, 'src', f), 'utf8').replace(/\r\n/g, '\n');
  const main = read('main.ts');
  const preload = read('preload.ts');
  assert.ok(main.includes("ipcMain.handle('sequence:key-vault'"), 'main.ts does not answer sequence:key-vault');
  assert.ok(main.includes('safeStorageCrypto(safeStorage'), 'main.ts must build the vault crypto with safeStorageCrypto');
  assert.ok(/keyVault:\s*\(\)/.test(preload) && preload.includes("'sequence:key-vault'"), 'preload has no keyVault key');
  assert.strictEqual((preload.match(/exposeInMainWorld\(/g) ?? []).length, 1);
});
