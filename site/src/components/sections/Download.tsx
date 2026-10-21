import { useMemo } from 'react';
import {
  CHECKSUMS,
  INSTALLERS,
  PORTABLE_WINDOWS,
  NEXT_BUILDS_PUBLISHED,
  NEXT_VERSION,
  RELEASE_NOTES,
  RELEASE_TAG,
  RELEASE_URL,
  detectInstallerId,
} from '@/data/release';
import { AppleGlyph, WindowsGlyph } from '@/components/OsIcons';

function OsIcon({ id }: { id: (typeof INSTALLERS)[number]['id'] }) {
  if (id === 'windows') return <WindowsGlyph className="h-[1.05rem] w-[1.05rem] shrink-0" />;
  return <AppleGlyph className="h-[1.05rem] w-[1.05rem] shrink-0" />;
}

export function Download() {
  const preferred = useMemo(() => detectInstallerId(), []);
  const primary = INSTALLERS.find((i) => i.id === preferred) ?? INSTALLERS[0];

  return (
    <section
      id="download"
      className="atmosphere-graphite tile text-[color:var(--on-dark)]"
      aria-labelledby="download-title"
    >
      <div className="tile-inner text-center">
        {/* The app plate itself (docs/brand/marks/sequence-app-icon.svg, Decision 28):
            the thing that will sit in the dock, shown at the size it sits there. */}
        <img
          src="/sequence-app-icon.svg"
          alt=""
          aria-hidden="true"
          width={128}
          height={128}
          decoding="async"
          className="mx-auto mb-8 h-32 w-32 select-none drop-shadow-[0_18px_40px_rgba(0,0,0,0.45)]"
        />
        <p className="eyebrow text-[color:var(--on-dark-muted)]">Download</p>
        <h2 id="download-title" className="display-sm">
          One file. Then it runs.
        </h2>
        {/*
          ── REAL COPY, AND EVERY CLAUSE IS CHECKABLE ────────────────────────

          Owner, 2026-09-19: "update the website with real copy and working
          downloads that people don't need to have 20 different things
          downloaded for — one package on install which runs the program
          end to end."

          The old line was "Sequence is free for Windows and Mac, runs locally,
          and needs no account to start", which is true and says nothing about
          the thing a person is actually worried about before a 180 MB
          download: what ELSE will this make me install.

          The answer is nothing, and it is worth saying in those words. The
          installer carries its own Node runtime, the analyzer, the web app and
          the model plumbing — `electron-builder.yml` ships the whole server
          tree as `extraResources`, and `tools/desktop-zip-smoke.mjs` extracts
          that tree somewhere it was never built and runs it, which is what
          makes "end to end" a measurement rather than a promise.

          THE MODEL IS THE ONE HONEST ASTERISK. Scanning and diagrams need
          nothing. Chat needs a model, and the app will set up a local one in
          a click or take an API key — so the sentence says both rather than
          letting somebody find out after the download.
        */}
        <p className="mx-auto mt-4 max-w-[34rem] text-[19px] text-[color:var(--on-dark-muted)]">
          One installer, nothing else to set up. No Node, no Docker, no account. Scanning and
          diagrams work the moment it opens; for chat it will set up a model on your machine in
          one click, or take an API key if you would rather.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4">
          <a
            href={primary.href}
            className="pill-cta inline-flex items-center gap-2.5 !bg-white !text-[rgb(29,29,31)] !border-white/90 shadow-[0_10px_30px_rgba(0,0,0,0.35)] hover:!bg-[rgb(240,240,244)]"
          >
            <OsIcon id={primary.id} />
            Download for {primary.os}
          </a>
          <p className="text-[13px] text-[color:var(--on-dark-muted)]">
            {primary.file} · {primary.size} · version {RELEASE_TAG.replace(/^v/, '')}
          </p>
        </div>

        {/*
          THE OTHER PLATFORMS ARE A LINE, NOT THREE MORE CARDS.

          They were three buttons the same size as the one above, so the page
          asked every reader to choose between builds for operating systems
          they are not running. The detection already knows; the others are
          here for the person on a different machine to the one they are
          reading on, which is a link, not a decision.
        */}
        {!NEXT_BUILDS_PUBLISHED ? (
          <p className="mx-auto mt-3 max-w-[30rem] text-[13px] text-[color:var(--on-dark-muted)]">
            {NEXT_VERSION} builds are coming. This is the latest published release; everything on this
            page about {NEXT_VERSION} is in the source now.
          </p>
        ) : null}

        <p className="mt-8 text-[13px] text-[color:var(--on-dark-muted)]">
          Also for{' '}
          {INSTALLERS.filter((i) => i.id !== primary.id).map((i, index, rest) => (
            <span key={i.id}>
              <a
                href={i.href}
                className="text-[color:var(--on-dark)] underline underline-offset-4 decoration-white/40 hover:decoration-white"
              >
                {i.os}
              </a>
              {index < rest.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </p>

        {/*
          THE FIRST-RUN WARNING, SAID BEFORE THE OS SAYS IT.

          A friend of the owner's downloaded 0.1.0 on 2026-09-19 and reported
          the package as broken. The hosted file was then fetched and tested:
          187,852,868 bytes as published, an MZ header, and 7-Zip answering
          "Everything is Ok" over 17,001 files. The download was fine. What he
          met was an unsigned installer and an operating system that says so
          in language that sounds like damage.

          A page that ships an unsigned build and does not mention it has
          handed every reader that surprise. Two sentences is the cheapest fix
          in the product, and it is honest about why: there is no certificate,
          not that the warning is wrong.
        */}
        {/*
          ── THE macOS STEP CHANGED, AND OUR COPY WAS A YEAR OUT OF DATE ────

          This said "right-click the app and choose Open". That was the answer
          for a decade and it is WRONG on macOS 15: Sequoia removed the
          Control-click override from Gatekeeper on purpose, to stop exactly
          the trick that malware was using. The reader is now sent to System
          Settings instead, and an instruction that does not work is worse than
          none — it tells somebody the download is broken.

          Owner, 2026-09-20, on his own Mac: "I got 'Sequence Not Opened, move
          to trash or done, Apple could not verify that Sequence is free of
          malware'." That is the NOTARIZATION gate, not the signature one. The
          app IS signed — ad-hoc, verified in the release log — which is what
          stops the older "is damaged and can't be opened". Getting past this
          one needs an Apple Developer membership, which is a decision with a
          price, not a build flag.
        */}
        <p className="mx-auto mt-10 max-w-[32rem] text-[13px] leading-relaxed text-[color:var(--on-dark-muted)]">
          Sequence is not notarized with Apple yet, so the first launch needs one extra step.
          <br />
          <span className="text-[color:var(--on-dark)]">macOS:</span> open it, let it be refused,
          then go to{' '}
          <span className="text-[color:var(--on-dark)]">
            System Settings → Privacy &amp; Security
          </span>{' '}
          and press <span className="text-[color:var(--on-dark)]">Open Anyway</span>. (On macOS 15
          the old right-click → Open trick no longer works — Apple removed it.)
          <br />
          <span className="text-[color:var(--on-dark)]">Windows:</span> SmartScreen shows{' '}
          <span className="text-[color:var(--on-dark)]">More info → Run anyway</span>.
          <br />
          Nothing is wrong with the download — a developer certificate is simply not something this
          project has bought.
        </p>
        {/*
          THE PORTABLE BUILD AND THE MANIFEST, on one quiet line.

          Neither is for the reader who just wants the app - they are for the
          two people the installer fails: somebody on a machine they may not
          install software on, and somebody whose download was flagged and who
          now needs a way to tell a bad copy from a blocked one. 0.1.0 had
          neither, which is why "the package is broken" could not be answered.
        */}
        <p className="mx-auto mt-6 max-w-[30rem] text-[13px] text-[color:var(--on-dark-muted)]">
          On Windows you can also{' '}
          <a
            href={PORTABLE_WINDOWS.href}
            className="text-[color:var(--on-dark)] underline underline-offset-4 decoration-white/40 hover:decoration-white"
          >
            take the portable zip
          </a>{' '}
          ({PORTABLE_WINDOWS.size}) and run it from any folder, with nothing installed. Every
          release ships{' '}
          <a
            href={CHECKSUMS.href}
            className="text-[color:var(--on-dark)] underline underline-offset-4 decoration-white/40 hover:decoration-white"
          >
            {CHECKSUMS.file}
          </a>{' '}
          so you can check the file you got is the file we built.
        </p>
        <details className="mx-auto mt-8 max-w-[34rem] text-left text-[13px] text-[color:var(--on-dark-muted)]">
          <summary className="cursor-pointer text-center text-[color:var(--on-dark)]">
            Release notes, {NEXT_VERSION}
          </summary>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            {RELEASE_NOTES.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
        <p className="mt-6 text-[13px]">
          <a href={RELEASE_URL} className="text-[color:var(--on-dark)] underline underline-offset-4 decoration-white/40 hover:decoration-white">
            All releases on GitHub
          </a>
        </p>
      </div>
    </section>
  );
}
