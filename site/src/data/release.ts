/**
 * Single source for installer URLs + sizes. site-links CI reads these strings.
 *
 * ── ONE VERSION, WRITTEN ONCE ─────────────────────────────────────────────
 *
 * `RELEASE_TAG` used to be the only thing derived and every filename spelled
 * `0.1.0` by hand, in six places, with a CI gate that spelled it a seventh
 * time. Cutting 0.1.1 meant finding all seven, and a release where one of them
 * was missed is a download button that 404s — the failure a reader cannot tell
 * from "the project is dead".
 *
 * So the version is a constant and every name is built from it. The gate reads
 * these exports rather than matching literals, which is why it can no longer
 * rot a release behind.
 */
export const PUBLIC_REPO = 'https://github.com/naidx0/sequence-arch-tool';
export const VERSION = '0.1.8.4';
/**
 * THE VERSION IN THE FILE NAMES. electron-builder refuses a four-part
 * package.json version, so a 0.1.8.1 release ships files named 0.1.8 (the
 * app, the tag and the notes say 0.1.8.1). Equal to VERSION for a
 * three-part release.
 */
export const FILE_VERSION = '0.1.8.4';
export const RELEASE_TAG = `v${VERSION}`;
export const RELEASE_URL = `${PUBLIC_REPO}/releases/tag/${RELEASE_TAG}`;

/**
 * THE VERSION THE PAGE DESCRIBES, which is ahead of the one it can download.
 *
 * 0.1.4 is merged and gated but its installers are not built or published yet,
 * so every download link above stays on `VERSION` (a release that exists) and
 * the page says so in words. When the 0.1.4 assets are attached: set VERSION to
 * '0.1.4', update the sizes below from the published assets, and set
 * `NEXT_BUILDS_PUBLISHED` to true. Nothing else on the page needs to change.
 */
export const NEXT_VERSION = '0.1.8.4';
export const NEXT_BUILDS_PUBLISHED = (VERSION as string) === NEXT_VERSION;

/** Short notes for the release, in the order a person meets them. */
export const RELEASE_NOTES = [
  'A new sidebar: Workflows, Components, Profiles and Skills open as views, with hover cards that preview an item and launch a workflow.',
  'Spaces are per chat, and a workflow you launch is watched live on the Agents surface.',
  'The chat overview and file buttons float over the pane; Focused or Detailed tool calls is one control in Settings.',
  'Coming back to the Architecture tab no longer shows the cards jumping: 12 arrangements before the final one are now 0, and 446 ms to settle is now 99 ms.',
  'The desktop app starts its engine before it builds the window and no longer waits for the first project read.',
  'Stop closes the provider connection on Node 20 and 22 as well as 24.',
  'Accessibility: the board tab strip holds only tabs, the status bar is a status region, and the open drawer stacks above the board dock.',
] as const;

/**
 * GitHub rewrites spaces in an asset name to dots in the download URL, which is
 * why the Windows file and its href differ by two characters. Both are real and
 * neither is a typo.
 */
const asset = (name: string) =>
  `${PUBLIC_REPO}/releases/download/${RELEASE_TAG}/${name.replace(/ /g, '.')}`;

export type Installer = {
  id: 'windows' | 'mac-arm' | 'linux';
  os: string;
  /** The short name on the OS button. */
  short: string;
  file: string;
  /**
   * READ OFF THE PUBLISHED ASSET, not off a local build.
   *
   * These were estimates until v0.1.1 shipped and the GitHub API was asked
   * what it was actually serving; a size that is a guess is the one number on
   * a download page a reader can catch us being wrong about, because their
   * browser tells them the real one while the file arrives.
   */
  size: string;
  href: string;
  /**
   * False while the asset is not attached to the release yet: the button then
   * opens the release page instead of a file that would 404 (all three 0.1.4
   * builds are attached, 2026-10-10).
   */
  ready: boolean;
};

/**
 * 0.1.8.4 sizes read off the built files (2026-10-21), decimal megabytes.
 * The Intel Mac files are on the release but not offered (owner, 2026-10-10).
 */
export const INSTALLERS: Installer[] = [
  {
    id: 'windows',
    os: 'Windows',
    short: 'Windows',
    file: `Sequence Setup ${FILE_VERSION}.exe`,
    size: '126 MB',
    href: asset(`Sequence Setup ${FILE_VERSION}.exe`),
    ready: true,
  },
  {
    id: 'mac-arm',
    os: 'macOS · Apple silicon',
    short: 'macOS',
    file: `Sequence-${FILE_VERSION}-arm64.dmg`,
    size: '130 MB',
    href: asset(`Sequence-${FILE_VERSION}-arm64.dmg`),
    ready: true,
  },
  {
    id: 'linux',
    os: 'Linux · AppImage',
    short: 'Linux',
    file: `Sequence-${FILE_VERSION}.AppImage`,
    size: '128 MB',
    href: asset(`Sequence-${FILE_VERSION}.AppImage`),
    ready: true,
  },
];

/** Where a button points: the file when it is attached, the release page until then. */
export const installerHref = (i: Installer) => (i.ready ? i.href : RELEASE_URL);

/** The Debian package, a second Linux row beside the AppImage. */
export const LINUX_DEB = {
  file: `Sequence-${FILE_VERSION}-amd64.deb`,
  size: '107 MB',
  href: asset(`Sequence-${FILE_VERSION}-amd64.deb`),
};

/**
 * THE PORTABLE WINDOWS BUILD, for the machine a person may not install on.
 *
 * It is a second row on the page and not a fourth button: the installer is the
 * answer for almost everybody, and this is the answer for a work laptop, a USB
 * stick, or somebody who met SmartScreen and would rather not argue with it.
 */
export const PORTABLE_WINDOWS = {
  file: `Sequence-${FILE_VERSION}-win.zip`,
  size: '158 MB',
  href: asset(`Sequence-${FILE_VERSION}-win.zip`),
};

/** Every release carries one, generated over the artefacts that were attached. */
export const CHECKSUMS = {
  file: 'SHASUMS256.txt',
  href: asset('SHASUMS256.txt'),
};

export function detectInstallerId(): Installer['id'] {
  if (typeof navigator === 'undefined') return 'windows';
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac/i.test(ua)) return 'mac-arm';
  if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) return 'linux';
  return 'windows';
}
