# WAgen Design System

> **Single source of truth** for all UI work in this codebase.  
> Every component, color, spacing value, and interaction pattern lives here.  
> When building new UI, match this — do not diverge.

---

## 1. Color Palette

### Brand

| Token | Hex | Usage |
|-------|-----|-------|
| `--green-primary` | `#25d366` | Primary CTA, WhatsApp brand, success accents |
| `--green-dark` | `#1db954` | Hover state of primary CTA |
| `--green-subtle` | `#dcfce7` | Success pill background |
| `--green-text` | `#166534` | Success pill text |
| `--blue-primary` | `#2563eb` | Links, active states, secondary CTA |
| `--blue-dark` | `#1d4ed8` | Hover state of blue CTA |
| `--blue-subtle` | `#eff6ff` | Blue hover backgrounds, info banner bg |
| `--blue-border` | `#bfdbfe` | Info banner border |
| `--blue-ring` | `#93c5fd` | Focus ring color |

### Ink

| Token | Hex | Usage |
|-------|-----|-------|
| `--ink` | `#122033` | Headings, bold labels, primary text |
| `--ink-muted` | `#5f6f86` | Secondary text, descriptions |
| `--ink-light` | `#94a3b8` | Placeholders, disabled text, timestamps |
| `--ink-faint` | `#cbd5e1` | Borders on disabled, faint dividers |

### Surfaces

| Token | Hex | Usage |
|-------|-----|-------|
| `--surface` | `#ffffff` | Cards, inputs, modals |
| `--surface-raised` | `#f8fafc` | Table header, card header tints |
| `--surface-page` | `#f4f7fb` | Page / wz-body background |
| `--border` | `#e2eaf4` | Card borders, input borders |
| `--border-inner` | `#edf2f7` | Inner dividers within cards |
| `--border-input` | `#dce5f0` | Input/select border (slightly darker) |

### Status

| Status | Background | Text | Border |
|--------|-----------|------|--------|
| Completed / Active | `#dcfce7` | `#166534` | `#bbf7d0` |
| Running / Scheduled | `#dbeafe` | `#1d4ed8` | `#bfdbfe` |
| Draft | `#ede9fe` | `#7c3aed` | `#ddd6fe` |
| Failed / Cancelled | `#ffe4e6` | `#be123c` | `#fecdd3` |
| Warning / Amber | `#fef9c3` | `#854d0e` | `#fde68a` |

---

## 2. Typography

Font: **system UI stack** (inherits from `font: inherit` everywhere — never hard-code a font family).

| Role | Size | Weight | Color |
|------|------|--------|-------|
| Page title (`bl-page-title`) | `1.35rem` | `800` | `#122033` |
| Section title (`sch-section-title`) | `0.9rem` | `800` | `#122033` |
| Table heading (`th`) | `0.65rem` | `800`, `letter-spacing: 0.1em`, UPPERCASE | `#5f6f86` |
| Body text | `0.84rem` | `400` | `#334155` |
| Secondary / description | `0.8rem` | `400` | `#5f6f86` |
| Micro / timestamp | `0.72rem` | `400` | `#94a3b8` |
| Badge label | `0.68rem` | `800`, UPPERCASE | varies by color |

---

## 3. Spacing Scale

Use these values consistently — no arbitrary pixel offsets.

| Name | Value | Use case |
|------|-------|----------|
| `xs` | `0.25rem` | Icon gap, tight inline spacing |
| `sm` | `0.5rem` | Button gap, chip gap |
| `md` | `0.75rem` | Field label gap, card inner padding |
| `lg` | `1rem` | Section gap, toolbar padding |
| `xl` | `1.25rem` | Modal body padding, layout gap |
| `2xl` | `1.5rem` | Between major sections |

---

## 4. Border Radius

| Name | Value | Use case |
|------|-------|----------|
| `sm` | `6px` | Chip, badge, token tag |
| `md` | `8px` | Button, input, select |
| `lg` | `10px` | Dropdown menu, small card |
| `xl` | `12px` | Standard card |
| `2xl` | `14px` | Overview card, preview card |
| `3xl` | `16px` | Modal, large card |
| `pill` | `999px` | Status pill, segment chip, toggle track |

