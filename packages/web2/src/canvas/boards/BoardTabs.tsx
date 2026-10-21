/* ══════════════════════════════════════════════════════════════════════════
   THE BOARD TAGS — every board of the project as a pill
   packages/web2/src/canvas/boards/BoardTabs.tsx

   Jaden, round 8: "just be able to smartly choose between which board they
   want to use … the boards have like tags … between the separate tab
   surfaces." One strip, drawn the same on the Architecture and the Whiteboard
   surfaces, so the two read as one Boards concept: the Architecture board
   (graph glyph) first, then each whiteboard (pen glyph), then "+".

   B's pill (board.css `.vt`): the open board is the raised one. Double-click
   a whiteboard's name to rename it; its x asks first, in B's confirm dialog,
   because a board's drawing goes with it.

   Rendered at boot with the Architecture pill alone (the index loads after the
   board's first layout), so the strip's height never changes under the board.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { ConfirmDialog } from '../../shell2/ConfirmDialog';
import { S2Icon } from '../../shell2/icons';
import { useActiveSessionIdIfAny, useSessionsIfAny } from '../../state/connect';
import { boardsApi } from './boardsClient';
import { ARCH_BOARD_ID, boardLabel, type BoardMeta, type BoardsIndex, type LinkableBoards } from './boardsModel';
import './boards.css';

export interface BoardTabsProps {
  index: BoardsIndex | null;
  /** The board on screen. */
  current: string;
  onOpen: (board: BoardMeta) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Items per board, when the surface knows (shown in the delete question). */
  itemCount?: (id: string) => number | null;
  /**
   * Fold to the one pill whenever the tags would not fit the strip (measured), not only at the pane widths the
   * stylesheet names. For a strip whose width is set by its place (the whiteboard's, absolutely placed), not by
   * its own content (the architecture toolbar's, which folds on the board's width in board.css).
   */
  measureFold?: boolean;
  /** The strip's own name: "Boards" beside the architecture board, "Spaces" on the Spaces surface. */
  caption?: string;
  /** A Space was added from another chat (linked, not copied). The surface opens it; the stream refreshes the list. */
  onLinked?: (board: BoardMeta) => void;
}

/** A Space another chat also holds: removing it here unlinks it and the drawing stays there. */
/* With no chat open a delete is project wide: how many chats hold this Space, when more than one does. */
const heldByChats = (b: BoardMeta, chat: string | null): number => (chat === null ? (b.chats ?? []).length : 0);
const linkedElsewhere = (b: BoardMeta, chat: string | null): boolean => chat !== null && (b.chats ?? []).length > 1 && (b.chats ?? []).includes(chat);

const ARCH_PLACEHOLDER: BoardMeta = {
  id: ARCH_BOARD_ID,
  name: 'Architecture',
  kind: 'architecture',
  rev: 0,
  createdAt: '',
  updatedAt: '',
};

