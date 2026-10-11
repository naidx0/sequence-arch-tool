import { useMemo } from 'react';
import { AppleGlyph, WindowsGlyph } from '@/components/OsIcons';
import {
  CHECKSUMS,
  INSTALLERS,
  NEXT_BUILDS_PUBLISHED,
  NEXT_VERSION,
  PORTABLE_WINDOWS,
  RELEASE_NOTES,
  RELEASE_TAG,
  RELEASE_URL,
  detectInstallerId,
} from '@/data/release';

/** The download, from release.ts only. Same facts as Download.tsx, shorter. */
export function Get() {
  const primary = useMemo(() => {
    const id = detectInstallerId();
    return INSTALLERS.find((i) => i.id === id) ?? INSTALLERS[0]!;
  }, []);
  const Glyph = primary.id === 'windows' ? WindowsGlyph : AppleGlyph;
  const others = INSTALLERS.filter((i) => i.id !== primary.id);

  return (
    <section id="download" className="cx-section cx-rule" aria-labelledby="download-title">
      <div className="cx-wrap text-center">
        <img
          src="/sequence-app-icon.svg"
          alt=""
          aria-hidden="true"
          width={96}
          height={96}
          loading="lazy"
          decoding="async"
          className="mx-auto mb-8 h-24 w-24 select-none drop-shadow-[0_18px_40px_rgba(0,0,0,0.5)]"
        />
        <h2 id="download-title" className="cx-h2">
          Download Sequence
        </h2>
        <p className="cx-lede mx-auto mt-4 max-w-[34rem]">
          One installer, nothing else to set up. No Node, no Docker, no account. Scanning and diagrams work offline; chat
          uses a local model or your API key.
        </p>
        <div className="mt-9 flex flex-col items-center gap-3">
          <a href={primary.href} className="cx-btn cx-btn-primary !min-h-[50px] !px-7 !text-[16px]">
            <Glyph className="h-[18px] w-[18px]" />
            Download for {primary.os}
          </a>
          <p className="cx-note">
            {primary.file} · {primary.size} · version {RELEASE_TAG.replace(/^v/, '')}
          </p>
          {!NEXT_BUILDS_PUBLISHED ? (
            <p className="cx-note max-w-[30rem]">
              {NEXT_VERSION} builds are coming. This is the latest published release; everything on this page about{' '}
              {NEXT_VERSION} is in the source now.
            </p>
          ) : null}
          <p className="cx-note mt-3">
            Also for{' '}
            {others.map((i, n) => (
              <span key={i.id}>
                <a href={i.href} className="cx-link">
                  {i.os}
                </a>
                {n < others.length - 1 ? ' · ' : ''}
              </span>
            ))}{' '}
            ·{' '}
            <a href={PORTABLE_WINDOWS.href} className="cx-link">
              Windows portable zip
            </a>{' '}
            ({PORTABLE_WINDOWS.size})
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-[46rem] gap-4 text-left sm:grid-cols-2">
          <div className="cx-panel p-5">
            <p className="text-[14px] font-semibold">First launch on macOS</p>
            <p className="cx-note mt-2">
              The app is not notarized yet. Open it, let it be refused, then press Open Anyway in System Settings →
              Privacy &amp; Security. On macOS 15 right-click → Open no longer works.
            </p>
          </div>
          <div className="cx-panel p-5">
            <p className="text-[14px] font-semibold">First launch on Windows</p>
            <p className="cx-note mt-2">
              The installer is not code-signed, so SmartScreen asks. Choose More info → Run anyway. Check the file
              against{' '}
              <a href={CHECKSUMS.href} className="cx-link">
                {CHECKSUMS.file}
              </a>
              .
            </p>
          </div>
        </div>

        <details className="mx-auto mt-8 max-w-[34rem] text-left text-[13.5px] text-[color:var(--on-dark-muted)]">
          <summary className="cursor-pointer text-center text-[color:var(--on-dark)]">Release notes, {NEXT_VERSION}</summary>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            {RELEASE_NOTES.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
        <p className="mt-5 text-[13.5px]">
          <a href={RELEASE_URL} className="cx-link">
            All releases on GitHub
          </a>
        </p>
      </div>
    </section>
  );
}
