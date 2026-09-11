import { Composer } from './Composer';
import type { ComposerProps } from './Composer';
import { Transcript } from './Transcript';
import type { TranscriptProps } from './Transcript';

import './chat.css';

/* ══════════════════════════════════════════════════════════════════════════
   THE CHAT COLUMN — items 2.5 + 2.7 + 2.8 assembled
   packages/web2/src/chat/ChatColumn.tsx

   One agent owns the transcript, the composer and the permission control
   because they are ONE INTERACTION. Splitting them is how three sheets ended up
   specifying one control three ways.

   This is the seam item 2.3's <Shell/> mounts. It takes props and threads them;
   it holds no state and calls no fetch. The engine seam rule from the adoption
   study's §5 is that `engine/` never imports React and `components/` never
   calls fetch — components receive callbacks threaded from the shell, which is
   what makes every one of them testable with props alone and the transport
   swappable when Sequence goes packaged.

   TWO CHILDREN, ONE FLEX AXIS. The transcript takes the free space and scrolls;
   the composer block does not shrink. `min-height:0` on the scroller is what
   makes `overflow:auto` on a flex child actually scroll instead of growing —
   see chat.css.
   ══════════════════════════════════════════════════════════════════════════ */

export interface ChatColumnProps extends TranscriptProps {
  composer: ComposerProps;
}

export function ChatColumn({
  turns,
  inFlight,
  onOpen,
  onEdit,
  onAttach,
  onStarter,
  composer,
  contextWindow,
  reasoningProvider,
  proposals,
}: ChatColumnProps) {
  return (
    <div className="chat-scope chatcol" data-testid="chat-column">
      <Transcript
        turns={turns}
        inFlight={inFlight}
        onOpen={onOpen}
        onEdit={onEdit}
        onAttach={onAttach}
        onStarter={onStarter}
        contextWindow={contextWindow}
        reasoningProvider={reasoningProvider}
        proposals={proposals}
      />
      <Composer {...composer} />
    </div>
  );
}
