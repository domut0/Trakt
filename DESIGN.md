# Design system

The visual language of this app. Read this before touching any screen.

The identity is **fixed and not up for revisiting**: MyFitnessPal-style dark theme,
Inter, one blue accent. No fonts other than Inter. No noise, grain, texture, mesh
gradients, glows, or purple-blue "AI" gradients. No second accent colour. The app must
not read as default AI-generated UI.

What follows is about **restraint and consistency**, not restyling.

## Type: seven roles, no literals

The app had grown to 16 distinct `text-[NNpx]` sizes doing overlapping jobs. That, more
than any single layout, is what made it feel cluttered. Use these classes only.

| Class       | Size / weight    | Use for                                        |
| ----------- | ---------------- | ---------------------------------------------- |
| `t-title`   | 30 / 600         | Screen title. One per screen.                  |
| `t-heading` | 20 / 600         | Card or subsection title.                      |
| `t-body`    | 15 / 400         | Row labels, values, buttons.                   |
| `t-label`   | 13 / 400         | Subtitles, hints, prose. Add muted colour.     |
| `t-caption` | 11 / 600 CAPS    | Group headers, eyebrows. Tracking is built in. |
| `t-stat`    | 22 / 600 tabular | A number compared against another number.      |
| `t-hero`    | 32 / 700 tabular | The single hero number on a screen.            |

**A `text-[NNpx]` literal in a component is now a bug.** Two exceptions already in the
tree, both genuine one-offs: the workout stopwatch and the 88px log button's own sizing.

`t-stat` and `t-hero` are tabular by construction, so a stat can no longer ship with
jittering digits because someone forgot `tnum`. Numbers that are NOT compared (a
timestamp, a one-off count in prose) can stay `t-body`/`t-label`.

## Layout: grouped lists, not floating cards

Use `group-list` + `group-row` (+ `group-row-sep` on every row after the first) with a
`group-header` above. This is the iOS inset-grouped table pattern.

Related rows share **one** container with hairline separators. Six separate rounded boxes
on a screen read as six unrelated things; one grouped list reads as one thing with six
parts. `CalendarView` had six containers on a single screen.

- **No border on containers.** On a dark theme, fill does the lifting: `--surface`
  `#1a2029` against `--background` `#0e1217` is already a clear step. Adding a stroke on
  top is what makes an interface look busy. Remove `border border-border/40` where you
  find it.
- **No card inside a card.** If content needs its own container inside a group, the group
  is wrong.
- Separators are inset from the left, matching iOS. A full-width rule reads as a divider
  _between_ groups.

## Hierarchy: one subject per screen

The rules above remove inconsistency. Applied alone they also remove **rank**, and a
screen where everything is level reads as bland rather than calm. That was the state
this document is now correcting: `t-hero` was used exactly once in the whole app,
`t-body` and `t-label` were 66% of all type and sit 2px apart, and every screen
resolved to a stack of identical grey boxes. The tell was that `/workout` was the
best-composed screen in the app and the only one that ignored the card system.

**Every screen has one subject, and it should be obvious within a second which one it
is.** On the day view that is the timeline; on a finished workout it is the record, if
there is one.

- **One elevated surface per screen. At most one.** Two elevated things are two
  subjects, which is none.
- **Rank may come from size instead of fill.** Where two cards are co-equal subjects,
  neither takes `--muted`: they both sit at `--surface` and the taller one leads. This
  is not a loophole in the rule above, it is the rule above declining to fire, and it
  buys something concrete. The day view's timeline draws bands INSIDE itself, and
  `--muted` is the only fill step they have. A canvas that took `--muted` would leave
  its own contents nowhere to go, and the fix for that is always someone inventing a
  fourth step with an opacity variant, which has been shipped and reverted here once
  already.
- **Elevation is fill, never stroke.** The rule above still holds: no borders, no
  shadows. There is a third step already in the palette, and it is enough:
  `--background` `#0e1217` → `--surface` `#1a2029` → `--muted` `#232b36`. Surface to
  muted is the same order of step as background to surface (+9/11/13 per channel
  against +12/14/18), so a card can lift without a line around it.
- **Size is the other lever, and it is free.** A number the screen exists to show
  should be at `t-hero`. If it does not fit its container, grow the container.
- A track, groove or well goes the **other** way, towards `--background`. A progress
  bar's track was once lighter than the card holding it, which reads as raised.
- **A stroke may encode state, never elevation.** The no-border rule is about depth,
  and it stands. It says nothing about meaning. On the day view's timeline a dashed
  outline means planned and a solid fill means it happened, which is a semantic
  distinction carried by a channel that is not hue, exactly as the colour section
  below asks for. This is written down so that nobody reads "no borders" in isolation
  and deletes the dashed bands as decoration, which is precisely what that rule, taken
  alone, would tell them to do. The test: remove the stroke and ask whether the screen
  loses a fact or just a line. If it loses a fact, it stays.

One consequence to know before using `--muted` as a card: this document's contrast
figures are quoted against `--surface`, and on the lighter fill they drop by about
12%. Recomputed there: muted-foreground 5.72:1, success 8.19:1, warning 8.55:1,
foreground 13.07:1, all still AA. The tightest is `--fat` `#a97fd0` at **4.51:1**,
which clears normal-text AA by a hair and large text comfortably. If that margin ever
feels thin, the thing to change is the fill, not the colour.

