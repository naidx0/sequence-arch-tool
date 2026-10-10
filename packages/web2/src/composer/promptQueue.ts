/* ══════════════════════════════════════════════════════════════════════════
   THE EDITABLE QUEUE ABOVE THE COMPOSER (S5)
   packages/web2/src/composer/promptQueue.ts

   What a person types while a turn runs and does not steer into it waits
   here, per chat, as a LIST: they can edit an item, move it up or down, or
   take it back, and the items go one at a time, first to last, each after
   the turn before it settles. (The store's old `session.queued` held one
   string and no way to change it.)

   Pure operations on an immutable state, plus a tiny subscribable store so
   a React list and the drain loop read the same thing. Nothing here sends:
   `createQueueDrain` is handed a `send` and called when a turn settles.
   ══════════════════════════════════════════════════════════════════════════ */

export interface QueuedPrompt {
  id: string;
  text: string;
  /** The window that queued it. Only that window sends it; another window (or this one after a reload) holds it until Resume. */
  w?: string;
}

export type QueueItems = readonly QueuedPrompt[];

/* ── pure operations ────────────────────────────────────────────────────── */

export function enqueue(items: QueueItems, item: QueuedPrompt, opts: { front?: boolean } = {}): QueueItems {
  if (item.text.trim() === '') return items;
  return opts.front ? [item, ...items] : [...items, item];
}

export function editItem(items: QueueItems, id: string, text: string): QueueItems {
  /* Editing an item down to nothing is taking it back. */
  if (text.trim() === '') return removeItem(items, id);
  return items.map((i) => (i.id === id ? { ...i, text } : i));
}

export function moveItem(items: QueueItems, id: string, delta: -1 | 1): QueueItems {
  const at = items.findIndex((i) => i.id === id);
  const to = at + delta;
  if (at === -1 || to < 0 || to >= items.length) return items;
  const next = items.slice();
  [next[at], next[to]] = [next[to]!, next[at]!];
  return next;
}

export function removeItem(items: QueueItems, id: string): QueueItems {
  return items.some((i) => i.id === id) ? items.filter((i) => i.id !== id) : items;
}

/* ── the store, keyed by chat ───────────────────────────────────────────── */

export interface PromptQueue {
  items(key: string): QueueItems;
  subscribe(fn: () => void): () => void;
  add(key: string, text: string, opts?: { front?: boolean }): QueuedPrompt | null;
  edit(key: string, id: string, text: string): void;
  move(key: string, id: string, delta: -1 | 1): void;
  remove(key: string, id: string): void;
  /** Take the first item off (the drain sends it). */
  shift(key: string): QueuedPrompt | null;
  /** Items restored after a restart wait here, unsent, until the person presses Resume (T3 Code's held queue). */
  held(key: string): boolean;
  /** Let a held chat's queue go (the drain sends the first item). */
  release(key: string): void;
  /** Re-read one queue from storage (another window changed it). */
  reload(key: string): void;
}

/** Where a queue keeps its items between launches (localStorage's shape; `length` / `key` let it be scanned). */
export interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
  readonly length?: number;
  key?(index: number): string | null;
}

/** One storage entry per queue (so two windows never overwrite each other's chats), named by project and chat. */
export const QUEUE_STORAGE_PREFIX = 'sequence:pq:v2:';
/** A queue nobody opened for this long is dropped, so prompt text does not sit in storage forever. */
export const QUEUE_MAX_AGE_MS = 14 * 24 * 3600 * 1000;

