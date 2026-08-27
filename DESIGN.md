---
name: Workout Tracker
description: A training day printed as a Swiss railway timetable - paper ground, one ink, rules instead of elevation.
colors:
  paper: "#F3F2EE"
  ink: "#141310"
  ink-2: "#5A574E"
  ink-3: "#6E6B60"
  rule: "#D8D6CE"
  rule-strong: "#B9B6AB"
  wash: "#E9E7E0"
  signal: "#C8102E"
typography:
  title:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "30px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontVariation: "width 80%"
  heading:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.005em"
    fontVariation: "width 85%"
  body:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "-0.004em"
  label:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
  caption:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.1em"
    fontVariation: "width 75%"
  stat:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.02em"
    fontFeature: "tabular-nums"
  hero:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.03em"
    fontVariation: "width 78%"
    fontFeature: "tabular-nums"
  action:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.35
  hour:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.02em"
    fontVariation: "width 72%"
    fontFeature: "tabular-nums"
rounded:
  sm: "0px"
  md: "0px"
  lg: "0px"
spacing:
  gutter: "20px"
  row-y: "11px"
  row-gap: "12px"
  section-gap: "26px"
  touch-min: "44px"
components:
  table:
    backgroundColor: "transparent"
    rounded: "{rounded.sm}"
  table-row:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "11px 20px"
    height: "44px"
  table-header:
    textColor: "{colors.ink-2}"
    typography: "{typography.caption}"
    padding: "0 0 5px 0"
  inked-cell:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
  nav-tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-3}"
    typography: "{typography.label}"
    height: "44px"
  nav-tab-active:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    height: "44px"
  nav-action:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    padding: "4px 12px"
    height: "44px"
  button-solid:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    padding: "0 16px"
    height: "44px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "0 16px"
    height: "44px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.action}"
  toggle-on:
    backgroundColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    width: "48px"
    height: "28px"
  toggle-off:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    width: "48px"
    height: "28px"
  sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "20px"
---

# Design System: Workout Tracker

## Overview

**Creative North Star: "The Printed Timetable"**

The app is a schedule, so it is printed like one. The whole visual world is a Swiss railway timetable page: a paper ground, one black ink, hairline rules, tabular figures, columns that hold their position, and tables that run to the trim instead of floating inside rounded cards. Seed key `95982b50`; the direction contract ships as an HTML comment at the top of `<body>` in the built markup.

Two rules from the dark system this replaced are deliberately inverted, and they are why the build looks the way it does. **Elevation was fill; rank now comes from rule weight and position** - on paper there is no fill step to lift with, so a hairline separates, a stronger rule divides, and a 2px ink rule announces. Nothing is raised. **"No borders" is gone**, because it was always the wrong rule here: a dashed outline already carried a fact (planned) rather than a decoration. Every rule on this page carries a fact.

The one idea that survived untouched is *dashed outline = planned, solid fill = happened*. It is native to a timetable - the scheduled column against the actual one - so it is stronger here than it was, not merely preserved. The palette is two-ink by construction: black on paper, plus a single signal red spent only on the exception, the way a two-colour press spends its second plate. The app is phone-only by product decision, so there is no desktop layout and no breakpoints; the paper is `#F3F2EE` rather than white because the app is opened in a dark bedroom every night and pure white is a flashlight.

**Key Characteristics:**
- Paper ground, one ink, one signal; no gray ramp, no opacity variants
- Rank from rule weight (1px hairline / 1px strong / 2px ink), never from fill or shadow
- Zero radius everywhere; butt caps and mitred joins in every icon
- Tabular figures by default across the whole document
- State carried by mark (filled square, struck rule), never by hue
- Metric identity carried by hatch angle, consistent across screens
- Tables bleed to the trim; the gutter lives on the cell
- One authored motion: the flap

## Colors

Two inks on paper, and the second one is rationed: a two-colour press gets exactly one extra plate, and a timetable spends it on the exception.

