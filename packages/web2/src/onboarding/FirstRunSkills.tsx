/* ══════════════════════════════════════════════════════════════════════════
   FIRST RUN: THE SKILLS STEP
   packages/web2/src/onboarding/FirstRunSkills.tsx

   A small pop-up card, click click click: "Bring your skills?" Bring them
   (search the known folders, import everything found at once), Skip, or Choose
   which (a compact checklist to deselect first). No typing, no path: the server
   looks in the known Claude, Codex and Cursor places on its own.
   Self-contained, so Settings > Skills mounts the same card.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';

import { Icon } from '../chat/Icon';
import type { OnboardingClient, FoundSkill, SkillsFound } from './onboardingClient';
import { clearPendingSkills, savePendingSkills } from './skillsPending';
import { copyText, SKILLS_PROMPT } from './skillsPrompt';

export interface FirstRunSkillsProps {
  client?: OnboardingClient;
  /** True while the step is on screen; the first look waits for it. */
  active: boolean;
  /** Its place on the setup track (data-card); omit when mounted on its own. */
  card?: number;
  /** Imported (or nothing left to import) and the person pressed Continue, or Skip. */
  onNext: () => void;
  /** An agent is connected: "Ask my agent" is live and hands its prompt to onAskAgent (the chat box). */
  agentConnected?: boolean;
  onAskAgent?: (prompt: string) => void;
  /** Standing alone over the app (Settings): take focus on open, onto Bring them. */
  modal?: boolean;
}

type View = 'ask' | 'choose';

/** The server's words for "this request was full; the rest wait for another". */
const CAP_MESSAGE = /press Import again/;

/** Which tool a found skill came from, in words; no folder is shown. */
export const sourceOf = (c: FoundSkill): string => (/\.claude/.test(c.shown) ? 'Claude' : /\.codex/.test(c.shown) ? 'Codex' : /\.cursor/.test(c.shown) ? 'Cursor' : 'This project');

