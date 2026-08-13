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

## Spacing

- Page gutter: `px-5` (20px). Every screen, no exceptions.
- Between sections: `section-gap` (28px).
- Inside a row: `gap-3` (12px).
- Steps available: 4 / 8 / 12 / 16 / 20 / 28. Nothing else.

## Colour

- Accent (`--color-accent`) marks things that are **actionable or currently selected**.
  Never decorative. If everything is accented, nothing is.
- Muted (`--color-muted-foreground`) for secondary text. It measures 6.56:1 on surface
  and 7.53:1 on background, so it passes AA. **Do not use opacity variants** like
  `/60` or `/50`: those compute to 3.74:1 and fail.
- The metric colours (`--color-carbs`, `--fat`, `--protein`, `--steps`, `--bodyweight`,
  `--cardio`, `--nutrition`) are data encodings. Use them only to identify that metric,
  never as decoration.

## Touch and motion

- 44px minimum hit area on everything interactive. Keep the icon small and expand the hit
  area with padding or an `after:-inset-*` overlay rather than growing the row.
- `prefers-reduced-motion` is handled globally in `styles.css`. Do not add per-component
  handling.
- Every icon-only button needs an `aria-label` saying what it does.

## Copy

- Sentence case. "View workout", not "View Workout".
- **No em dashes anywhere.** Use a hyphen or restructure.
- The habit feature is called **Habits**, generically, on every surface. It is not a
  supplement tracker; supplements are one thing a user might track with it.
