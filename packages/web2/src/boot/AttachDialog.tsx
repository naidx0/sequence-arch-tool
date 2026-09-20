import { useCallback, useEffect, useRef, useState } from 'react';

import './boot.css';

import type { BrowseEntry, GetBrowseResponse, RecentRepo } from '@sequence/api-types';

import type { AttachFailure } from '../state/types';
import { attachFailureCopy } from './attachFailure';
import { classifyWireFailure, readScannedGraph } from './bootSequence';
import type { BootTransport, ScannedRepoDraft } from './bootSequence';
import { desktopBridge } from './desktopBridge';
import { Glyph } from './icons';
import { pathCrumbs } from './paths';

/**
 * ITEM 2.4 — THE ATTACH DIALOG.
 *
 * UNSHEETED. §5.6 of the plan lists it by name among the eleven surfaces the
 * Graphite book does not cover, so this is design work rather than
 * transcription and every decision below is argued rather than cited. What IS
 * cited is the one law that generalises from sheet 08.5 — three parts to every
 * absence, and the second is the one that gets dropped — and the control ladder
 * from law 3, which is why every row here is 28px and every control 28/26.
 *
 * FOUR DECISIONS, EACH WITH ITS REASON.
 *
 * 1. THE BOUNDARY IS RENDERED, NOT INFERRED. `GET /api/browse` is jailed to a
 *    browse root and returns it in every listing; `parent === null` IS the top.
 *    So the up control's disabled state is read straight off `parent`, and the
 *    root is printed in a callout. A user who does not know the jail exists
 *    reads a disabled control as a bug and a 403 as a crash — the two most
 *    common attach errors are both consequences of a boundary nobody was told
 *    about.
 *
 * 2. THE ROW IS THE COMMITMENT; THE CHEVRON IS THE DESCENT. One row, one
 *    primary action, and the primary action of a dialog called "Open a
 *    repository" is to open one. Descending is a separate, smaller target on
 *    the right. The alternative — the row descends when it can and attaches
 *    when it cannot — makes the same gesture mean two different things
 *    depending on data the user cannot see.
 *
 * 3. THE SCANNABLE TAG IS A HINT, NOT A PERMISSION. `BrowseEntry.isRepo` is
 *    computed from marker files on disk (`.git`, `package.json`, a compose
 *    file — `browse.ts`'s REPO_MARKERS). Every row stays openable whether or
 *    not it carries the tag, because the markers are evidence about what a scan
 *    will find and not a rule about what may be attached; a folder with no
 *    marker attaches fine and answers with the calm 422 when there is nothing
 *    to draw. The tag is uncoloured for the same reason: it reports a file on
 *    disk, which is not a verdict.
 *
 * 4. RECENTS COME FIRST. The repository you want is usually the one you had.
 *    The route already filters them to the caller's own jail, so a stale entry
 *    pointing outside the boundary is dropped by the server rather than offered
 *    here and refused on click.
 *
 * WHAT IT HANDS BACK. On success, a {@link ScannedRepoDraft} — and the summary
 * in it is the SERVER'S, taken from the attach response's `graphSummary`, never
 * recounted here. The platform has a `graphSummary()` and a second count in the
 * client is a second answer waiting to disagree with the first.
 */

export interface AttachDialogProps {
  transport: BootTransport;
  onAttached: (repo: ScannedRepoDraft) => void;
  onClose?: () => void;
}

