# WAgen Inbox V2 — UI Design Guide

**Reference mockup:** `.superpowers/brainstorm/360-1777049666/content/inbox-exact.html`
**CSS prefix:** `iv-`
**Module path:** `apps/web/src/modules/dashboard/inbox-v2/`

---

## Layout — 4-Column Grid

```css
.iv-shell {
  display: grid;
  grid-template-columns: 220px 340px 1fr 288px;
  height: 100vh;
  overflow: hidden;
  background: #f8fafc;
}
```

| Column | Width | Component | File |
|--------|-------|-----------|------|
| 1 | 220px fixed | Left nav tree | `NavSidebar.tsx` |
| 2 | 340px fixed | Conversation list | `ConversationList.tsx` |
| 3 | flex 1 | Message thread | `MessageThread.tsx` |
| 4 | 288px fixed | Details sidebar | `DetailsSidebar.tsx` |

**Responsive breakpoints:**
- `< 1200px`: hide col 4 (details), toggle via button in thread header
- `< 900px`: hide col 1 (nav), show hamburger
- `< 768px`: show only col 2 OR col 3 (tap to switch)

---

## Fonts

```css
/* Page titles, org name, contact name, thread name, conv list title */
font-family: "Space Grotesk", sans-serif;
font-weight: 700;

/* Everything else */
font-family: "Manrope", sans-serif;
font-weight: 400–800;
```

Both fonts already imported in `apps/web/src/styles.css` — do NOT add a second import.

---

## Color Tokens

```
Ink / Text
  #122033   — page titles, names, strong headings (Space Grotesk)
  #334155   — body text, message content, nav items
  #475569   — medium-weight body
  #5f6f86   — secondary labels, timestamps, metadata
  #94a3b8   — placeholders, muted, disabled

Surfaces / Borders
  #fff      — card bg, input bg, sidebar bg
  #f8fafc   — page bg, thread bg, search input bg
  #fafbfd   — row hover bg
  #f1f5f9   — section dividers, activity pill bg, format btn hover
  #edf2f7   — tab border, thead bg
  #e2eaf4   — card borders, input borders, accordion borders

Blue (primary / active)
  #2563eb   — primary blue, active tab, send button, links
  #1d4ed8   — blue hover, send dropdown
  #f0f4ff   — active nav item bg, active conv row bg, unread bubble bg
  #c7d6f7   — active tab border
  #dbeafe   — outbound bubble bg, blue badge bg
  #bfdbfe   — outbound bubble border, blue badge border
  #93c5fd   — focus ring

Green (WhatsApp / resolve / opted-in)
  #25d366   — Resolve button, unread badge, WhatsApp channel dot
  #1db954   — resolve hover
  #dcfce7   — open status pill bg
  #bbf7d0   — open status pill border
  #166534   — open status pill text, opted-in text

Red / Rose (urgent / failed / complaint)
  #f43f5e   — priority dot urgent, delivery failed
  #be123c   — danger text, urgent label text
  #ffe4e6   — urgent/complaint pill bg
  #fecdd3   — urgent/complaint pill border

Amber (AI paused / snooze / warm)
  #f59e0b   — AI paused warning, warm score, amber priority
  #fef9c3   — private note bg
  #fef08a   — private note border
  #ca8a04   — private note label text

Purple (flow / draft / device labels)
  #7c3aed   — flow assignment accent
  #ede9fe   — purple label bg
  #ddd6fe   — purple label border

Label dot colors (square 8px, border-radius 2px)
  Complaint  #f43f5e
  Urgent     #f43f5e
  Lead       #25d366
  Billing    #2563eb
  Device     #7c3aed
  Warm       #f59e0b
  Cold       #94a3b8
  Hot        #f43f5e
```

---

## Column 1 — Left Nav (`NavSidebar.tsx`)

### Dimensions
- Width: 220px
- Background: #fff
- Right border: 1px solid #e2eaf4

### Org Switcher (top)
```
Height: 52px
Padding: 13px 14px
Logo: 30×30px, border-radius 8px, gradient #2563eb→#7c3aed
Org name: Space Grotesk 700 13.5px #122033
Caret: ▾ 10px #94a3b8
Hover: background #fafbfd
```

### Search Row
```
Padding: 9px 12px
Input: height 30px, border-radius 7px, font-size 12.5px
       bg #f8fafc, border #e2eaf4, focus border #93c5fd
       left padding 28px (search icon at 8px)
Compose btn: 28×28px, border-radius 7px, border #e2eaf4
```