### Primary
- **Ink** (`#141310`): The one black. Body text, every figure, the heavy rules that open a table and mark the now line, the fill of the inked cell, the fill of every identity hatch. Measured 16.58:1 on paper.

### Secondary
- **Signal Red** (`#C8102E`): The second ink, and the only chromatic value in the system. It carries the exception in two senses - *over a ceiling* and *this broke* - kept apart by mark rather than by hue: an overrun figure takes a struck rule beneath it, an error takes a filled flag. Also the text caret. 5.25:1 on paper, 4.75:1 on wash.

### Neutral
- **Paper** (`#F3F2EE`): The ground, and the only background. Warm by roughly 5 points across the channels, which is paper; cream is roughly 30 and is somewhere else. Deliberately not `#ffffff` because of the bedroom.
- **Ink 2** (`#5A574E`): Secondary text - annotations, units, column headers, the footnote voice. 6.45:1.
- **Ink 3** (`#6E6B60`): Tertiary - hour column, placeholders, inactive nav labels, the open mark's stroke, an actual band's outline. 4.76:1, still AA, still not a gray ramp.
- **Rule** (`#D8D6CE`): The hairline. Between rows of the same table, and the default border colour for every element in the build.
- **Rule Strong** (`#B9B6AB`): A real division. Between sections, under column headers, at column edges, and the dash of a planned outline.
- **Wash** (`#E9E7E0`): The one filled tone. What "solid fill = happened" fills with - an actual band on the timeline, a pressed row.

### Named Rules

**The Three Real Inks Rule.** There are exactly three text tones and each is a measured colour, not one colour at three opacities. Never write an opacity variant on text, and never introduce a fourth gray. Opacity variants are what let secondary text drift below AA in the system this replaced.

**The Rules-Below-AA Rule.** `rule` and `rule-strong` sit below AA on purpose, because they never carry text. Their job is to divide, and a hairline that meets text contrast is a black bar. Never put text or a glyph in these two values.

**The Second Ink Rule.** Signal red appears only on the exception: an overrun measure, an error flag, the caret. It is never a brand colour, never a highlight, never applied to a heading, and it never means "primary action" - the primary action is inked black.

**The Mark, Not Hue Rule.** State is carried by shape. Filled square = done / met / logged; the same square open = not yet, at the same footprint so a list does not reflow as it completes. Struck rule in the second ink = over a ceiling. Filled flag in the second ink = something broke. The legacy `success`, `warning` and seven metric colour names resolve to plain ink (or signal) so nothing renders unstyled, but new work states status with a mark.

## Typography

**Display / Body / Label Font:** Archivo Variable (self-hosted, one 88KB woff2, weight 100-900 and width 62-125%), falling back to `ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto`. There is exactly one family. It is self-hosted because this is an offline-first PWA and a webfont request is a network dependency in an app whose pitch is that it has none.

**Character:** A grotesk with a width axis, which is the lever a timetable actually wants: a column narrows without the typeface changing underneath it. Headers are set narrow and tracked; figures are set at normal width so the digits stay open at a glance. The result reads as printed matter rather than as an interface.

### Hierarchy
The seven original role names are kept because 42 files use them and the names were never the problem; every value was redrawn for the new face. Two roles are new.

- **Title** (800, 30px, width 80%, uppercase, line-height 1): The page's own name, set in the top margin the way a timetable names its page. One per screen. Not a title card.
- **Heading** (700, 17px, width 85%, uppercase): A table's name. Sits on the heavy rule that opens the table.
- **Body** (400, 15px): Row labels, values, buttons. The workhorse.
- **Label** (400, 13px): Annotations, units, hints, nav labels - the footnote voice. Pair with ink-2.
- **Caption** (700, 10px, width 75%, tracking 0.1em, uppercase): A *column header*. It labels the column of data beneath it, so deleting it deletes a fact, and it always sits on a rule.
- **Stat** (600, 22px, tabular): A figure compared against another figure.
- **Hero** (800, 44px, width 78%, tabular): The one figure a screen exists to show, set at the scale a timetable sets a departure time.
- **Action** (600, underlined 1.5px at 3px offset): A text control. Accent-as-a-colour does not exist here, so print's own answer applies: a rule under the word.
- **Hour** (600, 11px, width 72%, tabular, ink-3): The hour column down the left edge of a schedule. Never competes with the rows it indexes.