---

## 5. Shadow Scale

| Name | Value | Use case |
|------|-------|----------|
| `xs` | `0 1px 3px rgba(0,0,0,0.04)` | Input focus shadow base |
| `sm` | `0 2px 12px rgba(0,0,0,0.05)` | Preview card, panel |
| `md` | `0 8px 24px rgba(0,0,0,0.12)` | Dropdown menu |
| `lg` | `0 24px 60px rgba(0,0,0,0.18)` | Modal |
| `green-glow` | `0 4px 14px rgba(37,211,102,0.3)` | Primary green CTA |
| `blue-glow` | `0 4px 14px rgba(37,99,235,0.22)` | Blue CTA (wz-continue-btn) |

---

## 6. Component Recipes

### 6.1 Buttons

#### Primary Green CTA (`sch-launch-btn`)
```css
height: 2.4rem; padding: 0 1.25rem;
border: 0; border-radius: 10px;
background: linear-gradient(135deg, #25d366, #1db954);
color: #fff; font-weight: 700; font-size: 0.84rem;
box-shadow: 0 4px 14px rgba(37,211,102,0.3);
/* hover: opacity 0.92 + translateY(-1px) */
/* disabled: opacity 0.45 */
```

#### Blue CTA (`wz-continue-btn`)
```css
height: 2.5rem; padding: 0 1.5rem;
border: 0; border-radius: 10px;
background: linear-gradient(135deg, #2563eb, #1d4ed8);
color: #fff; font-weight: 700; font-size: 0.88rem;
box-shadow: 0 4px 14px rgba(37,99,235,0.22);
```

#### Outline / Secondary (`sch-cancel-btn`, `bl-toolbar-btn`)
```css
height: 2.2–2.4rem; padding: 0 0.75–1.1rem;
border: 1px solid #e2eaf4; border-radius: 8–10px;
background: #fff; color: #5f6f86; font-weight: 600;
/* hover: background #f1f5f9 */
```

#### Blue Outline (`sch-test-btn`, `aud-upload-btn`)
```css
border: 1.5px solid #2563eb; color: #2563eb; background: #fff;
/* hover: background #eff6ff */
```

#### Icon-only (`bl-icon-btn`, `aud-more-btn`, `bl-more-btn`)
```css
width: 2–2.2rem; height: 2–2.2rem;
border: 1px solid #e2eaf4; border-radius: 6–8px;
background: #fff; display: grid; place-items: center;
```

#### New/Primary Action (`bl-new-btn`, `aud-new-seg-btn`)
```css
background: #25d366 (list) or #2563eb (data); color: #fff;
height: 2.1–2.4rem; border-radius: 8–10px; font-weight: 700;
```

---

### 6.2 Cards

#### Standard Card (`sch-section`, `aud-segments-card`)
```css
border: 1px solid #e2eaf4;
border-radius: 12px;
background: #fff;
padding: 1rem 1.1rem;
```

#### Overview / Stats Card (`bl-overview-card`)
```css
border: 1px solid #e2eaf4;
border-radius: 14px;
background: #fff;
overflow: hidden;
/* Head: padding 0.75rem 1rem, border-bottom */
/* Stats grid: repeat(N, 1fr), each cell border-right */
```

#### Preview Card (`sch-preview-card`, `eu-preview-panel`)
```css
border: 1px solid #e2eaf4;
border-radius: 14px;
background: #fff;
overflow: hidden;
box-shadow: 0 2px 12px rgba(0,0,0,0.05);
```

#### Info Banner (`sch-info-banner`)
```css
background: #eff6ff; border: 1px solid #bfdbfe;
border-radius: 10px; padding: 0.65rem 0.85rem;
color: #1e40af; font-size: 0.82rem;
display: flex; align-items: flex-start; gap: 0.6rem;
```

---

### 6.3 Inputs & Selects

