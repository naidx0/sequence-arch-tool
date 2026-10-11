import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveInRepo, realpathContained } from './jail.js';

export class FileOperationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Mutations never follow links, touch reserved state, or overwrite another file. */
export function organizeFile(root: string, body: { op?: unknown; path?: unknown; to?: unknown }, reserved: (abs: string) => boolean): { recoverable?: boolean; trashId?: string; trashPath?: string } {
  const deny = (message: string): never => { throw new FileOperationError(403, message); };
  const safe = (rel: unknown): string => {
    if (typeof rel !== 'string' || !rel || /[\\:\u0000-\u001f<>"|?*]/.test(rel)) return deny('invalid project-relative path');
    const parts = rel.split('/');
    if (parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p) || /^(\.git|\.sequence|\.ssh|\.aws|\.gnupg)$/i.test(p) || /^\.env(?:\.|$)/i.test(p) || /^(credentials(?:\..*)?|id_rsa|id_ed25519)$/i.test(p) || /\.(pem|key|p12|pfx)$/i.test(p))) return deny('path is reserved or contains secrets');
    const abs = resolveInRepo(root, rel);
    if (!abs || reserved(abs)) return deny('path escapes project root or is reserved');
    // Reject in-root links too: a mutation must address what the tree names.
    let current = root;
    for (const part of parts) {
      current = path.join(current, part);
      try { if (fs.lstatSync(current).isSymbolicLink()) return deny('symlink paths cannot be organized'); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
    return abs;
  };
  if (body.op !== 'move' && body.op !== 'delete') throw new FileOperationError(400, 'op must be move or delete');
  const source = safe(body.path);
  let stat: fs.Stats;
  try { stat = fs.lstatSync(source); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new FileOperationError(404, 'file not found');
    throw e;
  }
  // Hard-link + unlink provides a portable exclusive destination for files.
  // Directory rename lacks a portable atomic no-replace operation.
  if (!stat.isFile()) throw new FileOperationError(409, 'Only regular files can be organized; folder operations are not supported');
  const transfer = (destination: string) => {
    try { fs.linkSync(source, destination); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new FileOperationError(409, 'destination already exists — never overwrite');
      throw e;
    }
    try { fs.unlinkSync(source); } catch (e) { fs.unlinkSync(destination); throw e; }
  };
  if (body.op === 'move') {
    const destination = safe(body.to);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    safe(body.path); safe(body.to);
    transfer(destination);
    return {};
  }
  // Explicit op:'delete' is the confirmed intent supplied by the Files dialog.
  // Nothing is destroyed: keep data plus its original location in a private bucket.
  const trashRel = '.sequence/trash';
  const trash = resolveInRepo(root, trashRel);
  if (!trash || realpathContained(trash) !== path.join(root, '.sequence', 'trash')) return deny('trash path is not safe');
  fs.mkdirSync(trash, { recursive: true });
  if (fs.realpathSync(trash) !== path.join(root, '.sequence', 'trash')) return deny('trash path is not safe');
  const trashId = crypto.randomUUID(), bucket = path.join(trash, trashId);
  fs.mkdirSync(bucket);
  fs.writeFileSync(path.join(bucket, 'metadata.json'), JSON.stringify({ path: body.path, deletedAt: Date.now() }), { flag: 'wx' });
  safe(body.path);
  transfer(path.join(bucket, 'data'));
  return { recoverable: true, trashId, trashPath: `${trashRel}/${trashId}` };
}
