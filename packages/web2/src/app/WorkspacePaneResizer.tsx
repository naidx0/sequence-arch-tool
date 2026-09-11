import { useEffect, useRef } from 'react';

import type { ChromeTabId } from './chromeTabModel';
import { WORKSPACE_PANE_MIN_PX, workspacePaneResizerTestId } from './chromeTabModel';

/**
 * Gutter between two workspace columns. Mirrors {@link PaneResizer} in the
 * frame shell — mouse events on the window, keyboard nudge, aria separator.
 */

export interface WorkspacePaneResizerProps {
  leftPane: ChromeTabId;
  rightPane: ChromeTabId;
  leftWidth: number;
  rightWidth: number;
  dragging: boolean;
  onResize: (leftWidth: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

const KEYBOARD_STEP = 8;

export function WorkspacePaneResizer({
  leftPane,
  rightPane,
  leftWidth,
  rightWidth,
  dragging,
  onResize,
  onDragStart,
  onDragEnd,
}: WorkspacePaneResizerProps) {
  const origin = useRef<{ x: number; width: number } | null>(null);
  const maxLeft = leftWidth + rightWidth - WORKSPACE_PANE_MIN_PX;
  const minLeft = WORKSPACE_PANE_MIN_PX;

  useEffect(() => {
    if (!dragging) return undefined;

    const move = (event: MouseEvent) => {
      const from = origin.current;
      if (!from) return;
      const next = from.width + (event.clientX - from.x);
      onResize(Math.min(maxLeft, Math.max(minLeft, next)));
    };
    const up = () => {
      origin.current = null;
      onDragEnd();
    };

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dragging, maxLeft, minLeft, onResize, onDragEnd]);

  return (
    <button
      type="button"
      className="shell-workspace-resizer"
      data-testid={workspacePaneResizerTestId(leftPane)}
      data-pane-left={leftPane}
      data-pane-right={rightPane}
      data-dragging={dragging ? 'true' : 'false'}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${leftPane} and ${rightPane}`}
      aria-valuenow={leftWidth}
      aria-valuemin={minLeft}
      aria-valuemax={maxLeft}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        origin.current = { x: event.clientX, width: leftWidth };
        onDragStart();
      }}
      onKeyDown={(event) => {
        const arrow = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
        if (arrow !== 0) {
          event.preventDefault();
          onResize(Math.min(maxLeft, Math.max(minLeft, leftWidth + arrow * KEYBOARD_STEP)));
          return;
        }
        if (event.key === 'Home') {
          event.preventDefault();
          onResize(minLeft);
        } else if (event.key === 'End') {
          event.preventDefault();
          onResize(maxLeft);
        }
      }}
    />
  );
}
