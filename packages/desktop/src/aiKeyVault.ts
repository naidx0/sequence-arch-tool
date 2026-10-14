import fs from 'node:fs';
import path from 'node:path';

/**
 * THE KEY VAULT — 0.1.8.1 B3 (audit H4). Electron-free, so it runs under
 * `node --test`; main.ts hands it `safeStorage` (DPAPI on Windows, Keychain on
 * macOS, libsecret on Linux).
 *
 * At every launch, before the engine is spawned:
 *   1. the keys already sealed in `<userData>/ai-keys.sealed` are decrypted;
 *   2. any key the engine wrote into the user store's `ai.json` since (a key
 *      saved in Settings during the last session) is sealed too, and taken out
 *      of `ai.json`;
 *   3. the plaintext map goes to the engine in `SEQUENCE_AI_KEYS`, which the
 *      engine reads once and deletes from its environment
 *      (analyzer server/aiKeyStore.ts).
 *
 * FALLBACK: when encryption is not available (Linux with no keyring, where
 * Electron would only obfuscate), nothing is sealed and `ai.json` keeps its
 * keys as the engine wrote them: 0o600 in a 0o700 directory.
 *
 * SLOT NAMES are the engine's: `profile:<id>|<provider>|<baseUrl>`,
 * `role:<name>|…`, `$|…` for the flat config. The test holds the two equal.
 */

export interface VaultCrypto {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(sealed: Buffer): string;
}

export type KeySlots = Record<string, string>;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const addr = (u: unknown): string => (typeof u === 'string' ? u.trim().replace(/\/+$/, '') : '');
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const slot = (prefix: string, o: Obj): string => `${prefix}|${str(o.provider)}|${addr(o.baseUrl)}`;

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

/** Every non-empty key in an ai.json, by slot (the engine's extractKeys). */
export function extractKeys(raw: unknown): KeySlots {
  const out: KeySlots = {};
  eachKeyHolder(raw, (o, s) => {
    if (typeof o.apiKey === 'string' && o.apiKey.trim() !== '') out[s] = o.apiKey;
  });
  return out;
}

function stripKeys(raw: unknown, slots: KeySlots): unknown {
  const out = JSON.parse(JSON.stringify(raw)) as unknown;
  eachKeyHolder(out, (o, s) => {
    if (typeof o.apiKey === 'string' && slots[s] === o.apiKey) delete o.apiKey;
  });
  return out;
}

function writePrivate(file: string, data: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

export interface VaultPaths {
  /** The user store's ai.json (`~/.sequence/ai.json`, or under SEQUENCE_USER_DIR). */
  aiFile: string;
  /** `<userData>/ai-keys.sealed`. */
  sealedFile: string;
}

/**
 * Seal any new keys, take them out of ai.json, and return every key the vault
 * holds (plaintext, for the spawn env). {} when encryption is unavailable.
 * Never throws: a launch must not fail on the vault.
 */
/** Every slot the config has a place for, keyed or not (review B: a sealed key whose place is gone is dropped). */
export function holderSlots(raw: unknown): Set<string> {
  const out = new Set<string>();
  eachKeyHolder(raw, (_o, s) => out.add(s));
  return out;
}

export function openVault(paths: VaultPaths, crypto: VaultCrypto, log: (line: string) => void = () => {}): KeySlots {
  let available = false;
  try {
    available = crypto.available();
  } catch {
    available = false;
  }
  if (!available) {
    log('encryption unavailable: keys stay in the 0o600 user file');
    return {};
  }
  let sealed: KeySlots = {};
  try {
    if (fs.existsSync(paths.sealedFile)) {
      const parsed = JSON.parse(crypto.decrypt(fs.readFileSync(paths.sealedFile))) as unknown;
      if (isObj(parsed)) for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') sealed[k] = v;
    }
  } catch (e) {
    /* REVIEW B: A SEALED FILE WE CANNOT OPEN IS NEVER OVERWRITTEN. It may open
       next time (a keyring that was locked, a profile not yet unlocked); writing
       over it with only this launch's keys would destroy every other one. So:
       nothing is sealed this launch, and any key still in ai.json stays there. */
    log(`could not open the sealed keys, leaving them untouched: ${(e as Error).message}`);
    return {};
  }
  let config: unknown;
  let configReadable = true;
  try {
    if (fs.existsSync(paths.aiFile)) config = JSON.parse(fs.readFileSync(paths.aiFile, 'utf8'));
  } catch {
    config = undefined;
    configReadable = false;
  }
  /* REVIEW B: a sealed key whose place in ai.json is gone (the profile was
     deleted or re-pointed, the config removed) is dropped, not carried forever.
     Only when ai.json could be read: an unreadable file says nothing. */
  let pruned = false;
  if (configReadable) {
    const places = holderSlots(config);
    for (const k of Object.keys(sealed)) {
      if (!places.has(k)) {
        delete sealed[k];
        pruned = true;
      }
    }
  }
  const fresh = extractKeys(config);
  /* The file's key is the newer one for its slot. Seal FIRST and prove the
     round trip, and only then take the keys out of the file: a failure in
     between leaves a key in two places, never in none. */
  const all = { ...sealed, ...fresh };
  if (Object.keys(fresh).length === 0 && !pruned) return sealed;
  try {
    const blob = crypto.encrypt(JSON.stringify(all));
    if (JSON.stringify(JSON.parse(crypto.decrypt(blob))) !== JSON.stringify(all)) throw new Error('round trip differs');
    writePrivate(paths.sealedFile, blob);
    if (Object.keys(fresh).length > 0) writePrivate(paths.aiFile, JSON.stringify(stripKeys(config, fresh), null, 2));
    log(`sealed ${Object.keys(fresh).length} key(s)${pruned ? '; dropped keys whose profile is gone' : ''}`);
    return all;
  } catch (e) {
    log(`could not seal the keys, they stay in the 0o600 user file: ${(e as Error).message}`);
    return sealed;
  }
}
