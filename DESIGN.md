---
name: Trakt
description: Dark, rounded, and out of the way - a near-black ground, rounded cards instead of rules, one rounded face in sentence case, and a single red spent only on the exception.
colors:
  paper: "#000000"
  surface: "#1C1C1E"
  wash: "#2C2C2E"
  ink: "#FFFFFF"
  ink-2: "#AEAEB2"
  ink-3: "#8E8E93"
  rule: "#2C2C2E"
  rule-strong: "#38383A"
  signal: "#FF453A"
typography:
  family: "ui-rounded, SF Pro Rounded, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
  title: { fontSize: "28px", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.02em" }
  heading: { fontSize: "17px", fontWeight: 600, lineHeight: 1.2, letterSpacing: "-0.01em" }
  body: { fontSize: "16px", fontWeight: 400, lineHeight: 1.35, letterSpacing: "-0.01em" }
  label: { fontSize: "14px", fontWeight: 400, lineHeight: 1.35 }
  caption: { fontSize: "13px", fontWeight: 500, lineHeight: 1.2 }
  stat: { fontSize: "22px", fontWeight: 600, lineHeight: 1.05, tabular: true }
  hero: { fontSize: "40px", fontWeight: 700, lineHeight: 1, tabular: true }
radii: { sm: "6px", md: "12px", lg: "20px" }
---

# Trakt

## Overview

Three visual systems have shipped in this repo: a MyFitnessPal dark, a printed
Swiss timetable, and this one. The first two were each chosen deliberately,
documented at length, and abandoned inside a fortnight.

So this one is built **not to have a thesis**. It looks like the platform it
runs on. There is no metaphor to get tired of, and nothing here is a reference
to anything.

The timetable was abandoned for a reason worth recording, because it is the
trap any future redesign here will walk straight back into. Condensed grotesque,
plus ALL-CAPS micro-labels at 10px on 0.1em of tracking, plus heavy ruling
everywhere, is **not** a neutral Swiss style — it is the single most
recognisable house style of the last two years of AI design tools. It was
adopted specifically to escape looking generated, and it is what made the app
look generated.

## What survived the repaint

None of this is about paint, and all of it carries forward unchanged:

- **State is carried by MARK, never by hue.** A filled square against an open
  one; a struck rule under an overrun figure; a ringed dot rather than a
  recoloured one. This is what makes the app readable to a protanope, and it is
  the one thing the timetable got unambiguously right.
- **Dashed outline = planned. Solid fill = happened.** Currently RETIRED, not
  abandoned. The `planned` and `actual` utilities were deleted because nothing
  drew them any more: the 24-hour day timeline was the only surface that ever
  did. The Plan tab lists planned workouts as ordinary rows, which is honest -
  a list of intentions does not need distinguishing from a list of facts when
  there are no facts in it. Re-add the two utilities if a screen ever shows
  scheduled beside actual.
- **44px minimum** on every interactive target, always.
- **Tabular figures** on anything compared against anything else. `body` sets
  `font-variant-numeric: tabular-nums` globally; `.pnum` is the escape hatch for
  running prose.
- **Phone only.** No breakpoints, no desktop layout.
- **One theme.** There is no light mode and no toggle to build one.

## Colors

Nine values, and only one of them is a hue.

| Token         | Value     | What it is                                    |
| ------------- | --------- | --------------------------------------------- |
| `paper`       | `#000000` | The ground.                                   |
| `surface`     | `#1C1C1E` | A card. The one elevation step.               |
| `wash`        | `#2C2C2E` | A control sitting on a card.                  |
| `ink`         | `#FFFFFF` | Primary text and figures. 21:1 / 18.4:1       |
| `ink-2`       | `#AEAEB2` | Secondary text, annotations. 10.6:1 / 9.3:1   |
| `ink-3`       | `#8E8E93` | Tertiary. 6.9:1 / 6.0:1 — AA on both grounds. |
| `rule`        | `#2C2C2E` | Hairline. Never carries text.                 |
| `rule-strong` | `#38383A` | The separator inside a card.                  |
| `signal`      | `#FF453A` | The exception. Nothing else is coloured.      |

The names are inherited from the build this replaced, and they still mean what
they say: **`paper` is the ground, `ink` is what is printed on it.** Inverting
their values inverted the whole app correctly, because every `bg-ink text-paper`
pair in the tree means "a chip printed the other way round" and continues to.

**The ground is true black, not a dark grey.** The app is opened in bed in the
dark every night on an OLED phone, where `#000` is an off pixel: it emits
nothing and lets the card edges do all the work. This is the exact mirror of the
reasoning that made the old paper `#F3F4F5` rather than `#ffffff`.

**Three text tones, named as three real colours** rather than one colour at
three opacities. Opacity variants are what let secondary text drift below AA two
redesigns ago; naming the tone is the fix that lasts.

**One hue.** A single accent spent only where something is wrong or destructive
means it is never decoration and never competes for attention. If an accent hue
is ever wanted for interactive text, it is a one-line token change — but the
thing it would replace is weight, which currently does that job for free.

## Typography

**One face**: `ui-rounded`, which resolves to SF Pro Rounded on iOS — where this
app actually lives, as an installed PWA on a phone. Zero bytes, no licence,
already resident, cannot fail to load on a cold start in a gym basement.

Two consequences, both load-bearing:

1. SF cannot legally be self-hosted as a webfont, so there is no fallback that
   looks like it. On anything that is not Apple hardware this renders in the
   platform's own UI face. That is fine and is not a bug.
2. **`npm run screenshots` drives Playwright on Windows, where SF does not
   exist.** Every screenshot it produces is set in Segoe UI, and thin light text
   on black picks up subpixel colour fringing that can read as faintly blue. It
   remains the best instrument in this repo for layout, state and regressions.
   It is not evidence about type or about text colour. Judge those on a phone.

**Sentence case everywhere. There is no uppercase type role**, and adding one is
the easiest way to make this app look generated again.

**No `font-stretch` anywhere.** SF exposes no addressable width axis, so a
stretch declaration does not narrow anything — it just sits in the file looking
like it works. Five of the seven roles in the previous system used one.

## Layout

Page gutter is **16px**, which is also a card's internal padding, so a card's
first word sits 32px from the trim and its label sits directly over it.

Rows are **48px minimum** with 12px/16px padding. The 44px floor for interactive
targets is separate and lower, and it is a floor rather than a size.

## Elevation & depth

Three steps, and no shadows anywhere.

`paper` → `surface` → `wash`. A card is a lighter rectangle on the ground; a
control is a lighter rectangle on the card. A sheet is a `surface`, because it
is elevated above the page by definition.

**Anything that translates or overlays must declare its own ground.** This is
the rule most expensive to forget, and it has now bitten twice. `SessionView`'s
swipe row renders "Edit" and "Delete" as underlays and slides the row over them:
a transparent row let both print through it at rest, which put the word "Edit"
directly on top of the set number, since they share the same left gutter.

## Shapes

`20px` on a card, `12px` on a control inside one, `6px` on small state marks —
`20px` on a 10px square would be a circle.

The radius **is** the containment. It is the card edge, not a rule, that says
where one group of rows stops and the next begins.

## Rules

Almost all gone: 76 `group-row-sep` hairlines and 14 `group-header` rules became
space and card edges.

One hairline survives and does one job — divide two rows inside a single card,
**inset 16px from the left** so it reads as dividing that list rather than
cutting the card in half. It is drawn as a background-image so the inset costs
no extra element.

`hairline-*`, `rule-*` and `rule-heavy-*` all still exist as aliases so nothing
renders unstyled, and they all resolve to the same quiet separator. **A new rule
in this app is almost always a mistake.** Use a card, or use space.

## Components

- **Card** (`group-list`): `surface`, 20px, `overflow: hidden` so a pressed
  row's own background cannot square off the corners.
- **Row** (`group-row`): 48px minimum, space-between, 12px/16px.
- **Card label** (`group-header`): sentence case, `ink-2`, 16px inset, 8px below.
  No rule.
- **Bottom bar**: three equal grid columns — Today, Plan, and the action
  button between them — the button last by source order. Never two flex
  halves around it: that centres the button but makes the tabs unequal,
  because each sits in the middle of half of whatever the button left over.
  History and Charts are not tabs; they are icons in Today's corner, with
  Settings. The corner is where you go elsewhere, on every screen.
- **Active tab**: colour only, never weight. A bolder label is a wider one,
  and a tab that changes width when you select it moves its neighbours.
- **Chip row**: plain `ink-2` text; the selected chip is `bg-ink text-paper` at
  12px radius. Used for the metric and range pickers and the Daily/7-day toggle,
  which all look the same on purpose.
- **Segmented control**: chips in a `wash` track at 12px, inner chips at 6px.
- **Marks**: `mark-done` (filled square), `mark-open` (the same square, ringed,
  same footprint so a list does not reflow), `mark-over` (struck rule in the
  signal), `mark-error` (filled flag in the signal).
- **Ribbon segment** (Plan → Nutrition): a phase drawn at 4.5px/day between a
  52px floor and a 168px ceiling, on a ribbon that scrolls rather than fits. The
  selected one is `bg-ink text-paper`; an untracked one is a dashed `ink-3`
  outline over `paper`; the last one has no end, so it carries a dashed right
  edge and the word "onward". **A segment drawn shorter than it really is prints
  a dashed break inside its right edge and states its real length** — the width
  is a claim about a duration, and where the claim cannot be kept the drawing
  has to say so.
- **Last session** (Workout): a `surface` card under the current lift. Set
  number in `ink-3` in a fixed 16px column so the weights line up, figure in
  `ink`, RPE quiet after it; date right-aligned in the header, "Today" and
  "Yesterday" spelled out. Caps at six rows and says how many it kept back.
  Renders **nothing** on a lift you have never done — an empty state here would
  take the same space as the thing it is apologising for.
- **Card actions** (Plan → Workout split): a tap opens a row of `wash` pills
  under the card — Edit card / Do this today / Delete — attached to it with no
  separator, because they belong to it. Never a long press: this list has twice
  hidden a control behind a gesture and been wrong both times.
- **Boundary handle**: a 3px `ink` bar in a 24px target, on every change-point
  after the first. Dragging it moves that date; the ribbon's layout is frozen
  for the duration of the drag and the landing date rides above the handle.
- **Against target** (Plan): a scrolling chart, one column per day, back to the
  first day ever logged. Calories rise from a centre line in `ink-3`, steps
  fall from it in `ink`, **each on its own absolute axis** — not as a fraction
  of target, so a day with no target in force still draws. Both maxima come from
  the data (`niceCeil`, plus one step of headroom so a goal line is never on
  the chart's edge) and are labelled in a fixed gutter, unit under number. **The
  target is a per-day tick, so it reads as a staircase** and steps visibly where
  a phase changes. Tapping a column opens that day's card — date, cals, steps,
  macros — beside the bar, flipping side near the end. Nothing is converted
  between the halves: the app has no TDEE and must not imply one.
- **Editable figure** (Today, History → day panel): the card _is_ the editor.
  The figure is an input in `t-stat`, transparent, right-aligned, sized to its
  own content; the target beside it and the status mark after it are unchanged.
  The raw string lives in the parent and only for the focused field, so an
  outside write lands immediately everywhere else.
- **Chart area fill**: a flat 16% `ink` wash. Not a gradient — that is a grey
  ramp and the stock charting-library look. Not a hatch either: hatching exists
  because a one-colour press cannot print a tint, and white rules over black
  read as scratches across the plot.

## Copy

**A label that explains itself gets no second line.** "Export backup / Download
all data as JSON". "Clear all data / Wipe all workouts and start fresh".
"Untracked / A day you chose not to log, rather than one you missed." In every
pair the second line only restates the first, and a screen of those reads as
machine-written even when each sentence is individually defensible. Five of them
were deleted from Settings in one pass.

Helper text earns its place only by carrying a fact you could **not** guess:
that disconnecting the sheet deletes nothing, that a sheet already belongs to
another install, that a reset keeps the exercise library, that an import
replaces rather than merges. Those stay.

**No trailing period on a fragment.** Labels, chips, status lines and empty
states are not sentences: "Not synced yet", "Backup imported", "Offline, will
sync when you reconnect". A full sentence warning about a consequence keeps its
punctuation, because it is one.

**Sentence case.** "View workout", not "View Workout". And no em dashes.

## Do's and don'ts

**Do**

- Reach for a card or for space before reaching for a line.
- Give every overlay, sheet, banner and translating row an explicit background.
- Keep figures tabular.
- Hide scrollbars. Every scroller here is dragged with a thumb; `styles.css`
  does it once for all of them.
- Spend `signal` only on something wrong or destructive. Not on "today" — a
  date is not a warning.

**Don't**

- Add an uppercase type role. Not one.
- Add letter-spacing to small text.
- Add a second hue, a gradient, a glow, or a shadow.
- Add a feature toggle. The Settings Features and Tabs sections were deleted for
  a reason: a product that hedges about its own feature list reads as one nobody
  made a decision about.
- Re-propose the light theme, or a theme toggle.
- Write a second line under a label that already says it.
- Put a period on a fragment.

## Motion

Motion is for something that genuinely enters or leaves, and nothing else.

- **Sheets** slide up from the bottom: the gesture says where the sheet came
  from and where a swipe-down will send it.
- **The toast** slides and fades, because it appears unbidden and its whole
  job is to be noticed.
- **Route changes** are a 280ms opacity fade. There is no horizontal slide:
  a 24px travel on every tab tap was the most template-like motion in the
  app, and — the practical half — an `animation-fill-mode: both` keyframe
  that ends on a transform leaves that transform on the element forever,
  which makes it the containing block for every `position: fixed` descendant.
  That is not a theory: it put the Accept button of a coach's plan off the
  bottom of the client's screen. **Any full-screen or fixed overlay is
  rendered through `createPortal` to `document.body`**, so no ancestor can
  do it again.
- **Nothing animates on arrival.** Sections used to fade up as a page
  mounted; after the second visit that is not delight, it is latency.

## Known open

- **No accent hue.** Interactive text is marked by weight against `ink-2`. This
  is a deliberate near-monochrome, not an oversight, but it has never been seen
  on a real phone in a real gym.
