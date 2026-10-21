import { memo, useId, useState } from 'react';

import type { KnobSpec } from './knobs';

/**
 * ONE ADVANCED KNOB, WHICH OWNS ITS OWN TEXT (APP-01).
 *
 * The box used to write every keystroke into the panel's state, and the panel is
 * 2,800 lines: typing "120000" into Timeout re-rendered all of it six times, the
 * lag the audit saw under CPU load and the context of the one crash it logged.
 * The row now keeps the RAW STRING in its own state and tells the panel through
 * `onDraft`, which writes a ref (no render). The panel reads the ref at Save.
 * `React.memo` plus stable props mean a keystroke renders this row and nothing
 * else.
 *
 * The text is never coerced, trimmed or clamped here: any string is kept as typed
 * and judged elsewhere. `initial` is read once per mount; the panel remounts the
 * row (new key) when it loads a different model.
 */
export interface KnobRowProps {
  spec: KnobSpec;
  initial: string;
  /** The text as it stands when the reader leaves the box (blur): the panel validates it. */
  onCommit: (key: string, raw: string) => void;
  /** The sentence for this box's text, or null when it is fine (judged on blur by the panel). */
  error: string | null;
  onDraft: (key: string, raw: string) => void;
}

function KnobRowImpl({ spec: k, initial, onDraft, onCommit, error }: KnobRowProps) {
  const [text, setText] = useState(initial);
  const errId = useId();
  const write = (raw: string): void => {
    setText(raw);
    onDraft(k.key, raw);
  };
  return (
    <div className="sb-row sb-row-knob">
      <span className="sb-row-txt">
        <span className="sb-row-t">{k.label}</span>
        <span className="sb-row-sub">{k.hint}</span>
      </span>
      {k.slider ? (
        /* A real slider, like ChatGPT's and Codex's: it writes the same string the box does. */
        <input
          type="range"
          className="sb-slider"
          data-testid={`settings-knob-${k.key}-slider`}
          aria-label={k.label}
          min={k.slider.min}
          max={k.slider.max}
          step={k.slider.step}
          value={Number.isFinite(Number(text)) && text.trim() !== '' ? Number(text) : k.slider.rest}
          onChange={(e) => write(e.target.value)}
        />
      ) : null}
      <input
        className="sb-input sb-input-num"
        data-testid={`settings-knob-${k.key}`}
        aria-label={`${k.label} value`}
        inputMode="decimal"
        value={text}
        placeholder={k.placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        onChange={(e) => write(e.target.value)}
        onBlur={() => onCommit(k.key, text)}
      />
      {error ? (
        <span className="sb-knob-err" id={errId} role="alert" data-testid={`settings-knob-${k.key}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

export const KnobRow = memo(KnobRowImpl);
