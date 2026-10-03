import type { JSX, ReactNode } from "react";
import { format } from "date-fns";
import {
  Activity,
  Beef,
  Bike,
  ChevronLeft,
  ChevronRight,
  Droplet,
  Dumbbell,
  Flame,
  Footprints,
  Scale,
  Wheat,
} from "lucide-react";
import type { ProgressDay } from "../lib/coach-progress";
import { progressValue, trainingTotal } from "../lib/coach-progress";
import { parseDayKey } from "../lib/daily-log";
import "./CoachProgressCalendar.css";

export interface CoachProgressCalendarProps {
  weeks: (string | null)[][];
  days: Map<string, ProgressDay>;
  unit: "lbs" | "kg";
  clientName: string;
  onSelectDay: (date: string) => void;
}

export interface CoachProgressDayProps {
  day: ProgressDay;
  unit: "lbs" | "kg";
  clientName: string;
  onBack: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  status?: ReactNode;
}

export function CoachProgressCalendar({
  weeks,
  days,
  unit,
  clientName,
  onSelectDay,
}: CoachProgressCalendarProps): JSX.Element {
  return (
    <div className="coach-progress-calendar">
      <div className="ts-weekdays" aria-hidden="true">
        <span>Mon</span>
        <span>Tue</span>
        <span>Wed</span>
        <span>Thu</span>
        <span>Fri</span>
        <span>Sat</span>
        <span>Sun</span>
      </div>
      <div className="ts-weeks">
        {weeks.map((week, weekIndex) => (
          <div
            key={weekIndex}
            className="ts-week"
            role="group"
            aria-label={`Week ${weekIndex + 1}`}
          >
            {week.map((dateKey, colIndex) => {
              if (!dateKey) {
                return <span key={colIndex} className="ts-empty" aria-hidden="true" />;
              }

              const dayData = days.get(dateKey);
              const dateObj = parseDayKey(dateKey);
              const dayNum = dateObj.getDate();

              const workouts = dayData?.workouts ?? [];
              const hasWorkouts = workouts.length > 0;
              const firstWorkout = workouts[0];
              const workoutName = firstWorkout?.name ?? "–";
              const totalWorkoutSets = trainingTotal(workouts, "sets");
              const workoutDetail = hasWorkouts
                ? totalWorkoutSets === undefined
                  ? "–"
                  : `${totalWorkoutSets} sets`
                : "";

              const cardio = dayData?.cardio ?? [];
              const hasCardio = cardio.length > 0;
              const firstCardio = cardio[0];
              const cardioName = firstCardio?.name ?? "–";
              const totalCardioMinutes = trainingTotal(cardio, "durationMinutes");
              const cardioDetail = hasCardio
                ? totalCardioMinutes === undefined
                  ? "–"
                  : `${totalCardioMinutes} min`
                : "";

              const CardioIcon = hasCardio
                ? firstCardio.name.toLowerCase().includes("bike")
                  ? Bike
                  : firstCardio.name.toLowerCase().includes("walk")
                    ? Footprints
                    : Activity
                : Activity;

              const dateStr = format(dateObj, "EEE d MMM yyyy");
              const metricsText = [
                `Bodyweight: ${dayData?.log?.bodyweight !== undefined ? `${progressValue(dayData.log.bodyweight, true, true)} ${unit}` : "not recorded"}`,
                `Calories: ${dayData?.log?.calories !== undefined ? `${progressValue(dayData.log.calories, false, true)} kcal` : "not recorded"}`,
                `Protein: ${dayData?.log?.protein !== undefined ? `${progressValue(dayData.log.protein, false, true)} g` : "not recorded"}`,
                `Carbs: ${dayData?.log?.carbs !== undefined ? `${progressValue(dayData.log.carbs, false, true)} g` : "not recorded"}`,
                `Fat: ${dayData?.log?.fat !== undefined ? `${progressValue(dayData.log.fat, false, true)} g` : "not recorded"}`,
                `Steps: ${dayData?.log?.steps !== undefined ? `${progressValue(dayData.log.steps, false, true)}` : "not recorded"}`,
              ].join("; ");

              const workoutText = hasWorkouts
                ? workouts
                    .map((w) => `${w.name}${w.sets != null ? `, ${w.sets} sets` : ""}`)
                    .join("; ")
                : "not logged";

              const cardioText = hasCardio
                ? cardio
                    .map(
                      (c) =>
                        `${c.name}${c.durationMinutes != null ? `, ${c.durationMinutes} minutes` : ""}`,
                    )
                    .join("; ")
                : "not logged";

              const ariaLabel = `Open ${clientName}, ${dateStr}. ${metricsText}. Workout: ${workoutText}. Cardio: ${cardioText}`;

              return (
                <button
                  key={dateKey}
                  type="button"
                  className="ts-mini cursor-interaction"
                  data-date={dateKey}
                  onClick={() => onSelectDay(dateKey)}
                  aria-label={ariaLabel}
                >
                  <span className="ts-date">{dayNum}</span>
                  <span className="ts-numbers">
                    <span className="ts-stat" data-metric="bodyweight">
                      <span className="ts-label" aria-hidden="true">
                        W
                      </span>
                      <span
                        className={`ts-value${dayData?.log?.bodyweight === undefined ? " ts-missing" : ""}`}
                      >
                        {progressValue(dayData?.log?.bodyweight, true, false)}
                      </span>
                    </span>

                    <span className="ts-stat" data-metric="calories">
                      <span className="ts-label" aria-hidden="true">
                        <Flame className="ts-icon" />
                      </span>
                      <span
                        className={`ts-value${dayData?.log?.calories === undefined ? " ts-missing" : ""}`}
                      >
                        {progressValue(dayData?.log?.calories, false, false)}
                      </span>
                    </span>

                    <span className="ts-stat" data-metric="protein">
                      <span className="ts-label" aria-hidden="true">
                        P
                      </span>
                      <span
                        className={`ts-value${dayData?.log?.protein === undefined ? " ts-missing" : ""}`}
                      >
                        {progressValue(dayData?.log?.protein, false, false)}
                      </span>
                    </span>

                    <span className="ts-stat" data-metric="carbs">
                      <span className="ts-label" aria-hidden="true">
                        C
                      </span>
                      <span
                        className={`ts-value${dayData?.log?.carbs === undefined ? " ts-missing" : ""}`}
                      >
                        {progressValue(dayData?.log?.carbs, false, false)}
                      </span>
                    </span>

                    <span className="ts-stat" data-metric="fat">
                      <span className="ts-label" aria-hidden="true">
                        F
                      </span>
                      <span
                        className={`ts-value${dayData?.log?.fat === undefined ? " ts-missing" : ""}`}
                      >
                        {progressValue(dayData?.log?.fat, false, false)}
                      </span>
                    </span>

                    <span className="ts-stat" data-metric="steps">
                      <span className="ts-label" aria-hidden="true">
                        <Footprints className="ts-icon" />
                      </span>
                      <span
                        className={`ts-value${dayData?.log?.steps === undefined ? " ts-missing" : ""}`}
                      >
                        {progressValue(dayData?.log?.steps, false, false)}
                      </span>
                    </span>
                  </span>

                  <span className="ts-training">
                    <span className="ts-mini-event">
                      <Dumbbell className="ts-icon" aria-hidden="true" />
                      <span className="ts-mini-event-text">
                        <span className={`ts-mini-event-name${hasWorkouts ? "" : " ts-missing"}`}>
                          <span className="ts-name-text">{workoutName}</span>
                          {workouts.length > 1 && (
                            <span className="ts-more">+{workouts.length - 1}</span>
                          )}
                        </span>
                        {workoutDetail ? (
                          <span className="ts-mini-event-detail">{workoutDetail}</span>
                        ) : null}
                      </span>
                    </span>

                    <span className="ts-mini-event">
                      <CardioIcon className="ts-icon" aria-hidden="true" />
                      <span className="ts-mini-event-text">
                        <span className={`ts-mini-event-name${hasCardio ? "" : " ts-missing"}`}>
                          <span className="ts-name-text">{cardioName}</span>
                          {cardio.length > 1 && (
                            <span className="ts-more">+{cardio.length - 1}</span>
                          )}
                        </span>
                        {cardioDetail ? (
                          <span className="ts-mini-event-detail">{cardioDetail}</span>
                        ) : null}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CoachProgressDay({
  day,
  unit,
  clientName,
  onBack,
  onPrevious,
  onNext,
  status,
}: CoachProgressDayProps): JSX.Element {
  const dateObj = parseDayKey(day.date);
  const formattedDate = format(dateObj, "EEE d MMM yyyy");
  const monthYearStr = format(dateObj, "MMMM yyyy");

  return (
    <div className="coach-progress-day">
      <button
        type="button"
        className="ts-back cursor-interaction"
        onClick={onBack}
        aria-label="Back to calendar"
      >
        <ChevronLeft className="ts-back-icon" aria-hidden="true" />
        Calendar
      </button>

      <div className="ts-client-name">{clientName}</div>
      <h1 className="ts-title" aria-live="polite">
        {formattedDate}
      </h1>

      <div className="ts-day-navigation">
        <button
          type="button"
          className="cursor-interaction"
          onClick={onPrevious}
          disabled={!onPrevious}
          aria-label="Previous day"
        >
          <ChevronLeft className="ts-nav-icon" aria-hidden="true" />
        </button>
        <span>{monthYearStr}</span>
        <button
          type="button"
          className="cursor-interaction"
          onClick={onNext}
          disabled={!onNext}
          aria-label="Next day"
        >
          <ChevronRight className="ts-nav-icon" aria-hidden="true" />
        </button>
      </div>

      {status}
      <dl className="ts-today-numbers">
        <div className="ts-today-number">
          <dt>
            <Scale className="ts-field-icon" aria-hidden="true" />
            Bodyweight
          </dt>
          <dd>
            <span className={`ts-value${day.log?.bodyweight === undefined ? " ts-missing" : ""}`}>
              {progressValue(day.log?.bodyweight, true, true)}
            </span>
            {day.log?.bodyweight !== undefined ? <span className="ts-unit">{unit}</span> : null}
          </dd>
        </div>

        <div className="ts-today-number">
          <dt>
            <Flame className="ts-field-icon" aria-hidden="true" />
            Calories
          </dt>
          <dd>
            <span className={`ts-value${day.log?.calories === undefined ? " ts-missing" : ""}`}>
              {progressValue(day.log?.calories, false, true)}
            </span>
            {day.log?.calories !== undefined ? <span className="ts-unit">kcal</span> : null}
          </dd>
        </div>

        <div className="ts-today-number">
          <dt>
            <Beef className="ts-field-icon" aria-hidden="true" />
            Protein
          </dt>
          <dd>
            <span className={`ts-value${day.log?.protein === undefined ? " ts-missing" : ""}`}>
              {progressValue(day.log?.protein, false, true)}
            </span>
            {day.log?.protein !== undefined ? <span className="ts-unit">g</span> : null}
          </dd>
        </div>

        <div className="ts-today-number">
          <dt>
            <Wheat className="ts-field-icon" aria-hidden="true" />
            Carbs
          </dt>
          <dd>
            <span className={`ts-value${day.log?.carbs === undefined ? " ts-missing" : ""}`}>
              {progressValue(day.log?.carbs, false, true)}
            </span>
            {day.log?.carbs !== undefined ? <span className="ts-unit">g</span> : null}
          </dd>
        </div>

        <div className="ts-today-number">
          <dt>
            <Droplet className="ts-field-icon" aria-hidden="true" />
            Fat
          </dt>
          <dd>
            <span className={`ts-value${day.log?.fat === undefined ? " ts-missing" : ""}`}>
              {progressValue(day.log?.fat, false, true)}
            </span>
            {day.log?.fat !== undefined ? <span className="ts-unit">g</span> : null}
          </dd>
        </div>

        <div className="ts-today-number">
          <dt>
            <Footprints className="ts-field-icon" aria-hidden="true" />
            Steps
          </dt>
          <dd>
            <span className={`ts-value${day.log?.steps === undefined ? " ts-missing" : ""}`}>
              {progressValue(day.log?.steps, false, true)}
            </span>
          </dd>
        </div>
      </dl>

      <div className="ts-today-training">
        {day.workouts.length === 0 ? (
          <div className="ts-today-event">
            <Dumbbell className="ts-event-icon" aria-hidden="true" />
            <div>
              <span className="ts-event-name ts-missing">No workouts logged</span>
            </div>
          </div>
        ) : (
          day.workouts.map((workout) => {
            const timeStr = workout.startedAt ? format(new Date(workout.startedAt), "h:mm a") : "";
            const detailParts = [
              workout.sets != null ? `${workout.sets} sets` : "",
              timeStr,
            ].filter(Boolean);

            return (
              <div key={workout.id} className="ts-today-event">
                <Dumbbell className="ts-event-icon" aria-hidden="true" />
                <div className="ts-event-body">
                  <span className="ts-event-name">{workout.name}</span>
                  {detailParts.length > 0 ? (
                    <span className="ts-event-detail">{detailParts.join(" · ")}</span>
                  ) : null}
                  {workout.note ? (
                    <span className="ts-event-note">Note: {workout.note}</span>
                  ) : null}
                  {workout.details && workout.details.length > 0 ? (
                    <div className="ts-event-subdetails">
                      {workout.details.map((detail, idx) => (
                        <span key={idx}>{detail}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })
        )}

        {day.cardio.length === 0 ? (
          <div className="ts-today-event">
            <Activity className="ts-event-icon" aria-hidden="true" />
            <div>
              <span className="ts-event-name ts-missing">No cardio logged</span>
            </div>
          </div>
        ) : (
          day.cardio.map((c) => {
            const timeStr = c.startedAt ? format(new Date(c.startedAt), "h:mm a") : "";
            const detailParts = [
              c.durationMinutes != null ? `${c.durationMinutes} min` : "",
              c.distance != null ? `${c.distance} ${unit === "lbs" ? "mi" : "km"}` : "",
              timeStr,
            ].filter(Boolean);

            const CardioIcon = c.name.toLowerCase().includes("bike")
              ? Bike
              : c.name.toLowerCase().includes("walk")
                ? Footprints
                : Activity;

            return (
              <div key={c.id} className="ts-today-event">
                <CardioIcon className="ts-event-icon" aria-hidden="true" />
                <div className="ts-event-body">
                  <span className="ts-event-name">{c.name}</span>
                  {detailParts.length > 0 ? (
                    <span className="ts-event-detail">{detailParts.join(" · ")}</span>
                  ) : null}
                  {c.note ? <span className="ts-event-note">Note: {c.note}</span> : null}
                  {c.details && c.details.length > 0 ? (
                    <div className="ts-event-subdetails">
                      {c.details.map((detail, idx) => (
                        <span key={idx}>{detail}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
