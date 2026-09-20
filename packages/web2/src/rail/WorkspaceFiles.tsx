import type { WorkspaceView } from '../state/types';

/* ══════════════════════════════════════════════════════════════════════════
   THE LOCAL WORKSPACE — what the rail shows when no repository is open.
   packages/web2/src/rail/WorkspaceFiles.tsx

   Owner, 2026-09-13: "It should default to a workspace wherever it's
   installed, or make one … then we know where it's writing files, its cache,
   all of that."

   Until this existed the rail's repo-less body was one sentence — "Open a
   repository and the index fills as the board draws." True, and not an answer
   to the question actually being asked, which is "where does this thing put
   my stuff". A General chat could not read a file, could not write one, and
   could not say where it would have put one.

   ── THE RULE THIS COMPONENT EXISTS TO ENFORCE ─────────────────────────────
   A WORKSPACE FILE IS NEVER A RAIL ROW. Sheet 11.2: "Three rungs, and no
   fourth" — board card, file, function — and every one of those is a thing the
   SCAN found. Nothing here was scanned: these are files somebody (or this
   chat) wrote into a folder. Rendering them through `RailRowLine` would make
   them look like index rows and invite exactly the confusion the grounded/
   guessed law exists to prevent. Two lists in one column, never one list.

   ── HUE BUDGET: 0 ────────────────────────────────────────────────────────
   Nothing here is a claim about the world — a file exists or it does not — so
   there is no verdict to spend a hue on. The path is the only thing that
   carries weight, and it carries it in ink and in mono.
   ══════════════════════════════════════════════════════════════════════════ */

export interface WorkspaceFilesProps {
  /** `null` until the listing has been asked for. */
  workspace: WorkspaceView | null;
}

/** Bytes, said the way a person reads them. Never a fake precision. */
function size(bytes: number | undefined): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function WorkspaceFiles({ workspace }: WorkspaceFilesProps) {
  /*
   * THREE STATES, AND THEY SAY DIFFERENT THINGS.
   *
   * `null` is "not asked yet" and must not claim the folder is empty — that
   * would be absence of a signal read as evidence of absence, which is the
   * second law in docs/how-to-verify.md.
   */
  if (workspace === null) {
    return (
      <p className="rail-empty" data-testid="rail-empty">
        Open a repository and the index fills as the board draws.
      </p>
    );
  }

  const files = workspace.entries.filter((e) => e.kind === 'file');
  return (
    <div className="ws" data-testid="rail-workspace">
      <p className="rail-empty">Open a repository and the index fills as the board draws.</p>
      <div className="ws-head">
        <span className="ws-title">Workspace</span>
        <span className="ws-count">
          {files.length === 0 ? 'empty' : `${files.length} file${files.length === 1 ? '' : 's'}`}
        </span>
      </div>
      {/*
        THE PATH IS THE POINT. It is the literal answer to the owner's
        question, so it is rendered whole and selectable rather than
        truncated with an ellipsis a reader cannot copy out of.
      */}
      <p className="ws-root" data-testid="rail-workspace-root" title={workspace.root}>
        {workspace.root}
      </p>
      {files.length === 0 ? (
        <p className="ws-none">
          {workspace.exists
            ? 'Nothing here yet. Files this chat writes land in that folder.'
            : 'Not created yet. It is made the first time this chat writes a file.'}
        </p>
      ) : (
        <ul className="ws-rows">
          {files.map((f) => (
            <li key={f.path} className="ws-row">
              <span className="ws-path">{f.path}</span>
              <span className="ws-size">{size(f.bytes)}</span>
            </li>
          ))}
        </ul>
      )}
      {workspace.omitted > 0 ? (
        <p className="ws-none">{`+${workspace.omitted} more not listed here`}</p>
      ) : null}
    </div>
  );
}
