# Drawing the nutrition timeline

Four directions, written 2026-09-13. Rendered versions of all four, in the app's
own palette: https://claude.ai/code/artifact/7d35ecdd-b818-4921-b138-00060ba5ff5c

The timeline already holds the right data - dated change-points with no end
dates, so one row covers every day after it. What it does not do is show the
shape of it. All four below draw the same three phases: maintenance at 2,700,
an untracked Saturday, then the cut at 2,400 with steps up to 24,000.

## 01 The step chart

The plan as a step line, because a phase IS a step: flat until the next
change-point, then a jump. Logged days sit behind it as dots. Solid left of
today, dashed right of it, so one line is both history and forecast.

The untracked Saturday draws as a gap in the line rather than a dip to zero,
which is the distinction the flag exists for in the first place.

- **Answers:** am I following the plan, and what does it do next.
- **Cost:** reuses the Charts machinery, so it is the cheapest to build. It is
  also a chart, which is the least novel thing on this list.

## 02 The ribbon

Time as one horizontal band cut into segments, width proportional to duration,
so a phase you held for six weeks looks like six weeks. Current phase filled,
untracked day a dashed notch. Tap a segment to edit it - the ribbon REPLACES the
phase list rather than sitting above it, so there is no picture of a list to
keep in sync with the list.

- **Answers:** where am I in the arc, and how long has this been going.
- **Cost:** a one-day phase is about 3px wide at year scale. It needs a minimum
  segment width, and a minimum width lies about duration.

## 03 The staircase

The step chart drawn as architecture rather than as a line. Each block's height
is its calorie level and its width is its duration, so a year of dieting becomes
one silhouette: a bulk is a tall block, a cut descends, a long maintenance is a
broad flat tread, an untracked day is a missing one.

- **Answers:** what have I actually been doing all year, without reading a number.
- **Cost:** needs three or more phases to be legible. On day one it is a single
  grey block and stays that way for weeks.

## 04 The gap

Intake hangs down from the top as a ceiling; steps stand up from the bottom as a
floor. The empty space between them is the deficit, and when the cut starts
calories drop and steps rise at the same instant, so the gap visibly opens. The
only drawing here whose subject is the negative space.

It also draws the two rules the app now has - calories are a ceiling, steps are a
floor - as an actual ceiling and an actual floor.

- **Answers:** how hard is this phase, as a shape rather than two numbers to subtract.
- **Cost:** the gap is not a real quantity. Calories and steps are different
  units, so its width is suggestive rather than measurable. That is a genuine
  honesty problem, not a polish one.

## The recommendation

**01 and 02 together.** The ribbon at the top of the Nutrition section answers
"where am I" at a glance and makes the phases tappable; the step chart under it
answers "am I actually doing it". Those are the two questions the screen exists
for and neither repeats the other.

**03 is the one to build if it should feel like yours.** It is the only concept
here that would not turn up in another tracker, and its weakness is temporary:
it needs three phases, and three phases exist by November.

**04 is the risk.** Best idea on the page, and it cannot quite justify its own
axis. Prototype before committing - if the gap reads as a real quantity it is
misleading, and if it reads as a mood it is honest and very good.
