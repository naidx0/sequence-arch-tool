import fs from 'node:fs';
import path from 'node:path';
import { AI_FILE, SEQUENCE_DIR, readUserJson, writeUserJson } from './store.js';

/* ══════════════════════════════════════════════════════════════════════════
   API KEYS LIVE AT USER LEVEL ONLY — 0.1.8.1 B3 (audit H4)
   packages/analyzer/src/server/aiKeyStore.ts

   Three rules, and this module is where each one is kept:

   1. A key is never written into `<repo>/.sequence/`. Every ai.json write goes
      to the user store (`~/.sequence/ai.json`, 0o600 in a 0o700 dir).
   2. A repository that already holds one (written by 0.1.8 and earlier for a
      trusted repo) is migrated on load: its keys move to the user-level
      `repo-keys.json` (see below) and the repo's file loses them.
   3. In the desktop app, Electron `safeStorage` (DPAPI / Keychain / libsecret)
      holds the keys. Main decrypts them at spawn and passes them in
      `SEQUENCE_AI_KEYS`; this module fills them back into the config it reads
      and strips them from the config it writes, so the file on disk only
      carries a key the vault has not sealed yet (the 0o600 fallback).

   SLOTS. A key is held for one place in the config AND the address it was
   given for: `profile:<id>|<provider>|<baseUrl>`, `role:<name>|…`, `$|…` for
   the flat config. A profile re-pointed at another host therefore never gets
   the old key filled back in (the same rule mergeStoredProfileKeys keeps).
   packages/desktop/src/aiKeyVault.ts implements the same slot names; its test
   holds the two equal.
   ══════════════════════════════════════════════════════════════════════════ */

export type KeySlots = Record<string, string>;

/** The env var the desktop passes the unsealed keys in (JSON object, slot -> key). */
export const HELD_KEYS_ENV = 'SEQUENCE_AI_KEYS';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const addr = (u: unknown): string => (typeof u === 'string' ? u.trim().replace(/\/+$/, '') : '');
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function slot(prefix: string, o: Obj): string {
  return `${prefix}|${str(o.provider)}|${addr(o.baseUrl)}`;
}

