/* ══════════════════════════════════════════════════════════════════════════
   WHAT THE VERSION SECTION SAYS
   packages/web2/src/settings/versionModel.ts

   Pure: the server's version, update check and install job in, the words and
   the one action out. No React.
   ══════════════════════════════════════════════════════════════════════════ */

import type { InstallJob, UpdateCheck, VersionInfo } from './versionClient';

const OS_NAME: Record<string, string> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };

export function platformLabel(v: Pick<VersionInfo, 'platform' | 'arch'>): string {
  return `${OS_NAME[v.platform] ?? v.platform} ${v.arch}`;
}

/** The line a person pastes into a bug report. */
export function copyText(v: VersionInfo): string {
  return `Sequence ${v.version}${v.commit ? ` (${v.commit})` : ''}, ${platformLabel(v)}`;
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

export type UpdateAction = { kind: 'update'; label: string } | { kind: 'release'; label: string; href: string } | { kind: 'check'; label: string } | { kind: 'none' };

export interface UpdateView {
  /** The row's title. */
  title: string;
  /** The line under it. */
  sub: string;
  action: UpdateAction;
  /** 0 to 1 while a download runs, else null. */
  progress: number | null;
  busy: boolean;
  /** The failure in plain words. */
  error: string | null;
  /** What to do to finish, after the installer has been started. */
  howto: string | null;
}

const BUSY = new Set(['downloading', 'verifying', 'launching']);

const REPO = 'naidx0/sequence-arch-tool';

/** The release page link, only when it is a page of this repo on github.com over https; else the repo's releases page. */
export function releaseHref(htmlUrl: string | null | undefined): string {
  const fallback = `https://github.com/${REPO}/releases`;
  if (!htmlUrl) return fallback;
  try {
    const u = new URL(htmlUrl);
    const ok = u.protocol === 'https:' && !u.username && !u.password && !u.port && u.hostname === 'github.com' && (u.pathname === `/${REPO}` || u.pathname.startsWith(`/${REPO}/`));
    return ok ? u.href : fallback;
  } catch {
    return fallback;
  }
}

export function describeUpdate(check: UpdateCheck | null, job: InstallJob | null): UpdateView {
  const j = job ?? { state: 'idle', received: 0, total: 0, error: null, howto: null, version: null, file: null };
  if (BUSY.has(j.state)) {
    const pct = j.total > 0 ? Math.min(1, j.received / j.total) : null;
    const word = j.state === 'downloading' ? 'Downloading' : j.state === 'verifying' ? 'Checking the download' : 'Starting the installer';
    return {
      title: `Updating to v${j.version ?? check?.latest?.version ?? ''}`.trim(),
      sub: j.state === 'downloading' && j.total > 0 ? `${word}, ${formatBytes(j.received)} of ${formatBytes(j.total)}` : word,
      action: { kind: 'none' },
      progress: j.state === 'downloading' ? pct : null,
      busy: true,
      error: null,
      howto: null,
    };
  }
  if (j.state === 'launched') {
    return { title: `The installer for v${j.version ?? check?.latest?.version ?? ''} is running`, sub: j.howto ?? 'Follow the installer to finish.', action: { kind: 'none' }, progress: null, busy: false, error: null, howto: j.howto };
  }
  const error = j.state === 'failed' ? j.error : null;
  if (check?.newer && check.latest) {
    const v = check.latest.version;
    if (check.installable) {
      return {
        title: `Version ${v} is available`,
        sub: check.asset ? `${check.asset.name}, ${formatBytes(check.asset.size)}. It is checked against the release's checksums before it runs.` : 'Checked against the release checksums before it runs.',
        action: { kind: 'update', label: `Update to v${v}` },
        progress: null,
        busy: false,
        error,
        howto: null,
      };
    }
    return {
      title: `Version ${v} is available`,
      sub:
        check.desktop === false
          ? 'This copy of Sequence is not the installed app (it runs from source or the command line), so it does not update itself. Open the release page.'
          : 'This release has no installer we can check for this computer. Open its page to download one.',
      action: { kind: 'release', label: 'Open release page', href: releaseHref(check.latest.htmlUrl) },
      progress: null,
      busy: false,
      error,
      howto: null,
    };
  }
  return {
    title: check?.latest ? 'You are on the latest version' : 'Updates',
    sub: check === null ? 'Checking for updates' : check.offline && !check.latest ? 'Could not reach GitHub just now. Sequence will try again later.' : check.checkedAt ? `Last checked ${new Date(check.checkedAt).toLocaleDateString()}` : 'Not checked yet',
    action: { kind: 'check', label: 'Check now' },
    progress: null,
    busy: false,
    error,
    howto: null,
  };
}

export interface NoteBlock {
  kind: 'h' | 'p' | 'li';
  text: string;
}

/** A release note's markdown as headings, paragraphs and list items; links and emphasis lose their marks. */
export function noteBlocks(body: string): NoteBlock[] {
  const out: NoteBlock[] = [];
  const clean = (s: string): string => s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/`([^`]+)`/g, '$1').trim();
  for (const raw of body.split('\n')) {
    const l = raw.trimEnd();
    if (!l.trim()) continue;
    const h = /^#{2,6}\s+(.*)$/.exec(l);
    if (h) out.push({ kind: 'h', text: clean(h[1]!) });
    else if (/^\s*[-*]\s+/.test(l)) out.push({ kind: 'li', text: clean(l.replace(/^\s*[-*]\s+/, '')) });
    else out.push({ kind: 'p', text: clean(l) });
  }
  return out;
}