All inputs/selects share:
```css
height: 2.25rem; padding: 0 0.75rem;
border: 1px solid #dce5f0; border-radius: 8px;
background: #fff; font: inherit; font-size: 0.84rem;
color: #122033; outline: none;
/* focus: border-color #93c5fd + box-shadow 0 0 0 3px rgba(147,197,253,0.18) */
```

Classes: `sch-input`, `sch-select`, `aud-name-input`, `eu-select`, `bl-search-input`

---

### 6.4 Status Pills (`bl-status-pill`)
```css
display: inline-flex; align-items: center;
min-height: 1.6rem; padding: 0 0.6rem;
border-radius: 999px;
font-size: 0.66rem; font-weight: 800;
letter-spacing: 0.04em; text-transform: uppercase;
/* Color set by .status-completed / .status-running / .status-draft / .status-failed */
```

---

### 6.5 Toggle Switch (`sch-toggle`)
```html
<label class="sch-toggle">
  <input type="checkbox" />
  <span class="sch-toggle-track" />
</label>
```
- Track: `2.6rem × 1.4rem`, `border-radius: 999px`, unchecked `#cbd5e1`, checked `#25d366`
- Thumb: `::after` pseudo, 1rem circle, `box-shadow: 0 1px 3px rgba(0,0,0,0.2)`

---

### 6.6 Dropdown Menu (`dd-*`)
```html
<div class="dd-wrap">
  <button class="bl-more-btn">⋮</button>
  <div class="dd-menu">
    <button class="dd-item">Action</button>
    <div class="dd-divider" />
    <button class="dd-item dd-item-danger">Delete</button>
  </div>
</div>
```
- Menu: `position: absolute; right: 0; top: calc(100% + 4px); z-index: 60`
- Always add `<div style="position:fixed;inset:0;z-index:50" onClick={close} />` backdrop when open

---

### 6.7 Modal (`csm-*`, `tbm-*`)
```html
<div class="csm-backdrop">   <!-- fixed, inset 0, rgba(15,23,42,0.45), grid place-items:center -->
  <div class="csm-modal">   <!-- max-height 90vh, flex col, border-radius 16px, shadow-lg -->
    <div class="csm-header">...</div>
    <div class="csm-body">...</div>
    <div class="csm-footer">...</div>
  </div>
</div>
```

---

### 6.8 Table Pattern

```html
<section class="broadcast-table-shell">       <!-- border, border-radius, overflow:hidden -->
  <div class="bl-table-toolbar">              <!-- flex, space-between, padding, border-bottom -->
    <span class="bl-table-title">Title</span>
    <div class="bl-toolbar-right">...</div>
  </div>
  <table class="broadcast-table">
    <thead><tr><th>COL</th>...</tr></thead>
    <tbody>
      <tr>
        <td>...</td>
      </tr>
    </tbody>
  </table>
  <div class="bl-pagination">...</div>
</section>
```

- `th`: `font-size: 0.65rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: #5f6f86; background: #f8fafc`
- `td`: `padding: 0.7rem 0.85rem; font-size: 0.83rem; border-bottom: 1px solid #f1f5f9`
- Row hover: `background: #f8fafc`
- Selected row: `background: #eff6ff`

---

## 7. Layout Patterns

### 7.1 Page Header
```html
<div class="bl-page-header">
  <h2 class="bl-page-title">Page Name</h2>
  <div class="bl-page-header-actions">
    <!-- toolbar buttons, primary CTA -->
  </div>
</div>
```

### 7.2 Two-Column Wizard Step (`sch-layout`)
```html
<section class="sch-page">
  <div class="sch-header">
    <button class="wz-back-btn">← Label</button>
  </div>
  <div class="sch-layout">                <!-- grid: 1fr 340px, gap 1.5rem -->
    <div class="sch-form-col">
      <!-- section cards stacked vertically -->
    </div>
    <div class="sch-preview-col">         <!-- position: sticky; top: 1rem -->
      <div class="sch-preview-card">...</div>
    </div>
  </div>
  <div class="sch-bottom-bar">            <!-- sticky, bottom 0 -->
    <div class="sch-bottom-left" />
    <div class="sch-bottom-right">
      <button class="sch-cancel-btn">Cancel</button>
      <button class="sch-launch-btn">Send ›</button>
    </div>
  </div>
</section>
```