### Named Rules

**The Tabular-By-Default Rule.** `font-variant-numeric: tabular-nums` is set on `body`, not opted into. This is a document made almost entirely of numbers in columns, and proportional digits do not line up. `.pnum` is the escape hatch, for running prose only.

**The Column-Header Rule.** Caption type is only legal directly above the column it names, sitting on a rule. If a small tracked uppercase line is floating above a heading with no column of data under it, it is an eyebrow, and the correct fix is to delete it, not to restyle it.

**The No-Literal-Sizes Rule.** Carried forward from the incumbent system and still true: a raw pixel font-size in a component is a bug. Every piece of type takes one of the nine roles above.

**The Underline-Is-The-Control Rule.** A text control is marked by a rule under the word (action role). Colouring a word black does not make it look pressable, and there is no accent hue to spend.

## Layout

A single phone column, `max-w-md`, centred, locked to `100dvh`. Phone-only is a product decision: there are no breakpoints and no desktop layout anywhere in the build. The page itself never scrolls - `html`/`body` are `overflow: hidden` and scrolling happens only inside the shell's content area - which is what keeps the bottom nav and every sheet pinned to the visible viewport in the installed PWA.

The page gutter is 20px. Vertical rhythm between tables is 26px. Rows are 11px/20px with a 44px minimum height, which is also the floor for every interactive target in the build. The day timeline is a 24-hour canvas at 56px per hour with a narrow tabular hour column at the left; the full 24h span is an explicit product override of an adaptive window, not an inferred default.

### Named Rules

**The Bleed-To-Trim Rule.** A table's ruling reaches the page edge and the gutter is put back on the cell's own padding. The table utility does this with `margin-inline: -20px`, which *assumes it sits inside the page's 20px gutter*. Anything rendered at the top level with no gutter must not use it, or it hangs 40px off both trims - the mistake cost two components in this build. Either wrap it (a `mx-5` table inside a `px-5` section is the settings pattern) or rule the element directly, as the week strip does.

**The Header-Does-Not-Bleed Rule.** The table header deliberately carries no negative margin. The rule below it bleeds because a printed table's ruling does; its name does not, because a label hanging off the page edge is a clipped word. The first build of the stylesheet gave the header the same -20px and every section title on every screen lost its first character.

**The One-Subject Rule.** Carried forward from the incumbent system, restated in this world's terms: every screen has one subject and it should be obvious within a second which one it is. Rank is now declared by the heavy rule and by hero-scale type, not by an elevated surface.

## Elevation & Depth

There is no elevation. No shadow token exists in this system, no surface is raised, and no fill step is used to lift anything. Depth is entirely line weight and position - three weights, each meaning something different, so a screen can be read by its rules alone.

### Rule Vocabulary
- **Hairline** (`1px solid rule`, top or bottom): Between rows of the same table. The lightest mark that still divides. Also available as an inset box-shadow separator, so it can be inset from the left - a rule running the full width reads as the end of the table rather than a division inside it.
- **Rule** (`1px solid rule-strong`): A real division - between sections, under column headers, at column edges. Also the top edge of the bottom nav.
- **Heavy rule** (`2px solid ink`): Reserved for the two marks allowed to shout: the top of a table, and the now line. Also the top edge of every sheet and popup, and the top border of the active nav tab's cell.

### Named Rules

**The Rank-From-Weight Rule.** Rank comes from rule weight and position, never from fill, shadow, or a lighter background. A thing is more important because a heavier rule opens it, not because it is raised.

