# The design overhaul, before and after

Every claim below was checked against a screenshot rather than against the diff.
Where a claim did not survive its own image, that is recorded too.

"Before" is commit `eef3a66`, which added the screenshot harness and touched no
app code, so its tree is the pre-overhaul app plus a harness that still matches
its strings. "After" is the branch head.

## How to regenerate

The images in `docs/before-after/` are a curated subset. The full 42-screen sets
are not committed: they are ~4.4 MB of binaries that are redundant with the
repo's own history, since `eef3a66` is a commit and the capture is reproducible.

```bash
git worktree add ../before-tree eef3a66
ln -s "$PWD/node_modules" ../before-tree/node_modules   # see note below
cd ../before-tree && PORT=8081 npm run dev &
SCREENSHOT_BASE_URL=http://localhost:8081 SCREENSHOT_OUT=screenshots-before npm run screenshots
git worktree remove ../before-tree
```

`npm install` is not needed in the worktree. `29a3f00` deleted 41 dependencies,
but every one was unreachable from app code, so today's `node_modules` serves
the old tree too. Use the harness **as it exists at `eef3a66`**, not today's:
the copy pass renamed "Daily log" to "Daily numbers" and today's harness selects
on the new string.

## A caveat that limits one comparison

`31d9c43` moved the seeded cheat days (offsets 8 and 29 were Wednesdays, so the
branch was dead and no capture had ever contained one) and added a cheat day
carrying no numbers. **The seed therefore differs between the two sets.**

For Today, History and the calendar this does not matter: the days being
compared carry identical numbers, and the cheat-day change is itself one of the
fixes on show. For **Charts it does matter**: the plotted series moved, so the
before and after chart images are not comparing like with like and no visual
claim is made about them here.

## Today, scrolled to the goal rows

`before-11-today-populated-scrolled.png` / `after-11-today-populated-scrolled.png`

This is the pair that motivated the whole exercise. Identical logged numbers on
both sides.

|                                  | Before                | After             |
| -------------------------------- | --------------------- | ----------------- |
| Protein 226g against a 200g goal | `OVER`, solid red bar | `✓ +26g`, green   |
| Steps 12,480 against 10,000      | `OVER`, solid red bar | `✓ +2,480`, green |
| Carbs 168g of 300g               | teal, in progress     | unchanged         |
| Fat 62g of 80g                   | purple, in progress   | unchanged         |

Confirmed in the images:

- **Both overages were red, and both are now green.** Beating a protein goal by
  26g was the best row on that screen and the only one painted like a failure.
- **The bars were clamped at 100%.** Before, protein and steps are both solid
  bars filling the full width, so 8,100 steps and 14,000 steps rendered
  identically. After, the surplus draws as its own segment past a divider, so
  the two are distinguishable.
- **Carbs and fat stayed neutral**, which is what makes green mean anything.
  A version that turned every row green would have been no more informative
  than one that turned them all red.
- **Each green value carries a `✓`.** State is not left to hue alone, which
  matters because success and warning collapse to nearly the same olive under
  protanopia (measured: 37.9 apart, 10.4 simulated).

## Today, at the top

`before-10-today-populated.png` / `after-10-today-populated.png`

- **The ring centre went from `t-body` (15px) to `t-hero` (32px)**, and the ring
  grew from 72px to 124px to fit it. Before, "2,180" inside the ring was
  _smaller_ than the 22px macro grams beside it: the derived numbers outranked
  the number the screen exists to show. `styles.css` had defined `t-hero` with a
  docstring naming "macro ring centre" as its use case, and the app had never
  used it there.
- **The macro colour moved off the percentage onto the grams.** Before:
  `31% / 26% / 42%` coloured and small, `168g / 62g / 226g` white and large.
  After, the percentages are gone and the gram values carry their metric colour.
- **The consistency dots went 6px to 10px.** At 6px a colour cannot read as a
  colour, and these encode whether a day had a workout and a log.
- **The daily numbers card sits one fill step up** (`--surface` to `--muted`),
  which is what makes it the subject. No border and no shadow: `DESIGN.md` bans
  both, and the third fill step was already in the palette.
- **The Habits card lost a whole row.** Before, a "2 of 4" pill and a gear above
  a hairline. After, "2 of 4 done / Edit habits" rides the group's last row,
  which is itself the edit control. It also lost an invisible card-inside-a-card:
  a `bg-surface` wrapper around a `group-list` that is already `--surface`.
- **The nav showed two accent-blue items at once** — the selected tab, plus
  Workout, which was hard-coded to accent on every route. After, exactly one
  item is accent and it is the current tab; an active workout is carried by a
  badge on the glyph instead.
- **"DAILY LOG" is now "DAILY NUMBERS"**, one of four names the same feature had.

## The calendar

`before-22-history-calendar.png` / `after-22-history-calendar.png`

The seed differs here by design, so compare the _rendering rule_, not the days.

Before, a declared cheat day **replaced** the food dot. A day the user had
explicitly marked drew fewer dots than a day they had logged normally, and a
cheat day with no macros drew nothing at all, making it identical to a day they
never opened. The app was quietly punishing honest logging.

After, a cheat day is a hollow ring **alongside** the food dot. Aug 10 in the
after image shows `● ○`, a workout dot plus the ring, where the old rule would
have drawn only the workout dot. The marker is a shape, not a hue.

## Ending a workout

`after-workout-summary.png`. **There is no before image, because there was no
screen.** `workout.tsx` called `endWorkout()` and then `router.navigate` home.
An hour of training ended in a redirect.

`README.md:19` had advertised "PR detection — celebrates estimated-1RM and rep
PRs at the end of a session" since long before any of it existed; the only match
for "pr" in the library was a Tailwind `pr-5` padding class.

The summary now reports duration, sets, exercises and volume, and leads with
whichever number the workout earned: a record if there was one, volume if not,
set count if volume is unusable. There is never a placeholder. A workout with no
records still gets a real summary and no consolation copy, and ending one with
nothing logged still shows nothing, because that is a cancel.

## The six empty states

Not a visual claim, but the one the audit rated loudest. All six had shared a
single grammatical frame: **[imperative] + [object] + ["to" + purpose]**.

| Screen             | After                                                  |
| ------------------ | ------------------------------------------------------ |
| Today, numbers     | "Nothing logged today."                                |
| Today, workouts    | "You haven't trained yet."                             |
| Charts             | "No calories in this range"                            |
| Exercise, strength | "Never logged"                                         |
| Exercise, cardio   | "Not tracked here" + explanation                       |
| History weekly     | "Nothing to look back on yet"                          |
| History calendar   | "Empty day"                                            |
| Workout            | "No sets yet" + "The workout starts when you log one." |

Lengths run 2 to 14 words. Four lost their second sentence. Five carry no call
to action at all. None uses the old frame.

The charts state also had a bug: it claimed nothing had ever been logged, which
was false whenever data existed outside the selected range. It now names the
metric and points at the range chips.

## What is not claimed

- **Charts**: the seed moved, so no visual comparison is honest here.
- **The unit-switch hazard is documented, not fixed** (`929d644`). Neither
  candidate fix can recover what unit an existing set was logged in, so a
  backfill would launder a guess into a stored fact.
  `src/lib/__tests__/unit-switch.test.ts` pins current behaviour instead.
- **With habits enabled, the ring's lower half sits below the fold** on first
  paint, visible in `after-10-today-populated.png`. Fixing it means reordering
  sections, and the comment above the current order argues for it on thumb-reach
  grounds. Left for a human call.
