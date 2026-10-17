import { Fragment } from 'react';

/* Settings copy is written with `backticks` around a path or a key; the screen shows it as code, never the ticks. */
export function Ticks({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}
