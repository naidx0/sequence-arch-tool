import { useId } from 'react';
import type { AgentCaps } from '../agents/agentRuns';
import './r9.css';

/** A model's explicit empty effort list also overrides the provider's list. */
export function modelEfforts(caps: AgentCaps | undefined, modelId?: string): string[] {
  const model = caps?.models.find(m => m.id === modelId)
    ?? caps?.models.find(m => m.isDefault) ?? caps?.models[0];
  return [...new Set(model ? model.efforts : (caps?.efforts ?? []))];
}

export interface EffortSliderProps {
  choices: readonly string[];
  value?: string;
  onChange: (value: string) => void;
  label?: string;
}

/** Native range supplies Arrow, Home and End semantics; wire values stay literal. */
export function EffortSlider({ choices, value, onChange, label = 'Reasoning effort' }: EffortSliderProps) {
  const id = useId();
  const unique = [...new Set(choices)];
  if (!unique.length) return null;
  const index = Math.max(0, unique.indexOf(value ?? ''));
  return (
    <div className="r9-effort" data-testid="effort-slider">
      <label htmlFor={id}>{label}<output htmlFor={id}>{value && unique.includes(value) ? value : 'Provider default'}</output></label>
      <input id={id} type="range" min={0} max={unique.length - 1} step={1} value={index}
        disabled={unique.length === 1} aria-label={label} aria-valuetext={value && unique.includes(value) ? value : 'Provider default'}
        onChange={e => { const next = unique[Number(e.target.value)]; if (next !== undefined) onChange(next); }} />
      <div className="r9-effort-labels" aria-hidden="true">
        {unique.map(e => <span key={e} data-selected={e === value || undefined}>{e}</span>)}
      </div>
    </div>
  );
}
