# Components: the contract the UI builds against (proposal from the UX chat, 2026-10-12)

The backend chat owns the engine. The UX branch builds against this shape with a mock, and
adapts when the backend lands its real routes. If the backend picks other names, it says so
once and the UI follows.

## Routes

`GET /api/components` returns

```json
{
  "enabled": true,
  "mode": "approve",
  "groups": [
    {
      "id": "design-elements",
      "name": "Design elements",
      "blurb": "Interface review, layout, type and colour passes.",
      "components": [
        { "id": "better-typography", "name": "Better typography", "blurb": "One line, under 80 chars.",
          "source": "jakubkrehel/skills", "license": "MIT", "installed": true, "inWorkspace": true }
      ]
    }
  ]
}
```

- `enabled`: master switch (Settings, and `/components off`).
- `mode`: `"auto"` (model picks and runs), `"approve"` (approval card first), `"manual"` (only
  from the `+` menu, never suggested).
- `PUT /api/components/settings` body `{ enabled?, mode? }`.
- `POST /api/components/:id/workspace` body `{ inWorkspace: boolean }` adds or removes one
  component from this workspace.

## Turn events (both engines)

- `component:offer` `{ turnId, offerId, componentId, name, reason }`: in `approve` mode, when a
  trigger matches (for example "reverse engineer"). The UI shows an approval card:
  "Use <name>?" with **Use it** and **Keep the regular workflow**.
- Reply: `POST /api/components/offer/:offerId` body `{ accept: boolean }`.
- `component:used` `{ turnId, componentId, name }`: shown as a tool row in `auto` mode.

## Composer

- `+` menu row "Components" lists groups and their components; picking one attaches it to the
  next message as a chip (`{ components: [id] }` in the ask body).
- `/components` opens the same picker; `/components off` and `/components on` flip `enabled`.