### Nav Items
```css
.iv-nav-item {
  display: flex; align-items: center; gap: 9px;
  padding: 7px 14px;
  font-size: 13px; font-weight: 600; color: #475569;
  cursor: pointer; transition: background 80ms, color 80ms;
  position: relative;
}
.iv-nav-item:hover { background: #f8fafc; color: #122033; }
.iv-nav-item.active { background: #f0f4ff; color: #2563eb; }
.iv-nav-item.active::before {
  content: ""; position: absolute; left: 0; top: 4px; bottom: 4px;
  width: 3px; background: #2563eb; border-radius: 0 3px 3px 0;
}
```

Count badge: 10.5px 800, bg #f1f5f9, active: bg #dbeafe color #2563eb

### Section Headers (collapsible)
```
font-size: 12px; font-weight: 700; color: #334155;
padding: 8px 14px 4px;
icon: 13px color #5f6f86
caret: ▾ 8px #94a3b8, margin-left auto
```

### Sub-items (indented)
```
padding: 5px 14px 5px 36px;
font-size: 12.5px; font-weight: 500; color: #5f6f86;
active: color #2563eb; background #f0f4ff; font-weight 600;
```

### Channel Dots
```
width: 8px; height: 8px; border-radius: 50%;
WhatsApp: #25d366
Facebook: #1877f2
Email:    #f59e0b
Web:      #2563eb
API:      #7c3aed
```

### Agent Footer
```
height: 52px; padding: 10px 14px;
border-top: 1px solid #f1f5f9;
Avatar: 30×30px border-radius 50%, gradient #dcfce7→#bbf7d0 color #166534
Online dot: 9×9px #22c55e, border 2px #fff, bottom-right of avatar
Name: 12.5px 700 #334155
Email: 11px #94a3b8, truncate
```

---

## Column 2 — Conversation List (`ConversationList.tsx`)

### Dimensions
- Width: 340px
- Background: #fff
- Right border: 1px solid #e2eaf4

### Panel Header
```
Padding: 12px 14px 0
Title: Space Grotesk 700 16px #122033 letter-spacing -0.025em
"Open" pill: 10px 800 uppercase, bg #dcfce7, color #166534, border #bbf7d0, border-radius 999px
3 icon buttons: 26×26px, border-radius 7px, border #e2eaf4, color #5f6f86
```

### Mine / Unassigned / All Tabs
```
Tab font: 13px 600
Active: color #2563eb, border-bottom 2px #2563eb
Count badge: 11px 800, active: bg #dbeafe color #2563eb
Tab height: ~36px with 7px top/bottom padding
Row border-bottom: 2px solid #edf2f7
```

### Conversation Row
```css
.iv-crow {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid #f1f5f9;
  cursor: pointer; transition: background 80ms;
  position: relative;
}
.iv-crow:hover { background: #fafbfd; }
.iv-crow.active {
  background: #f0f4ff;
  border-left: 2px solid #2563eb;
  padding-left: 12px;
}
```

#### Avatar + Channel Badge
```
Avatar: 36×36px border-radius 50%, gradient initials, font 11px 800
Channel badge: 14×14px border-radius 50%, border 2px #fff
  Position: absolute bottom -2px right -2px
  W=WhatsApp #25d366, f=Facebook #1877f2, @=Email #f59e0b, A=API #7c3aed
```

#### Row Body Layout
```
Source line (above name):
  font-size: 10.5px; font-weight: 600; color: #94a3b8;
  "⊙ Channel Name" format

Name:
  font-size: 13.5px; font-weight: 700; color: #122033;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;

Snippet:
  font-size: 12px; font-weight: 500; color: #5f6f86;
  Reply icon ↩ (11px #94a3b8) for agent replies
  Lock icon 🔒 (10px) for private note snippets

Labels row — Chatwoot style (colored dot + text, NOT pills):
  Each label: flex row, gap 3px, font-size 11px 600 color #334155
  Dot: 8×8px border-radius 2px
```

#### Right-side Indicators (absolute positioned)
```
Priority !!:
  font-size: 12px; font-weight: 900; color: #f43f5e;
  amber variant: #f59e0b (medium priority)

Unread badge:
  18×18px circle, background #25d366, color #fff, font-size 10px 800

AI paused: "⏸ Xm" — 10px 700 #f59e0b

Timestamp: 11px 500 #94a3b8 — "1d · 34m" format
```

---

## Column 3 — Message Thread

