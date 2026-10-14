import type { PostGithubCloneRefusal } from '@sequence/api-types';

import type { AttachFailure } from '../state/types';

/**
 * ITEM 2.4 — THE ATTACH-ERROR MAPPING. Classified ONCE, here, at the client
 * boundary.
 *
 * The state contract (`state/types.ts`, frozen) declares `AttachFailure` as a
 * seven-member union and says who owns filling it in: "Classification happens
 * once, at the client boundary (2.4 owns it), and every surface downstream
 * reads this union instead of re-deciding from a status code." That sentence is
 * the whole design. A status code re-read in three surfaces becomes three
 * slightly different sentences about the same refusal, and the one that is
 * wrong is always the one on the screen the user is looking at.
 *
 * WHAT THE WIRE ACTUALLY GIVES US, measured rather than assumed
 * (`packages/analyzer/src/server/repoServer.ts`, the `POST /api/attach` arm):
 *
 *   415  wrong content-type                                    — a client bug
 *   400  'invalid JSON body: …'                                — a client bug
 *   400  'body must include a string "path"'                   — a client bug
 *   400  'Pick a project folder inside your home directory,
 *         not the home directory itself.'                      — a refusal
 *   400  'path is not a directory'                             — a refusal
 *   403  'path escapes the browse root'                        — a refusal
 *   404  'directory not found'                                 — a refusal
 *   422  { error, code:'no-manifests', repoName }              — A NOTE
 *   500  'scan failed: <message>'                              — a fault
 *
 * FOUR OF THOSE SHARE A STATUS AND CARRY NO CODE. Only the 422 has a stable
 * discriminator (`NoManifestsError.code`), so the two meaningful 400s can only
 * be told apart by the sentence the server sent. That is fragile, and the
 * design point is what happens when the match fails: an unrecognised 400 falls
 * to `transport`, which renders the server's own words verbatim. A fallback
 * that GUESSED between the two named cases would put a confident, specific and
 * wrong instruction on screen; a fallback that quotes the server cannot be
 * wrong about anything except how helpful it is.
 *
 * THE 422 IS A NOTE, AND THAT IS A RULING, NOT A STYLE CHOICE. The throw site
 * says so in the engine: "a repo with no compose/K8s/Helm manifests is out of
 * v1 scope, not a failure: surface it as a calm 422 carrying a distinct `code`
 * so the home screen renders an informational note, never the red error wall."
 *
 * UNSHEETED. Graphite covers the graph domain; the attach dialog is one of the
 * eleven surfaces §5.6 lists as uncovered. The one law borrowed from the book
 * is sheet 08.5's, which is about empty boards but generalises exactly:
 * docs/brand/graphite/pages/08-board-density-and-overflow.html — "Every
 * empty state carries the same three parts: what is not here, why it is not
 * here, and one thing to do about it. The second part is the one that gets
 * dropped." So every entry below has all three, and the type makes `action`
 * compulsory so a later edit cannot drop the third.
 */

/**
 * Every member of the union, as values, so a walk over the copy table is
 * possible and a member added to the contract without copy fails a test rather
 * than rendering an empty box.
 */
export const ATTACH_FAILURE_KINDS = [
  'no-manifests',
  'outside-browse-root',
  'home-directory-itself',
  'not-found',
  'not-a-directory',
  'scan-threw',
  'transport',
] as const;

export type AttachFailureKind = (typeof ATTACH_FAILURE_KINDS)[number];

/**
 * How loudly a failure is allowed to be drawn.
 *
 * Graphite law 1: every hue on screen is a claim about the world, and there are
 * never more hues than there are claims.
 *
 *   note   Nothing is wrong. The repo is real and the scanner is telling you
 *          what it did not recognise. Uncoloured, and phrased as information.
 *   plain  A refusal, or a request that could not be completed. The app is
 *          working exactly as designed — a folder above the browse boundary is
 *          a boundary doing its job, and an engine that is not running is the
 *          local-first case. Uncoloured.
 *   fault  Something on the far side broke. This is the ONLY tone that spends
 *          `--wont`, and `scan-threw` is the only failure that earns it.
 */
