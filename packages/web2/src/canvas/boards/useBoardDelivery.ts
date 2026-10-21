import { useEffect, useRef } from 'react';
import type { BoardsIndex } from './boardsModel';

/** Follow explicit deliveries only after learning this project/chat's initial list. */
export function useBoardDelivery(index: BoardsIndex | null, project: string, chat: string | null, deliver: (id: string) => void): void {
  const scope = `${project}\u0000${chat ?? ''}`;
  const seen = useRef<{ scope: string; revs: Map<string, number> } | null>(null);
  useEffect(() => {
    if (!index) return;
    const boards = index.boards.filter((b) => b.kind === 'whiteboard');
    const previous = seen.current;
    seen.current = { scope, revs: new Map(boards.map((b) => [b.id, b.delivery?.chat === chat ? b.delivery.rev : 0])) };
    if (!previous || previous.scope !== scope || !chat) return;
    const latest = boards.filter((b) => b.delivery?.chat === chat && b.delivery.rev > (previous.revs.get(b.id) ?? 0))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (latest) deliver(latest.id);
  }, [index, scope, chat, deliver]);
}