## Spacing

- Page gutter: `px-5` (20px). Every screen, no exceptions.
- Between sections: `section-gap` (28px).
- Inside a row: `gap-3` (12px).
- Steps available: 4 / 8 / 12 / 16 / 20 / 28. Nothing else.

## Colour

**Red is for things that break, not for numbers that are large.**

The palette could previously express neutral and failure and nothing else, so hitting a
protein goal looked exactly like blowing a calorie ceiling. Colour now does three separate
jobs, and a token does exactly one of them.

- Accent (`--color-accent`) marks things that are **actionable or currently selected**.
  Never decorative. If everything is accented, nothing is.
- State (`--color-success`, `--color-warning`) is the state of a **value against a goal**,
  and nothing else. Success `#4ade80` is a goal met; warning `#fbbf24` is over a ceiling.
  As text both pass AA: success 10.78:1 on background and 9.40:1 on surface, warning
  11.26:1 and 9.81:1. Success is deliberately not `--nutrition` `#4fa97a`, which is the
  daily-log dot's identity colour and keeps meaning only "nutrition entry".
- Destructive (`--color-destructive`) is for **destruction and errors only**: delete,
  clear data, a failed write, a sync collision. **Never a data value.** A cheat day is not
  an error. Being over your step goal is not an error. Those are `--warning` and
  `--success`. Red on a number the user simply logged is the app telling them off for
  using it.
- Muted (`--color-muted-foreground`) for secondary text. It measures 6.56:1 on surface
  and 7.53:1 on background, so it passes AA. **Do not use opacity variants** like
  `/60` or `/50`: those compute to 3.74:1 and fail.
- The metric colours (`--color-carbs`, `--fat`, `--protein`, `--steps`, `--bodyweight`,
  `--cardio`, `--nutrition`) are data encodings. Use them only to identify that metric,
  never as decoration.

**State must never be carried by hue alone.** Whatever the colour says, a fill, a label or
an icon has to say as well, so "met" is still readable by someone who cannot tell the two
hues apart. This is measured, not boilerplate: simulated for protanopia, `--success` and
`--warning` fall from 37.9 apart to roughly 10 (CIEDE2000; the exact figure moves with the
simulation model), close enough to read as the same olive. A bare green number and a bare amber number are the same number to those users. A
filled ring, a "goal met" label or a check beside the value all solve it.

The identity declared at the top of this file (lines 5-8) is **unchanged**, and this
amendment is bounded on purpose. Green and amber are **not a second brand accent**: blue
is still the only colour that means "press this", and nothing here adds a font, a
gradient, a glow or a texture. State colours only ever report on a value. If one of them
ever becomes navigation, a button or a mood, this rule has been broken.

## Touch and motion

- 44px minimum hit area on everything interactive. Keep the icon small and expand the hit
  area with padding or an `after:-inset-*` overlay rather than growing the row.
- `prefers-reduced-motion` is handled globally in `styles.css`. Do not add per-component
  handling.
- Every icon-only button needs an `aria-label` saying what it does.

## Copy

- Sentence case. "View workout", not "View Workout".
- **No em dashes anywhere.** Use a hyphen or restructure. Prefer restructuring: the
  substitution usually reads worse than the sentence you would have written instead.
- The habit feature is called **Habits**, generically, on every surface. It is not a
  supplement tracker; supplements are one thing a user might track with it.

### One name per thing

A feature with several names reads as several features, and nothing signals "nobody
read this end to end" faster. Settled:

- **Daily numbers.** Not "daily log", "daily summary" or "today's numbers", all of
  which shipped simultaneously for one feature.
- **Workout**, never "session", on any user-facing surface. The internal type is still
  `WorkoutSession`; that is fine, it is not a label.

### Empty states must not share a shape

This is the rule that matters most and the easiest to break by accident. Every empty
state in the app was once built from one frame:

> [imperative] + [object] + ["to" + purpose]
>
> "Log your calories on the Today tab **to track progress over time**."

Each was fine alone. Six of them in one app is the signature of text generated to a
pattern, and it is what makes an interface feel machine-written even when every
sentence is defensible.

**Vary them deliberately.** The current set runs from two words to fourteen, opens
eight different ways, and five carry no call to action at all. Before adding one, read
it against the others as a set. Specifically:

- **A purpose clause is almost always deletable.** A screen with nothing on it is
  usually self-explanatory, and "to track your progress here" tells the user something
  they already know.
- **Say what is true, not what is generic.** The Charts empty state used to claim
  nothing had ever been logged, which was wrong whenever data existed outside the
  selected range. Naming the metric and the range fixed a bug, not just a sentence.
- **Check where the component actually renders** before writing a call to action.
  Pointing at "the big button" is wrong on the screen that has no big button.
- If every empty state becomes a terse fragment, the rhyme is back in a new key.

### Do not manufacture praise

The app notices records because a training log is about them. It does not congratulate
anyone for showing up, and a workout with no records still gets a plain, real summary.
Hollow encouragement from software that does not know the user is the fastest way to
sound fake, and it is the opposite of the restraint the rest of this document buys.
