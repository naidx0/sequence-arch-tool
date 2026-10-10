/* ══════════════════════════════════════════════════════════════════════════
   SKILLS IMPORT: TURN WHAT A PERSON PICKED OR DROPPED INTO SKILL FILES
   packages/web2/src/settings/skillsFiles.ts

   A person can hand over a skill folder, a folder of skill folders (another
   project's .sequence/skills), a single SKILL.md, or loose notes. All of it
   becomes `<slug>/<file>` paths with a SKILL.md at the top of each slug, the
   shape POST /api/skills takes. The server re-checks everything; this only
   decides what to send and says in words what it left out.
   ══════════════════════════════════════════════════════════════════════════ */

export const MAX_FILES = 40;
export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_TOTAL_BYTES = 800 * 1024;
const TEXT_EXT = /\.(md|markdown|txt|json|ya?ml|toml|csv|sh|py|js|mjs|ts)$/i;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface PickedFile {
  /** Path inside what was picked, using "/" ("shop-rules/SKILL.md"), or just the name for a loose file. */
  path: string;
  file: File;
}

export interface SkillFilesResult {
  files: { path: string; content: string }[];
  slugs: string[];
  /** Plain-words reasons something was left out. */
  skipped: string[];
  /** Why nothing can be imported (empty when files is not). */
  error: string | null;
}

export function slugify(raw: string): string {
  const s = raw
    .replace(/\.[A-Za-z0-9]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|[-._]+$/g, '')
    .slice(0, 64);
  return SEGMENT.test(s) ? s : '';
}

export function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

function nameOf(markdown: string): string {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(markdown);
  const n = m ? /^name:\s*["']?([^"'\n]+)["']?\s*$/m.exec(m[1]!) : null;
  return n ? n[1]!.trim() : '';
}

export async function gatherSkillFiles(picked: PickedFile[]): Promise<SkillFilesResult> {
  const skipped: string[] = [];
  const clean = picked
    .map((p) => ({ ...p, path: p.path.replace(/\\/g, '/').replace(/^\/+/, '') }))
    .filter((p) => {
      const segs = p.path.split('/');
      if (segs.some((s) => s.startsWith('.') || s === 'node_modules')) return false;
      if (!TEXT_EXT.test(p.path)) {
        skipped.push(`${segs[segs.length - 1]} (not a text file)`);
        return false;
      }
      if (p.file.size > MAX_FILE_BYTES) {
        skipped.push(`${segs[segs.length - 1]} (over 256 KB)`);
        return false;
      }
      return true;
    });

  /* A folder of skill folders: SKILL.md sits two deep, never one. Drop the outer folder's name. */
  const hasTop = clean.some((p) => /^[^/]+\/SKILL\.md$/.test(p.path));
  const hasNested = clean.some((p) => /^[^/]+\/[^/]+\/SKILL\.md$/.test(p.path));
  const rooted = !hasTop && hasNested ? clean.map((p) => ({ ...p, path: p.path.split('/').slice(1).join('/') })).filter((p) => p.path.includes('/')) : clean;

  const out: { path: string; content: string }[] = [];
  for (const p of rooted) {
    let content: string;
    try {
      content = await readText(p.file);
    } catch {
      skipped.push(`${p.path} (could not be read)`);
      continue;
    }
    if (content.includes('\u0000')) {
      skipped.push(`${p.path} (not a text file)`);
      continue;
    }
    if (!p.path.includes('/')) {
      /* A loose file: one note becomes its own skill. */
      if (!/\.(md|markdown|txt)$/i.test(p.path)) {
        skipped.push(`${p.path} (loose files must be notes: .md or .txt)`);
        continue;
      }
      const base = /^SKILL\.md$/i.test(p.path) ? '' : p.path;
      const slug = slugify(nameOf(content)) || slugify(base);
      if (!slug) {
        skipped.push(`${p.path} (give it a name: add "name:" at the top, or put it in a folder)`);
        continue;
      }
      out.push({ path: `${slug}/SKILL.md`, content });
      continue;
    }
    const segs = p.path.split('/');
    if (!segs.every((s) => SEGMENT.test(s))) {
      skipped.push(`${p.path} (a name has characters a skill folder cannot use)`);
      continue;
    }
    out.push({ path: p.path, content });
  }

  const slugs = [...new Set(out.map((f) => f.path.split('/')[0]!))];
  const withMd = new Set(out.filter((f) => /^[^/]+\/SKILL\.md$/.test(f.path)).map((f) => f.path.split('/')[0]!));
  for (const s of slugs) {
    if (!withMd.has(s)) skipped.push(`${s} (no SKILL.md inside)`);
  }
  const files = out.filter((f) => withMd.has(f.path.split('/')[0]!));
  if (files.length > MAX_FILES) {
    return { files: [], slugs: [], skipped, error: `That is ${files.length} files. Import at most ${MAX_FILES} at once.` };
  }
  const total = files.reduce((n, f) => n + new Blob([f.content]).size, 0);
  if (total > MAX_TOTAL_BYTES) {
    return { files: [], slugs: [], skipped, error: `Those files add up to ${Math.ceil(total / 1024)} KB. Import at most ${MAX_TOTAL_BYTES / 1024} KB at once: pick fewer skills.` };
  }
  const kept = [...new Set(files.map((f) => f.path.split('/')[0]!))];
  return { files, slugs: kept, skipped, error: files.length === 0 ? 'No skill found. A skill is a folder with a SKILL.md inside, or a single note.' : null };
}

/** Everything under a dropped folder entry, with paths from the folder down. */
type Entry = { isFile: boolean; isDirectory: boolean; name: string; file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void; createReader?: () => { readEntries: (cb: (e: Entry[]) => void, err?: (e: unknown) => void) => void } };

async function walk(entry: Entry, prefix: string, out: PickedFile[]): Promise<void> {
  if (out.length > 400) return;
  if (entry.isFile && entry.file) {
    const f = await new Promise<File | null>((res) => entry.file!(res, () => res(null)));
    if (f) out.push({ path: `${prefix}${entry.name}`, file: f });
  } else if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise<Entry[]>((res) => reader.readEntries(res, () => res([])));
      if (batch.length === 0) break;
      for (const e of batch) await walk(e, `${prefix}${entry.name}/`, out);
    }
  }
}

/** What a drop carried: folders are walked; plain files keep their relative path when the browser gave one. */
export async function pickedFromDrop(dt: DataTransfer): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  const items = Array.from(dt.items ?? []);
  const entries = items.map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.() ?? null);
  if (items.length > 0 && entries.every((e) => e !== null)) {
    for (const e of entries) await walk(e!, '', out);
    return out;
  }
  return pickedFromList(dt.files);
}

export function pickedFromList(list: FileList | File[] | null | undefined): PickedFile[] {
  return Array.from(list ?? []).map((file) => ({ path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, file }));
}
