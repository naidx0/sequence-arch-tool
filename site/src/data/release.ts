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
export const VERSION = '0.1.3';
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
export const NEXT_VERSION = '0.1.4';
export const NEXT_BUILDS_PUBLISHED = (VERSION as string) === NEXT_VERSION;

/** Short notes for the release, in the order a person meets them. */
export const RELEASE_NOTES = [
  'Workspaces tree: chats under each workspace, and New chat lands in the open one.',
  'Whiteboard: select and drag by default; ask for a diagram and it lays itself out.',
  'Ask in place: point at a box on the whiteboard or the map and ask about exactly that.',
  'Architecture board with one view menu; Files with a one-line breadcrumb and rendered Markdown; a one-line terminal prompt.',
  'Reasoning slider; Agents show Context and Output as reported.',
  'Claude sets itself up from an 8.2 MB download; restart and continue; import old Claude Code and Codex chats.',
  'Edit from here, several agents at once with compare and merge, open a pull request.',
  'Drawings and chart cards inline in chat.',
] as const;

/**
 * GitHub rewrites spaces in an asset name to dots in the download URL, which is
 * why the Windows file and its href differ by two characters. Both are real and
 * neither is a typo.
 */
const asset = (name: string) =>
  `${PUBLIC_REPO}/releases/download/${RELEASE_TAG}/${name.replace(/ /g, '.')}`;

export type Installer = {
  id: 'windows' | 'mac-arm' | 'mac-intel';
  os: string;
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
};

export const INSTALLERS: Installer[] = [
  {
    id: 'windows',
    os: 'Windows',
    file: `Sequence Setup ${VERSION}.exe`,
    size: '102 MB',
    href: asset(`Sequence Setup ${VERSION}.exe`),
  },
  {
    id: 'mac-arm',
    os: 'Mac · Apple silicon',
    file: `Sequence-${VERSION}-arm64.dmg`,
    size: '123 MB',
    href: asset(`Sequence-${VERSION}-arm64.dmg`),
  },
  {
    id: 'mac-intel',
    os: 'Mac · Intel',
    file: `Sequence-${VERSION}.dmg`,
    size: '130 MB',
    href: asset(`Sequence-${VERSION}.dmg`),
  },
];

/**
 * THE PORTABLE WINDOWS BUILD, for the machine a person may not install on.
 *
 * It is a second row on the page and not a fourth button: the installer is the
 * answer for almost everybody, and this is the answer for a work laptop, a USB
 * stick, or somebody who met SmartScreen and would rather not argue with it.
 */
export const PORTABLE_WINDOWS = {
  file: `Sequence-${VERSION}-win.zip`,
  size: '137 MB',
  href: asset(`Sequence-${VERSION}-win.zip`),
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
  if (/Mac/i.test(ua)) {
    if (/Intel/i.test(ua) && !/arm|aarch64/i.test(ua)) return 'mac-intel';
    return 'mac-arm';
  }
  return 'windows';
}