**The Opaque-Overlay Rule.** Deleting a fill is right for a panel on the page and fatal for anything over it. `bg-surface` resolves to the paper itself, so removing it from an in-page panel is correct - but seventeen overlays went transparent during this work for exactly that reason. Every sheet, popup, banner or floating notification carries an explicit paper fill plus its own heavy top rule.

## Shapes

Everything is rectangular. The `sm`, `md` and `lg` radius tokens are all `0px`; a timetable is set on a rectangular grid and nothing on it is rounded. Icons are stroked at 1.6px with `butt` caps and `miter` joins for the same reason - a rounded cap would be the one soft thing on the page - and none of them uses an arc.

The recurring silhouettes are: the **ruled table** (2px ink top, 1px strong bottom, hairline-separated rows, run to the trim); the **inked cell** (a solid ink rectangle with paper knocked out of it); the **open or filled 10px square** that carries state; the **outlined measure** (a 1px ink track, hatched fill, quarter ticks hung below the rule so the fill never hides them); and the **planned/actual band** (1px dashed rule-strong on transparent, versus 1px solid ink-3 on wash).

## Components

### Tables (the card replacement)
- **Character:** A ruled table, not a container. There are no cards in this system.
- **Corner style:** Square (0px).
- **Background:** Transparent. The page's paper shows through.
- **Border:** 2px ink above, 1px `rule-strong` below; rows separated by a left-inset hairline.
- **Internal padding:** 11px vertical, 20px horizontal, 12px between a row's own parts, 44px minimum row height.
- **Header:** Caption type in ink-2, baseline-aligned, 5px above the table's opening rule, on the page gutter. Usually a title on the left and an action-underlined control on the right.
- **Don't nest.** If content inside a table needs its own table, the grouping is wrong.

### Buttons
- **Shape:** Square (0px), 44px minimum height, `scale(0.97)` on press, applied globally to every button.
- **Solid:** Ink fill, paper text, semibold body - the primary commit. On the gym screen this is a full-width 72px inked bar rather than a disc.
- **Quiet:** 1px `rule-strong` outline, ink text, transparent fill.
- **Text:** Action role - underlined ink, no chrome. The default for in-table controls.
- **Focus:** `2px solid ink` outline at 2px offset, themed globally, replacing the browser's blue.