export type FailureTone = 'note' | 'plain' | 'fault';

export interface FailureCopy {
  /** What is not here. */
  title: string;
  /** Why it is not here, in our words. */
  body: string;
  /**
   * What was actually REPORTED — the server's own sentence, or the browser's
   * own exception text. `null` only when `body` already IS those words, so
   * they are never printed twice and never dropped.
   *
   * This field exists because dropping it was a real defect, found by driving
   * the page rather than by reading it: a transport that threw with "boom"
   * rendered as the generic "the engine is not running", which was a lie AND
   * unfixable — nobody could quote the one string that would have located it.
   * Our sentence is authorship; this is evidence, and evidence is the half a
   * user can act on.
   */
  detail: string | null;
  /** One thing to do about it. Compulsory: this is the part that gets dropped. */
  action: FailureAction;
  /** A second way out, where there is one ("Allow this folder" beside "Choose another"). */
  secondary?: FailureAction;
  tone: FailureTone;
}

/** The sentence the outside-home refusal says, word for word (0.1.8.1 C5, audit P1-8). */
export const OUTSIDE_HOME_SENTENCE = 'Sequence can only open folders inside your home folder.';

/**
 * WORDS FOR PEOPLE, NOT FOR THE CODE (0.1.8.1 C5: "No internal terms (jail, boundary, browseRoot) appear in the UI").
 * The server's own sentences still name its implementation ("path escapes the browse root"); they are shown, because
 * they are the evidence, with those words put the way the reader knows the place: their home folder.
 */
export const INTERNAL_TERMS = /\bbrowse[ _-]?roots?\b|\bbrowseRoots?\b|\bjail(?:ed|s)?\b|\bboundar(?:y|ies)\b/gi;
export function plainWords(text: string): string {
  return text.replace(INTERNAL_TERMS, 'home folder');
}

export interface FailureAction {
  label: string;
  /**
   * What the surface should wire the control to. Named intents rather than
   * callbacks so the copy table stays pure and testable, and so two surfaces
   * showing the same failure cannot offer two different ways out of it.
   */
  intent: 'pick-another' | 'go-up' | 'retry' | 'attach-anyway' | 'connect-github' | 'check-url' | 'choose-folder' | 'allow-folder';
}

/**
 * The actions a clone refusal's body names (`PostGithubCloneRefusal.action`), as the control the strip offers (0.1.8.1
 * C4, audit P1-7). An action this build does not know is dropped in favour of the default, never shown as a raw word.
 */
export const SERVER_ACTIONS: Readonly<Record<PostGithubCloneRefusal['action'], FailureAction>> = {
  'connect-github': { label: 'Connect GitHub', intent: 'connect-github' },
  'check-url': { label: 'Check the address', intent: 'check-url' },
  'choose-folder': { label: 'Choose a folder', intent: 'choose-folder' },
};
const serverAction = (name: string | undefined): FailureAction | undefined =>
  name !== undefined && Object.prototype.hasOwnProperty.call(SERVER_ACTIONS, name) ? SERVER_ACTIONS[name as PostGithubCloneRefusal['action']] : undefined;

/** The server's sentence as a title: its first letter raised, nothing else changed. */
function asTitle(sentence: string): string {
  const t = sentence.trim();
  return t.length === 0 ? t : t[0]!.toUpperCase() + t.slice(1);
}

/**
 * Turn one HTTP answer into one classified failure.
 *
 * @param status  the HTTP status, or `null` when nothing answered at all.
 * @param body    the parsed JSON body, or `null` when there was none.
 * @param message a transport-level message (the thrown `TypeError`'s text),
 *                used only when `status` is null.
 */
