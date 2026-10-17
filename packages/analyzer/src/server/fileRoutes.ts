/**
 * Files rail and file read/write routes, moved out of repoServer.ts unchanged:
 *
 *   GET  /api/tree                     the jailed file tree
 *   GET  /api/file?path=               a jailed file read (GET/HEAD /api/media: a clip or image with Range)
 *   PUT  /api/file                     a jailed single-file save
 *   POST /api/file/op                  create/mkdir/rename/move/duplicate/delete/reveal
 *
 * Auth, owner and attached-repo checks stay in repoServer and arrive as callbacks (`requireOwner`,
 * `requireFileJail`); live state arrives as getters. Nothing here closes over createRepoServer state.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathMatchesProgramEditAllowlist } from '@sequence/schema';
import type { Unvalidated, GetTreeResponse, PutFileRequest, PutFileResponse } from '@sequence/api-types';
import { MAX_FILE_BYTES } from '../scan.js';
import { isTrusted, runHooks } from './hooks.js';
import { resolveInRepo } from './jail.js';
import { applyFileOp } from './fileOps.js';
import { clearCachedGraph } from './graphCache.js';
import { isManagedWorktree } from './chatWorktree.js';
import { buildTree } from './tree.js';
import { readHookFile, readHookTrust } from './store.js';
import { readProgramEditAllowlist } from './programMemory.js';
import { readSessionWorktree } from './sessionsStore.js';
import { isCheckpointSessionId, trackSessionWrite } from './checkpointStore.js';
import { MAX_BODY_BYTES, sendJson, sendError, isJsonRequest, readBody } from './routeHttp.js';

/** The clips GET /api/file?raw=1 serves with Range, by extension. */
const MEDIA_TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.gif': 'image/gif' };
/** GET /api/media also serves the stills a Space shows (a poster). */
export const MEDIA_ROUTE_TYPES: Record<string, string> = { ...MEDIA_TYPES, '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;

/** `Range: bytes=a-b` (also `a-` and the suffix form `-n`) against a file of `size` bytes. Null: no usable header, serve it whole. */
export function parseByteRange(header: string | undefined, size: number): [number, number] | 'unsatisfiable' | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (size === 0 || start >= size || start > end) return 'unsatisfiable';
  return [start, end];
}

export interface FileRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  method: string;
  requireOwner: () => boolean;
  requireFileJail: (res: http.ServerResponse) => string | null;
  activeRoot: () => string;
  /** The attached repo root, or null when none is attached. */
  getRoot: () => string | null;
  /** The signed-in user id under hosted auth (undefined locally). */
  sessionId: string | undefined;
  userConfigDir: string;
  userConfigDirFor: (sessionId: string | undefined) => string;
  markGraphStale: (relPath: string) => void;
  getStaleSince: () => string | null;
  foldPath: (p: string) => string;
  isDecisionRecordWritePath: (abs: string) => boolean;
  isSeqDiagramWritePath: (abs: string) => boolean;
  isSeqDiagramReadPath: (abs: string) => boolean;
  isPlanWritePath: (abs: string) => boolean;
  isMediaReadPath: (abs: string) => boolean;
  isPlanReadPath: (abs: string) => boolean;
  isDecisionRecordReadPath: (abs: string) => boolean;
  isPolicyReadPath: (abs: string) => boolean;
  isReservedResolved: (abs: string) => boolean;
}

const FILE_ROUTE_PATHS = new Set(['/api/tree', '/api/file', '/api/media', '/api/file/op']);
export function isFileRoutePath(pathname: string): boolean {
  return FILE_ROUTE_PATHS.has(pathname);
}

