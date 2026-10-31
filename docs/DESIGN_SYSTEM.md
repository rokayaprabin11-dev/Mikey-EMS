# Design system

The approved UI designs are on two private design canvases (ask the project owner for access):

- Super Admin: https://claude.ai/artifact/TobcWYaaT9XBHE6ezwMdFj
- Accountant: https://claude.ai/artifact/8PmVsHwPVRWYioRgzABN1m

PDF exports of both canvases are in `docs/design/` (`super-admin.pdf`, `accountant.pdf`).

Match them. When a screen is not drawn, compose it from the patterns below instead of inventing a new look.

## Look in one sentence

A calm office ledger: grey-paper background, white panels with thin borders, dark ink text, one blue for actions, colour only where it means something. Each workstation has its own sidebar colour so nobody confuses Computer 1 with Computer 2.

## Colour tokens

They are defined once, as Tailwind v4 theme variables in `apps/desktop/src/index.css` (`--color-paper` gives `bg-paper`, `text-paper`, `border-paper`, and so on). Tailwind's default palette is switched off, so these are the only colour classes. Use tokens, never raw hex in components. A test fails if `index.css` and this table differ.

| Token | Hex | Use |
| --- | --- | --- |
| `paper` | `#F2F4F3` | App background |
| `surface` | `#FFFFFF` | Panels, tables, inputs |
| `surface-muted` | `#FAFBFA` | Table headers, panel footers |
| `ink` | `#17212B` | Main text, selected segment |
| `ink-muted` | `#5A6672` | Secondary text, labels (5.9:1 on white) |
| `ink-soft` | `#3C4752` | Body text in notes |
| `line` | `#DDE2E0` | Panel borders, table header rule |
| `line-soft` | `#EDF0EE` | Row dividers |
| `line-strong` | `#C9D1CE` | Input and secondary button borders |
| `action` | `#1F4FD1` | Primary buttons, links, focus ring |
| `action-hover` | `#163A9C` | |
| `action-tint` | `#EAF0FD` | Selected option background, info banners |
| `chrome-admin` | `#14233A` | Super Admin sidebar |
| `chrome-admin-active` | `#2A3F5F` | Active nav item |
| `chrome-accountant` | `#0F3A31` | Accountant sidebar |
| `chrome-accountant-active` | `#24584B` | Active nav item |
| `crest` | `#8C1D2F` | School crest only. Never for errors or buttons |
| `ok` / `ok-tint` | `#0E7A55` / `#E7F4EE` | Paid, present, connected, money in |
| `warn` / `warn-tint` | `#B54708` / `#FDF0E3` | Dues, late, waiting, needs attention |
| `bad` / `bad-tint` | `#B42318` / `#FDECEA` | Errors, absent, failed, money out, destructive buttons |
| `neutral-tint` | `#EEF1F0` | Voided, inactive, holiday, view-only chips |

Rules:

- Status is never shown by colour alone. Chips always have a word ("Paid", "Late", "Voided"); money in/out columns have headers.
- Text contrast is at least 4.5:1. Do not use grey lighter than `ink-muted` for text.
- Outstanding dues are shown in `warn`, not `bad`. Owing money is normal, not an error.

## Typography

Bundle both fonts locally with `@fontsource`. No internet font loading. In Tailwind, `font-display` is Anek Latin and `font-sans` (the default) is IBM Plex Sans.

| Role | Font | Size / weight |
| --- | --- | --- |
| Page title | Anek Latin | 26px / 600 |
| Section title | Anek Latin | 19–20px / 600 |
| Big numbers (KPIs, amount due) | Anek Latin | 26–40px / 600–700, `tabular-nums` |
| Body, forms, tables | IBM Plex Sans | 14px / 400, table 13.5px |
| Labels, meta, captions | IBM Plex Sans | 12.5–13px / 400–600 |

- All numbers in tables use `font-variant-numeric: tabular-nums` and are right-aligned.
- Sentence case everywhere. No ALL-CAPS labels.
- If the Nepali interface is approved later, pair with Anek Devanagari and IBM Plex Sans Devanagari.

## Shape and spacing

