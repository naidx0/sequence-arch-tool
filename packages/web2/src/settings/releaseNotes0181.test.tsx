import { readFileSync } from 'node:fs';
import path from 'node:path';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { VersionSection } from './VersionSection';
import type { InstallJob, VersionClient } from './versionClient';
import { releaseNotesUrl } from './versionModel';

/*
 * 0.1.8.1 D1 (audit P2-8: "CHANGELOG link 404s"). The notes link in Settings opens the version's GitHub release page,
 * the URL the site uses too (site/src/data/release.ts), checked live to answer 200 for v0.1.8 on 2026-10-14. And the
 * repository has a CHANGELOG.md.
 */

afterEach(cleanup);

const IDLE: InstallJob = { state: 'idle', version: null, received: 0, total: 0, error: null, howto: null, file: null };
const client = (): VersionClient => ({
  version: async () => ({ version: '0.1.8', commit: 'fe705ddb', platform: 'win32', arch: 'x64', desktop: true }),
  update: async () => null,
  install: async () => IDLE,
  releases: async () => [
    { version: '0.1.8', title: 'Sequence 0.1.8', body: '## Highlights\n\n- Spaces' },
    { version: '0.1.7', title: 'Sequence 0.1.7', body: '- Older' },
  ],
});

describe('release notes link (D1)', () => {
  it('builds the GitHub release page of the version tag', () => {
    expect(releaseNotesUrl('0.1.8')).toBe('https://github.com/naidx0/sequence-arch-tool/releases/tag/v0.1.8');
    expect(releaseNotesUrl('v0.1.8')).toBe('https://github.com/naidx0/sequence-arch-tool/releases/tag/v0.1.8');
    expect(releaseNotesUrl('0.1.8.1')).toBe('https://github.com/naidx0/sequence-arch-tool/releases/tag/v0.1.8.1');
    expect(releaseNotesUrl('not a version')).toBe('https://github.com/naidx0/sequence-arch-tool/releases');
    expect(releaseNotesUrl(null)).toBe('https://github.com/naidx0/sequence-arch-tool/releases');
  });

  it('is the same URL the site links as "Full release notes"', () => {
    const site = readFileSync(path.join(__dirname, '../../../../site/src/data/release.ts'), 'utf8');
    expect(site).toMatch(/PUBLIC_REPO = 'https:\/\/github\.com\/naidx0\/sequence-arch-tool'/);
    expect(site).toMatch(/RELEASE_URL = `\$\{PUBLIC_REPO\}\/releases\/tag\/\$\{RELEASE_TAG\}`/);
  });

  it('each What\'s new entry in Settings links its release notes', async () => {
    render(<VersionSection client={client()} />);
    await waitFor(() => expect(screen.getAllByTestId('settings-whatsnew-notes-link')).toHaveLength(2));
    const hrefs = screen.getAllByTestId('settings-whatsnew-notes-link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      'https://github.com/naidx0/sequence-arch-tool/releases/tag/v0.1.8',
      'https://github.com/naidx0/sequence-arch-tool/releases/tag/v0.1.7',
    ]);
    for (const a of screen.getAllByTestId('settings-whatsnew-notes-link')) {
      expect(a.getAttribute('target')).toBe('_blank');
      /* Review N5: the control a reader knows as "Read more" is the one that opens the notes. */
      expect(a.textContent).toBe('Read more');
      expect(a.tagName).toBe('A');
    }
  });

  it('the repository has a CHANGELOG.md with 0.1.8 and the released 0.1.8.1', () => {
    const log = readFileSync(path.join(__dirname, '../../../../CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
    expect(log).toMatch(/^# Changelog/m);
    expect(log).toMatch(/^## 0\.1\.8\.2$/m);
    expect(log).toMatch(/^## 0\.1\.8\.1$/m);
    expect(log).toMatch(/^## 0\.1\.8$/m);
    expect(log.indexOf('## 0.1.8.2')).toBeLessThan(log.indexOf('## 0.1.8.1'));
    expect(log.indexOf('## 0.1.8.1')).toBeLessThan(log.indexOf('## 0.1.8\n'));
  });
});

describe('release notes actions use the kit button, not underlined links (sweep, item 5)', () => {
  it('Show all and Read more are quiet pills in one actions row', async () => {
    render(<VersionSection client={client()} />);
    const links = await screen.findAllByTestId('settings-whatsnew-notes-link');
    for (const a of links) {
      expect(a.className).toContain('sb-pill');
      expect(a.className).not.toContain('sb-link');
      expect(a.parentElement!.className).toBe('sb-news-acts');
    }
  });
});
