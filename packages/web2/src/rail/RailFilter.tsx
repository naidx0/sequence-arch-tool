/* The filter field a list shows once it holds more than FILTER_AFTER items (the shell's own field, nothing new). */

import { S2Icon } from '../shell2/icons';
import { FILTER_AFTER } from './railSections';

export function RailFilter({ label, count, value, onChange }: { label: string; count: number; value: string; onChange: (v: string) => void }) {
  if (count <= FILTER_AFTER) return null;
  return (
    <label className="s2-field rail-filter">
      <S2Icon name="search" small />
      <input type="search" value={value} placeholder={label} aria-label={label} data-testid="rail-filter" onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