/** Handle the file tree, read, media, save and operation routes. Returns false when the request is not one of ours. */
export async function handleFileRoute(ctx: FileRouteContext): Promise<boolean> {
  const { req, res, url, method } = ctx;
  const { pathname } = url;
  const { requireOwner, requireFileJail, activeRoot, sessionId, userConfigDir, userConfigDirFor, markGraphStale, foldPath, isDecisionRecordWritePath, isSeqDiagramWritePath, isSeqDiagramReadPath, isPlanWritePath, isMediaReadPath, isPlanReadPath, isDecisionRecordReadPath, isPolicyReadPath, isReservedResolved } = ctx;
  const getRoot = ctx.getRoot;
  // ---- GET /api/tree ----
  if (pathname === '/api/tree' && method === 'GET') {
    const root = requireFileJail(res);
    if (root === null) return true;
    if (getRoot() !== null && requireOwner()) return true;
    const tree: GetTreeResponse = buildTree(root);
    sendJson(res, 200, tree);
    return true;
  }

  // ---- GET /api/file?path=<repo-relative> ----
  // ---- GET /api/media?path=<repo-relative>: the same jail, a clip or image as its own bytes with Range ----
  if ((pathname === '/api/file' || pathname === '/api/media') && (method === 'GET' || (method === 'HEAD' && pathname === '/api/media'))) {
    const root = requireFileJail(res);
    if (root === null) return true;
    if (getRoot() !== null && requireOwner()) return true;
    let rel = url.searchParams.get('path') ?? '';
    /* An NTFS alternate data stream (`clip.mp4:payload`) names other bytes under a name the checks above would pass. */
    if (rel.replace(/^[A-Za-z]:[\\/]/, '').includes(':')) {
      sendError(res, 400, 'path must not contain ":"');
      return true;
    }
    /* Lane visual: a chat that works in its own worktree links files that live THERE. `chat=<id>` makes that
       worktree the jail for this read, and an absolute path is accepted only when it lies inside it (it is cut
       to a relative one and then goes through the same jail as any other). */
    let jailRoot = root;
    const chatParam = url.searchParams.get('chat');
    if (chatParam) {
      const wt = readSessionWorktree(root, chatParam);
      if (wt && !wt.removedAt) {
        try {
          const wtReal = fs.realpathSync(wt.path);
          /* The index file is project data, so its `worktree.path` is a claim, not a fact: it is a jail only when
             the repo really manages that folder (under Sequence's worktree folder, or listed by git). */
          if (await isManagedWorktree(root, [userConfigDir, userConfigDirFor(sessionId)], wtReal)) {
            jailRoot = wtReal;
            if (path.isAbsolute(rel)) {
              const r = path.relative(wtReal, path.resolve(rel));
              if (r !== '' && !r.startsWith('..') && !path.isAbsolute(r)) rel = r;
            }
          } else {
            sendError(res, 403, 'path escapes repo root or is reserved');
            return true;
          }
        } catch {
          /* a worktree that is gone is not a jail */
        }
      }
    }
    const reservedInJail = (resolved: string): boolean => {
      if (jailRoot === root) return false;
      let canonical: string;
      try {
        canonical = fs.realpathSync(resolved);
      } catch {
        canonical = resolved;
      }
      for (const name of ['.sequence', '.git', '.ssh', '.aws', '.gnupg']) {
        const lex = path.join(jailRoot, name);
        const roots = [lex];
        try {
          roots.push(fs.realpathSync(lex));
        } catch {
          /* absent */
        }
        const c = foldPath(canonical);
        const rs = foldPath(resolved);
        if (roots.some((r) => c === foldPath(r) || c.startsWith(foldPath(r) + '/') || rs === foldPath(r) || rs.startsWith(foldPath(r) + '/'))) return true;
      }
      return false;
    };
    // Same choke point as /api/prompt-file: the jail AND the reserved-dir
    // refusal. Without the reserved guard, GET /api/file?path=.sequence/ai.json
    // would ship the plaintext API key to any localhost caller, and .git/*
    // would be readable too.
    const abs = (() => {
      const resolved = resolveInRepo(jailRoot, rel);
      if (resolved === null) return null;
      if (reservedInJail(resolved)) return null;
      if (
        isReservedResolved(resolved) &&
        !isDecisionRecordReadPath(resolved) &&
        !isPolicyReadPath(resolved) &&
        !isSeqDiagramReadPath(resolved) &&
        !isPlanReadPath(resolved) &&
        !isMediaReadPath(resolved)
      )
        return null;
      return resolved;
    })();
    if (abs === null) {
      sendError(res, 403, 'path escapes repo root or is reserved');
      return true;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      /* `optional=1`: the caller is asking whether the file exists. 204 is "no, and that is fine": a 404 here is a
         red line in every browser console for a question that has a normal answer. */
      if (url.searchParams.get('optional') === '1') {
        res.statusCode = 204;
        res.end();
        return true;
      }
      sendError(res, 404, 'file not found');
      return true;
    }
    if (stat.isDirectory()) {
      sendError(res, 400, 'path is a directory');
      return true;
    }
    /* raw=1 on a clip a Space shows (.mp4 .webm .gif): its own bytes, with HTTP Range so a player can seek.
       A video outgrows MAX_FILE_BYTES, so it has its own ceiling and is answered before that check. */
    const ext = path.extname(abs).toLowerCase();
    const mediaType = pathname === '/api/media' ? MEDIA_ROUTE_TYPES[ext] : url.searchParams.get('raw') === '1' ? MEDIA_TYPES[ext] : undefined;
    if (pathname === '/api/media' && !mediaType) {
      sendError(res, 415, `not a media type this route serves (${Object.keys(MEDIA_ROUTE_TYPES).join(', ')})`);
      return true;
    }
    if (mediaType) {
      if (stat.size > MAX_MEDIA_BYTES) {
        sendError(res, 413, `media too large (>${MAX_MEDIA_BYTES} bytes)`);
        return true;
      }
      const range = parseByteRange(req.headers.range, stat.size);
      res.setHeader('content-type', mediaType);
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('accept-ranges', 'bytes');
      res.setHeader('cache-control', 'no-cache');
      if (range === 'unsatisfiable') {
        res.statusCode = 416;
        res.setHeader('content-range', `bytes */${stat.size}`);
        res.end();
        return true;
      }
      const [start, end] = range ?? [0, Math.max(0, stat.size - 1)];
      res.statusCode = range ? 206 : 200;
      if (range) res.setHeader('content-range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('content-length', String(stat.size === 0 ? 0 : end - start + 1));
      if (stat.size === 0 || method === 'HEAD') {
        res.end();
        return true;
      }
      const stream = fs.createReadStream(abs, { start, end });
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
      return true;
    }
    if (stat.size > MAX_FILE_BYTES) {
      sendError(res, 413, `file too large (>${MAX_FILE_BYTES} bytes)`);
      return true;
    }
    /* raw=1: a RASTER IMAGE on this allowlist as its own bytes, for the Files
       preview (round 7, B8). Anything else, SVG included, keeps the text
       answer below; every refusal above has already run. */
    const RAW_IMAGE: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif' };
    const rawType = url.searchParams.get('raw') === '1' ? RAW_IMAGE[path.extname(abs).toLowerCase()] : undefined;
    if (rawType) {
      res.statusCode = 200;
      res.setHeader('content-type', rawType);
      res.setHeader('x-content-type-options', 'nosniff');
      res.end(fs.readFileSync(abs));
      return true;
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(fs.readFileSync(abs, 'utf8'));
    return true;
  }

  // ---- PUT /api/file  { path, content }  (jailed single-file save) ----
  // The board's editable file view saves through here. This is a WRITE surface,
  // so it goes through the EXACT same jail + reserved-dir guard as the model
  // write path (resolveInRepo + isReservedResolved, mirroring vetWritePaths): a
  // traversal, an absolute path, a symlink escape, or any .sequence/.git/.ssh/
  // .aws/.gnupg target is refused with the same 403 shape as GET /api/file. No
  // new way to write outside the repo or into a reserved dir.

  if (pathname === '/api/file' && method === 'PUT') {
    const jail = requireFileJail(res);
    if (jail === null) return true;
    if (requireOwner()) return true;
    if (!isJsonRequest(req)) {
      sendError(res, 415, 'expected content-type application/json');
      return true;
    }
    let body: Unvalidated<PutFileRequest>;
    try {
      body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (e) {
      sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
      return true;
    }
    const rel = body.path;
    const content = body.content;
    if (typeof rel !== 'string' || rel.length === 0) {
      sendError(res, 400, 'body must include a string "path"');
      return true;
    }
    if (typeof content !== 'string') {
      sendError(res, 400, 'body must include a string "content"');
      return true;
    }
    // Same choke point as GET /api/file: jail (traversal/symlink) AND the
    // reserved-dir refusal. Workspace-home writes use ~/.sequence/workspace.
    const abs = resolveInRepo(jail, rel);
    if (
      abs === null ||
      (isReservedResolved(abs) &&
        !isDecisionRecordWritePath(abs) &&
        !isSeqDiagramWritePath(abs) &&
        !isPlanWritePath(abs))
    ) {
      sendError(res, 403, 'path escapes repo root or is reserved');
      return true;
    }
    const relPosix = rel.replace(/\\/g, '/');
    if (/(?:^|\/)(?:docs\/adr|\.sequence\/decisions)\/ADR-\d{3}-.+\.md$/.test(relPosix)) {
      try {
        if (fs.existsSync(abs)) {
          sendError(res, 409, 'decision record already exists — never overwrite');
          return true;
        }
      } catch {
        /* stat failure — proceed; write will surface errors */
      }
    }
    /* Program allowlist + pre-write hooks only apply to an attached repository. */
    if (getRoot() !== null) {
      const editAllowlist = readProgramEditAllowlist(activeRoot());
      if (editAllowlist && !pathMatchesProgramEditAllowlist(relPosix, editAllowlist)) {
        sendError(res, 403, 'path outside program.md Agent may edit allowlist');
        return true;
      }
      const hookOutcome = await runHooks('pre-write', {
        repoRoot: activeRoot(),
        file: readHookFile(activeRoot()),
        trusted: isTrusted(activeRoot(), readHookTrust(userConfigDir)),
        payload: { path: relPosix },
      });
      if (!hookOutcome.allowed) {
        const blocked = hookOutcome.outcomes.find((o) => o.kind === 'blocked');
        sendError(
          res,
          403,
          `blocked by a pre-write hook (${blocked?.command ?? 'hook'}): ${
            blocked && 'reason' in blocked ? blocked.reason : 'no reason given'
          }`,
        );
        return true;
      }
    }
    try {
      if (fs.statSync(abs).isDirectory()) {
        sendError(res, 400, 'path is a directory');
        return true;
      }
    } catch {
      /* not-yet-existing file — allowed */
    }
    if (getRoot() !== null && isCheckpointSessionId(body.sessionId)) {
      try {
        trackSessionWrite(activeRoot(), body.sessionId, path.relative(activeRoot(), abs));
      } catch (e) {
        process.stderr.write(`sequence: checkpoint tracking failed: ${(e as Error).message}
`);
      }
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    if (getRoot() !== null) {
      clearCachedGraph(activeRoot());
    }
    const writtenRel = path.relative(jail, abs);
    // ITEM 1.5 — the write's own answer says the graph is now behind the disk.
    // `stale` is not a warning about THIS response (the file was written); it is
    // the honest state of the graph the caller is still holding, which is the
    // thing a client has to react to.
    markGraphStale(writtenRel);
    const written: PutFileResponse & { stale: true; staleSince: string } = {
      ok: true,
      path: writtenRel,
      stale: true,
      staleSince: ctx.getStaleSince()!,
    };
    sendJson(res, 200, written);
    return true;
  }

  // ---- POST /api/file/op ---- (Files rail: create/mkdir/rename/move/duplicate/delete/reveal)
  // Jailed exactly like PUT /api/file: every path (and destination) goes through
  // resolveInRepo + the reserved-dir refusal; the project root is never a source.
  if (pathname === '/api/file/op' && method === 'POST') {
    const jail = requireFileJail(res);
    if (jail === null) return true;
    if (requireOwner()) return true;
    if (!isJsonRequest(req)) {
      sendError(res, 415, 'expected content-type application/json');
      return true;
    }
    let opBody: Unvalidated<{ op: string; path: string; to?: string }>;
    try {
      opBody = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (e) {
      sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
      return true;
    }
    if (getRoot() !== null) {
      const editAllowlist = readProgramEditAllowlist(activeRoot());
      if (editAllowlist && opBody.op !== 'reveal') {
        for (const candidate of [opBody.path, opBody.to]) {
          if (
            typeof candidate === 'string' &&
            !pathMatchesProgramEditAllowlist(candidate.replace(/\\/g, '/'), editAllowlist)
          ) {
            sendError(res, 403, 'path outside program.md Agent may edit allowlist');
            return true;
          }
        }
      }
    }
    const outcome = applyFileOp(jail, opBody, { isReserved: isReservedResolved });
    if (outcome.status === 200 && outcome.touched) {
      if (getRoot() !== null) clearCachedGraph(activeRoot());
      for (const p of outcome.touched) markGraphStale(p);
    }
    sendJson(res, outcome.status, outcome.body);
    return true;
  }

  return false;
}
