import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRepoServer } from '../server/repoServer.js';
import { jsonServerNames, readSetupInventory, tomlServerNames } from '../server/setupImport.js';

/**
 * Lock for "Import my setup": MCP servers and skills from ~/.claude and
 * ~/.codex, by NAME ONLY. The home here is a temp dir this test builds, with
 * planted secrets in every place one could hide (env values, args, an auth
 * file); none may appear in the answer.
 */

const SECRET = 'sk-PLANTED-0123456789';

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function plantHome(): string {
  const home = tempDir('seq-setup-home-');
  write(
    path.join(home, '.claude.json'),
    JSON.stringify({
      oauthAccount: { emailAddress: 'max@example.com' },
      mcpServers: { github: { command: 'npx', args: ['-y', 'gh-mcp', SECRET], env: { GITHUB_TOKEN: SECRET } } },
    }),
  );
  write(path.join(home, '.claude', 'settings.json'), JSON.stringify({ mcpServers: { playwright: { command: 'pw' }, github: {} } }));
  write(path.join(home, '.claude', '.credentials.json'), JSON.stringify({ token: SECRET }));
  write(path.join(home, '.claude', 'skills', 'deploy', 'SKILL.md'), '# deploy\n');
  fs.mkdirSync(path.join(home, '.claude', 'skills', 'not-a-skill'), { recursive: true });
  write(
    path.join(home, '.codex', 'config.toml'),
    [
      'model = "gpt-5"',
      '[mcp_servers.linear]',
      'command = "npx"',
      `env = { LINEAR_API_KEY = "${SECRET}" }`,
      '[mcp_servers.linear.env]',
      `TOKEN = "${SECRET}"`,
      '[mcp_servers."docs site"]',
      'url = "https://example.com"',
      '',
    ].join('\n'),
  );
  write(path.join(home, '.codex', 'auth.json'), JSON.stringify({ OPENAI_API_KEY: SECRET }));
  write(path.join(home, '.codex', 'skills', 'review', 'SKILL.md'), '# review\n');
  return home;
}

test('setup inventory: names from every source, deduped and sorted, and nothing else', () => {
  const home = plantHome();
  const inv = readSetupInventory(home);
  assert.deepStrictEqual(inv, {
    mcpServers: [
      { name: 'github', source: 'claude' },
      { name: 'playwright', source: 'claude' },
      { name: 'docs site', source: 'codex' },
      { name: 'linear', source: 'codex' },
    ],
    skills: [
      { name: 'deploy', source: 'claude' },
      { name: 'review', source: 'codex' },
    ],
  });
  const wire = JSON.stringify(inv);
  assert.ok(!wire.includes(SECRET), 'a planted secret reached the answer');
  assert.ok(!wire.includes('example.com'), 'an account or URL reached the answer');
});

test('an empty home is an empty answer, not an error; unreadable files are skipped', () => {
  const home = tempDir('seq-setup-empty-');
  write(path.join(home, '.claude.json'), '{ not json');
  assert.deepStrictEqual(readSetupInventory(home), { mcpServers: [], skills: [] });
  assert.deepStrictEqual(jsonServerNames(null), []);
  assert.deepStrictEqual(tomlServerNames('[mcp_serversX.a]\n[other.mcp_servers.b]'), []);
});

test('GET /api/onboarding/setup answers the inventory of the browse root', async () => {
  const home = plantHome();
  const store = tempDir('seq-setup-store-');
  const server = await createRepoServer(null, { webDist: undefined, browseRoot: home, recentStoreDir: store, userConfigDir: store });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    const body = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: '/api/onboarding/setup' }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
        })
        .on('error', reject);
    });
    assert.strictEqual(body.status, 200);
    const j = JSON.parse(body.text) as { mcpServers: { name: string }[]; skills: { name: string }[] };
    assert.deepStrictEqual(j.mcpServers.map((s) => s.name), ['github', 'playwright', 'docs site', 'linear']);
    assert.deepStrictEqual(j.skills.map((s) => s.name), ['deploy', 'review']);
    assert.ok(!body.text.includes(SECRET));
  } finally {
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }
});
