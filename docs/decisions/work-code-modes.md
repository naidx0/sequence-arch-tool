# MADR — Work | Code modes

**Status:** Accepted (owner grill 2026-08-15) · **SUPERSEDED ON CHROME by the v2 pivot, 2026-08-20**
([`PIVOT-V2.md`](../PIVOT-V2.md)) · **Date:** 2026-08-15  
**Canon:** [`product-final-plan.md`](../product-final-plan.md) for product intent;
[`brand/graphite/`](../brand/graphite/) for anything visual.

> **What changed.** `docs/research/v2-architecture-and-gaps.md` §1.2 puts **Work mode on the v2 CUT
> list**, and the one-topbar Work|Code switcher this MADR locks is a `packages/web` component deleted
> at Wave 7. `product-final-plan.md` §1 used to call this file "binding" and no longer does. Kept
> unarchived because the **reasoning** — why planning and implementation are separate sessions, and
> why the hop is a clone rather than a shared document — is the record the owner has needed. Do not
> read it as a layout.

## Context

Sequence shipped as one visual **coding** harness (chat | Architecture board). Owner grill
locked a Claude/Codex-shaped split: **Work** (planning) and **Code** (repo/system design)
inside one app, sessions **not shared**, **clone** to hop. X isometric maps are the Code
Architecture *depth* target, not Work, and not a second topology SoT.

## Decision

| # | Question | Choice |
|---|----------|--------|
| 1 | Product | Local-first, model-agnostic **visual workbench**. Plan in Work, build in Code. Each mode is complete alone. |
| 2 | Home | Always **Work + new empty chat**. Empty drafts auto-delete. Recents list holds real sessions only. |
| 3 | Switcher | **One** Work \| Code control — **topbar only**. Session lists partitioned by `mode`. Chat head is the active thread title + New + **Clone to Code/Work**, not a second switcher. |
| 4 | Hop | **Clone**, not share. Clone copies chat + Architecture into a **new** session of the other mode. Confirm **Leave this thread?** when the source has content. Source untouched. Bidirectional. |
| 5 | Architecture | SoT meta-document **per session**. Work = plan/process objects (`diagramFamily: process`, origin `design`/`chat`). Code = system parts (scan when attached; clone origin is never fake `scan`). English-first. |
| 6 | Canvas | Freeform surface in **both** modes. Chat infers Architecture vs Canvas from the utterance, attachments, and agent recommendation — **not** a manual chat-row or a third mode toggle. Board **follows** and shows a quiet crumb. Artifacts never become Architecture SoT / scanned services. |
| 7 | Layout | Codex organization (slim session rail + **one** topbar switcher) + Sequence stage. Chat \| board ~equal. Tools · skills · memory live in **Settings**; agents still get those descriptions in the ask prompt. Never Git-as-home. Ledger chrome. |
| 8 | Audience | Code = technical (repos, scratch, system design). Work = those people planning **plus** operators of difficult work systems. Not a consumer toy. |
| 9 | Agents | Work = planning toolbelt. Code = coding harness. Same chrome, different allowlists. |
| 10 | X-map grammar | Code Architecture depth (explainer, packets, playback; isometric optional **view** on the same `.seqd`). |

## Honesty

- Code clone Architecture `grounded.origin !== 'scan'` unless a repo is attached and the graph is real.
- Work Architecture must not pretend to be a scanned microservice map.
- Canvas artifacts never become Architecture nodes.
- Local-first: Work home and Code attach both work with no key.
- Do not ship three Work\|Code lectures (topbar + chat head + empty/tray copy).
- Session rail lists the live thread even when it is still empty; empty copy only when that **mode** has no threads.
- Session rail titles match the live diagram/plan name (`seqdDoc.title`, `.seqd` stripped) once a board exists, unless the human renamed the thread (`titleEdited`). Empty drafts stay a short placeholder — not `session N` after Accept, and not a chopped first prompt when a board title exists.

## Locking-test shapes

- Cold start: Work new chat + `product-chat` + `product-board`; topbar is the only `product-mode-switcher`.
- Chat source has no second `ModeSwitcher` and no `product-ask-target` row.
- Topbar Work\|Code is Ledger `.seg` (Space Mono, uppercase). Chat head is New + Clone + thread title only.
- Switcher filters `mode`; clone allocates a new id; source id unchanged. Leave-thread confirm when content exists.
- Bidirectional clone; Code clone origin is `design` or `chat` without attach.
- Canvas artifact id prefix is not a seqd node id.
- Packet click requires evidence id or honest `shape unknown`.
- Default Architecture browse remains RF cards unless isometric view flag is on.

## Non-goals (this amendment)

Isometric 3D as default, ops-health dots, replacing chat with “Ask the blueprint,”
shared Work/Code canvas, files-first Git pane, stuffing Work\|Code into the composer.

Model roles (local default / advisor / vision): [`model-roles.md`](model-roles.md).

## Addendum — Work seqd is the same IR as Code (2026-08-16)

Work and Code share the design seqd IR and `buildDesignAskPrompt`. Work is not a
weaker chat. The optional **plan** worker role is structuring, not “dumber.” Do
**not** switch Work onto Code’s “cite files / do not invent services” hint — that
would invent a repo on an unattached planning turn.

Prompt copy already lists valid node kinds. Coerce is the lock: invented kinds
(`interface`, …) become `service`, and `name` copies to `label`, so a Work dump
still paints. Do not add `interface` as a new node kind.

## Addendum — clickable Architecture | Canvas crumb (2026-08-17)

Chat may still infer Architecture vs Canvas. The board crumb is no longer
status-only: it is a Ledger `.seg` the human can press in Work and Code
(`Architecture` | `Canvas`). Do **not** put that picker in the topbar (Work|Code
lives there) and do **not** hide Canvas behind inference.

