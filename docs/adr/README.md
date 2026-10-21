# Architecture Decision Records — index

Decisions resolved with the owner for the vision-v2 / v20 program. Each ADR is the durable
"why" (the v20 plan that was the "what and how" was deleted 2026-08-20);
`../HANDOFF-AGENT-RESTART.md` is the current program state; `../vision.md` is the bar. A new
decision gets a new numbered file; an overturned decision gets its Status flipped to
*Superseded by ADR-NNN*, never silently edited.

| ADR | Decision | Status | Drives |
| --- | --- | --- | --- |
| [ADR-001](ADR-001-one-canvas.md) | Understanding + editing are ONE graph page (Draw toggle); Scratch folds in as the empty state | Accepted | Phase 1 |
| [ADR-002](ADR-002-canonical-layout.md) | Chat left · canvas center · rail right | Accepted | All phases |
| [ADR-003](ADR-003-functions-first-navigation.md) | Functions-first navigation; click → animated service-to-service flow; file-at-line | Accepted | Phase 2 |
| [ADR-004](ADR-004-background-logic-engine.md) | Logic engine runs in the background; the chat cites it — no pop-up suggestions | Accepted | Phase 3 |
| [ADR-005](ADR-005-chat-edits-the-canvas.md) | Chat edits the live canvas via validated patches, inline accept/reject | Accepted | Phase 3 |
| [ADR-006](ADR-006-surface-roster.md) | Domain stays separate; Programs + Task Board kept, elaboration deferred | Accepted (items open) | Phase 4 |
| [ADR-007](ADR-007-test-migration-policy.md) | Binding tests migrate with their surface; never deleted or weakened | Accepted | Phase 1+ |
| [ADR-008](ADR-008-diagram-output-standard.md) | Rendered diagrams are a first-class output; source is always a pure projection, never model-authored | Accepted | Phase 5 |
| [ADR-009](ADR-009-decision-records-as-output.md) | Design changes emit grounded ADR artifacts into the user's repo | Accepted | Phase 6 |
