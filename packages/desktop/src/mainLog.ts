import fs from 'node:fs';
import path from 'node:path';

/**
 * A small rotating log for the main process: <userData>/logs/main.log, capped
 * at ~1 MB with one previous file (main.log.1). It exists so that "the window
 * closed on me" leaves evidence. Electron-free; unit-tested with node --test.
 *
 * Lines are single-line, timestamped, and carry no secrets: anything that
 * looks like an absolute path outside `keepPrefix` (userData) is replaced,
 * and every line is length-capped.
 */

export const MAX_LOG_BYTES = 1024 * 1024;
export const MAX_LINE_CHARS = 400;

const PATH_RE = /(?:[A-Za-z]:[\\/]|\\\\|\/(?=[\w.-]+\/))[^\s"'`<>|*?]*/g;

/** Replace absolute paths with <path>, except those under keepPrefix. */
export function redactPaths(text: string, keepPrefix?: string): string {
  const keep = keepPrefix ? keepPrefix.replace(/\\/g, '/').toLowerCase() : null;
  return text.replace(PATH_RE, (m) =>
    keep && m.replace(/\\/g, '/').toLowerCase().startsWith(keep) ? m : '<path>'
  );
}

const R = '<redacted>';
const SECRET_RULES: [RegExp, string][] = [
  /* Authorization header values (Bearer/Basic/Token or bare). */
  [/(authorization\s*[:=]\s*)(?:(?:bearer|basic|token)\s+)?[^\s"',;]+/gi, `$1${R}`],
  [/\b(bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi, `$1${R}`],
  /* Provider keys and tokens by shape: sk-ant-api03-..., sk-proj-..., ghp_/gho_/..., JWTs. */
  [/\bsk-[A-Za-z0-9_-]{8,}/g, R],
  [/\bgh[pousr]_[A-Za-z0-9]{10,}/g, R],
  [/\bgithub_pat_[A-Za-z0-9_]{10,}/g, R],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, R],
  /* NAME=value where the name ends in key/token/secret/password. */
  [/\b([A-Za-z0-9_.-]*(?:key|token|secret|password|passwd))(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&"',;]+)/gi, `$1$2${R}`],
  /* Every URL query value. */
  [/([?&][^=&\s"']+=)[^&\s"']*/g, `$1${R}`],
];

/** Replace anything that looks like a credential. Over-redacting is the safe side. */
export function redactSecrets(text: string): string {
  return SECRET_RULES.reduce((t, [re, to]) => t.replace(re, to), text);
}

/** Keep the last `maxLines` lines of a stream, each capped, from a raw chunk. */
export function pushTail(tail: string[], chunk: string, maxLines = 8, maxLine = 300): void {
  for (const raw of chunk.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    tail.push(l.length > maxLine ? l.slice(0, 60) + '…' + l.slice(-(maxLine - 60)) : l);
  }
  if (tail.length > maxLines) tail.splice(0, tail.length - maxLines);
}

/** One log line: ISO timestamp, event name, optional single-line detail. */
export function formatLine(now: Date, event: string, detail?: string, keepPrefix?: string): string {
  let d = detail ? redactPaths(redactSecrets(detail), keepPrefix).replace(/[\r\n]+/g, ' ⏎ ').trim() : '';
  /* Keep the END: a crash line is last. */
  if (d.length > MAX_LINE_CHARS) d = d.slice(0, 100) + ' … ' + d.slice(-(MAX_LINE_CHARS - 100));
  return d ? `${now.toISOString()} ${event} ${d}` : `${now.toISOString()} ${event}`;
}

export class MainLog {
  readonly file: string;
  private size = 0;
  private stopped = false;

  constructor(
    private readonly dir: string,
    private readonly opts: { maxBytes?: number; keepPrefix?: string; now?: () => Date } = {}
  ) {
    this.file = path.join(dir, 'main.log');
    try {
      fs.mkdirSync(dir, { recursive: true });
      this.size = fs.existsSync(this.file) ? fs.statSync(this.file).size : 0;
    } catch {
      /* logging must never break the app */
    }
  }

  write(event: string, detail?: string): void {
    const line = formatLine((this.opts.now ?? (() => new Date()))(), event, detail, this.opts.keepPrefix) + '\n';
    const bytes = Buffer.byteLength(line);
    if (this.stopped) return;
    try {
      if (this.size + bytes > (this.opts.maxBytes ?? MAX_LOG_BYTES)) this.rotate();
      if (this.stopped) return;
      fs.appendFileSync(this.file, line);
      this.size += bytes;
    } catch {
      /* ignore */
    }
  }

  private rotate(): void {
    const prev = this.file + '.1';
    try {
      fs.rmSync(prev, { force: true });
      fs.renameSync(this.file, prev);
      this.size = 0;
      return;
    } catch {
      /* a reader may hold the file: fall back to truncating it */
    }
    try {
      fs.writeFileSync(this.file, '');
      this.size = 0;
    } catch {
      this.stopped = true; /* cannot enforce the cap: stop writing */
    }
  }
}
