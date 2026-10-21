/* The board's keys as the More menu prints them (boardKeys.ts binds them).
   A module of its own so the words load with the More menu, not at boot. */

export const BOARD_KEYS: ReadonlyArray<{ keys: string; does: string }> = [
  { keys: 'Space + drag', does: 'Pan, also while drawing' },
  { keys: 'Arrows', does: 'Select the next card' },
  { keys: 'Tab, then arrows', does: 'Move the focused card' },
  { keys: '+  −', does: 'Zoom in, out' },
  { keys: '0', does: 'Fit the board' },
  { keys: '1', does: '100%' },
  { keys: 'Esc', does: 'Back one step' },
];