export function classifyAttachFailure(
  status: number | null,
  body: unknown,
  message?: string,
): AttachFailure {
  if (status === null) {
    return {
      kind: 'transport',
      status: null,
      message: message && message.length > 0 ? message : 'the request did not complete',
    };
  }

  const said = errorText(body);
  /* The status is the only fact available when the body carries no words, and
   * the message must then be ABOUT the status rather than a sentence describing
   * a cause nobody reported. */
  const detail = said ?? `the server answered ${status} and said nothing more`;
  /* A refusal the server put into words (0.1.8.1 C4): its sentence and the action it named travel with it. */
  const named = actionText(body);
  const refused = (): AttachFailure => ({
    kind: 'transport',
    status,
    message: detail,
    ...(said !== null ? { said: true } : {}),
    ...(named !== null ? { serverAction: named } : {}),
  });

  if (status === 422) {
    const repoName = readRepoName(body);
    /* `code` is the stable discriminator. A 422 without it is some other
     * refusal, and dressing it as the friendly note would tell the user their
     * repo has no manifests when the server never said so. */
    if (hasNoManifestsCode(body) && repoName !== null) {
      return { kind: 'no-manifests', repoName, message: detail };
    }
    return refused();
  }

  /*
   * THE BODY'S ACTION DECIDES BEFORE THE STATUS DOES (0.1.8.1 C4/C5, review S3). The outside-home refusal names
   * `allow-folder` and the path to allow; a clone refusal names its own button (connect-github, check-url,
   * choose-folder) and its sentence is the title, whatever its status (a clone's 403 or 404 is not a folder refusal).
   */
  if (named === 'allow-folder') {
    const path = (body as { path?: unknown }).path;
    return { kind: 'outside-browse-root', message: detail, ...(typeof path === 'string' && path.length > 0 ? { path } : {}) };
  }
  if (named !== null && serverAction(named) !== undefined && status >= 400 && status < 500) return refused();

  if (status === 403) return { kind: 'outside-browse-root', message: detail };
  if (status === 404) return { kind: 'not-found', message: detail };
  if (status >= 500) return { kind: 'scan-threw', message: detail };

  if (status === 400) {
    const lower = (said ?? '').toLowerCase();
    if (lower.includes('home directory itself')) {
      return { kind: 'home-directory-itself', message: detail };
    }
    if (lower.includes('not a directory')) {
      return { kind: 'not-a-directory', message: detail };
    }
  }

  return refused();
}

/**
 * The copy table. One entry per union member, as a total switch, so the
 * compiler is what keeps it complete rather than a reviewer's memory.
 *
 * The sentences are deliberately plain and deliberately short. Nothing here
 * apologises, nothing shouts, and nothing describes a cause the server did not
 * report — where a reason exists it is quoted from `failure.message`, which is
 * the server's own text.
 */
export function attachFailureCopy(failure: AttachFailure): FailureCopy {
  const copy = rawCopy(failure);
  return {
    ...copy,
    title: plainWords(copy.title),
    body: plainWords(copy.body),
    detail: copy.detail === null ? null : plainWords(copy.detail),
  };
}

