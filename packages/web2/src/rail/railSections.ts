/* The sidebar's navigation sections (0.1.8.4). Jaden: "the side rail where you have tabs ... that format, we can also
   focus and follow with selected coding workflows, maybe there you can navigate components and agent profiles as well,
   instead of just calling it all from the + icon and / commands". One list, read by the panel rows, the collapsed rail
   and the section views, so the three can never disagree about what exists. */

import type { S2IconName } from '../shell2/icons';

export type RailSectionId = 'workflows' | 'components' | 'profiles' | 'skills';

export interface RailSectionDef {
  id: RailSectionId;
  label: string;
  icon: S2IconName;
}

export const RAIL_SECTIONS: readonly RailSectionDef[] = [
  { id: 'workflows', label: 'Workflows', icon: 'nodes' },
  { id: 'components', label: 'Components', icon: 'box' },
  { id: 'profiles', label: 'Agent profiles', icon: 'agents' },
  { id: 'skills', label: 'Skills', icon: 'bolt' },
];

/** A list holding more than this many items gets a filter field. */
export const FILTER_AFTER = 8;
