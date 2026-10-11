/* ══════════════════════════════════════════════════════════════════════════
   SETTINGS > SKILLS: IMPORT
   packages/web2/src/settings/SkillsImport.tsx

   Drop files or a folder on the card, or choose them. There is no server route
   that reads another project, so "from another project" means choosing that
   project's skills folder here: the browser reads it, the server writes only
   under .sequence/skills (POST /api/skills), and a name that already exists
   asks before it is replaced.
   ══════════════════════════════════════════════════════════════════════════ */

import { useRef, useState } from 'react';

import { gatherSkillFiles, pickedFromDrop, pickedFromList, type PickedFile, type SkillFilesResult } from './skillsFiles';

export type SkillsPost = (files: { path: string; content: string }[], overwrite: boolean) => Promise<{ status: number; body: { error?: string; conflicts?: string[]; imported?: string[] } }>;

const postSkills: SkillsPost = async (files, overwrite) => {
  const res = await fetch('/api/skills', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files, overwrite }) });
  const body = (await res.json().catch(() => ({}))) as { error?: string; conflicts?: string[]; imported?: string[] };
  return { status: res.status, body };
};

export function SkillsImport({ post = postSkills, onImported, children }: { post?: SkillsPost; onImported: () => void; children?: React.ReactNode }) {
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<SkillFilesResult | null>(null);
  const [conflicts, setConflicts] = useState<string[] | null>(null);
  const [done, setDone] = useState<string[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const take = async (picked: PickedFile[]) => {
    setDone(null);
    setFailure(null);
    setConflicts(null);
    const result = await gatherSkillFiles(picked);
    setPlan(result);
    if (result.error) return;
    await send(result, false);
  };

  const send = async (p: SkillFilesResult, overwrite: boolean) => {
    setBusy(true);
    try {
      const a = await post(p.files, overwrite);
      if (a.status === 409 && a.body.conflicts) {
        setConflicts(a.body.conflicts);
      } else if (a.status >= 200 && a.status < 300) {
        setConflicts(null);
        setDone(a.body.imported ?? p.slugs);
        onImported();
      } else {
        setFailure(a.body.error ?? `The server answered ${a.status}.`);
      }
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="sb-skill-import"
      data-testid="settings-skills-import"
      data-dropping={over ? 'true' : undefined}
      onDragOver={(e) => {
        if (!e.dataTransfer?.types?.includes('Files')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer) return;
        e.preventDefault();
        setOver(false);
        void pickedFromDrop(e.dataTransfer).then(take);
      }}
    >
      <p className="sb-row-sub" data-testid="settings-skills-import-hint" title="To copy from another project, choose its skills folder.">
        Drop skill files or a folder here, or choose them.
      </p>
      <div className="sb-acts">
        <button type="button" className="sb-pill sb-pill-solid" data-testid="settings-skills-import-files" disabled={busy} onClick={() => files.current?.click()}>
          Import files
        </button>
        <button type="button" className="sb-pill" data-testid="settings-skills-import-folder" disabled={busy} onClick={() => folder.current?.click()}>
          Import a folder
        </button>
        {/* Another surface owns the finder; this only asks for it. */}
        <button type="button" className="sb-pill" data-testid="settings-skills-find" onClick={() => window.dispatchEvent(new CustomEvent('seq:open-skills-finder'))}>
          Find skills on this computer
        </button>
      </div>
      <input ref={files} type="file" multiple hidden data-testid="settings-skills-file" onChange={(e) => { void take(pickedFromList(e.target.files)); e.target.value = ''; }} />
      <input
        ref={folder}
        type="file"
        multiple
        hidden
        data-testid="settings-skills-folder"
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => { void take(pickedFromList(e.target.files)); e.target.value = ''; }}
      />
      {children}
      {conflicts && plan ? (
        <div className="sb-note" role="alertdialog" aria-label="Replace skills" data-testid="settings-skills-conflict">
          <p>{conflicts.join(', ')} {conflicts.length === 1 ? 'is' : 'are'} already here. Replace {conflicts.length === 1 ? 'it' : 'them'}?</p>
          <div className="sb-acts">
            <button type="button" className="sb-pill sb-pill-solid" data-testid="settings-skills-replace" disabled={busy} onClick={() => void send(plan, true)}>
              Replace
            </button>
            <button type="button" className="sb-pill sb-pill-quiet" data-testid="settings-skills-keep" onClick={() => { setConflicts(null); setPlan(null); }}>
              Keep what is there
            </button>
          </div>
        </div>
      ) : null}
      {done ? (
        <p className="sb-ok" role="status" data-testid="settings-skills-imported">
          Imported {done.join(', ')}.
        </p>
      ) : null}
      {plan && plan.skipped.length > 0 ? (
        <p className="sb-note" data-testid="settings-skills-skipped">
          Left out: {plan.skipped.slice(0, 6).join('; ')}
          {plan.skipped.length > 6 ? `; and ${plan.skipped.length - 6} more` : ''}.
        </p>
      ) : null}
      {(plan?.error ?? failure) ? (
        <p className="sb-fail" role="alert" data-testid="settings-skills-import-failure">
          {plan?.error ?? failure}
        </p>
      ) : null}
    </div>
  );
}