### Thread Header (`ThreadHeader.tsx`)
```
Height: ~56px; padding: 10px 16px;
Background: #fff; border-bottom: 1px solid #e2eaf4;

Left: avatar (36px) + name (Space Grotesk 700 15px #122033)
  + ⚠ warning (#f59e0b) when AI paused
  + source line: 12px 500 #5f6f86
  + "Close details" link: #2563eb 600 12px

Right:
  🔕 mute: 32×32px border #e2eaf4 border-radius 8px color #5f6f86
  ↑ share: same
  Resolve group:
    "Resolve": height 32px, bg #25d366, color #fff, border-radius 8px 0 0 8px, 13px 700
    "▾": 28×32px bg #1db954, border-radius 0 8px 8px 0
```

### Message Area
```
Background: #fff
Padding: 20px 16px 12px
```

### Date Separator
```
font-size: 11px; font-weight: 700; text-transform: uppercase;
letter-spacing: 0.08em; color: #94a3b8; text-align: center;
padding: 12px 0 8px;
```

### Message Bubbles

**Inbound:**
```
background: #f1f5f9
border-radius: 14px with border-bottom-left-radius: 4px
font-size: 13.5px; line-height: 1.5; color: #334155;
max-width: 65%
Avatar 24×24px left, visible only on last msg of group
```

**Outbound:**
```
background: #e8f0fe
border: 1px solid #bfdbfe
border-bottom-right-radius: 4px (other corners 14px)
color: #1e3a5f
Aligned right
```

**Private Note:**
```
background: #fef9c3; border: 1px solid #fef08a;
all corners 14px (no asymmetric)
color: #713f12; max-width: 78%
Header: "🔒 Private Note" — 10px 800 uppercase #ca8a04, mb 5px
@mention: color #2563eb font-weight 700
```

**Reply-to quote:**
```
border-left: 3px solid #2563eb; padding: 3px 8px; margin-bottom: 7px;
font-size: 12px; color: #5f6f86;
background: rgba(37,99,235,0.06); border-radius: 3px
```

**Bubble footer:**
```
display: flex; justify-content: flex-end; gap: 5px; margin-top: 5px;
Timestamp: 11px #94a3b8
Delivery:
  ✓  sent      11.5px #94a3b8
  ✓✓ delivered 11.5px #94a3b8
  ✓✓ read      11.5px #2563eb
  ✗  failed    11.5px #f43f5e + "· Retry" link
```

**Unread bubble:** background #e8f4ff, border 1px #bfdbfe

### Activity Pill
```
Centered, font-size 11.5px color #5f6f86
bg: #f1f5f9; border: 1px solid #e2eaf4; padding: 4px 12px; border-radius: 999px;
```

### Typing Indicator
```
Left-aligned with avatar
Bubble: bg #f1f5f9, padding 10px 14px, border-radius 14px / 4px bottom-left
3 dots: 6×6px #94a3b8, gap 4px
Animation: bounce 5px up, stagger 0.2s each, 1.4s ease-in-out infinite
Auto-clear: 30s after last typing_on event
```

### Message Grouping Rules
```
Group consecutive messages when ALL true:
  same direction
  both is_private === false
  time diff < 300 seconds
  neither content_type === "activity"

Avatar: show only on LAST msg of group
Timestamp: show only on FIRST msg of group
Private notes: always standalone (never grouped)
```

### Canned Response Popup
```
Trigger: "/" at start of compose textarea
Position: absolute above compose, left/right 14px margin
bg: #fff; border: 1px solid #e2eaf4; border-radius: 10px;
box-shadow: 0 8px 32px rgba(0,0,0,0.12); padding: 8px; z-index: 50;

Search input: 32px height, border #e2eaf4, border-radius 7px, 12.5px
Items: padding 7px 10px, border-radius 7px, 12.5px
  key: 11px 800 #2563eb monospace, margin-right 6px
  hover/active: bg #f0f4ff
```

---

## Compose Area (`ComposeArea.tsx`)

```
bg: #fff
border-top: 2px solid #e2eaf4
```

### Mode Tabs
```
Reply / Private Note
13px 700, active: color #2563eb border-bottom 2px #2563eb
Expand icon right-aligned: 13px #94a3b8
```

### Format Bar
```
Buttons: 28×26px, border-radius 5px, color #5f6f86
hover: bg #f1f5f9
Separator: 1×16px #e2eaf4
Order: B  I  🔗  ♡  ❤  |  ≡  1.  </>
```

### Textarea
```
min-height: 56px; max-height: 140px; resize: none; border: none;
font: Manrope 13px 1.5 #334155
placeholder: #94a3b8
placeholder text: "Shift + enter for new line. Start with '/' to select a Canned Response."
Note mode: background #fef9c3
```

