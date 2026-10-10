/* ══════════════════════════════════════════════════════════════════════════
   SETTINGS > GENERAL > VERSION AND UPDATES (G7, 0.1.5)
   packages/web2/src/settings/VersionSection.tsx

   Owner, 2026-10-10: the running version and build in Settings with a copy
   button, a one-click update, and the version history.

     This build   "Sequence 0.1.4", the commit it was built from and the OS,
                  and Copy (one line for a bug report).
     Updates      asked on opening Settings (the server answers from a day's
                  cache and asks GitHub at most once a day). Newer: "Update to
                  vX" downloads this OS's installer, checks it against the
                  release's SHASUMS256.txt and runs it, and only on this click.
                  Offline says nothing worse than "could not reach GitHub".
     What's new   the release notes bundled with the app, newest first.

   The page talks to its own server only (versionClient.ts); the server is the
   one that reaches GitHub. Buttons are the settings kit's (.sb-pill).
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react';

import { copyText, describeUpdate, noteBlocks, platformLabel } from './versionModel';
import { createVersionClient, type InstallJob, type ReleaseNote, type UpdateCheck, type VersionClient, type VersionInfo } from './versionClient';

const POLL_MS = 700;

export function VersionSection({ client }: { client?: VersionClient }) {
  const api = useRef<VersionClient>(client ?? createVersionClient());
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [job, setJob] = useState<InstallJob | null>(null);
  const [notes, setNotes] = useState<ReleaseNote[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const [checking, setChecking] = useState(false);

  /** Ask the server; answers the install job's state, or null when it did not answer. */
  const refresh = useCallback(async (force: boolean): Promise<InstallJob['state'] | null> => {
    setChecking(true);
    const snap = await api.current.update(force);
    setChecking(false);
    if (!snap) return null;
    setCheck(snap.check);
    setJob(snap.install);
    return snap.install.state;
  }, []);

  useEffect(() => {
    let live = true;
    void api.current.version().then((v) => live && setVersion(v));
    void api.current.releases().then((n) => {
      if (!live) return;
      setNotes(n);
      setOpen((o) => o ?? n[0]?.version ?? null);
    });
    void refresh(false);
    return () => {
      live = false;
    };
  }, [refresh]);

  const running = job !== null && (job.state === 'downloading' || job.state === 'verifying' || job.state === 'launching');
  /* Set by the Update click: poll until the server reports the job running and then ending, so a failure
     that lands after the POST answered (or a POST that answered idle) is still shown. */
  const [following, setFollowing] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  useEffect(() => {
    if (!running && !following) return undefined;
    const id = setInterval(() => {
      void refresh(false).then((state) => {
        if (state && state !== 'downloading' && state !== 'verifying' && state !== 'launching') setFollowing(false);
      });
    }, POLL_MS);
    return () => clearInterval(id);
  }, [running, following, refresh]);

  useEffect(() => {
    if (copied === 'idle') return undefined;
    const id = setTimeout(() => setCopied('idle'), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  const view = describeUpdate(check, job);
  const error = view.error ?? startError;
  const onAction = (): void => {
    if (view.action.kind === 'update' && check?.latest) {
      setStartError(null);
      void api.current.install(check.latest.version).then((j) => {
        if (!j) {
          setStartError('Could not start the update: the app did not accept the request. Try again, or open the release page.');
          return;
        }
        setJob(j);
        setFollowing(true);
      });
    } else if (view.action.kind === 'check') {
      void refresh(true);
    }
  };
  const copy = (): void => {
    if (!version) return;
    const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clip?.writeText) {
      setCopied('failed');
      return;
    }
    void clip.writeText(copyText(version)).then(
      () => setCopied('done'),
      () => setCopied('failed'),
    );
  };

  return (
    <section className="sb-group" data-testid="settings-version">
      <h3 className="sb-lab">Version and updates</h3>
      <div className="sb-card">
        <div className="sb-row sb-row-act" data-testid="settings-version-build">
          <span className="sb-row-txt">
            <span className="sb-row-t" data-testid="settings-version-number">
              {version ? `Sequence ${version.version}` : 'Sequence'}
            </span>
            <span className="sb-row-sub" data-testid="settings-version-detail">
              {version ? `${version.commit ? `Build ${version.commit}, ` : ''}${platformLabel(version)}` : 'Version not reported'}
            </span>
          </span>
          <button type="button" className="sb-pill" data-testid="settings-version-copy" disabled={!version} onClick={copy}>
            {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy'}
          </button>
        </div>

        <div className="sb-row sb-row-act" data-testid="settings-update-row" data-busy={view.busy || undefined}>
          <span className="sb-row-txt">
            <span className="sb-row-t" data-testid="settings-update-title">
              {view.title}
            </span>
            <span className="sb-row-sub" data-testid="settings-update-sub" role="status">
              {view.sub}
            </span>
            {view.progress !== null ? <progress className="sb-update-bar" data-testid="settings-update-progress" max={1} value={view.progress} aria-label="Download progress" /> : null}
          </span>
          {view.action.kind === 'update' ? (
            <button type="button" className="sb-pill sb-pill-solid" data-testid="settings-update-go" onClick={onAction}>
              {view.action.label}
            </button>
          ) : view.action.kind === 'release' ? (
            <a className="sb-pill" data-testid="settings-update-release" href={view.action.href} target="_blank" rel="noreferrer noopener">
              {view.action.label}
            </a>
          ) : view.action.kind === 'check' ? (
            <button type="button" className="sb-pill" data-testid="settings-update-check" disabled={checking} onClick={onAction}>
              {checking ? 'Checking' : view.action.label}
            </button>
          ) : null}
        </div>
        {error ? (
          <p className="sb-fail" data-testid="settings-update-error" role="alert">
            {error}
          </p>
        ) : null}

        {notes.length > 0 ? (
          <div className="sb-news" data-testid="settings-whatsnew">
            <h4 className="sb-news-h">What's new</h4>
            {notes.map((n) => {
              const on = open === n.version;
              return (
                <div key={n.version} className="sb-news-item" data-testid="settings-whatsnew-item" data-version={n.version}>
                  <button type="button" className="sb-disclosure" aria-expanded={on} onClick={() => setOpen(on ? null : n.version)}>
                    <span className="sb-news-v">{n.title}</span>
                  </button>
                  {on ? (
                    <div className="sb-news-body">
                      {noteBlocks(n.body).map((b, i) =>
                        b.kind === 'h' ? (
                          <h5 key={i} className="sb-news-sub">
                            {b.text}
                          </h5>
                        ) : b.kind === 'li' ? (
                          <p key={i} className="sb-news-li">
                            {b.text}
                          </p>
                        ) : (
                          <p key={i} className="sb-news-p">
                            {b.text}
                          </p>
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
