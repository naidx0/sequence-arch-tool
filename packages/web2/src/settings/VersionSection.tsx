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

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { desktopBridge } from '../boot/desktopBridge';
import { useStoreIfAny } from '../state/connect';

import { copyText, describeUpdate, noteBlocks, noteHighlight, platformLabel, releaseNotesUrl, updateHelpPrompt, type NoteBlock } from './versionModel';
import { createVersionClient, type InstallJob, type ReleaseNote, type UpdateCheck, type VersionClient, type VersionInfo } from './versionClient';

const POLL_MS = 700;
/* A collapsed line longer than this runs past two lines at the narrowest Settings width. */
const LONG_LINE = 90;
const BLANK = String.fromCharCode(10, 10);

/** One release's notes: a two-line highlight, and "Read more" opens the whole thing in place. Collapsed on every
    mount; nothing is remembered. */
function NoteDigest({ blocks, testid, href }: { blocks: NoteBlock[]; testid: string; href?: string }) {
  const [more, setMore] = useState(false);
  const [clamped, setClamped] = useState(false);
  /* Whether layout measured the lines at all (jsdom does not): the length rule stands in only then. */
  const [measured, setMeasured] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const shown = more ? blocks : noteHighlight(blocks);
  /* A line the two-line clamp cuts is hidden text too: measure it, and treat a long line as cut where nothing measures. */
  useLayoutEffect(() => {
    const kids = Array.from(body.current?.children ?? []) as HTMLElement[];
    setClamped(kids.some((k) => k.scrollHeight > k.clientHeight + 1));
    setMeasured(kids.some((k) => k.clientHeight > 0));
  }, [blocks, more]);
  const cut = !measured && shown.some((b) => b.text.length > LONG_LINE);
  return (
    <>
      <div ref={body} className={more ? 'sb-news-body' : 'sb-news-body sb-news-digest'} data-testid={`${testid}-body`} data-expanded={more}>
        {shown.map((b, i) =>
          b.kind === 'h' ? (
            <h5 key={i} className="sb-news-sub">
              {b.text}
            </h5>
          ) : (
            <p key={i} className={b.kind === 'li' ? 'sb-news-li' : 'sb-news-p'}>
              {b.text}
            </p>
          ),
        )}
      </div>
      {blocks.length > shown.length || cut || clamped || more ? (
        <button type="button" className="sb-link sb-news-more" data-testid={`${testid}-toggle`} aria-expanded={more} onClick={() => setMore((m) => !m)}>
          {more ? 'Show less' : 'Show all'}
        </button>
      ) : null}
      {/* "Read more" opens the whole notes where they are published (0.1.8.1 D1, audit P2-8: it 404ed; review N5). The
          in-place expansion is "Show all". */}
      {href ? (
        <a className="sb-link sb-news-more" data-testid={`${testid}-link`} href={href} target="_blank" rel="noreferrer noopener" title="The release notes on GitHub">
          Read more
        </a>
      ) : null}
    </>
  );
}

export function VersionSection({ client }: { client?: VersionClient }) {
  const api = useRef<VersionClient>(client ?? createVersionClient());
  const store = useStoreIfAny();
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [job, setJob] = useState<InstallJob | null>(null);
  const [notes, setNotes] = useState<ReleaseNote[]>([]);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const [checking, setChecking] = useState(false);
  /* The automatic-check switch: null until the server answers (then it is hidden, not guessed). */
  const [autoCheck, setAutoCheck] = useState<boolean | null>(null);
  /* The update check got no answer from the app at all (not the same as GitHub being offline). */
  const [unreachable, setUnreachable] = useState(false);

  /** Ask the server; answers the install job's state, or null when it did not answer. */
  const refresh = useCallback(async (force: boolean): Promise<InstallJob['state'] | null> => {
    setChecking(true);
    const snap = await api.current.update(force);
    setChecking(false);
    setUnreachable(!snap);
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
    });
    void api.current.updateCheck?.().then((v) => live && setAutoCheck(v));
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

  const view = describeUpdate(check, job, { unreachable: unreachable && check === null, startError });
  const error = view.error;
  const latestNotes = check?.newer && check.latest?.notes ? noteBlocks(check.latest.notes) : [];
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
    } else if (view.action.kind === 'restart') {
      /* In-place installs (mac swap, Windows portable zip) finish when the app quits; main logs this one as the update restart. */
      void Promise.resolve(desktopBridge()?.shell?.('restart-for-update')).catch((e: Error) => setStartError(`Could not restart: ${e.message}`));
    }
  };
  /* Puts a ready prompt in the chat composer and closes Settings so it can be seen. It sends nothing and runs nothing. */
  const askAgent = (): void => {
    if (!store || !error) return;
    const prompt = updateHelpPrompt(error, check, job);
    const draft = store.getState().composer.draft ?? '';
    store.dispatch({ type: 'composer/draft', text: draft.trim() === '' ? prompt : `${draft.trimEnd()}${BLANK}${prompt}` });
    store.dispatch({ type: 'shell/overlay', overlay: null });
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
            {view.detail ? (
              <span className="sb-row-sub" data-testid="settings-update-detail">
                {view.detail}
              </span>
            ) : null}
            {view.progress !== null ? (
              <progress className="sb-update-bar" data-testid="settings-update-progress" max={1} value={view.progress} aria-label="Download progress" />
            ) : view.busy ? (
              <progress className="sb-update-bar" data-testid="settings-update-progress" data-indeterminate="yes" aria-label="Working" />
            ) : null}
          </span>
          {view.action.kind === 'restart' ? (
            typeof desktopBridge()?.shell === 'function' ? (
              <button type="button" className="sb-pill sb-pill-solid" data-testid="settings-update-restart" onClick={onAction}>
                {view.action.label}
              </button>
            ) : null
          ) : view.action.kind === 'update' ? (
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
        {autoCheck !== null ? (
          <label className="sb-row sb-row-switch">
            <input
              type="checkbox"
              role="switch"
              className="sb-switch"
              data-testid="settings-update-auto"
              checked={autoCheck}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                setAutoCheck(on);
                void api.current.setUpdateCheck?.(on).then((v) => {
                  if (v === null) setAutoCheck(!on);
                  else void refresh(false);
                });
              }}
            />
            <span className="sb-row-txt">
              <span>Check for updates</span>
              <span className="sb-row-sub">Off: Sequence only looks when you press Check now.</span>
            </span>
          </label>
        ) : null}
        {error ? (
          <div className="sb-fail sb-fail-row" data-testid="settings-update-error" role="alert">
            <span className="sb-fail-t">{error}</span>
            {store ? (
              <button type="button" className="sb-pill sb-pill-quiet" data-testid="settings-version-help" onClick={askAgent}>
                Ask the agent to help
              </button>
            ) : null}
          </div>
        ) : null}

        {latestNotes.length > 0 && check?.latest ? (
          <div className="sb-news" data-testid="settings-update-notes">
            <h4 className="sb-news-h">In v{check.latest.version}</h4>
            <NoteDigest blocks={latestNotes} testid="settings-update-notes" />
          </div>
        ) : null}

        {notes.length > 0 ? (
          <div className="sb-news" data-testid="settings-whatsnew">
            <h4 className="sb-news-h">What's new</h4>
            {notes.map((n) => (
              <div key={n.version} className="sb-news-item" data-testid="settings-whatsnew-item" data-version={n.version}>
                <span className="sb-news-v">{n.title}</span>
                <NoteDigest blocks={noteBlocks(n.body)} testid="settings-whatsnew-notes" href={releaseNotesUrl(n.version)} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
