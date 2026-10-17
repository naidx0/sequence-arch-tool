import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { PICK_FOLDER_OPTIONS, pickFolder, type FolderDialogOptions } from '../pick-folder';

/*
 * 0.1.8.1: `pickFolder()` on `sequence:pick-folder` — the OS folder dialog alone (openDirectory), the folder or null,
 * and NO attach. The web app's clone "Clone into" calls it (web2 boot/desktopBridge.ts `pickFolder`).
 * Source-text assertions for the two Electron files, the preload-bridge.test.ts pattern (CI has no Electron runtime).
 */

test('pickFolder returns the chosen folder, with the openDirectory dialog', async () => {
  let asked: FolderDialogOptions | null = null;
  const got = await pickFolder(async (o) => {
    asked = o;
    return { canceled: false, filePaths: ['D:\code\new-app'] };
  });
  assert.strictEqual(got, 'D:\code\new-app');
  assert.deepStrictEqual(asked, PICK_FOLDER_OPTIONS);
  assert.ok(PICK_FOLDER_OPTIONS.properties.includes('openDirectory'));
});

test('Cancel, or nothing chosen, is null', async () => {
  assert.strictEqual(await pickFolder(async () => ({ canceled: true, filePaths: ['x'] })), null);
  assert.strictEqual(await pickFolder(async () => ({ canceled: false, filePaths: [] })), null);
});

const SRC = path.resolve(__dirname, '..', '..', 'src');
test('the preload exposes pickFolder on sequence:pick-folder, and main answers it without attaching', () => {
  const preload = fs.readFileSync(path.join(SRC, 'preload.ts'), 'utf8');
  assert.match(preload, /pickFolder:\s*\(\):\s*Promise<string \| null> => ipcRenderer\.invoke\('sequence:pick-folder'\)/);
  const main = fs.readFileSync(path.join(SRC, 'main.ts'), 'utf8');
  const line = main.split('\n').find((l) => l.includes("ipcMain.handle('sequence:pick-folder'"));
  assert.ok(line, 'main handles sequence:pick-folder');
  assert.match(line!, /pickFolder\(/);
  assert.doesNotMatch(line!, /attach|openRepoDialog|setRepo/);
});

test('the web side reads it by the same name', () => {
  const web = fs.readFileSync(path.resolve(SRC, '..', '..', 'web2', 'src', 'boot', 'desktopBridge.ts'), 'utf8');
  assert.match(web, /pickFolder\?\(\): Promise<string \| null>;/);
});
