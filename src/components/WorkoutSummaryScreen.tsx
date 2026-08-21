import { Check } from "lucide-react";
import { Component, type ReactNode } from "react";
import {
  formatDuration,
  formatNumber,
  recordDetail,
  recordTitle,
  recordValue,
  type WorkoutSummaryData,
} from "../lib/workout-summary";

/**
 * What the app says after an hour of work.
 *
 * The screen is deliberately quiet. It congratulates nobody for showing up, and
 * a session that beat nothing still gets a real summary rather than a
 * consolation message: the facts of the session ARE the summary, and a record
 * is one more fact when there is one. The restraint is the point. An app that
 * gushed here would read as more machine-written, not less.
 *
 * Composition follows /workout, which this replaces on the same route: an
 * eyebrow and a title on the screen's centre axis, one number set large enough
 * to be the subject, then grouped rows for everything that supports it.
 *
 * THE SUBJECT IS WHICHEVER NUMBER THE SESSION EARNED. A record leads when there
 * is one, because that is the number the lifter came for. Otherwise it is the
 * volume moved, and when even that is unusable (a session of bodyweight work,
 * or an import with a corrupt weight) it is the set count, which is always
 * real. There is always something honest to put here, so there is never a
 * placeholder.
 */

/** The number that leads the screen, and the words that say what it is. */
interface Subject {
  /** Whether the caption above the number names a record or plain facts. */
  isRecord: boolean;
  caption: string;
  value: string;
  suffix: string;
  title?: string;
  detail?: string;
}

function subjectOf(data: WorkoutSummaryData): Subject {
  const [headline] = data.records;
  if (headline) {
    const { value, suffix } = recordValue(headline, data.unit);
    return {
      isRecord: true,
      caption: "Personal record",
      value,
      suffix,
      title: recordTitle(headline, data.unit),
      detail: recordDetail(headline, data.unit),
    };
  }
  if (data.volume != null) {
    return {
      isRecord: false,
      caption: "Total volume",
      value: formatNumber(data.volume),
      suffix: data.unit,
    };
  }
  return {
    isRecord: false,
    caption: "Sets logged",
    value: formatNumber(data.setCount),
    suffix: data.setCount === 1 ? "set" : "sets",
  };
}

interface Fact {
  label: string;
  value: string;
}

/**
 * The supporting rows. Whatever the subject already says is left out: repeating
 * the hero number four inches below itself is how a summary starts to feel
 * padded.
 */
function factsOf(data: WorkoutSummaryData, subject: Subject): Fact[] {
  const facts: Fact[] = [];
  // A duration the builder could not measure is left out rather than shown as
  // "0 min", which would be the app inventing a fact about the user's session.
  if (data.durationMinutes != null) {
    facts.push({ label: "Duration", value: formatDuration(data.durationMinutes) });
  }
  if (subject.caption !== "Sets logged") {
    facts.push({ label: "Sets", value: formatNumber(data.setCount) });
  }
  facts.push({ label: "Exercises", value: formatNumber(data.exerciseCount) });
  if (data.volume != null && subject.caption !== "Total volume") {
    facts.push({ label: "Volume", value: `${formatNumber(data.volume)} ${data.unit}` });
  }
  return facts;
}

function SummaryScreen({ data, onDone }: { data: WorkoutSummaryData; onDone: () => void }) {
  const subject = subjectOf(data);
  const facts = factsOf(data, subject);
  const otherRecords = data.records.slice(1);

  return (
    <div className="mx-auto flex h-[100dvh] max-w-md flex-col bg-background">
      {/* The content scrolls in its own region so the way out below it is
          always on screen and never sits on top of the last record. */}
      <div className="flex-1 overflow-y-auto">
        <header className="px-5 pt-14 text-center">
          <div className="t-caption text-muted-foreground">Finished</div>
          <h1 className="mt-1 text-balance break-words t-title">{data.slotName}</h1>
        </header>

        <section className="section-gap flex flex-col items-center px-5 text-center anim-fade-up">
          {subject.isRecord ? (
            // A record is a success, never an alert, and never a badge either: it
            // is a fact stated in the same eyebrow slot every other state uses,
            // and the number under it does the work. The glyph and the words are
            // what carry the meaning, since under protanopia the green reads as
            // much the same olive as the app's warning colour. Same shape as the
            // goal notes on the daily log.
            <span className="flex items-center gap-1 t-caption text-success">
              <Check size={12} strokeWidth={3} aria-hidden="true" />
              {subject.caption}
            </span>
          ) : (
            <span className="t-caption text-muted-foreground">{subject.caption}</span>
          )}
          <div className="mt-3 flex items-baseline gap-2">
            <span className="t-hero">{subject.value}</span>
            <span className="t-body text-muted-foreground">{subject.suffix}</span>
          </div>
          {subject.title && <div className="mt-2 text-balance t-body">{subject.title}</div>}
          {subject.detail && (
            <div className="mt-1 t-label text-muted-foreground">{subject.detail}</div>
          )}
        </section>

        <section className="section-gap">
          <h2 className="group-header t-caption">This session</h2>
          <div className="group-list mx-5">
            {facts.map((fact, i) => (
              <div key={fact.label} className={`group-row ${i === 0 ? "" : "group-row-sep"}`}>
                <span className="t-body text-muted-foreground">{fact.label}</span>
                <span className="tnum t-body">{fact.value}</span>
              </div>
            ))}
          </div>
        </section>

        {otherRecords.length > 0 && (
          <section className="section-gap">
            <h2 className="group-header t-caption">Other records</h2>
            <div className="group-list mx-5">
              {otherRecords.map((record, i) => {
                const { value, suffix } = recordValue(record, data.unit);
                return (
                  <div
                    key={`${record.exerciseId}-${record.kind}`}
                    className={`group-row ${i === 0 ? "" : "group-row-sep"}`}
                  >
                    <div className="min-w-0">
                      <div className="t-body">{recordTitle(record, data.unit)}</div>
                      <div className="t-label text-muted-foreground">
                        {recordDetail(record, data.unit)}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="tnum t-stat">{value}</span>{" "}
                      <span className="t-label text-muted-foreground">{suffix}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* Outside the scroller, so it is on screen from the first frame however
          many records a long session produced. */}
      <div
        className="px-5 pt-7"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 24px)" }}
      >
        <button
          onClick={onDone}
          className="min-h-[44px] w-full rounded-full bg-accent py-3 t-body font-semibold text-accent-foreground"
        >
          Done
        </button>
      </div>
    </div>
  );
}

/**
 * Ending a workout is not allowed to depend on this screen rendering.
 *
 * The data is assembled and the session is closed BEFORE any of this mounts, so
 * by the time a render error could happen the workout is already safely ended.
 * All that is left to protect is the user's way out: on a throw this renders
 * nothing and hands control back to the caller, which navigates home, instead of
 * unmounting the tree and leaving a blank screen with no way off it.
 */
class SummaryBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function WorkoutSummaryScreen({
  data,
  onDone,
}: {
  data: WorkoutSummaryData;
  onDone: () => void;
}) {
  return (
    <SummaryBoundary onError={onDone}>
      <SummaryScreen data={data} onDone={onDone} />
    </SummaryBoundary>
  );
}