### 7.3 Field Row (`sch-field-row`)
```html
<div class="sch-field-row">      <!-- flex, space-between, min-height 2.25rem -->
  <span class="sch-field-label">Label</span>
  <input class="sch-input" />
</div>
```

### 7.4 Stepper (`wz-stepper`)
```html
<div class="wz-stepper">
  <div class="wz-step-wrap">
    <div class="wz-step is-active">   <!-- or is-complete -->
      <div class="wz-step-num">1</div>
      <span class="wz-step-label">Step Name</span>
    </div>
    <div class="wz-step-line" />
  </div>
  ...
</div>
```

### 7.5 Accordion (`eu-*`)
```html
<div class="eu-accordion is-open">
  <button class="eu-accordion-head">
    <span class="eu-acc-check is-done">✓</span>
    <span class="eu-acc-title">Title</span>
    <span class="eu-acc-chevron">∧</span>
  </button>
  <div class="eu-accordion-body">...</div>
</div>
```

---

## 8. CSS Prefix Namespace

| Prefix | File section | Scope |
|--------|-------------|-------|
| `bl-` | Broadcast list redesign | List page: header, overview stats, table, pagination |
| `wz-` | Broadcast wizard redesign | Stepper, template grid cards, back button, continue button |
| `aud-` | Audience selection step | Excel card, segments card, segment table, bottom bar |
| `csm-` | Create Segment Modal | Backdrop, modal, filter rows, preview contacts |
| `eu-` | Excel Upload sub-page | Layout, accordions, dropzone, mapping, preview panel |
| `sch-` | Schedule Broadcast step | 2-col layout, sections, field rows, toggle, preview, bottom bar |
| `tbm-` | Test Broadcast Modal | Backdrop, phone inputs, footer |
| `dd-` | Shared dropdown | dd-wrap, dd-menu, dd-item, dd-item-danger, dd-divider |

**Rule:** When creating a new feature, pick a 2–3 letter prefix, add all classes under it in `broadcast.css` (before the "Original styles below" comment), and list the prefix in this table.

---

## 9. Interaction Patterns

### Click-outside (dropdowns, tooltips)
```tsx
{isOpen ? (
  <div style={{ position: "fixed", inset: 0, zIndex: 50 }} onClick={() => setIsOpen(false)} />
) : null}
```
Place this **before** the triggering element in the DOM so it doesn't intercept child clicks.

### Hover tooltip
Use `onMouseEnter` / `onMouseLeave` on the row, store hovered ID in state, render `.dd-menu`-style absolutely positioned panel.

### Loading states
- Buttons: show `"Loading…"` text + `disabled` prop, `opacity: 0.5`
- Full page: `<div className="broadcast-loading">Loading…</div>`
- Inline: spinner character `⟳` (animated via CSS if needed)

### Optimistic UI
Use TanStack Query `useMutation` with `onSuccess` → `queryClient.invalidateQueries`.

---

## 10. Do / Don't

| ✅ Do | ❌ Don't |
|-------|---------|
| Reuse existing `sch-*` classes for new wizard steps | Create inline `style={{}}` for structural layout |
| Use `bl-status-pill status-{status}` for all status badges | Use raw colors for status — always use the pill classes |
| Put new CSS at the **top** of broadcast.css, before "Original styles below" | Append new CSS after original styles |
| Make tables use `broadcast-table-shell + bl-table-toolbar` | Create standalone tables without the shell wrapper |
| Use `wz-back-btn` for all wizard back navigation | Use plain `<a>` or different back button styles |
| Close dropdowns with a fixed-inset backdrop div | Use `blur` or `focusout` for dropdown close |
| Use `sch-launch-btn` (green gradient) for final send/launch actions | Use green color on non-final actions |
| Use `sch-cancel-btn` for cancel/back in wizard bottombars | Use `broadcast-secondary-btn` (old class) |