export function BoardTabs({ index, current, onOpen, onCreate, onRename, onDelete, itemCount, measureFold = false, caption = 'Boards', onLinked }: BoardTabsProps) {
  /* Spaces belong to a chat: with one open, + is a small menu (New space, Add from another chat). With none, + makes a board. */
  const chat = useActiveSessionIdIfAny();
  const sessions = useSessionsIfAny();
  const [addOpen, setAddOpen] = useState<null | 'menu' | 'pick'>(null);
  const [pick, setPick] = useState<LinkableBoards | 'loading' | 'failed' | null>(null);
  const addWrap = useRef<HTMLSpanElement | null>(null);
  const addMenu = useRef<HTMLDivElement | null>(null);
  /* Where the + menu hangs (viewport pixels, under the + button). */
  const [addPos, setAddPos] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!addOpen) return;
    const place = () => {
      /* Folded, the + is hidden and the picker (opened from the fold's list) hangs from the fold pill. */
      const plus = addWrap.current?.getBoundingClientRect();
      const r = plus && plus.width > 0 ? plus : fold.current?.getBoundingClientRect();
      if (!r) return;
      setAddPos({ top: Math.round(r.bottom + 6), left: Math.max(8, Math.min(Math.round(r.left), window.innerWidth - 280)) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [addOpen]);
  const chatTitle = (id: string): string => sessions.find((s) => s.id === id)?.title || 'Earlier chat';
  useEffect(() => {
    if (!addOpen) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (addWrap.current && !addWrap.current.contains(t) && !addMenu.current?.contains(t)) setAddOpen(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setAddOpen(null);
      addWrap.current?.querySelector<HTMLButtonElement>('[data-testid="board-tab-new"]')?.focus();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key, true);
    };
  }, [addOpen]);
  useEffect(() => {
    if (!addOpen) return;
    addMenu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [addOpen, pick]);
  const addKeys = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = [...(addMenu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]!.focus();
  };
  const openPicker = () => {
    if (!chat) return;
    setAddOpen('pick');
    setPick('loading');
    boardsApi.linkable(chat).then(
      (found) => setPick(found),
      () => setPick('failed'),
    );
  };
  const addFrom = (b: BoardMeta) => {
    if (!chat) return;
    setAddOpen(null);
    void boardsApi.link(b.id, chat).then((meta) => onLinked?.(meta), () => undefined);
  };
  /* The names are the ones the reader sees: a stored default "Whiteboard" displays as Space (boardLabel). */
  const boards = (index?.boards ?? [ARCH_PLACEHOLDER]).map((b) => ({ ...b, name: boardLabel(b) }));
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirm, setConfirm] = useState<BoardMeta | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  /* The fold: on a narrow board the tags become one pill and this list (board.css, boards.css, container boardstack). */
  const [foldOpen, setFoldOpen] = useState(false);
  const fold = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!foldOpen) return;
    const away = (e: PointerEvent) => {
      if (fold.current && !fold.current.contains(e.target as Node)) setFoldOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setFoldOpen(false);
      fold.current?.querySelector<HTMLButtonElement>('[data-testid="board-tab-fold"]')?.focus();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key, true);
    };
  }, [foldOpen]);
  /* Opening the list puts focus on the open board's row; arrows, Home and End walk the rows (menu pattern). */
  useEffect(() => {
    if (!foldOpen) return;
    const items = fold.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]');
    const on = fold.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]');
    (on ?? items?.[0])?.focus();
  }, [foldOpen]);
  const foldKeys = (e: React.KeyboardEvent) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const items = [...(fold.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]!.focus();
  };
  const shownBoard = boards.find((b) => b.id === current) ?? boards[0]!;
  /* 0.1.5 review: in a 240 px whiteboard pane two tags and + need 196 px of a 146 px strip; the tag's x was cut and
     + hidden. The tags are measured unfolded (the fold lifted for the reading, in the same layout pass, so nothing
     paints) and fold to the one pill when they would not fit; again whenever the strip or the boards change. */
  const strip = useRef<HTMLDivElement | null>(null);
  const tabsId = useId();
  const [tight, setTight] = useState(false);
  const boardsKey = boards.map((b) => `${b.id}\u0000${b.name}`).join('\u0001');
  useLayoutEffect(() => {
    const el = strip.current;
    if (!measureFold || !el) return undefined;
    const measure = () => {
      const was = el.getAttribute('data-fold');
      if (was) el.removeAttribute('data-fold');
      const over = el.scrollWidth > el.clientWidth + 1;
      if (was) el.setAttribute('data-fold', was);
      setTight(over);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureFold, boardsKey, editing?.id]);
  /* Renaming opens the tag's field: never folded away under the person's cursor. */
  const folded = measureFold && tight && !editing;
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    if (!editing) return;
    const name = editing.name.trim();
    const was = boards.find((b) => b.id === editing.id)?.name;
    setEditing(null);
    if (name && name !== was) onRename(editing.id, name);
  };

  return (
    <div
      ref={strip}
      className="board-tabs"
      role="group"
      aria-label={caption}
      data-testid="board-tabs"
      data-solo={boards.length === 1 ? 'true' : undefined}
      data-many={boards.length > 2 ? 'true' : undefined}
      data-fold={folded ? 'true' : undefined}
    >
      {/* The strip's own name (round 0.1.5): the window bar above lists SURFACES (Architecture, Whiteboard...); this lists the
          BOARDS inside, so the same word in both places reads as two different things. Folded away when the pane is narrow. */}
      <span className="btag-cap" aria-hidden="true">{caption}</span>
      {/* The strip also holds each whiteboard's delete button and the add button, and a tablist may hold nothing but tabs. So the
          tablist is this empty owner and the tabs are handed to it by id; the pills keep their look and their buttons. */}
      <span
        className="btag-owner"
        role="tablist"
        aria-label={caption}
        aria-owns={boards.filter((b) => editing?.id !== b.id).map((b) => `${tabsId}-${b.id}`).join(' ') || undefined}
      />
      {boards.map((b) => {
        const on = b.id === current;
        if (editing?.id === b.id) {
          return (
            <span key={b.id} className="btag is-editing" data-on={on ? 'true' : 'false'}>
              <S2Icon name={b.kind === 'architecture' ? 'nodes' : 'pen'} small />
              <input
                ref={input}
                className="btag-input"
                data-testid="board-tab-rename"
                aria-label={`Rename ${b.name}`}
                value={editing.name}
                maxLength={60}
                onChange={(e) => setEditing({ id: b.id, name: e.target.value })}
                onBlur={commit}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') setEditing(null);
                }}
              />
            </span>
          );
        }
        return (
          <span key={b.id} className="btag" data-on={on ? 'true' : 'false'} data-kind={b.kind}>
            <button
              type="button"
              role="tab"
              id={`${tabsId}-${b.id}`}
              className="btag-main"
              aria-selected={on}
              data-testid={`board-tab-${b.id}`}
              data-board-kind={b.kind}
              /* The name is the accessible name and the tooltip even when a narrow board folds the tag to its icon (board.css). */
              aria-label={b.name}
              title={b.kind === 'architecture' ? `${b.name}: the scanned architecture, with a drawing layer on top` : `${b.name}: a board (double-click to rename)`}
              onClick={() => onOpen(b)}
              onDoubleClick={() => {
                /* The architecture board is named by what it is; whiteboards are named by you. */
                if (b.kind === 'whiteboard') setEditing({ id: b.id, name: b.name });
              }}
            >
              <S2Icon name={b.kind === 'architecture' ? 'nodes' : 'pen'} small />
              <span className="btag-t">{b.name}</span>
            </button>
            {b.kind === 'whiteboard' ? (
              <button
                type="button"
                className="btag-x"
                data-testid={`board-tab-delete-${b.id}`}
                aria-label={`Delete ${b.name}`}
                title={`Delete ${b.name}`}
                onClick={() => setConfirm(b)}
              >
                <S2Icon name="x" small />
              </button>
            ) : null}
          </span>
        );
      })}
      <span className="btag-addwrap" ref={addWrap} data-testid="board-tab-add-wrap">
        <button
          type="button"
          className="btag-add"
          data-testid="board-tab-new"
          aria-label={chat ? 'Add a board' : 'New board'}
          title={chat ? 'Add a board' : 'New board'}
          aria-haspopup={chat ? 'menu' : undefined}
          aria-expanded={chat ? addOpen !== null : undefined}
          disabled={index === null}
          onClick={() => (chat ? setAddOpen((o) => (o ? null : 'menu')) : onCreate())}
        >
          <S2Icon name="plus" small />
        </button>
        {chat && addOpen
          ? /* In the body, not in the strip: the strip scrolls sideways and clips what hangs below it, and its pane is a layout container, which would also catch a fixed child. */
            createPortal(
              <div className="board-scope btag-add-portal" style={{ display: 'contents' }}>
<div ref={addMenu} className="bview-list btag-fold-list" role="menu" aria-label="Add a board" data-testid="board-tab-add-menu" onKeyDown={addKeys} style={{ position: 'fixed', top: addPos.top, left: addPos.left, zIndex: 40 }}>
            {addOpen === 'menu' ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="bview-item"
                  data-testid="board-tab-add-new"
                  onClick={() => {
                    setAddOpen(null);
                    onCreate();
                  }}
                >
                  <S2Icon name="plus" small />
                  <span className="bview-item-t">New board</span>
                </button>
                <button type="button" role="menuitem" className="bview-item" data-testid="board-tab-add-from" onClick={openPicker}>
                  <S2Icon name="pen" small />
                  <span className="bview-item-t">Add from another chat…</span>
                </button>
              </>
            ) : pick === 'loading' || pick === 'failed' || pick === null ? (
              <span className="bview-item-k" role="none" data-testid="board-tab-add-status">
                {pick === 'failed' ? 'Could not load boards.' : 'Loading boards…'}
              </span>
            ) : pick.groups.length === 0 && pick.earlier.length === 0 ? (
              <span className="bview-item-k" role="none" data-testid="board-tab-add-status">
                No boards in other chats.
              </span>
            ) : (
              <>
                {pick.groups.map((g) => (
                  <div key={g.chat} role="group" aria-label={chatTitle(g.chat)} data-testid={`board-tab-add-group-${g.chat}`}>
                    <span className="bview-item-k" role="none">{chatTitle(g.chat)}</span>
                    {g.boards.map((b) => (
                      <button key={b.id} type="button" role="menuitem" className="bview-item" data-testid={`board-tab-add-${g.chat}-${b.id}`} onClick={() => addFrom(b)}>
                        <S2Icon name="pen" small />
                        <span className="bview-item-t">{boardLabel(b)}</span>
                      </button>
                    ))}
                  </div>
                ))}
                {pick.earlier.length > 0 ? (
                  <div role="group" aria-label="Earlier boards" data-testid="board-tab-add-group-earlier">
                    <span className="bview-item-k" role="none">Earlier boards</span>
                    {pick.earlier.map((b) => (
                      <button key={b.id} type="button" role="menuitem" className="bview-item" data-testid={`board-tab-add-earlier-${b.id}`} onClick={() => addFrom(b)}>
                        <S2Icon name="pen" small />
                        <span className="bview-item-t">{boardLabel(b)}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
              </div>,
              document.body,
            )
          : null}
      </span>
      <span className="btag-fold" ref={fold} data-testid="board-tab-fold-wrap">
        <button
          type="button"
          className="vt btag-fold-btn"
          data-testid="board-tab-fold"
          aria-haspopup="menu"
          aria-expanded={foldOpen}
          aria-label={`Board: ${shownBoard.name}. Switch board`}
          title={`${shownBoard.name}: switch board`}
          onClick={() => setFoldOpen((o) => !o)}
        >
          <S2Icon name={shownBoard.kind === 'architecture' ? 'nodes' : 'pen'} small />
          <S2Icon name="chev" small />
        </button>
        {foldOpen ? (
          <div className="bview-list btag-fold-list" role="menu" aria-label={caption} data-testid="board-tab-fold-list" onKeyDown={foldKeys}>
            {boards.map((b) => (
              <span className="btag-fold-row" key={b.id} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={b.id === current}
                  className={`bview-item${b.id === current ? ' on' : ''}`}
                  data-testid={`board-tab-fold-${b.id}`}
                  onClick={() => {
                    setFoldOpen(false);
                    if (b.id !== current) onOpen(b);
                  }}
                >
                  <S2Icon name={b.kind === 'architecture' ? 'nodes' : 'pen'} small />
                  <span className="bview-item-t">{b.name}</span>
                </button>
                {b.kind === 'whiteboard' ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="btag-x"
                    data-testid={`board-tab-fold-delete-${b.id}`}
                    aria-label={`Delete ${b.name}`}
                    title={`Delete ${b.name}`}
                    onClick={() => {
                      setFoldOpen(false);
                      setConfirm(b);
                    }}
                  >
                    <S2Icon name="x" small />
                  </button>
                ) : null}
              </span>
            ))}
            <button
              type="button"
              role="menuitem"
              className="bview-item"
              data-testid="board-tab-fold-new"
              disabled={index === null}
              onClick={() => {
                setFoldOpen(false);
                onCreate();
              }}
            >
              <S2Icon name="plus" small />
              <span className="bview-item-t">New board</span>
            </button>
            {chat ? (
              <button
                type="button"
                role="menuitem"
                className="bview-item"
                data-testid="board-tab-fold-add-from"
                disabled={index === null}
                onClick={() => {
                  setFoldOpen(false);
                  openPicker();
                }}
              >
                <S2Icon name="pen" small />
                <span className="bview-item-t">Add from another chat…</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </span>
      {confirm ? (
        <ConfirmDialog
          icon="trash"
          danger
          title={linkedElsewhere(confirm, chat) ? `Remove "${confirm.name}" from this chat?` : `Delete "${confirm.name}"?`}
          body={
            linkedElsewhere(confirm, chat)
              ? 'It stays, with its drawing, in the other chats that have it.'
              : heldByChats(confirm, chat) > 1
                ? `It is in ${heldByChats(confirm, chat)} chats. Deleting it removes it, with its drawing, from all of them. The architecture board is not touched.`
                : 'Its drawing is deleted with it. The architecture board is not touched.'
          }
          items={(() => {
            const n = itemCount?.(confirm.id) ?? null;
            return n === null ? undefined : [{ label: confirm.name, meta: n === 1 ? '1 mark' : `${n} marks` }];
          })()}
          confirmLabel={linkedElsewhere(confirm, chat) ? 'Remove from chat' : 'Delete board'}
          testId="board-delete-confirm"
          okTestId="board-delete-ok"
          cancelTestId="board-delete-cancel"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const id = confirm.id;
            setConfirm(null);
            onDelete(id);
          }}
        />
      ) : null}
    </div>
  );
}
