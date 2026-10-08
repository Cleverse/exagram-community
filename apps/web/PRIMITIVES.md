# Primitives

Everything Phase A built for the design-handoff rewrite: the global chrome, the shared UI primitives and the mock data
modules. Values come verbatim from `docs/design/design_handoff_exagram_team/Exagram Team.dc.html` — line numbers below
point into it.

Rule that governs all of this: **a colour that changes on hover lives in a Tailwind class, never in an inline `style`.**
An inline `style` outranks a `hover:` utility, so `style={{ background }}` next to `hover:bg-…` silently kills the
hover. Geometry (height, padding, radius, font size) is fine inline.

---

## Global CSS — `src/css/index.css`

> **v3 visuals (Exagram Team v3, `docs/design/exagram-team-v3/`).** Every token below keeps its name and carries the v3
> value: cool neutrals (text `#171923` / `#292b33` / `#3a3d48`, icons `#4e5261`, muted `#646879`, tertiary `#6f7383`),
> the `#fafbfd` sidebar and `#f6f7fa` canvas (`ground`), hover `#f4f4f8`, row hover `#f7f7fa`, selected row `#f2f2f6`,
> selected nav `#eff0f4`, lines `#eff0f4` / `#e7e8ee` / `#e1e3e9` / `#d3d5de`, near-black primary actions (`#171923`,
> hover `#2e3039`), 6px `--radius` and 10px `--radius-dialog`. Purple (`accent` `#6338f0`, and the band's `mark-*`) is
> brand only: the logo mark, the collapsed rail's account avatar and the thinking dots. Links are ink with a purple
> hover. Status colours are v2's. Added in v3: `label` (sidebar labels), `control-edge` (`#858999`, a control's
> boundary), `pane-line` (`#eff0f4`, the 1px line between panes), `line-segment` (`#d3d5de`), `type-doc` / `type-html` /
> `type-chat` / `folder` / `folder-fill` (the type icons), `radius-dialog` and `shadow-sheet`. `chip` / `subtle` /
> `press` are the soft fill and its hover and pressed steps (`#f4f4f8` / `#eff0f4` / `#e7e8ee`).

