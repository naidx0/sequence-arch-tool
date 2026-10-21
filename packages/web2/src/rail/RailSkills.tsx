/* The Skills list (moved under its row from the old Skills group; same rows, same test ids). A skill is used by name:
   the click puts its command in the composer. */

import type { SkillsView } from '../settings/settingsClient';
import { RailRow } from '../shell2/RailRow';
import { S2Icon } from '../shell2/icons';
import { useStore } from '../state/connect';
import { RailNote } from './RailSection';

export function RailSkills({ skills, repoPath }: { skills: SkillsView | null; repoPath: string | null }) {
  const store = useStore();
  const list = skills?.skills ?? [];
  return (
    <div className="rail-list" data-testid="rail-list">
      {list.map((sk) => (
        <RailRow key={sk.slug} className="s2-it" data-testid="s2-skill" icon={<S2Icon name="bolt" small />} title={sk.description}>
          <button
            type="button"
            className="s2-it-hit s2-rail-hit"
            onClick={() => {
              store.dispatch({ type: 'composer/draft', text: `/${sk.slug} ` });
              document.querySelector<HTMLTextAreaElement>('[data-testid="s2-chat"] textarea')?.focus();
            }}
          >
            <span className="s2-t">{sk.name}</span>
          </button>
        </RailRow>
      ))}
      {list.length === 0 ? <RailNote testId="s2-skills-empty">{repoPath ? 'No skills yet. Add one in .sequence/skills.' : 'Open a project to use its skills.'}</RailNote> : null}
    </div>
  );
}
