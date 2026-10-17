/* ══════════════════════════════════════════════════════════════════════════
   ONE RAIL ROW (round 8)
   packages/web2/src/shell2/RailRow.tsx

   Jaden: "issues between the rail... file rail and the session rails. These
   things should realistically be matching." Every rail draws its rows with
   this: the session sidebar's projects and chats, and the Files tree. One
   height, one inset, one radius, one 16 px chevron slot and one 16 px icon
   slot, one type size and weight, one hover and one selected fill, and one
   indent per level (shell2.css, "ONE RAIL ROW"). The chevron slot is there on
   every row, drawn or not, so every icon at a depth lands on one line.

   A row that needs a whole-row button (a chat) puts it in `children` with the
   class `s2-rail-hit`: the button stretches over the row, so the row keeps its
   geometry and the button its 100 percent target.
   ══════════════════════════════════════════════════════════════════════════ */

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

export const RAIL_ROW = 's2-rail-row';

export interface RailRowProps extends HTMLAttributes<HTMLDivElement> {
  /** 0 for a top-level row; each level indents by one step. */
  depth?: number;
  selected?: boolean;
  /** What the chevron slot holds (a fold control or a chevron); empty keeps the slot. */
  twist?: ReactNode;
  /** The row's glyph, drawn in the 16 px icon slot. */
  icon?: ReactNode;
  /** A small mark on the icon's corner (a worktree's branch). */
  badge?: ReactNode;
}

export function RailRow({ depth = 0, selected = false, twist, icon, badge, className, style, children, ...rest }: RailRowProps) {
  return (
    <div
      {...rest}
      className={[RAIL_ROW, selected ? 'is-on' : '', className ?? ''].filter(Boolean).join(' ')}
      data-rail-depth={depth}
      style={{ ...style, '--rail-depth': depth } as CSSProperties}
    >
      <span className="s2-rail-twist">{twist ?? null}</span>
      <span className="s2-rail-ic" aria-hidden="true">
        {icon ?? null}
        {badge ? <span className="s2-rail-badge">{badge}</span> : null}
      </span>
      {children}
    </div>
  );
}
