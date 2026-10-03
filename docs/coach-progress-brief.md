# Coach progress proposal

## Decisions from the user

- The coach needs an overview of all clients and a separate detail view after selecting one.
- Both views support weekly and two-week review; monthly overview is also wanted.
- Roster adherence means **logging consistency only**. It does not mean meeting a target or following the prescribed program.
- Detail shows actual daily bodyweight, steps, calories, protein, carbs and fat, with compact readable rows.

## Recommended flow

Show a Clients tab only in coach mode. Keep configuration in Settings. The Clients view owns a shared Week / 2 weeks / Month selection and displays each client in a stable order. Open a client to a daily-numbers grid; Back returns to the same roster, period and scroll position.

Two sample-data concepts are available for choosing the roster layout:

- **Calendar:** a seven-column strip per client, extended into additional rows for longer periods. Each date states how many of the six numbers were recorded, such as 3/6. Shape and text distinguish complete, partial and empty dates. This conveys presence only; 6/6 is not a score for goal attainment.
- **Counts:** each client lists recorded-day counts for each metric, such as bodyweight 5/7 days and steps 7/7 days. This is better for comparison across many clients because it exposes exactly which numbers are missing. This is the recommended starting point, with calendar as an optional later view if date patterns matter more.

The detail grid has a pinned Date column and columns for bodyweight, steps, calories, protein, carbs and fat. Put units in headers. Use tabular values at 14–16px, compact row spacing and horizontal scrolling for all columns on a phone. Do not shrink six metrics to fit an unreadable width.

## Rules to settle before implementation

- Count whether a field was recorded, including a real zero; missing remains a distinct state. Do not infer nutrition completion from calories alone.
- Exclude future dates from recorded-day denominators. Today is in progress rather than a failed day. The interactive concept uses completed sample periods to avoid pretending these rules are already implemented.
- Show counts per metric without inventing a universal adherence score. If clients have different expected logging schedules, define the denominator with the coach before adding percentages or alerts.
- A failed or unavailable snapshot is not an empty log. Show loading, unavailable and stale states separately, and label when the coach fetched the data independently from any known client sync time.
- A roster should fetch in bounded batches and retain useful snapshots while switching periods or clients. The current single-client temporary snapshot store is not sufficient by itself; caching and freshness need an explicit design.
- Reading must not start an unsolicited Google authorization window. Any request for fresh authorization follows a deliberate user action.
- Preserve the existing plan-editing locks and sheet-only coaching writes. The new progress views are read-only.

## Status

This is a proposal and an interactive concept using fictional clients. It has not been connected to Google Sheets or implemented in Trakt. Choose Calendar or Counts before building the roster. The workout reading/editor changes and Google launch fix are separate local changes on `codex/workout-preview-ios`.
