/* The overview rail: when it is shown, and the reader's own choice. Pure rules plus one stored flag. */
import { useCallback, useState } from 'react';

/** Narrower than this and the rail would take the chat's room (the shell's stage-narrow width is 1200, its sidebar folds near 1180). */
export const OVERVIEW_MIN_W = 1180;
export const OVERVIEW_KEY = 'v3.overview';
/** A stored fold from an older build. Nothing reads or writes it now: a chat that is alone cannot be minimised by hand. */
export const OVERVIEW_PILL_KEY = 'v3.overview.pill';

export interface OverviewVisibility {
  /** No surface is open: the chat is alone (Shell2's `centred`). */
  alone: boolean;
  winW: number;
  /** The Agents dock takes the same place on the right. */
  agentsOpen: boolean;
  /** The reader's stored choice. Not read for a chat that is alone: it cannot be hidden by hand (0184 finish). */
  open: boolean;
  /** With a surface open the rail yields its column; the reader pressing the toggle puts it back beside the surface (this session only). */
  beside?: boolean;
}

/**
 * Whether the toggle is offered: any window at least OVERVIEW_MIN_W wide, with or without a surface open.
 * The rule for the rail itself: it shows by default while no surface is open; a surface opening (Quick open, the
 * Files list, the bar) takes its column and the toggle stays; pressing the toggle brings it back beside the surface.
 * The Agents dock shares the column: pressing the toggle then closes the dock, and opening the dock yields the rail.
 */
export function overviewAvailable(v: Pick<OverviewVisibility, 'winW'>): boolean {
  return v.winW >= OVERVIEW_MIN_W;
}

export function overviewVisible(v: OverviewVisibility): boolean {
  return overviewAvailable(v) && !v.agentsOpen && (v.alone || v.beside === true);
}

export function readOverviewOpen(): boolean {
  try {
    return localStorage.getItem(OVERVIEW_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeOverviewOpen(open: boolean): void {
  try {
    localStorage.setItem(OVERVIEW_KEY, open ? '1' : '0');
  } catch {
    /* storage unavailable: the choice lasts for this session only */
  }
}

/** The stored choice, on by default. */
export function useOverviewOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(readOverviewOpen);
  const toggle = useCallback(() => {
    setOpen((was) => {
      writeOverviewOpen(!was);
      return !was;
    });
  }, []);
  return [open, toggle];
}