export function FirstRunSkills({ client, active, card, onNext, agentConnected, onAskAgent, modal }: FirstRunSkillsProps) {
  const [found, setFound] = useState<SkillsFound | null>(null);
  const [view, setView] = useState<View>('ask');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** What came in: the name shown and the id Edit removes by (the skill name, or the path while it waits for a project). */
  const [brought, setBrought] = useState<{ id: string; name: string }[] | null>(null);
  const [editing, setEditing] = useState(false);
  /** Skills the project already had, left as they are: the line says so when nothing new came in. */
  const [already, setAlready] = useState(0);
  /** In the Edit list: the ones that stay. */
  const [stay, setStay] = useState<Set<string>>(new Set());
  /** Why some were not brought (one line each), shown as a count with the reasons on hover. */
  const [problems, setProblems] = useState<string[]>([]);
  const working = useRef(false);
  const bringRef = useRef<HTMLButtonElement | null>(null);
  const skipRef = useRef<HTMLButtonElement | null>(null);
  const continueRef = useRef<HTMLButtonElement | null>(null);
  const doneRef = useRef<HTMLButtonElement | null>(null);
  /** Confirmed with no project open: remembered, imported when one is. */
  const [waiting, setWaiting] = useState(false);
  const asked = useRef(false);
  /** Copy state: 'copied', or 'select' when the clipboard refused and the text is shown selected instead. */
  const [copy, setCopy] = useState<'idle' | 'copied' | 'select'>('idle');
  const promptBox = useRef<HTMLTextAreaElement | null>(null);
  const live = agentConnected === true && !!onAskAgent;

  const copyPrompt = async () => {
    setCopy((await copyText(SKILLS_PROMPT)) ? 'copied' : 'select');
  };
  useEffect(() => {
    if (copy === 'select') promptBox.current?.select();
  }, [copy]);

  const look = async (): Promise<SkillsFound | null> => {
    if (!client?.skillsFind) return null;
    setBusy(true);
    setFailure(null);
    const a = await client.skillsFind('');
    setBusy(false);
    if (!a.ok) {
      setFailure(a.message);
      return null;
    }
    setFound(a.body);
    setChecked(new Set(a.body.candidates.map((c) => c.path)));
    return a.body;
  };

  useEffect(() => {
    if (!active || asked.current) return;
    asked.current = true;
    void look();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const toggle = (p: string) =>
    setChecked((cur) => {
      const n = new Set(cur);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  /** One request imports up to a cap; the server names what did not fit, so ask again for the rest, automatically. */
  const bring = async (paths: string[]) => {
    if (!client?.skillsImport || paths.length === 0 || working.current) return;
    working.current = true;
    setBusy(true);
    setFailure(null);
    const imported: string[] = [];
    const notes = new Set<string>();
    let kept = 0;
    for (let round = 0; round < 30; round++) {
      const a = await client.skillsImport('', paths);
      if (!a.ok) {
        if (round > 0) {
          notes.add(a.message);
          break;
        }
        setBusy(false);
        working.current = false;
        if (a.needsProject) {
          savePendingSkills({ text: '', selected: paths });
          setWaiting(true);
          setBrought(paths.map((p) => ({ id: p, name: found?.candidates.find((c) => c.path === p)?.slug ?? p })));
        } else setFailure(a.message);
        return;
      }
      if (round === 0) kept = a.body.kept.length;
      imported.push(...a.body.imported);
      const capped = a.body.problems.filter((x) => CAP_MESSAGE.test(x));
      for (const x of a.body.problems) if (!CAP_MESSAGE.test(x)) notes.add(x);
      if (capped.length === 0) break;
      if (a.body.imported.length === 0) {
        for (const x of capped) notes.add(x);
        break;
      }
    }
    setBusy(false);
    working.current = false;
    setAlready(kept);
    setProblems([...notes]);
    setBrought(imported.map((n) => ({ id: n, name: n })));
  };

  const bringAll = async () => {
    const f = found ?? (await look());
    if (!f) return;
    await bring(f.candidates.map((c) => c.path));
  };

  const edit = () => {
    setStay(new Set((brought ?? []).map((b) => b.id)));
    setEditing(true);
  };
  const toggleStay = (id: string) =>
    setStay((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  /** Done in Edit: what was unticked goes. Only skills just brought into the project are removed, by name. */
  const finishEdit = async () => {
    const all = brought ?? [];
    const drop = all.filter((b) => !stay.has(b.id));
    if (drop.length === 0) {
      setEditing(false);
      return;
    }
    if (waiting) {
      const keep = all.filter((b) => stay.has(b.id));
      if (keep.length > 0) savePendingSkills({ text: '', selected: keep.map((b) => b.id) });
      else clearPendingSkills();
    } else if (client?.skillsRemove) {
      setBusy(true);
      setFailure(null);
      const a = await client.skillsRemove(drop.map((b) => b.id));
      setBusy(false);
      if (!a.ok) {
        setFailure(a.message);
        return;
      }
    }
    setAlready(0);
    setProblems([]);
    setBrought(all.filter((b) => stay.has(b.id)));
    setEditing(false);
  };

  const rows: FoundSkill[] = found?.candidates ?? [];
  const none = found !== null && rows.length === 0 && !busy;

  /* Standing alone (Settings): focus lands on Bring them, or Skip when there is nothing to bring. */
  useEffect(() => {
    if (!modal || !active || brought) return;
    (none ? skipRef : bringRef).current?.focus();
  }, [modal, active, none, brought]);
  /* After Bring them, and after Edit > Done, the focus goes to the next thing to press, not to the page. */
  useEffect(() => {
    if (!brought || !active) return;
    (editing ? doneRef : continueRef).current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brought !== null, editing, active]);

  return (
    <section
      className="fr-card fr-skills"
      data-card={card}
      aria-hidden={card === undefined ? undefined : !active}
      data-testid="first-run-setup-skills"
      data-found={rows.length}
      data-view={brought ? (editing ? 'edit' : 'done') : view}
      onKeyDown={(e) => {
        /* Escape is Skip: always one key away, whatever the card is showing. */
        if (e.key === 'Escape') {
          e.stopPropagation();
          onNext();
        }
      }}
    >
      <h2 className="fr-card-t">Bring your skills?</h2>
      {brought && !editing ? (
        <p className="fr-card-sub" data-testid="first-run-skills-result">
          {brought.length === 0
            ? already > 0
              ? 'Nothing new: already in this project.'
              : 'No skills kept.'
            : waiting
              ? `Saved. ${brought.length} will come in when you open a project.`
              : `Brought ${brought.length} skill${brought.length === 1 ? '' : 's'}: ${brought.slice(0, 3).map((b) => b.name).join(', ')}${brought.length > 3 ? `, +${brought.length - 3}` : ''}.`}
        </p>
      ) : brought ? (
        <p className="fr-card-sub">Untick the ones to drop.</p>
      ) : (
        <p className="fr-card-sub" data-testid="first-run-skills-where">
          {none ? 'Nothing found in Claude, Codex or Cursor.' : 'Looks in Claude, Codex and Cursor.'}
        </p>
      )}
      {brought && !editing && problems.length > 0 ? (
        <p className="fr-card-sub" data-testid="first-run-skills-problems" title={problems.join('; ')}>
          + {problems.length} not brought
        </p>
      ) : null}
      {!brought && found?.truncated ? (
        <p className="fr-card-sub" data-testid="first-run-skills-more">
          + more not shown
        </p>
      ) : null}
      {brought && editing ? (
        <ul className="fr-lines" data-testid="first-run-skills-edit-rows">
          {brought.map((b) => (
            <li key={b.id} className="fr-line" data-testid="first-run-skills-edit-row">
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-8)', flex: '1 1 auto', minWidth: 0 }}>
                <input type="checkbox" data-testid="first-run-skills-edit-check" checked={stay.has(b.id)} onChange={() => toggleStay(b.id)} />
                <span className="fr-line-name">{b.name}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      {!brought && view === 'choose' ? (
        <ul className="fr-lines" data-testid="first-run-skills-rows">
          {rows.map((c) => (
            <li key={c.path} className="fr-line" data-testid="first-run-skills-row" data-kind={c.kind}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-8)', flex: '1 1 auto', minWidth: 0 }}>
                <input type="checkbox" data-testid="first-run-skills-check" checked={checked.has(c.path)} onChange={() => toggle(c.path)} />
                <span className="fr-line-name">{c.slug}</span>
                <span className="fr-line-sub">{sourceOf(c)}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      {!brought && view === 'ask' ? (
        <div className="fr-agent-row" data-testid="first-run-skills-agent" data-live={live ? 'true' : 'false'} >
          {live ? (
            <button
              type="button"
              className="fr-btn"
              data-testid="first-run-skills-ask-agent"
              onClick={() => {
                onAskAgent?.(SKILLS_PROMPT);
                onNext();
              }}
            >
              Ask my agent
            </button>
          ) : (
            <>
              <span className="fr-agent-l" data-testid="first-run-skills-no-agent">
                No agent connected
              </span>
              <button type="button" className="fr-btn" data-testid="first-run-skills-copy-prompt" onClick={() => void copyPrompt()}>
                {copy === 'copied' ? 'Copied' : 'Copy prompt for Claude or Codex'}
              </button>
            </>
          )}
        </div>
      ) : null}
      {!brought && view === 'ask' && !live && copy === 'select' ? (
        <textarea ref={promptBox} className="fr-input fr-agent-text" readOnly rows={3} value={SKILLS_PROMPT} data-testid="first-run-skills-prompt-text" aria-label="Prompt to send to your agent" onFocus={(e) => e.currentTarget.select()} />
      ) : null}
      {failure ? (
        <p className="fr-card-sub" role="alert" data-testid="first-run-skills-error">
          {failure}
        </p>
      ) : null}
      <div className="fr-card-acts">
        {brought && editing ? (
          <button ref={doneRef} type="button" className="fr-btn fr-primary" data-testid="first-run-skills-edit-done" disabled={busy} onClick={() => void finishEdit()}>
            <Icon name="check" size={12} /> Done
          </button>
        ) : brought ? (
          <>
            <button ref={continueRef} type="button" className="fr-btn fr-primary" data-testid="first-run-skills-next" onClick={onNext}>
              <Icon name="check" size={12} /> Continue
            </button>
            {brought.length > 0 ? (
              <button type="button" className="fr-ghost" data-testid="first-run-skills-edit" onClick={edit}>
                Edit
              </button>
            ) : null}
          </>
        ) : view === 'choose' ? (
          <button type="button" className="fr-btn fr-primary" data-testid="first-run-skills-import" disabled={busy || checked.size === 0} onClick={() => void bring([...checked])}>
            Bring {checked.size}
          </button>
        ) : (
          <button ref={bringRef} type="button" className="fr-btn fr-primary" data-testid="first-run-skills-bring" disabled={none} onClick={() => void bringAll()}>
            Bring them
          </button>
        )}
        {!brought ? (
          <button ref={skipRef} type="button" className="fr-ghost" data-testid="first-run-skills-skip" onClick={onNext}>
            Skip
          </button>
        ) : null}
        {!brought && view === 'ask' ? (
          <button type="button" className="fr-ghost" data-testid="first-run-skills-choose" disabled={none} onClick={() => setView('choose')}>
            Choose which
          </button>
        ) : null}
      </div>
    </section>
  );
}