### Footer
```
Icon buttons: 32×32px, border-radius 8px, border #e2eaf4, font-size 15px
  😊 emoji  📎 attach  🎙 voice  ✨ AI (border #c7d6f7, color #2563eb)
  📋 template  🌐 translate (WAgen-unique)

Send group (right-aligned):
  "Send ↵": height 34px, bg #2563eb, color #fff, border-radius 8px 0 0 8px, 13px 700
  "▾": 28×34px bg #1d4ed8, border-radius 0 8px 8px 0
```

---

## Column 4 — Details Sidebar (`DetailsSidebar.tsx`)

### Contact / Copilot Tabs
```
2 equal tabs, 13px 700
Active: color #2563eb, border-bottom 2px #2563eb
Height: ~42px
```

### Contact Card
```
Padding: 18px 14px 14px; text-align: center; border-bottom: 1px solid #f1f5f9;
Avatar: 54×54px border-radius 50%, 17px 800
Name: Space Grotesk 700 15px #122033 + ⏱ + ↗ icons (12px #94a3b8)
Title: 12px 500 #5f6f86

Fields (email/phone/company/location):
  flex row, gap 8px, padding 4px 0, font-size 12.5px #334155
  Icon: 12px #94a3b8, width 16px
  Copy icon: 11px #94a3b8, margin-left auto

Social: 28×28px, border-radius 7px, border #e2eaf4 — f / 𝕏 / in
Actions: 32×30px, border-radius 8px, border #e2eaf4
  💬 ✏ ⧖ 🚫(danger: border #fecdd3 color #f43f5e)
```

### Accordion
```css
.iv-acc { border-bottom: 1px solid #f1f5f9; }
.iv-acc-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 14px; cursor: pointer;
  font-size: 13px; font-weight: 700; color: #334155;
}
.iv-acc-head:hover { background: #fafbfd; }
.iv-acc-plus {
  width: 22px; height: 22px;
  border: 1px solid #e2eaf4; border-radius: 6px;
  font-size: 13px; display: grid; place-items: center;
  color: #5f6f86; background: #fff;
}
```

Open/closed state: `localStorage['iv-sidebar-sections']` — array of open section ids.

### Status / Priority Pills
```
padding: 2px 8px; border-radius: 999px;
font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em;

open:     bg #dcfce7 color #166534 border #bbf7d0
resolved: bg #dbeafe color #1d4ed8 border #bfdbfe
pending:  bg #fef3c7 color #92400e border #fde68a
snoozed:  bg #ede9fe color #7c3aed border #ddd6fe
urgent:   bg #ffe4e6 color #be123c border #fecdd3
high:     bg #fef3c7 color #92400e border #fde68a
medium:   bg #dbeafe color #1d4ed8 border #bfdbfe
low:      bg #f1f5f9 color #5f6f86 border #e2eaf4
hot:      bg #ffe4e6 color #be123c border #fecdd3
warm:     bg #fef3c7 color #92400e border #fde68a
cold:     bg #dbeafe color #1d4ed8 border #bfdbfe
```

### WAgen-Unique Sections
```
Lead Intelligence: border-left 3px solid #2563eb
  "WAgen" badge: bg #dbeafe color #1d4ed8, 11px 800
Flow Assignment:  border-left 3px solid #7c3aed
  "WAgen" badge: bg #ede9fe color #7c3aed, 11px 800
```

#### Lead Intelligence Content
```
Score pill / Stage / Lead Kind
AI Auto-Reply toggle:
  Track: 36×20px border-radius 999px
  OFF (paused): bg #f43f5e
  ON (live):    bg #25d366
  Knob: 16×16px #fff, shadow
  Duration options: 15m / 30m / 1h / 6h / 12h / 24h / forever
  Paused text: "Paused · Xm remaining" 11px #f59e0b
```

#### Flow Assignment Content
```
Flow card: bg #f8fafc, border #e2eaf4, border-radius 8px, padding 9px 11px
  Name: 12.5px 700 #122033
  Meta: "Last triggered: X" 11px #94a3b8
Buttons: Change | ▶ Trigger (blue: bg #f0f4ff border #c7d6f7 color #2563eb)
```

### Accordion Field Rows
```
Key: 10.5px 700 uppercase letter-spacing 0.06em #94a3b8
Value: 12.5px 600 #334155
Row padding: 4px 0
```

