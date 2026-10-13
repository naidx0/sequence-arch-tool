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

export type UpdateAction = { kind: 'restart'; label: string } | { kind: 'update'; label: string } | { kind: 'release'; label: string; href: string } | { kind: 'check'; label: string } | { kind: 'none' };

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
  /** How the download went: differential or full, in the server's numbers. Null when the server says nothing. */
  detail?: string | null;
}

/** "Differential: 12 MB downloaded of 180 MB, reused 168 MB" or "Full download". The server's numbers only. */
export function downloadDetail(j: Pick<InstallJob, 'mode' | 'downloaded' | 'fullSize' | 'reused' | 'fallbackReason'>): string | null {
  if (j.mode === 'differential') {
    const got = typeof j.downloaded === 'number' ? `${formatBytes(j.downloaded)} downloaded` : 'Downloading only what changed';
    const of = typeof j.fullSize === 'number' && j.fullSize > 0 ? ` of ${formatBytes(j.fullSize)}` : '';
    const reused = typeof j.reused === 'number' && j.reused > 0 ? `, reused ${formatBytes(j.reused)}` : '';
    return `Differential update: ${got}${of}${reused}`;
  }
  if (j.mode === 'full') return j.fallbackReason ? `Full download (${j.fallbackReason})` : 'Full download';
  return null;
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

export interface DescribeOptions {
  /** The server did not answer the update check at all. */
  unreachable?: boolean;
  /** The Update click was not accepted; shown with a Retry. */
  startError?: string | null;
}

const pctOf = (received: number, total: number): string => `${Math.min(100, Math.floor((received / total) * 100))}%`;

export function describeUpdate(check: UpdateCheck | null, job: InstallJob | null, opts: DescribeOptions = {}): UpdateView {
  const j = job ?? { state: 'idle', received: 0, total: 0, error: null, howto: null, version: null, file: null };
  if (BUSY.has(j.state)) {
    const pct = j.total > 0 ? Math.min(1, j.received / j.total) : null;
    const word = j.state === 'downloading' ? 'Downloading' : j.state === 'verifying' ? 'Checking the download against the release checksums' : 'Starting the installer';
    return {
      title: `Updating to v${j.version ?? check?.latest?.version ?? ''}`.trim(),
      sub: j.state === 'downloading' && j.total > 0 ? `${word} ${pctOf(j.received, j.total)}, ${formatBytes(j.received)} of ${formatBytes(j.total)}` : word,
      action: { kind: 'none' },
      progress: j.state === 'downloading' ? pct : null,
      busy: true,
      error: null,
      howto: null,
      detail: downloadDetail(j),
    };
  }
  if (j.state === 'launched' && j.installMode === 'in-place') {
    return {
      title: `Version ${j.version ?? check?.latest?.version ?? ''} is ready`.trim(),
      sub: 'It installs when Sequence quits. Quit and reopen Sequence to finish, or keep working and it installs the next time you quit.',
      action: { kind: 'restart', label: 'Restart now' },
      progress: null,
      busy: false,
      error: null,
      howto: j.howto,
      detail: downloadDetail(j),
    };
  }
  if (j.state === 'launched') {
    return { title: `The installer for v${j.version ?? check?.latest?.version ?? ''} is running`, sub: j.howto ?? 'Follow the installer to finish.', action: { kind: 'none' }, progress: null, busy: false, error: null, howto: j.howto };
  }
  const failed = j.state === 'failed' || (opts.startError ?? null) !== null;
  const error = j.state === 'failed' ? (j.error ?? 'The update failed and the app gave no reason.') : (opts.startError ?? null);
  if (check?.newer && check.latest) {
    const v = check.latest.version;
    if (check.installable) {
      return {
        title: `Version ${v} is available`,
        sub: `You have v${check.current}. ${check.asset ? `${check.asset.name}, ${formatBytes(check.asset.size)}. It is checked against the release's checksums before it runs.` : 'It is checked against the release checksums before it runs.'}`,
        action: { kind: 'update', label: failed ? 'Retry' : `Update to v${v}` },
        progress: null,
        busy: false,
        error,
        howto: null,
      };
    }
    return {
      title: `Version ${v} is available`,
      sub:
        check.manual
          ? `You have v${check.current}. ${check.manual}`
          : check.desktop === false
          ? `You have v${check.current}. This copy of Sequence is not the installed app (it runs from source or the command line), so it does not update itself. Open the release page.`
          : `You have v${check.current}. This release has no installer we can check for this computer. Open its page to download one.`,
      action: { kind: 'release', label: 'Open release page', href: releaseHref(check.latest.htmlUrl) },
      progress: null,
      busy: false,
      error,
      howto: null,
    };
  }
  if (check === null) {
    const down = opts.unreachable === true;
    return {
      title: 'Updates',
      sub: down ? 'Could not check for updates.' : 'Checking for updates',
      action: down ? { kind: 'check', label: 'Retry' } : { kind: 'none' },
      progress: null,
      busy: !down,
      error: down ? 'Sequence did not answer the update check. Try again in a moment.' : error,
      howto: null,
    };
  }
  const upToDate = check.latest !== null && !check.newer;
  const stamp = check.checkDisabled ? `Automatic checks are off. Showing what was found ${check.checkedAt ? new Date(check.checkedAt).toLocaleDateString() : 'earlier'}` : check.checkedAt ? `Last checked ${new Date(check.checkedAt).toLocaleDateString()}` : 'Not checked yet';
  return {
    title: upToDate ? "You're up to date" : 'Updates',
    sub: check.offline
      ? check.latest
        ? `Could not reach GitHub just now, so this is the last answer. v${check.latest.version} is the latest it knows of. ${stamp}`
        : 'Could not reach GitHub just now. Sequence will try again later.'
      : upToDate
        ? `v${check.current} is the latest version. ${stamp}`
        : stamp,
    action: { kind: 'check', label: check.offline ? 'Retry' : 'Check now' },
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
  const clean = (s: string): string => s.replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/g, '$1').replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/`([^`]+)`/g, '$1').trim();
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

/** The two lines a collapsed note shows: its first heading and the bullet or line under it, or else its first two
    bullets (or lines). */
export function noteHighlight(blocks: NoteBlock[]): NoteBlock[] {
  const first = blocks[0];
  if (!first) return [];
  if (first.kind === 'h') {
    /* The line under the heading, only when it belongs to it; else the first heading that has content under it. */
    const under = blocks[1];
    if (under && under.kind !== 'h') return [first, under];
    for (let i = 1; i < blocks.length - 1; i++) {
      if (blocks[i]!.kind === 'h' && blocks[i + 1]!.kind !== 'h') return [blocks[i]!, blocks[i + 1]!];
    }
    return [first];
  }
  return blocks.filter((b) => b.kind !== 'h').slice(0, 2);
}

/** A server-given asset link is used only when it parses to this repo's release download path: the tag and the
    file name as exactly two segments after /releases/download/ (so `..` cannot walk out of the repo). */
function isOwnDownload(href: string): boolean {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.host !== 'github.com' || u.search || u.hash || u.username || u.password) return false;
  const prefix = `/${REPO}/releases/download/`;
  if (!u.pathname.startsWith(prefix)) return false;
  const rest = u.pathname.slice(prefix.length).split('/');
  return rest.length === 2 && rest.every((p) => p !== '' && p !== '.' && p !== '..');
}

/** The download link of this computer's installer, built from the release the check named. Null without both. */
export function assetHref(check: Pick<UpdateCheck, 'latest' | 'asset'> | null): string | null {
  if (!check?.latest || !check.asset) return null;
  const given = (check.asset as { url?: unknown }).url;
  if (typeof given === 'string' && isOwnDownload(given)) return given;
  return `https://github.com/${REPO}/releases/download/${encodeURIComponent(check.latest.tag)}/${encodeURIComponent(check.asset.name)}`;
}

/** The prompt "Ask the agent to help" puts in the composer when an update fails. Only text: nothing runs. */
export function updateHelpPrompt(error: string, check: UpdateCheck | null, job: InstallJob | null): string {
  const target = check?.latest?.version ?? job?.version ?? null;
  const lines = [
    `Sequence's update failed and I need help finishing it. Please work out what went wrong and get me onto ${target ? `v${target}` : 'the latest version'}.`,
    '',
    `What failed: ${error}`,
    `Installed version: ${check ? `v${check.current}` : 'unknown'}`,
    `Target version: ${target ? `v${target}` : 'unknown'}`,
    `Release page: ${releaseHref(check?.latest?.htmlUrl)}`,
  ];
  const asset = assetHref(check);
  if (asset) lines.push(`Download: ${asset}`);
  lines.push('', 'This is the open source GitHub release and its download. Search whatever you need, tell me what you find and do the steps for me where you can.');
  return lines.join(String.fromCharCode(10));
}
