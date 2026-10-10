/* ══════════════════════════════════════════════════════════════════════════
   A CHAT'S ICON IS ITS MODEL'S MARK (round 9)
   packages/web2/src/chat/chatIcon.tsx

   Jaden: "Get rid of the chat icon completely... Sonnet models have the
   Sonnet/Claude icon, Codex models the Codex icon, Sequence models (local)
   use the Sequence logo. The regular chat logo is not good enough."

   So there is no generic bubble here at all: every chat resolves to one of
   three brands. The agent the chat talks to decides first (live, else the
   agent thread kept on disk); then the model it last ran on; anything else is
   Sequence's own (local) chat. The marks are shell2/brand's packaged SVGs,
   drawn through `ProviderIcon`.
   ══════════════════════════════════════════════════════════════════════════ */

import type { SessionIndexEntry } from '@sequence/api-types';
import type { ReactNode } from 'react';

import { ProviderIcon } from '../shell2/brandIcons';
import './r9.css';

export type ChatBrand = 'claude' | 'codex' | 'sequence';

/** The three brands a chat can wear, read off any names it carries. */
export function brandOfNames(...names: (string | null | undefined)[]): ChatBrand | null {
  const s = names.filter(Boolean).join(' ').toLowerCase();
  if (!s) return null;
  if (/claude|anthropic|opus|sonnet|haiku/.test(s)) return 'claude';
  if (/codex|openai|gpt|\bo[1-9]\b/.test(s)) return 'codex';
  return null;
}

export interface ChatIconContext {
  /** The live map of chat id -> agent (agentRuns' `agents`). */
  agents?: Readonly<Record<string, string>>;
  /** The model the chat runs on, when the caller knows it (a profile's wire id or a run's model). */
  model?: string | null;
}

type EntryLike = Pick<SessionIndexEntry, 'id'> & { agentThreads?: Record<string, unknown>; model?: string | null };

/** Which brand a chat wears: its agent's, else its model's, else Sequence's. */
export function chatBrandFor(session: EntryLike, ctx: ChatIconContext = {}): ChatBrand {
  const live = ctx.agents?.[session.id];
  const kept = Object.keys(session.agentThreads ?? {})[0];
  const agent = live || kept || null;
  return brandOfNames(agent) ?? brandOfNames(ctx.model ?? null, session.model ?? null) ?? 'sequence';
}

/** The brand mark for a chat, sized by the caller's `.s2-brand` rule. Never a chat bubble. */
export function chatIconFor(session: EntryLike, ctx: ChatIconContext = {}): ReactNode {
  const brand = chatBrandFor(session, ctx);
  return (
    <span className="r9-chat-icon" data-testid="chat-icon" data-brand={brand} aria-hidden="true">
      <ProviderIcon provider={brand} />
    </span>
  );
}