- Radius: panels 10px (`rounded-lg`), inputs and buttons 8px (`rounded-md`), small buttons 6px (`rounded-sm`), chips fully rounded (`rounded-full`).
- No drop shadows except dialogs.
- Spacing scale (px): 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 28. Page padding 22px top, 28px sides. Gap between panels 20px.
- Inputs and buttons: 40px high; primary actions 44–56px. Clickable targets at least 32px, 44px for main actions.

## Layout

```
┌──────────┬──────────────────────────────────────────────┐
│ Sidebar  │ Top bar: title + subtitle | search | BS date │
│ 232px    │          | status pill(s) | user menu        │
│ role     ├──────────────────────────────────────────────┤
│ colour   │ Content (panels on paper background)         │
│          │                                              │
│ server / │                                              │
│ link box │                                              │
└──────────┴──────────────────────────────────────────────┘
```

- Sidebar: crest + school name + workstation name; grouped nav; bottom box shows server status (Computer 1) or connection to Computer 1 (Computer 2). The Accountant sidebar has a white "Collect fee  F2" button at the top.
- Top bar always shows today's BS date with AD under it and the connection status pill.
- Must work at 1366×768: two-column areas wrap to one column; wide tables scroll inside their panel.

## Components (shadcn/ui base)

| Need | Component | Notes |
| --- | --- | --- |
| Buttons | `Button` | Variants: primary (`action`), secondary (white, `line-strong` border), dark (`ink`, for confirm-in-dialog), destructive (`bad`). Labels say the action: "Collect fee", "Save expense", "Approve void" |
| Inputs | `Input`, `Select`, `Textarea`, `RadioGroup`, `Checkbox` | Label above, help text below in `ink-muted`, error below in `bad` with 2px `bad` border and `aria-invalid` |
| Money input | custom `MoneyInput` | "Rs." prefix, right-aligned, tabular, parses with `parseRupees` |
| BS date input | custom `BsDateInput` | Accepts `2083-07-12`, shows "12 Kartik 2083, 29 Oct 2026" under it, allows day 32 |
| Tables | `Table` | Header row `surface-muted`, 12.5px `ink-muted`; rows 13.5px with `line-soft` dividers; totals row bold; pagination below |
| Status chip | `Badge` | Tint background + strong text colour from the status tokens |
| Segmented control | `ToggleGroup` | Selected = `ink` background, white text |
| Tabs | `Tabs` | Underline style, selected = `ink` 2px underline |
| Banners | `Alert` | Icon + bold sentence saying what happened + plain sentence saying what to do + one action button |
| Dialogs | `Dialog` / `AlertDialog` | Confirm money actions and restore. Restore requires typing `RESTORE` |
| Charts | Recharts | Bars only (no pies). Current period in `action`, others in a muted tint. Always add a text summary |

## Screen patterns

- **Collect fee**: left = steps (Find student → Choose dues → Take payment → Confirm and print), student card, dues list with checkbox + editable amount, method buttons, cash received and change. Right = live receipt preview with torn-paper edge, total in large Anek numerals, amount in words, then the "Review payment" button. Confirm in a dark-bordered panel. Success panel is green with "View receipt" and "Next student".
- **Dues shown with emphasis**: a panel with a 2px `warn` border and the amount in large `warn` numerals.
- **Needs a decision** (void request, unlinked IDs): panel with a 2px `warn` border.
- **Destructive confirmation** (restore, approve void): 2px `bad` border; destructive button stays disabled until the safeguard is met.
- **View-only screens**: a `neutral-tint` "View only" chip next to the title, no edit controls rendered at all.

## Writing

- Plain words for school office staff. "Collect fee", "Fees outstanding", "Not scanned yet", "Can't reach Computer 1".
- Errors say what happened and what to do: "Cash in hand is Rs. 1,12,340. Pay this from the bank, or lower the amount."
- Empty states invite the next action: "No student matches 'bibak'. Check the spelling, or search by student ID or guardian phone."
- An action keeps the same verb through the flow: button "Save expense" → toast "Expense saved".
- No emoji. Icons are simple stroke icons (lucide-react is fine since shadcn uses it).

## Accessibility

- Real `<button>`, `<a>`, `<label>` elements. Every icon-only button has `aria-label`.
- Visible focus ring: 2px `action`.
- Everything reachable by keyboard. Shortcuts: `F2` open Collect fee and focus student search, `Ctrl+K` global student search, `Ctrl+Enter` review/confirm payment, `Esc` close dialog. Show shortcuts on the buttons.