function rawCopy(failure: AttachFailure): FailureCopy {
  switch (failure.kind) {
    case 'no-manifests':
      return {
        title: `${failure.repoName} opened, but nothing was recognised`,
        body:
          'The folder is a real project. The scanner found no deployment manifests in it — no compose file, no Kubernetes manifest, no Helm chart — so there is no service topology to draw yet. Everything else still works.',
        detail: failure.message,
        action: { label: 'Pick another folder', intent: 'pick-another' },
        tone: 'note',
      };

    case 'outside-browse-root':
      return {
        title: 'That folder is outside your home folder',
        body: OUTSIDE_HOME_SENTENCE,
        /* The server says this very sentence now (OutsideHomeRefusal.error); it is not printed twice. */
        detail: failure.message.trim() === OUTSIDE_HOME_SENTENCE ? null : failure.message,
        action: { label: 'Choose another', intent: 'pick-another' },
        secondary: { label: 'Allow this folder', intent: 'allow-folder' },
        tone: 'plain',
      };

    case 'home-directory-itself':
      return {
        title: 'That is your home folder, not a project',
        body:
          'Opening it would let Sequence read and write every file in your home folder, keys and credentials included. Pick a project folder inside it instead.',
        detail: failure.message,
        action: { label: 'Pick a project folder', intent: 'pick-another' },
        tone: 'plain',
      };

    case 'not-found':
      return {
        title: 'That folder is not there',
        body:
          'It may have been moved or deleted since this list was built. The listing you are looking at is a snapshot, not a live view.',
        detail: failure.message,
        action: { label: 'Go back up', intent: 'go-up' },
        tone: 'plain',
      };

    case 'not-a-directory':
      return {
        title: 'That is a file, not a folder',
        body: 'Sequence attaches to a directory. Pick the folder that contains it.',
        detail: failure.message,
        action: { label: 'Go back up', intent: 'go-up' },
        tone: 'plain',
      };

    case 'scan-threw':
      return {
        title: 'The scan stopped part way',
        body: failure.message,
        /* `body` already IS the reported words. */
        detail: null,
        action: { label: 'Try again', intent: 'retry' },
        tone: 'fault',
      };

    case 'transport':
      /*
       * A 4xx is a REFUSAL, not an engine problem (0.1.8.1 C4, audit P1-7: "The engine answered 400" for a clone URL
       * the server did not take). The server's own sentence is the title and the action it named is the way out.
       * "Engine" is said only where the engine is the subject: nothing answered, or it failed (5xx).
       */
      if (failure.status !== null && failure.status >= 400 && failure.status < 500) {
        const action = serverAction(failure.serverAction) ?? { label: 'Try again', intent: 'retry' as const };
        return failure.said
          ? {
              title: asTitle(failure.message),
              body: action.intent === 'connect-github' ? 'Connect GitHub, then try again. Nothing was changed.' : 'Nothing was changed. Correct it and try again.',
              detail: null,
              action,
              tone: 'plain',
            }
          : {
              title: 'Sequence could not do that',
              body: `The request was refused (${failure.status}). Nothing was changed.`,
              detail: failure.message,
              action,
              tone: 'plain',
            };
      }
      return {
        title:
          failure.status === null
            ? 'The Sequence engine is not running'
            : `The engine answered ${failure.status}`,
        body:
          failure.status === null
            ? 'Nothing answered on this address. Sequence runs its own local engine; start it and this page will pick it up on the next try.'
            : failure.message,
        /* With a status, `body` is already the server's sentence. Without one,
         * the plain local-first sentence is the useful thing to read and the
         * browser's own text goes underneath it rather than instead of it. */
        detail: failure.status === null ? failure.message : null,
        action: { label: 'Try again', intent: 'retry' },
        tone: 'plain',
      };
  }
}

/* -------------------------------------------------------------------------- *
 * Reading an untrusted body. Every one of these is total and returns a
 * "do not know" rather than throwing: a malformed error body must not turn a
 * refusal the user could have acted on into a blank screen.
 * -------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The universal envelope is `{ error, ...extra }` — one writer, `sendError`. */
function errorText(body: unknown): string | null {
  const record = asRecord(body);
  const error = record?.error;
  return typeof error === 'string' && error.length > 0 ? error : null;
}

/** The action a refusal names (`{ error, action: 'connect-github' }`), or null. */
function actionText(body: unknown): string | null {
  const action = asRecord(body)?.action;
  return typeof action === 'string' && action.length > 0 ? action : null;
}

function hasNoManifestsCode(body: unknown): boolean {
  return asRecord(body)?.code === 'no-manifests';
}

function readRepoName(body: unknown): string | null {
  const name = asRecord(body)?.repoName;
  return typeof name === 'string' && name.length > 0 ? name : null;
}