export function AttachDialog({ transport, onAttached, onClose }: AttachDialogProps) {
  const [listing, setListing] = useState<GetBrowseResponse | null>(null);
  const [recents, setRecents] = useState<RecentRepo[]>([]);
  const [failure, setFailure] = useState<AttachFailure | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /*
   * The transport is held in a ref for the same reason it is in useBoot: the
   * natural way to mount this is `transport={createBootTransport()}` inline,
   * and a freshly-constructed object in a dependency array is an effect that
   * re-runs on every render — here, a directory listing re-fetched forever.
   * The ref makes the identity of the transport irrelevant to the effect while
   * still always calling the current one.
   */
  const held = useRef(transport);
  held.current = transport;

  const navigate = useCallback(async (path: string | null) => {
    const answer = await held.current.browse(path);
    if (answer.outcome === 'ok') {
      setListing(answer.body);
      setFailure(null);
      return;
    }
    /*
     * The browse route shares the attach route's jail and its status
     * vocabulary, so it shares the classifier. One mapping for both is the
     * whole point of 2.4 owning it: a 403 that reads one way when you browse
     * into a folder and another way when you open it is two products.
     */
    setFailure(classifyWireFailure(answer));
  }, []);

  useEffect(() => {
    let cancelled = false;

    void held.current.recent().then((answer) => {
      /* A recents list that failed to load is not worth a failure strip: the
       * folder browser below it still works, and an error about a convenience
       * would sit on top of the thing the user came here to do. It degrades to
       * empty, which is also what "you have never opened one" looks like. */
      if (!cancelled && answer.outcome === 'ok') setRecents(answer.body.recent);
    });

    void navigate(null);

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  /**
   * Attach, then read the graph the attach just produced.
   *
   * Two calls, because the platform gives the counts on one route and the graph
   * on another. The order matters: `POST /api/attach` is what changes the
   * server's single active repo, so a failure there means nothing moved, while
   * a failure on the second call means the repo IS attached and only this page
   * failed to read it — a different sentence, and the reason the second failure
   * keeps the dialog open with a retry instead of reporting an attach failure
   * that did not happen.
   */
  const attach = async (path: string) => {
    setBusy(path);
    setFailure(null);

    /*
     * THE `finally` IS THE POINT OF THE try, NOT THE catch.
     *
     * Every row is disabled while an attach is in flight, so `busy` is what
     * makes the whole list inert. Clearing it only on the paths that return
     * normally means any throw between here and the end leaves every control
     * switched off, with a progress cursor and no sentence — which is the
     * "spinner forever" failure this lane exists to prevent, wearing a
     * different hat. This was found by driving the real page, not by reading
     * the code: the two calls below cannot throw through `createBootTransport`,
     * which catches its own rejections, and a "cannot happen" is not worth the
     * shape of a permanently dead dialog.
     */
    try {
      const attached = await held.current.attach(path);
      if (attached.outcome !== 'ok') {
        setFailure(classifyWireFailure(attached));
        return;
      }

      const graphAnswer = await held.current.archGraph();
      if (graphAnswer.outcome !== 'ok') {
        setFailure(classifyWireFailure(graphAnswer));
        return;
      }
      const graph = readScannedGraph(graphAnswer.body);
      if (graph === null) {
        setFailure({
          kind: 'transport',
          status: graphAnswer.status,
          message: 'the repository attached, but the graph route answered with something else',
        });
        return;
      }

      onAttached({
        root: attached.body.root,
        repoName: attached.body.repoName,
        graph,
        summary: attached.body.graphSummary,
        scannedAt: graph.scannedAt,
      });
    } catch (error) {
      /* Reported with the thrown message rather than swallowed into a generic
       * sentence: a transport that threw is a bug, and a bug the user can
       * quote is one that gets fixed. */
      setFailure({
        kind: 'transport',
        status: null,
        message: (error as Error).message,
      });
    } finally {
      setBusy(null);
    }
  };

  /*
   * THE NATIVE PICKER. Present only in the Electron build, and only ever a
   * SHORTCUT past the folder browser below — never the only door to it, because
   * the browser build has no OS dialog and must stay completely usable.
   *
   * Read through `desktopBridge()` on every render rather than captured once:
   * the bridge is injected by the preload before first paint, so a value cached
   * in a ref would be correct today and wrong the moment that ordering changes.
   * The check is a capability test, not a truthiness test — see desktopBridge.ts.
   */
  const [picking, setPicking] = useState(false);
  const native = desktopBridge();

  const pickNative = async () => {
    const api = desktopBridge();
    if (api === undefined) return;

    setPicking(true);
    try {
      const picked = await api.openRepo();
      /* `null` is the OS dialog's "the user pressed Cancel". It is not a
       * failure and must not print like one — the user chose this. */
      if (picked !== null) await attach(picked);
    } catch (error) {
      /* An OS dialog that throws is a bug in the shell, not a user error, so it
       * is reported with the thrown message rather than a generic sentence —
       * same rule as `attach` above. */
      setFailure({ kind: 'transport', status: null, message: (error as Error).message });
    } finally {
      setPicking(false);
    }
  };

  const crumbs = listing === null ? [] : pathCrumbs(listing.root, listing.path);

  /*
   * DECISION 5 (added 2026-08-29) — A PATH CAN BE TYPED, NOT ONLY WALKED TO.
   *
   * Measured on a real journey walk: a repository three folders deep took six
   * clicks to reach, and one cloned OUTSIDE the browse root could not be
   * reached at all — the up control refused (correctly) and there was no other
   * door, so the user learned about the boundary by running out of buttons.
   *
   * The input does not weaken the jail by one byte: it posts the typed path to
   * the SAME `/api/attach`, whose realpath jail is load-bearing (attaching an
   * out-of-root path is refused 403; attaching home itself would re-root the
   * file jail over ~/.ssh and is refused 400). What changes is WHERE the user
   * learns the rule — the refusal strip, with the boundary named, instead of a
   * dead end. Enter attaches; the Open button is the same action for pointer
   * users, because an affordance that exists only on a key is a trap.
   */
  const [typed, setTyped] = useState('');
  const attachTyped = () => {
    const path = typed.trim();
    if (path.length === 0 || busy !== null) return;
    void attach(path);
  };

  return (
    <section className="attach" role="dialog" aria-label="Open a repository" data-testid="attach">
      <header className="attach-head">
        <h2 className="attach-h">Open a repository</h2>
        {onClose && (
          <button
            type="button"
            className="attach-iconbtn"
            aria-label="Close"
            data-testid="attach-close"
            onClick={onClose}
          >
            <Glyph name="x" size={12} />
          </button>
        )}
      </header>

      {listing !== null && (
        <p className="attach-callout" data-testid="attach-root-callout">
          Folders outside <code>{listing.root}</code> are not reachable — Sequence reads and writes
          only inside it.
        </p>
      )}

      <div className="attach-pathrow">
        <input
          type="text"
          className="attach-path-input"
          data-testid="attach-path"
          aria-label="Repository path"
          placeholder="Paste a repository path — Enter opens it"
          spellCheck={false}
          autoComplete="off"
          value={typed}
          disabled={busy !== null}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') attachTyped();
          }}
        />
        <button
          type="button"
          className="attach-native"
          data-testid="attach-path-open"
          disabled={busy !== null || typed.trim().length === 0}
          onClick={attachTyped}
        >
          Open
        </button>
      </div>

      <div className="attach-bar">
        <button
          type="button"
          className="attach-iconbtn"
          aria-label="Go up one folder"
          data-testid="attach-up"
          /* `parent === null` is the server's own statement that this is the
           * top of the jail. Nothing here re-derives it from string prefixes. */
          disabled={listing === null || listing.parent === null}
          onClick={() => listing?.parent && void navigate(listing.parent)}
        >
          <Glyph name="chevup" size={12} />
        </button>

        <nav className="attach-crumbs" data-testid="attach-crumbs" aria-label="Folder path">
          {crumbs.map((crumb, index) => (
            <span key={crumb.path} className="attach-crumb-item">
              {index > 0 && (
                <span className="attach-crumb-sep">
                  <Glyph name="chevright" size={12} />
                </span>
              )}
              <button
                type="button"
                className="attach-crumb"
                data-testid="attach-crumb"
                aria-current={index === crumbs.length - 1}
                onClick={() => void navigate(crumb.path)}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </nav>

        {native !== undefined && (
          <button
            type="button"
            className="attach-native"
            data-testid="attach-native"
            /* Inert while an attach is in flight for the same reason every row
             * is: two attaches racing would leave the server's single active
             * repo decided by whichever response landed last. */
            disabled={busy !== null || picking}
            onClick={() => void pickNative()}
          >
            Choose folder&hellip;
          </button>
        )}
      </div>

      {failure !== null && <FailureStrip failure={failure} />}

      {recents.length > 0 && (
        <>
          <p className="attach-legend">Recent</p>
          <ul className="attach-list">
            {recents.map((recent) => (
              <li key={recent.path} className="attach-row" data-testid="attach-recent">
                <button
                  type="button"
                  className="attach-open"
                  disabled={busy !== null}
                  onClick={() => void attach(recent.path)}
                >
                  <Glyph name="folder" size={12} />
                  <span className="attach-name">{recent.name}</span>
                  <span className="attach-path">{recent.path}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="attach-legend">
        {listing === null
          ? 'Reading the folder…'
          : listing.entries.length === 0
            ? 'No folders in here.'
            : 'Folders'}
      </p>

      <ul className="attach-list">
        {listing?.entries.map((entry) => (
          <EntryRow
            key={entry.path}
            entry={entry}
            busy={busy}
            onOpen={() => void attach(entry.path)}
            onDescend={() => void navigate(entry.path)}
          />
        ))}
      </ul>

      <footer className="attach-foot">
        <span className="attach-legend">
          Opening a folder scans it. Nothing is written.
        </span>
        {listing !== null && listing.parent !== null && (
          <button
            type="button"
            className="startup-btn solid"
            disabled={busy !== null}
            data-testid="attach-open-cursor"
            onClick={() => void attach(listing.path)}
          >
            Open this folder
          </button>
        )}
      </footer>
    </section>
  );
}

/**
 * One directory.
 *
 * The primary control comes FIRST in the DOM as well as visually, which is not
 * incidental: it is the tab order, and it is what a test that reaches for "the
 * button in this row" gets. A row whose first focusable control does something
 * other than its stated purpose is a keyboard trap of the quiet kind.
 */
function EntryRow({
  entry,
  busy,
  onOpen,
  onDescend,
}: {
  entry: BrowseEntry;
  busy: string | null;
  onOpen: () => void;
  onDescend: () => void;
}) {
  return (
    <li className="attach-row" data-testid="attach-entry">
      <button
        type="button"
        className="attach-open"
        disabled={busy !== null}
        onClick={onOpen}
        title={entry.path}
      >
        <Glyph name="folder" size={12} />
        <span className="attach-name">{entry.name}</span>
        {entry.isRepo && (
          <span
            className="attach-tag"
            data-testid="attach-scannable"
            /* What the tag is actually claiming, in full, for whoever hovers
             * it. The claim is about marker files, not about the repository. */
            title="This folder carries a project marker — .git, package.json or a compose file"
          >
            scannable
          </span>
        )}
      </button>

      {entry.hasChildren && (
        <button
          type="button"
          className="attach-iconbtn"
          aria-label={`Look inside ${entry.name}`}
          data-testid="attach-descend"
          onClick={onDescend}
        >
          <Glyph name="chevright" size={12} />
        </button>
      )}
    </li>
  );
}

/**
 * A failure, in the three parts.
 *
 * `data-tone` and `data-kind` are on the element because the stylesheet keys
 * off the first and the e2e tier keys off the second — and because a test that
 * asserts the tone is asserting the paint, which a test asserting the sentence
 * is not.
 */
function FailureStrip({ failure }: { failure: AttachFailure }) {
  const copy = attachFailureCopy(failure);
  const glyph = copy.tone === 'fault' ? 'alert' : copy.tone === 'note' ? 'info' : 'x';

  return (
    <div
      className="attach-failure"
      data-testid="attach-failure"
      data-tone={copy.tone}
      data-kind={failure.kind}
      /* `alert` for the one tone that is a fault; a refusal the user caused by
       * clicking is not an interruption worth seizing a screen reader for. */
      role={copy.tone === 'fault' ? 'alert' : 'status'}
    >
      <span className="attach-failure-glyph">
        <Glyph name={glyph} size={16} />
      </span>
      <span className="attach-failure-body">
        <span className="attach-failure-title">{copy.title}</span>
        <span className="attach-failure-why">{copy.body}</span>
        {/* What was actually reported, kept apart from what we wrote. Mono,
            because it is a quotation from a machine and the reader should be
            able to see where it starts and stops. */}
        {copy.detail !== null && (
          <span className="attach-failure-detail" data-testid="attach-failure-detail">
            {copy.detail}
          </span>
        )}
      </span>
    </div>
  );
}
