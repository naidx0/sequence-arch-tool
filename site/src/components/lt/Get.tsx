import { useMemo, type ReactElement } from 'react';
import { siLinux } from 'simple-icons';
import { AppleGlyph, WindowsGlyph } from '@/components/OsIcons';
import { MacAgent } from '@/components/lt/MacAgent';
import { PUBLIC_MIRROR } from '@/data/content';
import { CHECKSUMS, INSTALLERS, LINUX_DEB, PORTABLE_WINDOWS, NEXT_BUILDS_PUBLISHED, NEXT_VERSION, RELEASE_URL, VERSION, detectInstallerId, installerHref, type Installer } from '@/data/release';

/**
 * THE DOWNLOAD (owner, 2026-10-10: "add easier icons… Mac, Apple Silicon. We
 * don't need Mac Intel… very quick setup"). Three OS buttons with their marks,
 * the one this machine runs lit; three setup steps; open source under MIT.
 * Every file and size comes from release.ts. A build that is not attached yet
 * opens the release page and says so, so no button can 404.
 */
function LinuxGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d={siLinux.path} fill="currentColor" />
    </svg>
  );
}

const GLYPH: Record<Installer['id'], (p: { className?: string }) => ReactElement> = {
  windows: WindowsGlyph,
  'mac-arm': AppleGlyph,
  linux: LinuxGlyph,
};
const SUB: Record<Installer['id'], string> = {
  windows: 'Installer',
  'mac-arm': 'Apple silicon',
  linux: 'AppImage',
};

const SETUP = [
  { n: '1', title: 'Download', body: 'One file for your system. No Node, no Docker, no account.' },
  { n: '2', title: 'Open it', body: 'Not signed yet, so the first launch asks once. Windows: More info, Run anyway. macOS: System Settings, Privacy & Security, Open Anyway.' },
  { n: '3', title: 'Pick a folder', body: 'Sequence maps it on your machine. Add a local model or a key to chat.' },
] as const;

export function Get() {
  const mine = useMemo(() => detectInstallerId(), []);

  return (
    <section id="download" className="lt-section lt-band" aria-labelledby="download-title">
      <div className="lt-wrap text-center">
        <img
          src="/sequence-app-icon.svg"
          alt=""
          aria-hidden="true"
          width={88}
          height={88}
          loading="lazy"
          decoding="async"
          className="mx-auto mb-8 h-[88px] w-[88px] select-none drop-shadow-[0_18px_34px_rgba(11,12,14,0.22)]"
        />
        <h2 id="download-title" className="lt-h2">
          Download Sequence
        </h2>
        <p className="lt-lede mx-auto mt-5 max-w-[34rem]">
          Version {VERSION} is the full public release. Free and open source.
          {NEXT_BUILDS_PUBLISHED ? null : ` This page shows ${NEXT_VERSION}; its installers are not published yet, so these downloads are ${VERSION}.`}
        </p>

        <ul className="lt-os">
          {INSTALLERS.map((i) => {
            const Glyph = GLYPH[i.id];
            const lit = i.id === mine;
            return (
              <li key={i.id}>
                <a href={installerHref(i)} className={`lt-os-btn ${lit ? 'is-lit' : ''}`} aria-label={i.ready ? `Download for ${i.os}, ${i.size}` : `${i.os}: build coming, open the release page`}>
                  <Glyph className="lt-os-glyph" />
                  <span className="lt-os-name">{i.short}</span>
                  <span className="lt-os-sub">{SUB[i.id]}</span>
                  <span className="lt-os-meta">{i.ready ? i.size : 'Build coming soon'}</span>
                </a>
              </li>
            );
          })}
        </ul>
        <p className="lt-note mt-5">
          Also:{' '}
          <a href={PORTABLE_WINDOWS.href} className="lt-link">
            Windows portable zip
          </a>{' '}
          ·{' '}
          <a href={LINUX_DEB.href} className="lt-link">
            Linux .deb
          </a>{' '}
          ·{' '}
          <a href={CHECKSUMS.href} className="lt-link">
            checksums
          </a>{' '}
          ·{' '}
          <a href={RELEASE_URL} className="lt-link">
            all releases
          </a>
        </p>

        <MacAgent open={mine === 'mac-arm'} />

        <ol className="lt-setup">
          {SETUP.map((s) => (
            <li key={s.n} className="lt-glass">
              <span className="lt-step-n">{s.n}</span>
              <p className="lt-setup-title">{s.title}</p>
              <p className="lt-setup-body">{s.body}</p>
            </li>
          ))}
        </ol>

        <p className="lt-oss">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"
            />
          </svg>
          Open source under the MIT licence.{' '}
          <a href={PUBLIC_MIRROR} className="lt-link">
            Get the code on GitHub
          </a>{' '}
          and use it however you like.
        </p>
      </div>
    </section>
  );
}