### Inputs / Fields
- **Style:** Inherit the family and ink; the caret is signal red. Square, ruled, no fill of their own.
- **Placeholder:** ink-3 at full opacity (Firefox's default dimming drops it below AA).
- **Selection:** Ink ground, paper text. The browser's blue selection, gray scrollbar and blue focus ring are all a third colour arriving uninvited and are themed out once, globally.

### Toggle
- **Style:** A printed switch. 48x28, always outlined 1.5px in ink so the control is visibly present in both states, with a 19px square knob. On = ink fill, knob right, paper knob. Off = paper fill, knob left, ink knob. Same filled-versus-open logic as a ticked habit or a met target.
- **Tap target:** 44px via an absolutely-positioned overlay, so the 28px track stays compact without inflating row height.

### Navigation
- **Style:** Bottom bar, paper, 1px `rule-strong` on top, safe-area padded. Routed tabs are a 22px outlined icon over a 13px label; two equal flex halves sit either side of a fixed-width centre, so the action button holds the axis whatever the tab count.
- **Active tab:** A 2px ink rule across the top of its cell, the way a printed index marks the section you have your thumb in. Inactive tabs carry a transparent 2px top border so nothing shifts, and their label sits in ink-3.
- **Workout action:** The inked cell - ink fill, paper glyph and label, a filled (not stroked) icon. It is an action, not a destination, and it states its rank with fill and weight because colour is spoken for.

### Signature: the inked cell
One vocabulary for "this one", used in three places and nowhere else: the selected day in the week strip, the current lift row on the gym screen, and the nav's Workout action. Ink ground, paper knocked out. A second filled thing on the same screen would be a second selection - which is why today, when unselected, takes a 2px underscore beneath its figure instead of a fill.

### Signature: hatch
Metric identity without hue. Angle carries identity, density carries emphasis. Protein 90 degrees (1px/3px), carbs 45 (1px/4px), fat 0 (1px/5px), any non-macro metric a solid ink field. A *measured* quantity uses 135 (`hatch-dense`) and its overrun portion the same 135 in signal (`hatch-over`); 135 is reserved precisely because it is the one diagonal no metric answers to. The Charts area fill rotates to the selected metric's own angle, so the Carbs chart is ruled at the same angle as the Carbs swatch on the day view.

### Signature: the flap
The one authored motion. A committed figure rolls into place over 0.26s on `cubic-bezier(0.16, 1, 0.3, 1)`, translating and scaling in from above the way a split-flap board commits a departure. It fires on *change only, never on mount*; the wrapper is always present and always inline-block, so enabling it cannot shift layout. Every other animation in the build is navigation or entrance (sheet slide 0.3s, popup settle 0.2s, route slide 0.28s, one-shot toast 1.6s) and is not part of this vocabulary. Reduced motion is clamped globally, with animation delays zeroed so staggered entrances do not become invisible content, and the self-fading toast exempted so its confirmation is still readable. Never add per-component reduced-motion handling.

## Do's and Don'ts

### Do:
- **Do** use the world's own token names in new work: paper, ink, ink-2, ink-3, rule, rule-strong, wash, signal.
- **Do** rank things with rule weight: hairline between rows, `rule` between sections, 2px ink to open a table or mark the now line.
- **Do** carry state with a mark - filled square for met or done, open square for not yet, struck signal rule for an overrun, filled signal flag for an error.
- **Do** give a new metric its own hatch angle, and keep 135 degrees reserved for measured quantity so a measure can never be misread as carbs.
- **Do** put an explicit paper fill and a 2px ink top rule on every sheet, popup and floating notification.
- **Do** put the gutter on the cell and let the table's ruling run to the trim - and check that the table sits inside a 20px-gutter parent before using the bleeding utility.
- **Do** keep every interactive target at 44px minimum, expanding the hit area with an inset overlay rather than growing the row.
- **Do** draw new icons in the app's own icon file at 1.6px stroke, butt cap, mitre join, no arcs, and give every icon-only button an aria-label.

### Don't:
- **Don't** introduce a radius, a shadow, or a raised surface. There is no elevation in this system.
- **Don't** add a gray between the three named inks, and don't make a tone with opacity. Name the tone or use an existing one.
- **Don't** put text or a glyph in `rule` or `rule-strong`; they are below AA by design and only divide.
- **Don't** spend signal red on anything but the exception - no branded headings, no highlights, no primary buttons.
- **Don't** reintroduce hue as a carrier of state or of metric identity. The legacy `success`, `warning` and seven metric colour names are aliases kept only so nothing renders unstyled, not a second palette.
- **Don't** apply the bleeding table utility to an element rendered at the top level with no gutter; it will hang 40px off both trims.
- **Don't** give the table header a negative margin; its first character will be clipped off the page edge.
- **Don't** use caption type as a floating eyebrow above a heading. If there is no column of data beneath it, delete the line.
- **Don't** add a second authored motion. The flap is the only motion that carries meaning; everything else is navigation.
- **Don't** use a Unicode character (arrows, ticks) as an icon, and don't import a second icon family.

## Known open

- **The timeline renders one column.** The direction contract's thesis describes a scheduled column set against an actual column, with the gap between them reading as a delay. That two-column device is *not built*: the day timeline draws a single canvas in which planned and actual are distinguished by outline versus fill. Left deliberately unresolved pending real phone use. Do not treat the two-column layout as an existing rule, and do not treat the single column as a settled one.
- **The 24-hour canvas span** is an explicit override of an adaptive window.
