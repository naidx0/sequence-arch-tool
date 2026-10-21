/**
 * How much one agent may draw. A card is a status, not a page: past these the extra ops are dropped with a
 * diagnostic the agent can read (limits are applied by `capOps` in caps.ts, by the session and by the `ui` tool),
 * and the server refuses to store a spec over them.
 */
export const GENUI_LIMITS = {
  /** Surfaces (cards) one turn may open. */
  surfacesPerTurn: 8,
  /** Elements one surface may hold. */
  elementsPerSurface: 200,
} as const;