function readEntry(storage: QueueStorage | null, key: string, now: number): QueueItems | null {
  try {
    const raw = storage?.getItem(QUEUE_STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: unknown; items?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    if (typeof parsed.at === 'number' && now - parsed.at > QUEUE_MAX_AGE_MS) return null;
    const items = parsed.items
      .filter((i): i is QueuedPrompt => !!i && typeof (i as QueuedPrompt).id === 'string' && typeof (i as QueuedPrompt).text === 'string' && (i as QueuedPrompt).text.trim() !== '')
      .map((i) => ({ id: i.id, text: i.text, ...(typeof i.w === 'string' ? { w: i.w } : {}) }));
    return items.length ? items : null;
  } catch {
    return null;
  }
}

/** Every queue in storage; old and unreadable entries are removed on the way. Total. */
export function readStoredQueue(storage: QueueStorage | null, now = Date.now()): Map<string, QueueItems> {
  const out = new Map<string, QueueItems>();
  try {
    const keys: string[] = [];
    for (let i = 0; storage && i < (storage.length ?? 0); i++) {
      const k = storage.key?.(i);
      if (k && k.startsWith(QUEUE_STORAGE_PREFIX)) keys.push(k.slice(QUEUE_STORAGE_PREFIX.length));
    }
    for (const key of keys) {
      const items = readEntry(storage, key, now);
      if (items) out.set(key, items);
      else storage?.removeItem?.(QUEUE_STORAGE_PREFIX + key);
    }
  } catch {
    /* A queue that cannot be read starts empty. */
  }
  return out;
}

/** The key of a chat's queue: project and chat, so a queue made with no chat open in one project is never another project's. */
export const chatQueueKey = (repoRoot: string | null | undefined, chatId: string | null | undefined): string => `${repoRoot ?? 'home'}::${chatId ?? 'none'}`;

const EMPTY: QueueItems = Object.freeze([]) as QueueItems;

export function createPromptQueue(newId: () => string = defaultId(), storage: QueueStorage | null = null, windowId: string = defaultWindowId()): PromptQueue {
  /* What was queued when the app last closed comes back held: it is not sent until Resume. */
  const byKey = readStoredQueue(storage);
  const holds = new Set<string>(byKey.keys());
  const foreign = (key: string): boolean => (byKey.get(key) ?? []).some((i) => i.w !== windowId);
  const listeners = new Set<() => void>();
  const save = (key: string): void => {
    if (!storage) return;
    try {
      const items = byKey.get(key);
      if (items) storage.setItem(QUEUE_STORAGE_PREFIX + key, JSON.stringify({ at: Date.now(), items }));
      else storage.removeItem?.(QUEUE_STORAGE_PREFIX + key);
    } catch {
      /* Private mode or a full disk: the queue still works for this launch. */
    }
  };
  const set = (key: string, next: QueueItems): void => {
    if (next === (byKey.get(key) ?? EMPTY)) return;
    if (next.length === 0) {
      byKey.delete(key);
      holds.delete(key);
    } else byKey.set(key, next);
    save(key);
    for (const l of [...listeners]) l();
  };
  const get = (key: string): QueueItems => byKey.get(key) ?? EMPTY;
  return {
    items: get,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    add(key, text, opts) {
      if (text.trim() === '') return null;
      const item = { id: newId(), text, w: windowId };
      set(key, enqueue(get(key), item, opts));
      return item;
    },
    edit: (key, id, text) => set(key, editItem(get(key), id, text)),
    move: (key, id, delta) => set(key, moveItem(get(key), id, delta)),
    remove: (key, id) => set(key, removeItem(get(key), id)),
    shift(key) {
      const [first, ...rest] = get(key);
      if (!first) return null;
      set(key, rest);
      return first;
    },
    /* Another window changed this queue: take its version, so an item it sent is not sent again from here. */
    reload(key) {
      const items = readEntry(storage, key, Date.now());
      if (items) {
        byKey.set(key, items);
        /* What another window queued is not ours to send: it waits for Resume here. */
        if (foreign(key)) holds.add(key);
      } else {
        byKey.delete(key);
        holds.delete(key);
      }
      for (const l of [...listeners]) l();
    },
    held: (key) => holds.has(key),
    release(key) {
      if (!holds.delete(key)) return;
      /* Resume adopts the items: from here on this window sends them. */
      const mine = (byKey.get(key) ?? []).map((i) => ({ ...i, w: windowId }));
      if (mine.length) {
        byKey.set(key, mine);
        save(key);
      }
      for (const l of [...listeners]) l();
    },
  };
}

function defaultWindowId(): string {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultId(): () => string {
  let n = 0;
  return () => `q-${Date.now().toString(36)}-${++n}`;
}

function pageStorage(): QueueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The page's one queue; it survives a restart (held until Resume). */
export const promptQueue: PromptQueue = createPromptQueue(defaultId(), pageStorage());

/** Follow other windows: a change to a queue's storage entry replaces this window's copy of it. Returns the remover. */
export function followOtherWindows(queue: PromptQueue, target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const on = (e: Event): void => {
    const k = (e as StorageEvent).key;
    if (k && k.startsWith(QUEUE_STORAGE_PREFIX)) queue.reload(k.slice(QUEUE_STORAGE_PREFIX.length));
  };
  target.addEventListener('storage', on);
  return () => target.removeEventListener('storage', on);
}

/* ── the drain: one item per settled turn ───────────────────────────────── */

export interface QueueDrain {
  /**
   * Tell the drain whether a turn is running in this chat. On the edge from
   * running to settled, and whenever nothing runs and an item waits, the
   * first item is sent; the next one waits for THAT turn to settle.
   * Returns the item it sent, or null.
   */
  update(running: boolean): QueuedPrompt | null;
}

export function createQueueDrain(queue: PromptQueue, key: () => string, send: (text: string) => void): QueueDrain {
  /* Set when we sent and the turn we started has not been seen running yet,
     so the same render that sent cannot send a second item. */
  let awaitingStart = false;
  return {
    update(running) {
      if (running) {
        awaitingStart = false;
        return null;
      }
      if (awaitingStart) return null;
      if (queue.held(key())) return null;
      const next = queue.shift(key());
      if (!next) return null;
      awaitingStart = true;
      try {
        send(next.text);
      } catch {
        /* Refused before a turn began (offline, a lock): it goes back to the
           front, and the next update tries again. Never dropped. */
        awaitingStart = false;
        queue.add(key(), next.text, { front: true });
        return null;
      }
      return next;
    },
  };
}
