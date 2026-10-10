/* One door to the command palette for anything that is not the keyboard: the
   sidebar's Commands row and the chat's more menu ask for it by event, so the
   palette keeps owning its own open state (shell/CommandSurface). */
export const PALETTE_EVENT = 'seq:palette';

export function openCommandPalette(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PALETTE_EVENT));
}
