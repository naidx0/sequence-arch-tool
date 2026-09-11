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
