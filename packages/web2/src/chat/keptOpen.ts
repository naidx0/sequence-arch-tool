/* What is open stays open (S6): the transcript is virtualized, so a card's open state lives here, by key. */
export const keptOpen = new Map<string, boolean>();

/** Tests: forget what was opened (runs in two tests can share ids). */
export function resetKeptOpen(): void {
  keptOpen.clear();
}

/** Set a card's remembered state from outside it (the rail opening a subagent). */
export function keepOpen(key: string, open: boolean): void {
  keptOpen.set(key, open);
}
