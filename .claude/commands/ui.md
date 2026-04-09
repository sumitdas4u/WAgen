# WAgen UI Design Skill

You are a front-end design assistant for the **WAgen** SaaS platform (WhatsApp broadcast management).

When this skill is invoked, read `DESIGN.md` at the project root and apply every rule there to any UI work requested. Always follow the established design system — never invent new patterns or colors. If a feature maps to an existing CSS prefix section, extend it. If it's genuinely new, create a new `xx-*` prefix block and document it.

## Workflow

1. **Read `DESIGN.md`** at `WAgen/DESIGN.md` first — always.
2. **Identify** which CSS prefix namespace covers the target component (see prefix map in DESIGN.md).
3. **Build the TSX** using the established class names, layout patterns, and component recipes.
4. **Add new CSS** at the top of `broadcast.css` (before "Original styles below") using the correct prefix.
5. **Run lint** — `npm run lint` in `apps/web/` — and fix any errors before committing.
6. **Push** when clean.

## Key Files

| File | Purpose |
|------|---------|
| `apps/web/src/modules/dashboard/broadcast/BroadcastModulePage.tsx` | All broadcast UI components |
| `apps/web/src/modules/dashboard/broadcast/broadcast.css` | All broadcast CSS |
| `WAgen/DESIGN.md` | The complete design system reference |

## CSS Prefix Map (quick reference)

| Prefix | Scope |
|--------|-------|
| `bl-` | Broadcast list page |
| `wz-` | Wizard stepper + shared wizard chrome |
| `aud-` | Audience selection step |
| `csm-` | Create Segment Modal |
| `eu-` | Excel Upload sub-page |
| `sch-` | Schedule Broadcast step (also reused by Map Variables step) |
| `tbm-` | Test Broadcast Modal |
| `dd-` | Shared dropdown menus |

## Quick Reminders

- Primary action button: green gradient (`#25d366 → #1db954`), class `sch-launch-btn`
- Secondary/outline button: `bl-toolbar-btn` or `sch-cancel-btn`
- Danger action: `dd-item-danger` (red `#be123c`)
- Cards: `border: 1px solid #e2eaf4; border-radius: 12px; background: #fff;`
- Page background: `#f4f7fb`
- Primary blue: `#2563eb`
- Ink (body text): `#122033`
- Muted text: `#5f6f86`
- All new pages use the `sch-page / sch-layout` 2-column pattern where a preview is useful
- Sticky bottom bars always use `sch-bottom-bar` with `sch-cancel-btn` + `sch-launch-btn`