### Sections List (order)
```
1. Conversation Actions   — status, priority, assignee, labels, resolve/snooze buttons
2. Lead Intelligence*     — score, stage, kind, AI toggle (WAgen)
3. Flow Assignment*       — flow card + buttons (WAgen)
4. Conversation Participants
5. Macros
6. Contact Attributes     — opted_in, last_seen, channel
7. Conversation Information — created_at, ID
8. Previous Conversations — list with source+status+date
```

---

## Avatar Color System

Deterministic from phone last digit:

| Class | Gradient | Text color |
|-------|----------|------------|
| `av-blue`   | #dbeafe → #c7d6f7 | #1d4ed8 |
| `av-green`  | #dcfce7 → #bbf7d0 | #166534 |
| `av-purple` | #ede9fe → #ddd6fe | #7c3aed |
| `av-amber`  | #fef3c7 → #fde68a | #92400e |
| `av-rose`   | #ffe4e6 → #fecdd3 | #be123c |
| `av-teal`   | #ccfbf1 → #99f6e4 | #0f766e |

```ts
const AVATAR_COLORS = ["blue","green","purple","amber","rose","teal"];
function getAvatarColor(phone: string) {
  const n = parseInt(phone.replace(/\D/g,"").slice(-1)) || 0;
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}
```

---

## Transitions
```
Colors/hover:  120ms ease
Layout:        180ms ease
Toggle track:  200ms ease
Typing dots:   1.4s ease-in-out infinite
Dropdowns:     120ms ease
Bubbles:       instant (no animation — performance)
```

---

## Scrollbars
```css
::-webkit-scrollbar { width: 3px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #e2eaf4; border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #c7d6f7; }
```

---

## Z-index Stack
```
Canned popup:     50
Dropdown menus:   60
Modals/dialogs:  100
Toasts:          200
```

---

## Content Types in `MessageBubble.tsx`

| `content_type` | Render |
|---|---|
| `text` | Plain + linkify + WhatsApp markdown (`*bold*` `_italic_` `~strike~` `` `code` ``) |
| `image` | `<img>` thumbnail → lightbox on click |
| `audio` | `<audio controls>` + waveform stub |
| `video` | `<video controls>` |
| `document` | File icon + name + size + download link |
| `sticker` | `<img>` 120px, no bg |
| `location` | Static map thumbnail + "Open in Maps" |
| `contacts` | vCard: name + phone chip |
| `interactive` | Quick-reply button list |
| `template` | Header (img/vid/doc) + bold body + italic footer + button list |
| `activity` | Centered pill (no bubble) |

---

## Delivery Status
```
pending    ⏳  #94a3b8  (optimistic before WS echo)
sent       ✓   #94a3b8
delivered  ✓✓  #94a3b8
read       ✓✓  #2563eb
failed     ✗   #f43f5e  + "· Retry" (disabled after retry_count >= 3)
```

---

## Shimmer Skeletons
```css
.iv-shimmer {
  background: linear-gradient(90deg, #f1f5f9 25%, #e2eaf4 50%, #f1f5f9 75%);
  background-size: 200% 100%;
  animation: iv-shimmer 1.4s infinite;
  border-radius: 6px;
}
@keyframes iv-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```
Show 6 shimmer rows in conv list, 4 shimmer bubbles in thread on initial load.

---

## Keyboard Shortcuts (Phase 2)

| Key | Action |
|-----|--------|
| `j` / `k` | Next / prev conversation |
| `r` | Focus reply compose |
| `e` | Resolve conversation |
| `n` | Toggle private note mode |
| `/` | Open canned responses |
| `@` | Agent mention (note mode) |
| `Esc` | Close popup / deselect |
| `?` | Shortcuts help overlay |

---

## Component File Map
```
inbox-v2/
├── route.tsx                     Main layout + WS hook
├── inbox-v2.css                  All styles (iv- prefix)
├── api.ts                        API functions
├── queries.ts                    React Query hooks (normalized cache)
├── store/
│   └── convStore.ts              Zustand: byId + ids + filters
├── hooks/
│   └── useRealtimeSocket.ts      WS reconnect + typed event dispatch
└── components/
    ├── NavSidebar.tsx
    ├── ConversationList.tsx
    ├── ConversationRow.tsx
    ├── MessageThread.tsx
    ├── ThreadHeader.tsx
    ├── MessageBubble.tsx
    ├── TypingIndicator.tsx
    ├── ComposeArea.tsx
    ├── CannedResponsePopup.tsx
    ├── DetailsSidebar.tsx
    ├── ContactCard.tsx
    └── AccordionSection.tsx
```