/** Visit every object in an ai.json that can carry an `apiKey`, with its slot name. */
function eachKeyHolder(raw: unknown, visit: (o: Obj, slotName: string) => void): void {
  if (!isObj(raw)) return;
  visit(raw, slot('$', raw));
  if (Array.isArray(raw.profiles)) {
    for (const p of raw.profiles) if (isObj(p) && typeof p.id === 'string') visit(p, slot(`profile:${p.id}`, p));
  }
  if (isObj(raw.roles)) {
    for (const [name, b] of Object.entries(raw.roles)) if (isObj(b)) visit(b, slot(`role:${name}`, b));
  }
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Every non-empty key in the config, by slot. */
export function extractKeys(raw: unknown): KeySlots {
  const out: KeySlots = {};
  eachKeyHolder(raw, (o, s) => {
    if (typeof o.apiKey === 'string' && o.apiKey.trim() !== '') out[s] = o.apiKey;
  });
  return out;
}

export function hasKeys(raw: unknown): boolean {
  return Object.keys(extractKeys(raw)).length > 0;
}

/** A copy with every key the vault holds for that exact slot filled in where none is written. */
export function fillHeldKeys(raw: unknown, held: KeySlots): unknown {
  if (!isObj(raw) || Object.keys(held).length === 0) return raw;
  const out = clone(raw);
  eachKeyHolder(out, (o, s) => {
    const has = typeof o.apiKey === 'string' && o.apiKey.trim() !== '';
    if (!has && held[s] !== undefined) o.apiKey = held[s];
  });
  return out;
}

/** A copy without the keys the vault already holds (same slot, same value); others are kept. */
export function stripHeldKeys(raw: unknown, held: KeySlots): unknown {
  if (!isObj(raw) || Object.keys(held).length === 0) return raw;
  const out = clone(raw);
  eachKeyHolder(out, (o, s) => {
    if (typeof o.apiKey === 'string' && held[s] !== undefined && held[s] === o.apiKey) delete o.apiKey;
  });
  return out;
}

/** A copy with every key removed. */
export function stripAllKeys(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const out = clone(raw);
  eachKeyHolder(out, (o) => {
    delete o.apiKey;
  });
  return out;
}

/** The keys handed over at spawn, once taken out of the environment. */
let heldFromProcess: KeySlots = {};

/**
 * The vault's keys. The FIRST read from `process.env` also DELETES the
 * variable, so no terminal, agent CLI or tool this server starts inherits the
 * keys; later reads answer from memory. `createRepoServer` calls this first.
 */
export function heldKeysFromEnv(env: NodeJS.ProcessEnv = process.env): KeySlots {
  if (env === process.env) {
    if (env[HELD_KEYS_ENV] !== undefined) {
      heldFromProcess = { ...heldFromProcess, ...parseHeld(env[HELD_KEYS_ENV]) };
      delete env[HELD_KEYS_ENV];
    }
    return heldFromProcess;
  }
  return parseHeld(env[HELD_KEYS_ENV]);
}

function parseHeld(raw: string | undefined): KeySlots {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObj(parsed)) return {};
    const out: KeySlots = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string' && v !== '') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/** Read the user-level ai.json with the vault's keys filled in. */
export function readUserAiConfig(userConfigDir: string, held: KeySlots = heldKeysFromEnv()): unknown {
  const raw = readUserJson(userConfigDir, AI_FILE);
  return raw === undefined ? undefined : fillHeldKeys(raw, held);
}

/** Write the user-level ai.json (0o600), leaving out the keys the vault holds. */
export function writeUserAiConfig(userConfigDir: string, value: unknown, held: KeySlots = heldKeysFromEnv()): void {
  writeUserJson(userConfigDir, AI_FILE, stripHeldKeys(stripEnvKeys(value), held));
}

/**
 * A copy without the keys that came from the environment (`apiKeyEnv`, providerCatalog.ts): such a
 * config names its variable and the key is read again on every load, so the value is never written.
 */
export function stripEnvKeys(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const out = clone(raw);
  eachKeyHolder(out, (o) => {
    if (typeof o.apiKeyEnv === 'string' && o.apiKeyEnv !== '') delete o.apiKey;
  });
  return out;
}


/* ══════════════════════════════════════════════════════════════════════════
   MOVING A KEY OUT OF A REPOSITORY (rule 2), review round B

   The first cut MERGED a trusted repo's config into the user's own ai.json.
   The review found it lost keys (a 'default'-mode user config, a repo's
   `roles` keys) and could make a repository's provider the user's default.
   So the migration no longer merges configs at all. It moves the KEYS, by
   slot, into a user-level per-repository key store (`repo-keys.json`, 0o600 in
   the 0o700 user dir), and leaves the repo's config where it was, minus its
   keys. Reading that repo's config fills the keys back from the store.

   Nothing about the user's own config changes, so no default switches and no
   id can collide. The repo file is stripped ONLY when a re-read of the store
   shows every key the file held; otherwise it is left exactly as it was and
   the answer is 'failed'.
   ══════════════════════════════════════════════════════════════════════════ */

export const REPO_KEYS_FILE = 'repo-keys.json';

interface RepoKeysFile {
  version: 1;
  repos: Record<string, KeySlots>;
}

function repoKeyId(repoRoot: string): string {
  const r = path.resolve(repoRoot);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

function readRepoKeysFile(userConfigDir: string): RepoKeysFile {
  const raw = readUserJson<Partial<RepoKeysFile>>(userConfigDir, REPO_KEYS_FILE);
  const repos: Record<string, KeySlots> = {};
  if (raw && isObj(raw.repos)) {
    for (const [root, slots] of Object.entries(raw.repos)) {
      if (!isObj(slots)) continue;
      const clean: KeySlots = {};
      for (const [k, v] of Object.entries(slots)) if (typeof v === 'string' && v !== '') clean[k] = v;
      repos[root] = clean;
    }
  }
  return { version: 1, repos };
}

/** The keys moved out of this repository's own ai.json, by slot. */
export function readRepoKeys(userConfigDir: string, repoRoot: string): KeySlots {
  return readRepoKeysFile(userConfigDir).repos[repoKeyId(repoRoot)] ?? {};
}

/** A trusted repo's own config with the keys that were moved out of it filled back in. */
export function fillRepoKeys(raw: unknown, userConfigDir: string, repoRoot: string): unknown {
  return fillHeldKeys(raw, readRepoKeys(userConfigDir, repoRoot));
}

/**
 * Move the keys out of `<repo>/.sequence/ai.json`. Never throws.
 *  - UNTRUSTED repo: left alone ('none'). Its file is repo-supplied and never read.
 *  - TRUSTED repo whose file holds keys: the keys go to `repo-keys.json` under
 *    this repo, and the repo file loses them only once the store is proven to
 *    hold every one ('moved'). Any shortfall leaves the file untouched ('failed').
 */
export function migrateRepoAiConfig(repoRoot: string, userConfigDir: string, trusted: boolean): 'none' | 'moved' | 'failed' {
  const file = path.join(repoRoot, SEQUENCE_DIR, AI_FILE);
  let repoRaw: unknown;
  try {
    if (!fs.existsSync(file)) return 'none';
    repoRaw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return 'none';
  }
  if (!trusted) return 'none';
  const keys = extractKeys(repoRaw);
  if (Object.keys(keys).length === 0) return 'none';
  try {
    const store = readRepoKeysFile(userConfigDir);
    const id = repoKeyId(repoRoot);
    store.repos[id] = { ...(store.repos[id] ?? {}), ...keys };
    writeUserJson(userConfigDir, REPO_KEYS_FILE, store);
    const proven = readRepoKeys(userConfigDir, repoRoot);
    if (!Object.entries(keys).every(([slotName, key]) => proven[slotName] === key)) return 'failed';
    fs.writeFileSync(file, JSON.stringify(stripAllKeys(repoRaw), null, 2));
    return 'moved';
  } catch {
    return 'failed';
  }
}
