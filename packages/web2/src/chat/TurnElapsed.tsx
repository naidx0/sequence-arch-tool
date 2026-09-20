import { workedForLabel } from './transcriptModel';

export interface TurnElapsedProps {
  ms: number;
  live?: boolean;
}

export function TurnElapsed({ ms, live = false }: TurnElapsedProps) {
  return (
    <p
      className={`turn-elapsed${live ? ' turn-elapsed-live' : ''}`}
      data-testid="chat-turn-elapsed"
      data-live={live ? 'true' : undefined}
    >
      {workedForLabel(ms)}
    </p>
  );
}
