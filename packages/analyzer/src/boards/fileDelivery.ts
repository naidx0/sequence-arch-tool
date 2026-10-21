import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BoardError, boardsDir } from './boardStore.js';
import { resolveInRepo } from '../server/jail.js';

export interface FileDelivery { id: string; chat: string; path: string }
export const fileDeliveriesPath = (root: string): string => path.join(boardsDir(root), 'file-deliveries.json');

export function readFileDeliveries(root: string): FileDelivery[] {
  try {
    const rows: unknown = JSON.parse(fs.readFileSync(fileDeliveriesPath(root), 'utf8'));
    return Array.isArray(rows) ? rows.filter((r): r is FileDelivery => r && typeof r.id === 'string' && typeof r.chat === 'string' && typeof r.path === 'string') : [];
  } catch { return []; }
}

/** An explicit reveal of an existing artifact; saving a file alone never steals the person's surface. */
export function deliverFile(root: string, chat: string, rel: string): FileDelivery {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(chat)) throw new BoardError('artifact delivery needs the active chat');
  const resolved = resolveInRepo(fs.realpathSync(root), rel);
  if (!resolved) throw new BoardError('artifact path must stay inside the project', 400);
  if (!/\.(html?|svg|png|jpe?g|gif|webp)$/i.test(rel)) throw new BoardError('artifact preview supports HTML, SVG and images');
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new BoardError('artifact file not found', 404);
  const next = { id: randomUUID(), chat, path: rel.replace(/\\/g, '/') };
  const rows = readFileDeliveries(root).filter((r) => r.chat !== chat);
  fs.mkdirSync(boardsDir(root), { recursive: true });
  const tmp = `${fileDeliveriesPath(root)}.${next.id}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify([...rows, next]));
  fs.renameSync(tmp, fileDeliveriesPath(root));
  return next;
}
