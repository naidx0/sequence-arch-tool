/* ══════════════════════════════════════════════════════════════════════════
   THE SIDEBAR'S ICON RAIL (round 11, UX audit 5)
   packages/web2/src/shell2/SessionRail.tsx

   Opening a second surface at 1440 folds the sidebar for room, and New chat
   and Settings went with it, silently. A folded sidebar now leaves a 48 px
   rail: Show sidebar (it peeks over the content, Esc closes it), New chat and
   Settings, each with its name. The reader's stored choice is untouched, and
   the rail goes the moment the room comes back.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';

import { RailBody } from '../rail/RailBodyLazy';
import { RailSection } from '../rail/RailSection';
import { RAIL_SECTIONS, type RailSectionId } from '../rail/railSections';
import { createSettingsClient, type SkillsView } from '../settings/settingsClient';
import { sessionsClient } from '../sessions/sessionsClient';
import { groundedRepoRoot, useAppState, useStore } from '../state/connect';
import { createNewChat } from '../v3/sessionActions';
import { AsciiSpinner } from './AsciiSpinner';
import { S2Icon } from './icons';

import '../rail/sectionRail.css';

const defaultSkills = async (): Promise<SkillsView | null> => {
  const answer = await createSettingsClient().skills();
  return answer.outcome === 'ok' ? answer.body : null;
};

export function SessionRail({
  onExpand,
  onOpenSettings,
  covered = false,
  railFetch,
  skillsSource = defaultSkills,
}: {
  onExpand: () => void;
  onOpenSettings?: () => void;
  /** The sidebar is peeking over it: it keeps its room but leaves the tab order and the accessibility tree. */
  covered?: boolean;
  /** The fetch the section views read through (tests inject one). */
  railFetch?: typeof fetch;
  skillsSource?: () => Promise<SkillsView | null>;
}) {
  const store = useStore();
  const state = useAppState();
  const [creating, setCreating] = useState(false);
  const repoPath = groundedRepoRoot(state);
  /* The same sections the open sidebar lists, each opening its view in a floating panel beside the strip. */
  const [openSection, setOpenSection] = useState<RailSectionId | null>(null);
  const [skills, setSkills] = useState<SkillsView | null>(null);
  const flyRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (openSection !== 'skills' || !repoPath) return undefined;
    let live = true;
    void skillsSource().then((view) => {
      if (live) setSkills(view);
    });
    return () => {
      live = false;
    };
  }, [openSection, repoPath, skillsSource]);
  const closeFly = (focusBack = true) => {
    if (focusBack) navRef.current?.querySelector<HTMLElement>('[aria-expanded="true"]')?.focus();
    setOpenSection(null);
  };
  /* A press outside the flyout and the strip closes it. */
  useEffect(() => {
    if (!openSection) return undefined;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (flyRef.current?.contains(t) || navRef.current?.contains(t))) return;
      setOpenSection(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [openSection]);
  const newChat = async () => {
    if (creating) return;
    setCreating(true);
    try {
      await createNewChat(store, sessionsClient, repoPath ? 'code' : 'work');
    } finally {
      setCreating(false);
    }
  };
  return (
    <>
    <nav ref={navRef} className={`s2-iconrail${covered ? ' is-covered' : ''}`} aria-label="Sidebar, folded" data-testid="s2-iconrail" aria-hidden={covered ? 'true' : undefined} {...(covered ? { inert: '' } : {})}>
      <button type="button" className="s2-ibtn" aria-label="Show sidebar" title="Show sidebar" data-testid="s2-iconrail-expand" onClick={onExpand}>
        <S2Icon name="sidebar" />
      </button>
      <button type="button" className="s2-btn s2-solid s2-iconrail-new" aria-label="New chat" title="New chat" data-testid="s2-iconrail-new-chat" disabled={creating} onClick={() => void newChat()}>
        {creating ? <AsciiSpinner /> : <S2Icon name="plus" />}
      </button>
      {RAIL_SECTIONS.map((sec) => (
        <button
          key={sec.id}
          type="button"
          className={`s2-ibtn${openSection === sec.id ? ' is-on' : ''}`}
          aria-label={sec.label}
          title={sec.label}
          aria-expanded={openSection === sec.id}
          aria-controls="rail-section"
          data-testid={`s2-iconrail-${sec.id}`}
          onClick={() => (openSection === sec.id ? closeFly() : setOpenSection(sec.id))}
        >
          <S2Icon name={sec.icon} />
        </button>
      ))}
      <span className="s2-grow" />
      <button type="button" className="s2-ibtn" aria-label="Settings" title="Settings" data-testid="s2-iconrail-settings" onClick={onOpenSettings}>
        <S2Icon name="sliders" />
      </button>
    </nav>
    {openSection && !covered ? (
      <div ref={flyRef} className="rail-fly" data-testid="rail-fly">
        <RailSection id={openSection} variant="fly" onClose={closeFly}>
          <RailBody id={openSection} fetchImpl={railFetch} skills={skills} repoPath={repoPath} onDone={() => closeFly(false)} />
        </RailSection>
      </div>
    ) : null}
    </>
  );
}
