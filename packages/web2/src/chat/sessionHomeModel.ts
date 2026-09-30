import type { SessionHomeChip, SessionHomeContextProps } from './SessionHomeContext';

export interface SessionHomeFacts {
  repo: string | null;
  branch: string | null;
  modelLabel: string;
}

/** Turn grounded facts into the chip row the empty thread shows. */
export function sessionHomeContextFrom(facts: SessionHomeFacts): SessionHomeContextProps {
  const chips: SessionHomeChip[] = [
    {
      id: 'repo',
      /* "local workspace", not "Workspace". The bare word is the rail's
         heading for the same root, and one word in two places meaning two
         different things is what made the owner read an attached repo as
         still being the default root (2026-09-20). This chip is read when
         NOTHING is attached, so it says what that is. `sessionHomeModel.test`
         has asserted this string since the model was written. */
      label: facts.repo ?? 'local workspace',
      icon: 'folder',
    },
  ];

  if (facts.repo !== null) {
    chips.push({
      id: 'branch',
      label: facts.branch?.trim() ? facts.branch : 'branch unknown',
      icon: 'branch',
    });
  }

  chips.push({
    id: 'model',
    label: facts.modelLabel,
    icon: 'model',
  });

  return { chips };
}