**Deviation from the v3 spec, for contrast (WCAG AA wins over the spec's exact greys):** v3's tertiary `#969aaa` and
label `#9a9eac` fall under 4.5:1 as text, so `muted-2` and `label` are both `#6f7383` (4.71 on white, 4.55 on the
`#fafbfd` sidebar). Nothing tertiary is drawn on the `#f6f7fa` canvas, where it would need `#6b6f7f` (4.66), so there is
no canvas variant. The sidebar's counts use `muted` (4.86 on `nav-selected`), since `muted-2` drops to 4.14 on the
selected and hover fills. Control boundaries (the Switch's off track, radio rings, checkboxes) use `control-edge`
`#858999`: 3.48:1 on white and 3.36:1 on the dialog surface, over WCAG 1.4.11's 3:1.

`@theme` carries every colour in the README "Design tokens" table as a literal hex. Use a token only when its value
equals the prototype's exactly; otherwise write the arbitrary value.

| group      | tokens                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ink        | `ink` `body` `secondary` `secondary-2` `muted` `muted-2` `label` `control-edge`                                                                                                                                                                                                 |
| surfaces   | `panel` `ground` `surface` `ground-raised` `surface-soft` `chip` `row-hover` `row-selected` `toolbar` `menu-hover`                                                                                                                                                              |
| borders    | `line` `row-line` `line-faint` `line-soft` `line-strong` `line-pale` `card-line`                                                                                                                                                                                                |
| brand      | `accent` `mark-soft` `mark-mid` `mark-core` `md` · type icons `type-doc` `type-html` `type-chat` `folder` `folder-fill`                                                                                                                                                         |
| rail       | `rail` `rail-pill` `rail-fg` `rail-fg-muted`                                                                                                                                                                                                                                    |
| dark panel | `dark-panel` `dark-text` `dark-text-2` `dark-kicker` `dark-faint` `dark-chip` `dark-track` `dark-fill`                                                                                                                                                                          |
| status     | `pending` `pending-bg` `pending-line` `green-bg` `green-fg` `link-hover` `blue-bg` `blue-fg` `orange-bg` `orange-fg` `violet-fg` `html-bg` `html-fg` `gold-bg` `gold-fg` `gold-card` `gold-line` `danger` `dot`                                                                 |
| fonts      | `--font-sans` Geist, `--font-display` Archivo 500/600/700 (both with IBM Plex Sans Thai second, for Thai) · `--font-mono` Geist Mono. Archivo is v5's face for titles, headings and dialog titles (18px and up) and the uppercase micro-label; the Exagram wordmark stays Geist |

Base layer reproduces the prototype's reset (`html,body` margin 0 / `panel` / `overflow-x:auto`, `button` and
`input,textarea` inheriting the font, `a` ink hovering `link-hover`) and styles `#root` as the prototype's root element:
Geist, `min-height:100vh`, `font-size:15px`, `line-height:1.4`, `min-width:880px`, `position:relative`.

`@keyframes fadeUp` is global. Aura has one arrival curve and three durations, all tokens: use
`animation: "fadeUp var(--duration-panel) var(--ease-arrive)"` (300ms, `cubic-bezier(.22,.61,.36,1)`), a hover over
`--duration-row` (300ms), a tab underline over `--duration-tab` (340ms) and a press over `--duration-press` (120ms).

`:focus-visible` keeps a `2px` ink outline with a `2px` offset (v2 decision 6: focus rings are ink). The prototype shows
the browser default; this is the one deliberate deviation, for accessibility.

`button, input, textarea, select` take `border-radius: var(--radius)` (6px) in the base layer, so every control is
rounded without a class. A control drawn by an underline (`UnderlineTabs`) sets `borderRadius: 0`. v3's list rows have
no dividers, so they round too (the file list, Activity; P:1668, P:1729). Needs your action keeps its row hairline and
stays square. Dialogs take `--radius-dialog` (10px). Panes have no radius, and avatars are drawn square. The pending dot
stays a 6px square.

Utilities:

| utility       | what                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `well`        | the segmented track (v3 P:1573): white, a 1px ink@.09 hairline, `inset 0 1px 2px #f2f2f6`          |
| `press`       | the 1px press drop over `--duration-press`, colour/border/shadow transitions over `--duration-row` |
| `mono-label`  | v5 micro-label: Archivo 600 11px / .06em uppercase muted — list and panel section labels           |
| `mono-kicker` | the same in `label` — sidebar section labels, panel heads (History), the library's date groups     |
| `mono-col`    | 12px muted, sentence case — column headers                                                         |

The frost utilities (`frost`, `frost-approve`, `frost-send`, `frost-select`) are gone in v2: primary and approve are
`Button variant="primary"` / `"approve"` (near-black), and a selected row or revision is `bg-row-selected` (`#f2f2f6`).

`sidebar` and `nav-selected` name the sidebars' fill and their selected item (app and Settings), apart from `ground`
(the canvas) and `chip` (the soft fill).

Colour tokens added for the primitives: `hover` (`#f4f4f8`, the quiet/icon-button wash), `frost-line` (`#e7e8ee`) and
`line-on-dark` (white@.12, the gap line on the dark Context band).

---

## Chrome

### `AppShell` — `src/components/AppShell.tsx`

T:L1733–1870. No top bar: a `100vh` flex row with `overflow:hidden`, the sidebar, then `<main>` (`flex:1`,
`min-width:0`, `100vh`, scrolls on its own) around the `<Outlet/>`. A screen fills `main` with `height:100%`.
`LibraryActionsProvider` wraps it all (see below). The root row takes a desktop file dropped anywhere — sidebar, rail or
screen — and opens Upload with it (`actions.upload(file)`), so the browser never navigates to the file. On a new screen
`main` scrolls back to the top. `SidebarWidthContext` carries the current sidebar width (250, or 56 collapsed) for the
list column's drag limit beside the pane (`useListWidth`).

**Sidebar** (`<aside aria-label="Library sidebar">`), 240px on `sidebar` (`SIDEBAR_WIDTH`), edge to edge with the main
area on a full 1px `pane-line` right border (v3: panes sit flush, no gaps). It **stays 240px while the preview pane is
open**; there is no compact mode.

- Header, `22px 20px 0`: the 3×3 mark (5px cells, 1.5px gap) and "Exagram" in Geist 700 20px, together one link to
  `/activity`; a 32px `IconButton` "Collapse sidebar". Below it, 13px muted: "<organization> · team workspace" from
  `me.workspaceName` in a Team, "Personal library" in a Personal Workspace (`useWorkspaceKind`, `workspaceLine`).
- Section switcher: `UnderlineNav` (`<nav aria-label="Sections">`) with the links Artifacts (`/activity`) and Context
  (`/context`). The current one follows the route: Context for `/context`; none for `/connections`, which keeps the
  Artifacts body; Artifacts for the rest. `/settings/*` swaps the whole sidebar (see Settings shell). Chat arrives with
  its own route in Phase 6.
- Body per section: `LibrarySidebar` (Artifacts) or `ContextSidebar` (Context).
- Account row under a 1px `line` inset 20px: `AccountMenu` (`components/sidebar/AccountMenu.tsx`), a 48px button with
  `title` and `aria-label` "Account" and `aria-haspopup="menu"` — 32px ink `Avatar` (the collapsed rail's is purple, one
  of the three brand places), name 14/600, organization 12px muted, `IconChevronsUpDown`. It opens a 260px
  `Menu placement="up"` (v3 README §Account menu, P:3928–3933): MCP clients (`/connections`), Settings
  (`/settings/general`) and **Sign out**. It has no Workspace switch yet (ADR 0043 adds one). Connect Google is in
  Settings → General, not the menu.

**Settings shell**: on `/settings/*` the shell renders `SettingsSidebar` (`features/settings/SettingsSidebar.tsx`,
`<aside aria-label="Settings sidebar">`) in place of the app sidebar or rail: 250px on `sidebar` with the gapped right
divider, "Back to Exagram" (`IconArrowLeft`) to the last app route before Settings opened (kept in the shell's state;
`/activity` when the session started in Settings), "Settings" at 22px/700, the same Workspace line as the sidebar, then
`<nav aria-label="Settings">` with 34px, 14px, 6px-radius links, the current one `nav-selected` at 500 (v3's values)
with `aria-current="page"`. The tabs follow the Workspace kind (`visibleSettingsTabs`): General and Notifications in a
Personal Workspace, and also Team, Security (once redaction is on) and Audit in a Team. `SettingsPage` fills the rest: a
centred column up to 1250px (`56px 48px 96px`), the tab's H1 (Geist 700 32px) and a muted subline, then the tab.
`/settings` goes to General; `/settings/organization` and `/security` to Security, `/settings/account` to General, all
keeping the query string; any other tab is NotFound.

**Settings → Audit** (`features/audit/AuditPage.tsx`) keeps 20 rows per page and Show cost. The client chips became one
**Filter** button (`IconFilter`; ink fill with the filter's label, e.g. "ChatGPT · Grace Hopper", while a filter is on)
that opens "Filter audit log" (P:2259–2284): Client and Person selects built from the rows on hand (`chipsOf` /
`peopleOf`, a person keyed by email), each change applying at once, with Clear and Done. `ledger.activity` is
admin-only, so `useAuditRows` (`features/audit/hooks/useAuditRows.ts`) reads `me.isAdmin` first: a non-admin sees "Only
workspace admins can read the audit log.", never a table. An admin whose 90-day window comes back with zero rows sees an
honest empty state ("No client requests in the last 90 days.") instead of the design's sample log, which is now
test-fixture data only (`sampleAudit.ts`); any other failure is an alert with its message and a Retry.

**Collapsed rail** (`<aside aria-label="Collapsed sidebar">`), 56px (`RAIL_WIDTH`): an "Expand sidebar" 36px
`IconButton` at the top, the bare avatar (`AccountMenu compact`, still `title="Account"`) at the bottom. The choice is
kept in `localStorage` under `exagram.sidebarCollapsed`, read and written inside `try`.

**Page switch**: when the route's path changes (`location.pathname`), `main` plays
`animate([{opacity:0, transform:"scale(.988)"}, {opacity:1, transform:"none"}], {duration:300, easing:ease-arrive})`
(T:L3758). A preview lives in the query string, so opening or closing one keeps the path and does not animate; nor does
anything under `prefers-reduced-motion`.

The e2e suite relies on: `getByTitle("Account")`, menuitem "Sign out", complementary "Library sidebar", navigation
"Projects" (whose Project rows are links), button "New project".

The `/?google=linked` and `?error=google_*` notices still toast from here, on `/` only.

### `SidebarLink` · `SidebarCount` — `src/components/sidebar/SidebarLink.tsx`

T:L1760–1768. The sidebar's one row, a real `Link` (it takes `LinkProps`, drag handlers included): 34px, `0 10px`, 10px
gap, 14px `body`, 6px radius; hover washes `hover` (`#f4f4f8`) and the current row fills `nav-selected` (`#eff0f4`) at
500 with `aria-current="page"`. There is no left bar. `icon` goes before the label and `trailing` after it.
`SidebarCount` is the Geist Mono 11px `muted` count (not `muted-2`, which fails 4.5:1 on the selected fill). Project
rows carry the blue `IconProjectFolder` (17px).

### `LibrarySidebar` — `src/features/library/LibrarySidebar.tsx`

The Artifacts body. It reads everything it lights from the route, so it is the same beside every screen: black "New"
(36px, full width, opens Upload artifact / New project), Activity (`IconActivity`, with a `pending-tint` / `pending-fg`
badge counting the Revisions you approve), All artifacts (`IconGrid`), then `SectionLabel variant="sidebar"` groups
PINNED (hidden on `/mine`), SHARED PROJECTS and PROJECTS (each label links to the Projects screen `/projects`, and the
caret beside it folds the section; PROJECTS carries the 24px "New project" `+`). Every row that goes somewhere is a
link. A project row is the blue `IconProjectFolder` (17px), the name, `IconPeople` when shared, and the count; it
accepts a dragged Artifact (a move) or a desktop file (an upload into that Project, caught before the shell's own drop).
A PINNED row links to `?preview=:id` on the list on screen when the window is at least `PREVIEW_MIN_VIEWPORT` (1280px)
wide, or to the Artifact's page `/artifacts/:id` otherwise; a plain click hands the list its own selection.

### `ContextSidebar` — `src/features/context/ContextSidebar.tsx`

The Context body (T:L1815–1826): "Weekly recap", then six weeks newest first (`RECAP_WEEKS`), each `IconCalendar`, the
range earliest day first ("8–14 Sep", `weekLabel`), a `hover`-filled 18px tag "This week" / "Last week", and the count
of artifacts in that week. The week is the URL: `/context?week=<n>` (`paths.contextWeek(n)`, `weekFromSearch`), so the
page and the list always agree. Every row is a link. Both read their rows through `useRecapSource`, which brings in the
design's sample only once the library has loaded empty: while it loads the rows show real dates and no counts, and a
failed load says so.

### `LibraryActionsProvider` / `useLibraryActions` — `src/features/library/LibraryActions.tsx`, `useLibraryActions.ts`

Owns the Upload and New project dialogs once, for the sidebar and the library header alike: `upload(file?, projectId?)`
targets `projectId`, by default the Project on screen when Upload opens (`projectIdOf(pathname)`),
`newProject(parentId?)` opens the create dialog and lands on the new Project. A list screen calls
`useRegisterArtifactSelect(select)` so a PINNED row previews inside that list; with no list on screen the row goes to
`/artifacts/:id`.

### `ToastProvider` / `useToast` — `src/components/Toast.tsx`

Prototype lines 1057–1059. `const toast = useToast(); toast("…")`. Fixed bottom-centre 28px, `ink` on `ground`, 6px
radius, padding `14px 20px`, 15px, `--shadow-toast`, `fadeUp .2s`, `max-width:90vw`. Dismisses after 2600ms; a second
toast replaces the first.

> The README lists older values (24px, radius 10, `12px 18px`, 14px, white). The prototype wins.

### `Dialog` — `src/components/Dialog.tsx`

T:L3404–3458 (NEW / EDIT PROJECT). Scrim ink at `<scrim>` (`color-mix` of `--color-ink`) with `padding:24px`; a 10px
(`--radius-dialog`) card on `surface-dialog` (`#fafbfd`) with `1px solid line-soft`, `--shadow-dialog`,
`max-height:calc(100vh - 48px)`, `overflow:auto` and `fadeUp var(--duration-panel) var(--ease-arrive)`. Escape closes,
scrim click closes, focus moves into the panel, `role="dialog"` with `aria-label`.

| prop            | default                | notes                                                                                        |
| --------------- | ---------------------- | -------------------------------------------------------------------------------------------- |
| `title`         | —                      | string or node; the accessible name when it is a string. Omit it to drop the header entirely |
| `ariaLabel`     | —                      | overrides the name when `title` is a node, absent, or carries curly quotes                   |
| `onClose`       | —                      | Escape, scrim click and the close button all call it                                         |
| `width`         | `680`                  | max-width px. 560 recap · 680 project settings · 730 Share · 760 client detail               |
| `scrim`         | `0.45`                 | any opacity, `.14` (light) to `.55` (client detail)                                          |
| `surface`       | `var(--color-surface)` | any colour token                                                                             |
| `header`        | —                      | replaces the whole sticky header                                                             |
| `headerPadding` | `20px 24px`            | `20px 22px` in the recap modal                                                               |
| `titleSize`     | `18`                   | Archivo 600                                                                                  |
| `footer`        | —                      | right-hand footer content, usually Cancel + primary                                          |
| `helper`        | —                      | footer left text, 13px muted                                                                 |
| `bare`          | `false`                | drops the padded body wrapper so children sit flush to the card edges                        |
| `bodyGap`       | `28`                   | body is `flex-direction: column`                                                             |
| `bodyPadding`   | `24`                   |                                                                                              |
| `cardStyle`     | —                      | merged last onto the card, for chrome the shell cannot express                               |

Sticky header `20px 24px` / `border-bottom:1px solid line`, title Archivo 600 18px, 32px `IconButton` close. Sticky
footer `16px 24px` / `border-top`, `gap:10px` between buttons.

The card is the scrolling element: `max-height:calc(100vh - 48px)` with `overflow:auto`, header `position:sticky;top:0`
and footer `position:sticky;bottom:0`. There is no inner scroll container.

Dialogs that do not use the header/body/footer are still this component — `bare` plus the escape hatches:

```tsx
// RECAP MODAL: white card, rows flush to the edges.
<Dialog title={label} onClose={close} width={560} surface="var(--color-panel)" headerPadding="20px 22px" bare>
	{items.map((item) => (
		<button key={item.id} style={{ padding: "12px 22px", borderBottom: "1px solid var(--color-row-line)" }}>…</button>
	))}
</Dialog>

// SHARE DIALOG: own header block, own section rules, own footer strip.
<Dialog ariaLabel={`Share ${name}`} onClose={close} width={730} bare cardStyle={{ maxHeight: "none", overflow: "hidden" }}>
	…header block, sections, footer strip…
</Dialog>
```

With `bare` the Dialog still owns the scrim, its click-to-close, Escape, focus-in, `role="dialog"`, `aria-modal`, the
border, the shadow and the `fadeUp` entrance.

The footer pair is `outline` Cancel + `primary` (near-black) confirm at 40px, New / Edit project included (v3: no purple
button). A destructive confirm is `danger`; an approval is `approve`.

```tsx
<Dialog
	title="New project"
	onClose={close}
	helper="Private until you invite someone. Settings can change later."
	footer={
		<>
			<Button variant="outline" size={40} onClick={close}>
				Cancel
			</Button>
			<Button size={40} disabled={!name.trim()} onClick={save}>
				Create project
			</Button>
		</>
	}
>
	…fields…
</Dialog>
```

`dialogCancelClass` and `dialogPrimaryClass` are the same pair (outline / primary, 40px) as class strings, for a raw
`<button>` that has not moved to `Button`.

---

## `src/components/ui/`

Import from the barrel: `import { Button, TypeIcon, IconUpload } from "@/components/ui"`.

### `icons.tsx`

Aura line icons, copied from the prototype (`docs/design/aura-matrix/template.decoded.html`): 24×24 viewBox,
`fill="none"`, round caps and joins, drawn in `currentColor`. Colour an icon with `style={{ color }}` or a text-token
class, never a hex prop: `var()` does not resolve in SVG presentation attributes. Props: `size`, `strokeWidth`
(overrides the glyph's own weight), `fill` (`"currentColor" | "none"`, for the pinned pin), `className`, `style`. All
are `aria-hidden`.

Stroke weights follow the prototype:

- 1.2 hairline set: `IconFile` · `IconApp` · `IconChat` · `IconFolder` · `IconNewProject` · `IconSearch` · `IconUpload`
  · `IconShare` · `IconPeople` · `IconPerson` · `IconCalendar` · `IconShield` · `IconPlus` · `IconPencil`
- 1.4: `IconActivity`
- 1.5: `IconProjectFolder` (it colours itself; see below)
- 1.6: `IconSidebar` · `IconSend` · `IconChevronsUpDown` · `IconRefresh`
- 1.8: `IconGlobe` (Anyone with the link) · `IconSlidersHorizontal` (Link settings) · `IconEyeOff` (Hide password), all
  lucide geometry
- 2: `IconGrid` · `IconPin` · `IconClose` · `IconChevronDown` / `Up`
- 2.4: `IconChevronRight` / `Left`
- `IconEllipsis` is three filled dots.

Glyphs the prototype does not redraw keep their earlier paths: `IconArrowUp` · `IconMinus` · `IconCheck` ·
`IconCheckBold` · `IconCheckCircle` · `IconLink` · `IconUnlink` · `IconDownload` · `IconPeoplePlus` · `IconDollar` ·
`IconSparkle` · `IconLightbulb` · `IconHome` · `IconCopy` · `IconTrash` · `IconExternal` · `IconClock` · `IconTag` ·
`IconLock` · `IconInfo` · `IconWarning` · `IconMaximize` · `IconPlay` · `IconArrowLeft` (Back to Exagram) · `IconFilter`
(the Audit Filter button).

Colour rule (v3): type icons are colour-coded through `TypeIcon` (doc `type-doc` grey, HTML `type-html` orange, chat
`type-chat` blue) and a project is the blue `IconProjectFolder` (`folder` stroke over `folder-fill`). Every other line
icon draws in `currentColor`, grey (`secondary` or `muted`), and a pin turns ink. No icon is purple.

### `Button`

`variant` × `size`. `style` and `className` override anything. Every variant carries `press` (1px drop on press over
`--duration-press`, colour changes over `--duration-row`) and fades to 50% when disabled. The radius is the base layer's
6px.

| variant       | look                                                                       | weight |
| ------------- | -------------------------------------------------------------------------- | ------ |
| `primary`     | black (`primary`), white text, hover `primary-hover` — the default         | 600    |
| `approve`     | the same near-black (plan decision 6); its name keeps call sites readable  | 600    |
| `quiet`       | transparent, `secondary` text, hover `hover` (ink@.05)                     | 500    |
| `outline`     | v3 secondary: white, 1px `#e1e3e9` (`shadow-plate`), `body`, hover `hover` | 500    |
| `ghost`       | text only, `muted` → ink on hover                                          | 500    |
| `subtle`      | v3 soft fill: `chip`, hover `subtle`, pressed `press` (Draft with AI)      | 500    |
| `danger`      | `danger` text on `danger-bg`, hover `danger-hover`                         | 600    |
| `dangerGhost` | `danger` text only, `danger-bg` on hover (Team's Decline and Revoke)       | 500    |

The non-filled variants drop to 400 at 40/44, as the prototype's dialog Cancel does.

| size | padding  | type |
| ---- | -------- | ---- |
| 30   | `0 12px` | 13px |
| 32   | `0 12px` | 13px |
| 36   | `0 16px` | 14px |
| 40   | `0 16px` | 15px |
| 44   | `0 18px` | 15px |

30 / 32 / 36 are Aura's heights (Approve 30, row Share 32, New 36). 40 is the dialog footer; 44 the auth pages. `gap`
defaults to 8.

**Layout depends on the children.** More than one child means an icon beside a label, so the button gets `display:flex`,
`align-items:center`, the `gap` and `white-space:nowrap`. A single child is a text-only button and stays a plain block
button. If a text-only button has to nowrap, pass `className="whitespace-nowrap"`.

### `IconButton`

`size` 24 | 32 | 34 | 36, default 32 — the header action and dialog close (T:L1745); 34 is v3's larger header and ghost
icon button. Square with the 6px radius, `secondary` glyph centred, hover `hover` (`#f4f4f8`), `press`. The list
header's actions (`HeaderAction`: Search, Upload, Share, ⋯) are borderless with ink glyphs.

### `Switch`

48×28 (`sm` 32×18), a 6px track, ink when on and `control-edge` when off (3.48:1 on white, 3.36:1 on the dialog
surface), a white 22px knob rounded to sit inside it at `left: 3 | 23` with `--shadow-knob` (T:L3436). Track and knob
move over `--duration-press` on `--ease-arrive`. `role="switch"` with `aria-checked`. Props: `checked`,
`onChange(next)`, `label` (accessible name), `id`, `size`.

### `RadioCard`

T:L3442–3447. 6px-radius white card, `1px` border `line-soft` (selected and hover ink), `padding:14px 16px`, square 20px
ring in `control-edge` (ink when checked) with a 10px dot. Props: `name`, `value`, `checked`, `onSelect(value)`,
`label`, `description`.

A real `<input type="radio">` carries the group semantics. It covers the whole card at `opacity:0` rather than sitting
`sr-only`, so a pointer click and Playwright's `.check()` land on the input instead of on the label. The accessible name
is the `label` alone: `description` is tied on with `aria-describedby`, so a description mentioning a field name cannot
make `getByLabel` match a radio. Keyboard focus shows through `has-[:focus-visible]` on the card. The card is
`position:relative`, which is what the absolute input needs. Covered by `src/components/ui/RadioCard.test.tsx`.

### `Chip` · `SegmentedControl`

`Chip variant`:

| variant    | where                   | metrics                  |
| ---------- | ----------------------- | ------------------------ |
| `settings` | project header chips    | 34px, `0 12px`, 14px     |
| `filter`   | Audit Filter, Show cost | 36px, `0 14px`, 14px/500 |
| `source`   | Context "Sources" chips | 30px, `0 10px`, 13px     |

Each preset carries only the geometry every call site of that variant shares; `white-space` and `min-width` come from
the call site. Pass `background` / `color` / `borderColor`. The element is a `<button>` when there is an `onClick` and a
`<div>` otherwise; `as="button"` forces the button.

`SegmentedControl<T>` is the segmented well (T:L1882): Mine / Team, Project / Day. `tone="solid"` (default) is the
`well` utility with `padding:3px` and `gap:2px`; segments 28px, `0 12px`, 14px (v5), 6px radius; the selected segment is
black (`primary`) with white text at 600, the rest 500 muted. `tone="light"` (the recap's Project / Day, P:4095) is a
`ground` track with the selected segment white, ink, `--shadow-plate`, still at 13px. An option may carry a mono
`count`, 12px in `solid` and 11px in `light`. Switching does not animate. Each segment is a button with `aria-pressed`.

### `UnderlineTabs`

`src/components/ui/UnderlineTabs.tsx`. Section tabs (T:L1748, `navTabs` T:L4476) and scope tabs (T:L1834): an 18px gap,
a full-width 1px `line` base, the active tab `inset 0 -2px 0 ink` at 600, inactive 500 muted, colour and underline
transitioning over `--duration-tab`. `size="md"` is 32px / 14px; `size="sm"` is 30px / 13px, and a tab may carry a Geist
Mono 11px `count`. `size="lg"` is the Team page's row (handoff §2.3): 40px / 15px, `0 12px` padding, 4px apart, inactive
at 400, a 12px count. A tab's `badge` replaces its count with an 18px amber (`pending`) pill of white Geist Mono
12px/600; its `label` is what a screen reader hears instead of the bare number. `role="tablist"` (named by `ariaLabel`)
with `role="tab"` + `aria-selected`. Use it only for real tabs over one page (the library scope tabs, Phase 3); when
each item is its own address, use `UnderlineNav`. Covered by `UnderlineTabs.test.tsx`. (The library's All / Shared with
me / My uploads are routes, so they are `UnderlineNav`.)

```tsx
<UnderlineTabs ariaLabel="Scope" tabs={[{ value: "all", label: "All" }, …]} value={scope} onChange={setScope} />
```

### `UnderlineNav`

`src/components/ui/UnderlineNav.tsx`. The same look as navigation: `<nav aria-label>` of `Link`s, the current one with
`aria-current="page"`. The sidebar's section switcher and the Settings sections use the underline (ink).
`variant="scope"` is the library's root scope row (All · Shared with me · My uploads, v5 §3): text tabs 28px tall with
no padding, a 16px gap, a transparent fill and no base line, at 14px. The current one is ink at 600 over
`inset 0 -2px 0 ink`; the rest are `secondary` at 500 over the same underline in transparent (so nothing shifts),
turning ink on hover. Every count is Geist Mono 12px `muted-2` (v5's `#969aaa` fails 4.5:1; see the contrast note). The
underline eases over `--duration-tab` and the colour over `--duration-press`, both on `--ease-arrive`. v5 names an
orchid underline in its changelog but keeps ink for contrast. Covered by `UnderlineNav.test.tsx`.

```tsx
<UnderlineNav ariaLabel="Sections" items={[{ to: "/activity", label: "Artifacts", active: true }, …]} />
```

### `SectionLabel` · `MonoKicker` · `MonoCol` · `SectionRule`

`SectionLabel` is the uppercase list and panel label: Archivo 600 11px / .06em muted (`mono-label`). `variant="sidebar"`
is the same micro-label in `label` grey (`mono-kicker`). `as` picks the element (`div` by default). `MonoKicker` is
`SectionLabel variant="sidebar"`. `MonoCol` is a column header: sentence case, 12px muted (`mono-col`). `SectionRule` is
"Connected clients · 3": a `SectionLabel` followed by a 1px `line` rule filling the row.

### `GapLine`

`src/components/ui/GapLine.tsx`. The gapped vertical divider (T:L1736): an `aria-hidden` 1px `pane-line` absolutely
positioned on `side` (`left` | `right`), stopping `inset` px (default 12) short of the top and bottom so it never
touches a horizontal rule. `tone="light"` draws `line-on-dark` for the dark Context band. **The parent must be
`position: relative`.** v3 keeps it only inside a screen (the Settings column, the History panel and the Context band);
the shell's sidebar, list and preview sit edge to edge on full 1px `pane-line` borders instead.

### `TypeIcon`

`kind` is `MockFileType | ArtifactKind | "folder"`. Draws v3's colour-coded line icon at stroke 1.5 — `type-doc` grey
for every page-shaped kind, `type-html` orange, `type-chat` blue, the folder in `folder` over `folder-fill` — centred in
a `size` footprint (default 34) so rows keep their geometry. A footprint of 24 or more (list rows pass 24) draws the
20px glyph; smaller ones draw at most 16px: a page for `md` / `doc`, a browser window for `html`, a bubble for `chat`, a
folder for `folder`. `pdf`, `docx`, `pptx`, `xlsx` and images are small marks inside the page or window outline, not
text labels, because a label is unreadable at that size. `shared` adds a 12px muted `IconPeople` at the bottom-right.

### `Avatar` · `AvatarStack`

`Avatar` is a 6px-radius square of Geist Mono 500 initials, as v3 draws its person avatars (Share's people P:3029,
P:3067; the Activity actors P:1708). `square` drops the radius for the account avatar, which v3 draws sharp (P:1542,
P:1556). The default is 32px ink with white 12px initials; the collapsed rail passes `accent`, one of the three places
purple appears. `fontSize` defaults to 12 at 32+ and 9 below. It does not set `flex:none`; a call site that must not
shrink passes `className="flex-none"`. `AvatarStack` is the 64px right-aligned row slot: 26px neutral squares
(`row-line` / ink), `2px solid ground` ring, `gap:3px` with `margin-left:-6px`.

### `Menu`

The ROW MENU popover, T:L3277–3285. `anchor` is the trigger's `DOMRect`; the card lands at
`left: min(rect.left, innerWidth - width)` and `top: rect.bottom + 6`. `placement="up"` instead pins the card's bottom
6px above the trigger (the account menu at the foot of the sidebar). `width` defaults to 240; `max-height:60vh` with
`overflow-y:auto`, white, `1px solid line-soft`, 6px radius, `--shadow-menu`, `padding:6px`,
`fadeUp var(--duration-panel) var(--ease-arrive)`. Items are 15px, `padding:10px 12px`, hover `menu-hover`. Escape
closes; the full-screen click-catcher closes on an outside click. `header` takes non-interactive content above the
items. `role="menu"` with `role="menuitem"` items. Keyboard follows the ARIA menu pattern: opening focuses the first
item, Arrow Up/Down wrap through the items, Home/End jump to the ends, and closing returns focus to whatever held it
when the menu opened. Covered by `Menu.test.tsx`. An item may carry `checked` (one choice of a set is current: bold, a
trailing ink check, `menuitemradio` + `aria-checked`) and `indent` (a subordinate choice, such as a folder under its
project). An item may also carry `detail` (a 13px muted value after the label that truncates first; the item is then
named "label, detail"), `chevron` (a trailing ›, for an item that swaps in a sub-list) and `back` (a leading ‹, for the
row that returns). A menu whose contents swap passes `view` naming the list on show (focus moves to its first item on
each change) and `onEscape` so Escape steps back instead of closing.

```tsx
const [anchor, setAnchor] = useState<DOMRect | null>(null)
<button onClick={(event) => setAnchor(event.currentTarget.getBoundingClientRect())}>…</button>
{anchor ? <Menu anchor={anchor} onClose={() => setAnchor(null)} items={[{ label: "Rename", onSelect: rename }]} /> : null}
```

### `PageContainer`

`width` is `1040` (MCP) or `1120` (Context). Settings uses its own 1250px column (see Settings shell). Renders
`min-height:100vh` around `max-width:<width>; margin:0 auto; padding:32px 40px 96px`. `label` sets `data-screen-label`,
which names the screen for tests and screenshots.

### `ThinkingMatrix` — `src/components/ui/ThinkingMatrix.tsx`

Aura Matrix's thinking matrix in its Pulse register: a 3×3 grid of `accent` squares (15px by default, 12px in a meta
line) fading on `--ease-loop` (`thinkingPulse`, 1400ms) in a diagonal wave. It marks a file whose text is still being
indexed (`isIndexing` in `features/library/indexing.ts`: `extractionStatus === "queued"`), one per indexing row, and is
named "Indexing" for screen readers. Aura Matrix asks for one matrix per screen; this departs from it on purpose because
the mark is temporary and wordless. The `revisions` live event refetches the list and the Artifact when extraction ends.

---

## `src/mock/`

Local state for what the design shows and the API has no field for. Nothing here talks to the network; nothing here
belongs in a screen the API can already drive.

### `people.ts`

`ME`, `PEOPLE` (RC / KC / IG with name, email, user) and `initialsOf(name, email)` — first letters of the first two
words, uppercase, falling back to the first two characters of the email.

### `sample.ts`

The prototype's sample data, ported with its types.

- `ICON` (md / html / chat / folder tones), `AGE("2w") → 14`, `DATE` (age → "11 Sep 2026 · 09:12")
- `PUBLISH` — `{ auto | owner | editors }` → `[label, description, chipLabel]`
- `ACTION` — audit badge colours per `read | search | summarize | write | list`
- `HACKATHON` (`DocBlock[]`), `genericBlocks(name, owner, rev)`, `DECK` (5 slides)
- `SCOPES`, `CLIENTS` (`MockClient[]`)
- `AUDIT` (`AuditRow[]`: time, age, clientId, action, fileId, rev, query, redactedSpans, tokensIn, tokensOut)
- `makeProjects()`, `makeFiles(demoHighVolume = false)`, `makeGrants(projects, files, people)` — factories, not frozen
  constants, because the prototype mutates them
- `SECURITY_SAMPLES` (`RedactionSample[]`), `KIND_COLORS`, `SECURITY_INITIAL`

### `cost.ts`

`cost(tokensIn, tokensOut, redactedSpans)` = `in × 0.0000025 + out × 0.00001 + spans × 0.0012`. `usd(n)` → `"$0.000"` or
three decimals. `tokens(n)` → `"52.6k"` at 1000 and up. `costBreakdown(in, out, spans)` →
`"$0.018 · redaction $0.002 · serving $0.015"` — the parts round independently, so they need not add to the total.
Unit-tested in `cost.test.ts`.

### `store.ts`

`useLocalStore<T>(key, initial)` → `[value, set]`, backed by `localStorage` under `exagram.mock.<key>` through
`useSyncExternalStore`. `set` takes a value or an updater. Parsed values are memoised per raw string, so the same object
comes back between writes and an effect dependency on it is safe. `readMock`, `writeMock` and `clearMock` are the
non-hook equivalents.

### `projectSettings.ts`

`useProjectSettings(projectId: string)` →
`{ policy: string; overwrite: boolean; publish: Publish; set(patch: Partial<ProjectSettings>): void }` where `Publish`
is `"immediate" | "owner" | "editor"`. Defaults `{ policy: "", overwrite: false, publish: "immediate" }`, stored at
`exagram.mock.project.<id>`.

`publishLabel(publish)` → "Publishes immediately" / "Owner approves" / "Editor approves" — the header chip.
`publishToastLabel(publish)` is the same label lowercased, because the create toast splices it mid-sentence:
`` `${name} created — ${publishToastLabel(publish)}, private until you invite someone.` ``. Use `publishLabel` for
anything the reader sees as a standalone chip.

### `clientSettings.ts`

`useClientSettings(connectionId: string)` →
`{ access: "all" | "named"; folders: Record<projectId, "view" | "edit">; redaction: "default" | "strict" | "patterns"; scopes: string[]; set(patch: Partial<ClientSettings>): void }`,
stored at `exagram.mock.client.<id>`. An unwritten slot seeds itself from the matching sample client in `CLIENTS`
(access, folders, redaction and scopes as the prototype script lists them) and falls back to
`{ access: "all", folders: {}, redaction: "default", scopes: [] }` for an id that is not in the samples.
`defaultClientSettings(id)` exposes that seed directly.

### `policyDraft.ts`

`draftPolicy(projectName)` resolves the prototype's template after `DRAFT_DELAY_MS` (900). `policyTemplate(projectName)`
is the same string without the delay.

---

## The file list and the content window (Phase 3)

### `ListHeader` · `HeaderAction` — `src/features/library/ListHeader.tsx`

T:L1878–1945, v5 §2. The list head is its own non-scrolling block (`padding:<top> 28px 0`) above the rows' scroller. The
title row is at least 48px, bottom-aligned: a 14px breadcrumb (`<nav aria-label="Breadcrumb">`, each part ellipsizing)
over `PageTitle`, the Archivo 700 H1 at line-height 1.15 (one line, ellipsis), then the actions. `pageHeaderSize`
(`pageHeader.ts`) sizes it from two facts: the window is tall (`innerHeight >= 900`, `useTallViewport`, kept current on
resize) and the list has scrolled (`scrollTop > 24`, from the scroller's own `onScroll`). Tall at the top is 32px /
-.02em with 32px top padding and 24px to the tabs; short at the top 24px / -.015em, 24px, 16px; scrolled 24px (tall) or
22px (short) / -.015em, 16px, 12px. The swap is instant. A string title takes `itemCount` after it on its baseline (10px
gap): Geist Mono 12px `muted`, tabular figures, "N items", never shrinking while the title ellipsizes. `HeaderAction` is
a 32px `IconButton` named by its `title` and `aria-label`: "Search", "Upload", and on a Project "Share" and "More
actions", at the root "New project". `below` holds the Project page's rules chip; `tabs` the root's scope links
(`UnderlineNav variant="scope"` with counts). The sort row: "Updated ↑" 14/600, then the Project (170px) and Last
activity (120px) column heads over a 1px `line`.

### `ProjectRulesChip` — `src/features/project/ProjectRulesChip.tsx`

T:L1910–1925. Owner only (the page decides). A 28px chip "Project rules" with a mono count and a turning caret: a
disclosure (`aria-expanded` + `aria-controls`), not a dialog, so focus stays on the chip; Escape or an outside click
closes it and keeps focus there. The 340px card holds Policy, Overwrite and Published version, then "Edit settings",
which opens the settings dialog. The publish policy is the Project's API field; Policy and Overwrite are
`useProjectSettings`' local values until the API has columns for them, and their labels say "Saved in this browser".

### `ArtifactRow` · `ProjectRow` — `src/features/library/ArtifactRow.tsx`

The library root groups rows by recency under `GroupLabel` (`ArtifactList.tsx`): v5's micro-label (`mono-kicker`,
Archivo 11/600/.06em uppercase in `label`, not v5's `#969aaa`), "EARLIER THIS WEEK · 14", with `28px 10px 6px` padding
so groups part more clearly.

v3 P:1729. 44px rows, `0 10px`, 6px radius, a 1px margin and **no dividers**, a 24px `TypeIcon` footprint (the 20px
colour-coded glyph). The name is 14px regular ink; a Geist Mono 11px `KIND_TAG` ("PDF", "MD") and, when shared, a 14px
`IconPeople` follow it, because the line glyphs alone do not tell the office kinds apart. With the pane open
(`showMeta={false}`) the row is the icon and the name alone; the kind tag is then read out only. Project is 13px muted
in 170px; Last activity 12px muted, right-aligned in 120px. No avatars. The selected row wears `row-selected`
(`#f2f2f6`, no left bar); the others take the opaque `row-hover` wash on hover and keep it while focus is inside them.
The action strip — Share (32px), Copy link, Pin, "More actions for <title>" (36px) — shows on hover or focus, never on
the selected row (its pane carries the same actions); it fades in by opacity only (`fadeIn`) over a gradient ending in
`row-hover`, so there is no seam. A click selects and opens the pane; a double click or Enter on the name opens it in
full view. Each row carries `data-artifact-id`.

### `LibraryShell` · `useListWidth` — `src/features/library/LibraryShell.tsx`, `hooks/useListWidth.ts`

T:L4516, L4001–4006. With the pane open the list is sized — `flex: 0 1 <w>px`, 300px minimum, 400px until dragged — and
the pane fills the rest. The width never transitions. `useListWidth` keeps two widths: `preferred`, the reader's choice,
remembered under `exagram.listWidth` only when a drag ends or a keyboard nudge lands; and `width`, the shown one,
`preferred` clamped at render to 300 … `innerWidth − sidebar − 360` (`max`, kept in state so it follows a window resize;
the sidebar width comes from `SidebarWidthContext`, so the rail's freed room goes to the pane). A resize squeezes what
is shown without rewriting the choice. The handle, "Resize list", is 8px at `left:-4px` on the pane; its `aria-valuenow`
is the list width and the arrow keys move the edge by 24px. The library keeps the clicked row where it was on screen
when the pane opens (it re-scrolls by the row's shift).

### `PreviewPane` — `src/features/library/PreviewPane.tsx`

v3 README §3. `flex:1` with no maximum and `min-width: 360px`, plus the open side panel — History 300, Comments or the
Ledger 320 (`paneMinWidth`; `paneFrame`, and `useListWidth` reads `?panel=` for the same clamp; the list gives up its
space first, and the sheet keeps the 720px measure), `slideIn` over `--duration-panel` on `--ease-arrive` with no fill
mode (a retained transform would trap the pane's fixed dialogs). The header (v3.2, README §3) is two rows with fixed
roles, the same in both modes:

- **Row 1, navigation** (44px on `sidebar`, a `pane-line` bottom border, `0 8px`): Close ("Close preview"), or Back
  ("Back") in full view; a 1×16 `line` divider; the **folder button** (`Browse <folder>`, `aria-haspopup="menu"`: the
  blue `IconProjectFolder` and the Project's name, or `IconGrid` and the list's name, e.g. "All artifacts"; in full view
  the mono "N of M" follows it; ▾); a spacer; `ZoomMenu` (mono 12px `110%` ▾; the nine steps are a `Menu` of `checked`
  items, so `menuitemradio` with the menu's keyboard model and focus return); History (Owners; an `IconClock` button
  named "History", `aria-pressed` and `subtle` while its panel is open); Pin and Copy link (full view only); "More
  actions for
  <title>". Row 1's icon buttons are `HeaderIconButton`, 30px in `secondary`.
- **Row 2, the file** (white; `12px 14px`, full view `14px 16px 14px 18px`): in full view a 34px `chip` tile holding the
  `TypeIcon`; the title (16px/600, one line, ellipsis) over the 12px muted meta "Doc · v3 · updated…" (no Project: the
  folder button names it; no size: the API has none) and the underlined **Details**, which opens a popover
  (`role="dialog"` "Details": Project, Owner, Shared with, Clients, Revision; Escape closes it and refocuses the
  button). Then **Present** (`outline` 32px, `IconMaximize`; labelled in full view; in the docked pane icon only, named
  "Present", and shown only on a window at least 1800px wide (`usePresentFitsPane`, kept current on resize)), **Use in
  Claude** (`outline` 32px, `features/artifact/UseInClaude.tsx`: a popover with the continuation instruction naming the
  artifact ID and one Copy button; text to paste, not a deep link, so it works in ChatGPT with the Exagram app too),
  **Open** (`outline`, pane mode only) and **Share** (`primary`). Share and Open are separate buttons. The meta line
  adds a 12px `ThinkingMatrix` and "Indexing" while the file is indexing.
- **The ⋯ menu** (`composePreviewMenuItems`, `previewMenu.tsx`). In the docked pane (v5 §6) it leads with Present (only
  while the header has no Present button), Copy link (`copyArtifactLink`'s toast "Link copied — opens only for people
  this file is shared with.") and Pin / Unpin, which takes the place of "Pin for org" so the menu has one pin toggle.
  Full view's menu is unchanged, and so is the ⋯ on library rows.
- **Full view** — the Artifact's own page, `/artifacts/:id` (`ArtifactPage`) — the same two rows at full width, with no
  resize handle. The frame covers the viewport.

**Siblings** (`previewNavFor`, `features/library/previewNav.ts`) are the navigation order: a file in a Project the
reader can list steps through that Project's files, sorted as the list is; any other file through the list it came from,
in the order its rows are drawn ("All artifacts", "Shared with me", "My uploads", or Activity's feed); a file that list
does not hold through All artifacts. The screen passes `siblings`, the `folder` (`FolderRef`) and `onStep`: a list
replaces `?preview=` (`useArtifactSelection.step`), the page replaces `/artifacts/:id` and re-points its `returnTo` at
the list with the new file previewed. A page with no `returnTo` steps through the file's Project, or All artifacts (or
the Shared with me / My uploads list it came from). The pane owns the keyboard: ↑ / ↓ and k / j step whenever a preview,
the page or Present is open (row 1 has no ↑ ↓ buttons; the keys, the folder menu and Present's bar step), except inside
an input, textarea, select or contenteditable and while any `menu`, `dialog` or `listbox` is in the document.

**Folder menu** (`FolderMenu`, `features/library/FolderMenu.tsx`), from the folder button: 330px, `radius-dialog`,
`shadow-menu`. The Files view lists the folder's files in sibling order (the current one `aria-current`), each with its
revision and age, or its Project when browsing a list; a pick previews it (`onStep`). Its head has ‹ "Browse folders",
the folder's name and "Open folder →" / "Go to list →"; its foot "↑ ↓ to move between files". Browse folders lists All
artifacts, then SHARED PROJECTS and PROJECTS with counts, the current folder marked; a folder opens its files, and a
file from any of them previews in place (a list screen's selection falls back to `everything`). Arrows move, Enter
picks, Escape closes (claimed, so the pane stays) and focus returns to the button.

**Present** (`PresentMode`, `features/library/PresentMode.tsx`) portals a fixed full-viewport `region` ("Presenting

<title>") over every app chrome: the pane's document canvas under a 36px white top bar on a `pane-line` bottom line —
the title (13px/500), the folder name (12px `muted-2`), then Previous file · mono "N of M" · Next file, a divider and
**Exit** with an "Esc" hint. It covers the window; it does not ask for the browser's full screen. Escape (claimed on
`document`) or Exit ends it, back in the mode it started from (pane or full view), with focus on Present, or on ⋯ when it started from the
menu. Stepping
works inside it; it has no URL.

**URLs.** A list previews a file beside itself as `?preview=:id` (library scopes, a Project, Activity). `/artifacts/:id`
is the file's own page in full view, and the address a share or a copied link carries. A single click previews when the
window is at least `PREVIEW_MIN_VIEWPORT` (1280px) wide (`useCanPreview`) and opens the page otherwise; Open, a double
click, Enter on a row's name and a search pick always open the page (`useArtifactSelection.open`), which is told the
list it came from. Back and Escape on the page return to that list with the file previewed; a page reached by a link
goes back to the file's Project (previewed when the window has room). The page focuses Back when opened from a list. The
window-level Escape skips an event that is already `defaultPrevented`; `Menu`, `Dialog` and the pane's popovers claim
the Escape they handle that way. A preview's former addresses (`/…/artifacts/:id` under a list, with `?view=full` or
`?expanded=1`) redirect through `legacyPreviewTarget`. There is no Expand button. Copy link calls `copyArtifactLink`
(`useArtifactActions`), the same copy and toast as the row's. The body is the `ground` canvas. Markdown sits on `Sheet`:
20px of canvas around a white sheet with a 6px radius, no border and `--shadow-sheet`, padded `36px 40px 52px` and as
wide as the 720px measure plus that padding. The sheet opens with a mono uppercase eyebrow ("V3 · CURRENT · Project",
`label` colour) and the document's title (700, 1.867em). A Markdown file that starts with its own `# heading` skips the
title. Comments and the Ledger share `SidePanel` (two tabs); History is its own panel to the right.

### `HistoryPanel` · `CompareDialog` · `lineDiff` — `src/features/artifact/reading/`

T:L3123–3150. A 300px panel beside the reading surface with a `GapLine` on its left: "History" (`SectionLabel`), a mono
"N revisions", a close button; Revisions newest first — mono `vN`, who, when, the note, then "Waiting for approval"
(pending) or "Current · clients read this", their ⚠ / ✓ glyphs `aria-hidden`. A selected Revision wears `row-selected`.
Restore (the design's one ink fill; the existing restore endpoint, which writes a new Revision) is offered only for an
approved Revision that is not current; Compare with current for any non-current one, except on HTML and images, whose
bodies the text endpoint never serves. `CompareDialog` reads both texts from
`GET /artifacts/{id}/revisions/{revisionId}/text` (`useRevisionTextAt`; a 400 such as "Text extraction is unavailable"
shows as its own message) and renders a memoised `lineDiff`: a dependency-free LCS over `linesOf` (CRLF or LF, no lines
for an empty text, a trailing newline ends the last line), declining past a million line pairs. Added lines sit on
`green-bg`, removed ones on `html-bg`.

---

## Activity (Phase 4)

### `ActivityScreen` — `src/features/activity/ActivityScreen.tsx`

T:L1879–1993. `/activity` (a preview is `?preview=:id`): the landing screen, in the same `LibraryShell` and content
window as the library. The head is "Activity" (`PageTitle`, sized like the library's by `pageHeaderSize`) with a 14px "N
events · yours" / "· team" and a `SegmentedControl` Mine / Team with counts; the choice is `?scope=team` (Mine by
default). Then `NeedsAction`, then `EventTable` 36px below it (12px when nothing waits). A preview address the reader
cannot open shows not-found in the pane, never over the list.

### `buildFeed` · `feedFor` · `groupByDay` · `pendingAuthor` · `useNow` — `src/features/activity/`

The feed is built in the browser from what the reader already sees: each Artifact's latest publish ("Published vN") and
each pending submission ("vN needs approval"), newest first and uncapped. `feedFor` filters a scope and then keeps its
newest 60, so Mine survives a busy Team feed; the counts are the uncapped totals. Days are local calendar days ("Today ·
Mon 14 Sep", "Yesterday · …", then the date) against `useNow`, a clock that ticks every minute and on window focus. A
publish is the Owner's (the library row carries no Revision author, and publishing is the Owner's act), so for publish
events Mine means "published by me"; a pending event is its author's, and a Connection's write counts as its person's.
The workspace Ledger (`ledger.activity`) is admin-only and is not used; client reads live in Settings → Audit.
`pendingAuthor` names a pending Revision's author: "You"; for a Connection's write the client's name when it is the
reader's own Connection, else "Grace's Claude Code"; otherwise the author's first name — from the pending list's
`authorName` / `authorConnectionName`.

### `NeedsAction` · `needsActionGroups` — `src/features/activity/`

T:L1952–1969. "Needs your action" with a mono count (the grouped total), then one region per top-level Project (a file
in a folder counts under the folder's Project), named "<project> approvals": a 6px marigold square, the Project's name
(a link), "N revisions" and its publish rule, then `AwaitingApprovalBlock` rows naming the folder after the title ("Spec
› Pricing") — 52px, a 20px `TypeIcon`, "⚠ vN waiting · your upload / from <author> · <note>", a mono `v3 → v4` while the
pane is closed (just "v1" for a first upload), `quiet` Reject and `approve` Approve at 30px.

### `AccessRequests` · `RequestAccess` — `src/features/access-requests/`

`RequestAccess` sits on `NotFound` when a file's page passes `artifactId` (desktop and mobile `ArtifactPage` only, never
a Project): "Request access" opens an optional note (500 characters, a mono counter) and Send request; afterwards it
says only "Request sent. If the owner can share this file with you, they'll see your request." It fetches nothing to
decide whether to show. `AccessRequests` is the Owner's "Access requests" section above Needs your action (an amber card
on the phone): "<name> (<email>) asked for access to <title>", the note quoted, the Share dialog's `RoleSelect` (Viewer
by default), Dismiss and Grant at 30px. Its count joins the sidebar's Activity badge and the phone's bell.

### `EventTable` · `MoveCell` · `locationOf` — `src/features/activity/`

T:L1970–1991. A real `<table>`: a sticky head (Time · File · Source · Project › folder · actor, the plan's
`52px 1fr 140px 170px 22px`; Time · File only while the pane is open, v3's `40px 1fr`, P:4190), then one `<tbody>` per
day whose header button folds it and shows the count and, for files the reader owns, "N need a folder" (unique files) in
amber `pending-fg`. Rows at least 52px with no dividers and 6px ends (v3; the fill sits on the cells, since a `<tr>`
clips nothing), hover `row-hover`, selected `row-selected`, cells padded `12px 8px` and set at the top on a 19px line
(v5 §5), so the time and the actor line up with the title's first line: mono time, the title (the row's link) with a
mono 12px tag, a 12px detail line, the 14px source, the place, a 22px actor square. The head and day dates are 14px.
With the pane open (v3 P:1669–1676) a row grows to fit two lines, its cells padded `10px 8px`: the title alone, then the
place as `MoveCell compact` (22px, 12px, a 1px `line` hairline, at most 70% of the row) followed by "tag · detail" in
12px muted. A row click opens the pane. A pending row whose file the reader cannot list (a Collaborator's new file in
someone else's Project) keeps its title as plain text, opens nothing, and reads "Not in your library". `MoveCell` is the
place: for the file's Owner a 26px button opening a `Menu` of every Project they own with its folders indented, then "No
project", the present one checked; it moves with the existing `artifacts.move`, and a failure toasts "Couldn't move

<title>. <reason>". For anyone else it is plain text. A loose file in a Project that has folders reads "Unsorted" as an
amber chip (`unsorted-bg`, `pending-fg`); a file in a Project the reader cannot list reads "Shared with you".
`locationOf` (`location.ts`) derives Project › folder from the flat Project list.

---

## Context (Phase 5)

### `ContextPage` · `RecapItem` — `src/features/context/`

T:L2236–2313. `/context?week=n`; the week is picked in the sidebar (`ContextSidebar`), and each week starts with a fresh
search and every group open. A 1120px column, left-aligned with `20px 28px 96px`, headed like every screen: "Weekly
recap" in Geist 700 22px and a 13px muted "8–14 Sep · N artifacts, grouped by project". Then the summary band, a section
named by its h2: `dark-panel` with `ground` text on a `minmax(0,1fr) 260px` grid. Left (`26px 28px 28px`): the 3×3 mark
(`mark-soft` / `mark-mid` / `mark-core`), the mono 11px `dark-kicker` label, a Geist 18/500 headline, 14px `dark-text-2`
bullets and a Takeaway over a `line-on-dark` rule. Right, behind a `GapLine` inset 14 `tone="light"`: Sources as 30px
rows (links to real files; the tag brightens to `dark-text-2` on hover and focus), "+N more" past six, then — for this
week only — "Next · in 7h 12m" with a 2px `dark-fill` progress bar ("How much of today has passed", its `aria-valuetext`
spelling out the countdown) and a 26px rebuild button; a past week reads "past week". Below it, the files section (a
visually hidden h2 "Files from {range}"): a sticky toolbar (a 34px search on the desk colour, the Project / Day
`SegmentedControl`), groups folding under a caret inside an h3, and `RecapItem`s indented 28px — 16px line icon, 14px
name over 12px meta, mono revision — each a link to `/artifacts/:id`. The overflow dialog reads its rows from the live
group.

### Honesty — `recap.ts`, `useRecapSource.ts`, `fromArtifacts.ts`

The summary is written by a template from the week's own files, and the label says "Template summary", never "AI". It
reads the reader's real week; the design's sample (and its sample Projects) stands in only once the library and its
Projects have both loaded and the library is empty, and then the band says "sample week" and shows no clock and no
rebuild. Every file counts toward where attention went — files in no Project and files in a Project the reader cannot
list are named as such — so the headline never calls a week with files quiet. The copy counts "N files updated, M of
them interactive pages", says "updated" rather than "arrived", uses the week it is about ("this week" / "that week"),
counts only direct shares ("shared directly with someone"), and never says "private". Its sandbox line follows ADR 0015
(an opaque origin with no network). The week is a rolling seven days on the shared `useNow` clock, keyed on the local
day; ages are whole calendar days (`Date.UTC` of the local date), so a DST day still counts once, and progress is
measured against the day's own length. Rebuild moves the clock, re-reads the library and Projects, counts from what it
read, and says so — or says it failed. The page is `ready` once both reads have data; a later failed re-read keeps the
last good summary with a small "Couldn't refresh" line. While either first read is pending the page shows only the
week's dates, and a failed first read shows an alert.
