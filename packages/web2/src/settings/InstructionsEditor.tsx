/* ══════════════════════════════════════════════════════════════════════════
   SETTINGS > AGENTS: AGENTS.md, OPEN AND EDIT IN PLACE
   packages/web2/src/settings/InstructionsEditor.tsx

   The instruction file every agent reads first. It says where the file lives
   (the full path, with Copy), shows its text, and Edit opens it right here:
   Save writes it back through the server's own file route. No file yet: one
   button creates it. Nothing is hidden behind a link out of the app.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';

import { INSTRUCTIONS_FILE, createInstructionsClient, instructionsPath, type InstructionsClient, type InstructionsView } from './instructionsClient';

/* Round 13 (N5): an instructions file is prose; anything bigger is not one. */
const MAX_IMPORT_BYTES = 256 * 1024;

function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

const STARTER = '# Agent instructions\n\nWhat every agent should know about this project: how to build and test it, and the rules to follow.\n';

export function InstructionsEditor({ client }: { client?: InstructionsClient }) {
  const api = useRef(client ?? createInstructionsClient()).current;
  const [view, setView] = useState<InstructionsView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [imported, setImported] = useState<string | null>(null);

  /* Import never writes: the file's text opens in the editor, and Save is still the person's
     move. There is no server route that reads another project, so "copy from another project"
     is this: choose (or drop) that project's AGENTS.md. */
  const importFile = async (file: File | undefined | null) => {
    if (!file) return;
    setFailure(null);
    setSaved(false);
    if (file.size > MAX_IMPORT_BYTES) {
      setFailure(`${file.name} is too large to be an instructions file (limit 256 KB).`);
      return;
    }
    let text: string;
    try {
      text = await readText(file);
    } catch {
      setFailure(`${file.name} could not be read.`);
      return;
    }
    if (text.includes('\u0000')) {
      setFailure(`${file.name} is not a text file.`);
      return;
    }
    setDraft(text);
    setImported(file.name);
  };

  useEffect(() => {
    let live = true;
    void api.read().then((a) => {
      if (!live) return;
      if (a.outcome === 'ok') setView(a.body);
      else setFailure(a.message);
    });
    return () => {
      live = false;
    };
  }, [api]);

  useEffect(() => {
    if (draft !== null) area.current?.focus();
  }, [draft === null]);

  const where = instructionsPath(view?.root ?? null);
  const editing = draft !== null;

  const save = async () => {
    if (draft === null || !view) return;
    setSaving(true);
    setFailure(null);
    const a = await api.write(draft);
    setSaving(false);
    if (a.outcome !== 'ok') {
      setFailure(a.message);
      return;
    }
    setView({ ...view, exists: true, text: draft });
    setDraft(null);
    setImported(null);
    setSaved(true);
  };

  return (
    <section
      className="sb-group"
      data-testid="settings-instructions"
      data-dropping={over ? 'true' : undefined}
      onDragOver={(e) => {
        if (!e.dataTransfer?.types?.includes('Files')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        setOver(false);
        void importFile(e.dataTransfer.files[0]);
      }}
    >
      <h3 className="sb-lab">{INSTRUCTIONS_FILE}</h3>
      <div className="sb-card">
        <p className="sb-hint">Every agent reads this file first. Put the rules for this project here.</p>
        {view === null && failure === null ? (
          <p className="sb-note" data-testid="settings-instructions-loading">
            Looking for {INSTRUCTIONS_FILE}...
          </p>
        ) : null}
        {view !== null ? (
          <>
            <div className="sb-row sb-instr-where">
              <span className="sb-row-txt">
                <span className="sb-row-t">{view.exists ? 'Lives at' : 'Not created yet. It will live at'}</span>
                <code className="sb-copy-cmd" data-testid="settings-instructions-path">
                  {where}
                </code>
                <span className="sb-row-sub">{view.project ? 'The top of the open project.' : 'The home workspace. Open a project to give it its own.'}</span>
              </span>
              <button
                type="button"
                className="sb-pill sb-pill-sm"
                data-testid="settings-instructions-copy"
                onClick={() => {
                  void navigator.clipboard?.writeText(where).then(
                    () => setCopied(true),
                    () => setCopied(false),
                  );
                }}
              >
                {copied ? 'Copied' : 'Copy path'}
              </button>
              <button type="button" className="sb-pill sb-pill-sm" data-testid="settings-instructions-import" onClick={() => picker.current?.click()}>
                Import
              </button>
              <input
                ref={picker}
                type="file"
                hidden
                accept=".md,.markdown,.txt,text/*"
                data-testid="settings-instructions-file"
                onChange={(e) => {
                  void importFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              {!editing ? (
                <button
                  type="button"
                  className="sb-pill sb-pill-solid"
                  data-testid="settings-instructions-edit"
                  onClick={() => {
                    setSaved(false);
                    setDraft(view.exists ? view.text : STARTER);
                  }}
                >
                  {view.exists ? 'Edit' : `Create ${INSTRUCTIONS_FILE}`}
                </button>
              ) : null}
            </div>
            <p className="sb-row-sub" data-testid="settings-instructions-import-hint">
              Import a file, or drop one here. To copy from another project, choose its {INSTRUCTIONS_FILE}.
            </p>
            {editing && imported ? (
              <p className="sb-note" role="status" data-testid="settings-instructions-imported">
                Imported {imported}. Save to keep it{view.exists ? ', replacing the current text' : ''}, or Cancel.
              </p>
            ) : null}
            {editing ? (
              <div className="sb-instr-edit" data-testid="settings-instructions-editor">
                <textarea
                  ref={area}
                  className="sb-input sb-instr-text"
                  data-testid="settings-instructions-text"
                  aria-label={INSTRUCTIONS_FILE}
                  spellCheck={false}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <div className="sb-acts">
                  <button type="button" className="sb-pill sb-pill-solid" data-testid="settings-instructions-save" disabled={saving} onClick={() => void save()}>
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button type="button" className="sb-pill sb-pill-quiet" data-testid="settings-instructions-cancel" disabled={saving} onClick={() => {
                    setDraft(null);
                    setImported(null);
                  }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : view.exists ? (
              <pre className="sb-instr-preview" data-testid="settings-instructions-preview" tabIndex={0}>
                {view.text.trim() === '' ? '(empty file)' : view.text}
              </pre>
            ) : null}
            {saved ? (
              <p className="sb-ok" role="status" data-testid="settings-instructions-saved">
                Saved to {where}
              </p>
            ) : null}
          </>
        ) : null}
        {failure !== null ? (
          <p className="sb-fail" role="alert" data-testid="settings-instructions-failure">
            {failure}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export default InstructionsEditor;
