/** Where everything lives. Kept tiny so every other module can import it freely. */
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const LORA_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(LORA_ROOT, '..', '..');
export const RECIPES_PATH = path.join(LORA_ROOT, 'request-recipes.json');
export const SPLITS_PATH = path.join(LORA_ROOT, 'splits.json');
export const RUNS_DIR = path.join(LORA_ROOT, 'runs');

/**
 * The QA corpus manifest is read as DATA, never as code.
 * `tools/qa-loop/**` is owned by another workstream and is being rewritten; this
 * pipeline copies the two things it needs (the row shape, the clone-cache
 * convention) rather than importing them, so a refactor next door cannot break
 * the dataset build. See tools/lora/README.md § "What we copied from qa-loop".
 */
export const QA_MANIFEST_PATH = path.join(REPO_ROOT, 'tools/qa-loop/manifest.json');

/** Same convention as `tools/qa-loop/lib/clone.mjs`: cache lives OUTSIDE the repo. */
export function corpusCacheRoot(explicit) {
  return explicit ?? process.env.SEQUENCE_QA_CACHE ?? path.join(os.tmpdir(), 'sequence-qa-cache');
}
