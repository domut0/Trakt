import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { WorkoutLog } from "../WorkoutLog";
import {
  useStore,
  type Exercise,
  type PlannedLift,
  type WorkoutSession,
  type WorkoutSet,
} from "../../lib/store";

/**
 * Logging a workout, where the unit on screen is the EXERCISE.
 *
 * The workout screen lists exercises and counts their sets; tapping one opens
 * the exercise, whose rows are its sets. Nothing here mocks the store: these
 * drive the real actions and then read what they wrote, because the thing worth
 * asserting is what ends up in the record.
 */

const BENCH: Exercise = { id: "e_bench", name: "Bench Press", type: "main" };
const ROW: Exercise = { id: "e_row", name: "Barbell Row", type: "main" };

const SESSION: WorkoutSession = { id: "sess_today", splitSlotId: "s_upper", startedAt: 1_000 };

/** A finished session to stand in for "last time". */
const LAST_WEEK: WorkoutSession = {
  id: "sess_last",
  splitSlotId: "s_upper",
  startedAt: 100,
  endedAt: 200,
};

function pastSet(exerciseId: string, weight: number, reps: number, at: number): WorkoutSet {
  return { id: `p_${at}`, sessionId: LAST_WEEK.id, exerciseId, weight, reps, loggedAt: at };
}

function setup(lifts: PlannedLift[], history: WorkoutSet[] = []) {
  useStore.setState({
    hydrated: true,
    unit: "lbs",
    exercises: [BENCH, ROW],
    slots: [{ id: "s_upper", name: "Upper", rotationOrder: 0, plannedLifts: lifts }],
    sessions: history.length > 0 ? [LAST_WEEK, SESSION] : [SESSION],
    sets: history,
    activeSessionId: SESSION.id,
    currentExerciseId: undefined,
  });
  render(<WorkoutLog sessionId={SESSION.id} lifts={lifts} stopwatch="0:00" />);
}

/** The sets logged today, oldest first - the record these tests are about. */
function loggedToday(exerciseId = BENCH.id) {
  return useStore
    .getState()
    .sets.filter((s) => s.sessionId === SESSION.id && s.exerciseId === exerciseId)
    .sort((a, b) => a.loggedAt - b.loggedAt);
}

function openExercise(name: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));
}

function tapRow(index: number) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Set ${index}\\b`) }));
}

function editorValue(label: string) {
  return (screen.getByLabelText(label) as HTMLInputElement).value;
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function save() {
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

function done() {
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
}

describe("WorkoutLog", () => {
  beforeEach(() => {
    useStore.setState({ sets: [], sessions: [], exercises: [], slots: [] });
  });

  it("gives a prescribed 3 x 8 three rows, and counts what has been logged", () => {
    setup([{ exerciseId: BENCH.id, sets: 3, reps: "8" }]);

    // The count is on the row before anything is logged, because 0 of 3 is a
    // fact about the workout rather than an empty state.
    expect(screen.getByRole("button", { name: /^Bench Press/ })).toHaveTextContent("0/3 sets");

    openExercise("Bench Press");
    expect(screen.getByRole("button", { name: /^Set 1\b/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Set 2\b/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Set 3\b/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Set 4\b/ })).not.toBeInTheDocument();

    tapRow(1);
    type("Weight", "100");
    save();
    done();

    expect(screen.getByRole("button", { name: /^Bench Press/ })).toHaveTextContent("1/3 sets");
  });

  it("pre-fills a tapped row with its ghost, so Save logs exactly what was offered", () => {
    setup([{ exerciseId: BENCH.id, sets: 3, reps: "8", load: "100" }]);
    openExercise("Bench Press");

    tapRow(1);
    expect(editorValue("Weight")).toBe("100");
    expect(editorValue("Reps")).toBe("8");

    save();

    expect(loggedToday()).toHaveLength(1);
    expect(loggedToday()[0]).toMatchObject({ weight: 100, reps: 8 });
  });

  describe("the ghost, field by field", () => {
    const history = [
      pastSet(BENCH.id, 90, 5, 101),
      pastSet(BENCH.id, 90, 5, 102),
      pastSet(BENCH.id, 85, 5, 103),
    ];

    it("fills what the prescription left blank from last time, at that row's index", () => {
      setup([{ exerciseId: BENCH.id, sets: 3, reps: "8-12" }], history);
      openExercise("Bench Press");

      // The range is shown as prescribed; the weight comes from last time.
      expect(screen.getByRole("button", { name: /^Set 1\b/ })).toHaveTextContent("90 lbs × 8-12");
      expect(screen.getByRole("button", { name: /^Set 3\b/ })).toHaveTextContent("85 lbs × 8-12");

      tapRow(1);
      expect(editorValue("Weight")).toBe("90");
      // A range opens at its low end: that is the number certainly prescribed.
      expect(editorValue("Reps")).toBe("8");
    });

    it("lets the prescription beat last time on the field it names", () => {
      setup([{ exerciseId: BENCH.id, sets: 3, reps: "8-12", load: "100" }], history);
      openExercise("Bench Press");

      tapRow(1);
      expect(editorValue("Weight")).toBe("100");
    });

    it("ghosts both fields from last time when nothing was prescribed", () => {
      setup([{ exerciseId: BENCH.id }], history);
      openExercise("Bench Press");

      tapRow(1);
      expect(editorValue("Weight")).toBe("90");
      expect(editorValue("Reps")).toBe("5");
    });
  });

  it("adds a fourth set to a three-set prescription without touching the first three", () => {
    setup([{ exerciseId: BENCH.id, sets: 3, reps: "8", load: "100" }]);
    openExercise("Bench Press");

    for (const row of [1, 2, 3]) {
      tapRow(row);
      save();
    }
    fireEvent.click(screen.getByRole("button", { name: /Add set/ }));
    tapRow(4);
    type("Weight", "80");
    type("Reps", "12");
    save();

    const sets = loggedToday();
    expect(sets).toHaveLength(4);
    expect(sets.slice(0, 3).map((s) => [s.weight, s.reps])).toEqual([
      [100, 8],
      [100, 8],
      [100, 8],
    ]);
    expect(sets[3]).toMatchObject({ weight: 80, reps: 12 });
  });

  it("corrects a logged set in place rather than logging another", () => {
    setup([{ exerciseId: BENCH.id, sets: 3, reps: "8", load: "100" }]);
    openExercise("Bench Press");

    tapRow(1);
    save();
    const originalId = loggedToday()[0].id;

    tapRow(1);
    expect(editorValue("Weight")).toBe("100");
    type("Reps", "6");
    save();

    expect(loggedToday()).toHaveLength(1);
    expect(loggedToday()[0]).toMatchObject({ id: originalId, weight: 100, reps: 6 });
  });

  it("moves to the next exercise with unlogged sets once every row is logged", () => {
    setup([
      { exerciseId: BENCH.id, sets: 1, reps: "8", load: "100" },
      { exerciseId: ROW.id, sets: 2, reps: "10", load: "60" },
    ]);

    openExercise("Bench Press");
    expect(useStore.getState().currentExerciseId).toBe(BENCH.id);
    tapRow(1);
    save();
    done();

    expect(useStore.getState().currentExerciseId).toBe(ROW.id);
  });

  it("leaves you on an exercise you stepped out of half done", () => {
    setup([
      { exerciseId: BENCH.id, sets: 3, reps: "8", load: "100" },
      { exerciseId: ROW.id, sets: 2, reps: "10", load: "60" },
    ]);

    openExercise("Bench Press");
    tapRow(1);
    save();
    done();

    expect(useStore.getState().currentExerciseId).toBe(BENCH.id);
  });

  it("starts an unplanned workout empty, and adds an exercise off-plan", () => {
    setup([]);
    expect(screen.queryByRole("button", { name: /^Bench Press/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Add exercise/ }));
    fireEvent.click(screen.getByRole("button", { name: /Bench Press/ }));

    // The picker hands straight over to the exercise, with one row to tap.
    tapRow(1);
    type("Weight", "100");
    type("Reps", "5");
    save();
    done();

    expect(loggedToday()).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^Bench Press/ })).toHaveTextContent("1 sets");
  });

  it('labels the set counter as "0/1 sets" for a planned lift and "2 sets" when added by hand', () => {
    // Column header convention: always plural "sets", even for a single set.
    setup([{ exerciseId: BENCH.id, sets: 1, reps: "5" }]);
    expect(screen.getByRole("button", { name: /^Bench Press/ })).toHaveTextContent("0/1 sets");

    // Add a second lift manually (not in the plan) and log two sets.
    fireEvent.click(screen.getByRole("button", { name: /Add exercise/ }));
    fireEvent.click(screen.getByRole("button", { name: /Barbell Row/ }));
    tapRow(1);
    type("Weight", "135");
    type("Reps", "5");
    save();
    fireEvent.click(screen.getByRole("button", { name: /Add set/ }));
    tapRow(2);
    type("Weight", "135");
    type("Reps", "5");
    save();
    done();

    expect(screen.getByRole("button", { name: /^Barbell Row/ })).toHaveTextContent("2 sets");
  });
});

describe("what the review added", () => {
  it("offers what you just did, before it offers last week", () => {
    // The lived-in behaviour of every version of this app: go up to 105 on set
    // one and set two offers 105, not last week's 90.
    setup(
      [{ exerciseId: BENCH.id, sets: 3, reps: "5" }],
      [pastSet(BENCH.id, 90, 5, 101), pastSet(BENCH.id, 90, 5, 102)],
    );
    openExercise("Bench Press");

    tapRow(1);
    expect(editorValue("Weight")).toBe("90");
    type("Weight", "105");
    save();

    tapRow(2);
    expect(editorValue("Weight")).toBe("105");
  });

  it("still lets the prescription override what you just did, because it is an instruction", () => {
    setup([{ exerciseId: BENCH.id, sets: 3, reps: "5", load: "100" }]);
    openExercise("Bench Press");

    tapRow(1);
    type("Weight", "120");
    save();

    tapRow(2);
    expect(editorValue("Weight")).toBe("100");
  });

  it("records a setup note typed against the set, not only one inherited", () => {
    // The only place a per-set setup can be typed. prefillFor buckets on it, so
    // the same bar at two pin heights does not prefill across.
    setup([{ exerciseId: BENCH.id, sets: 2, reps: "5" }]);
    openExercise("Bench Press");

    tapRow(1);
    type("Weight", "100");
    type("Setup note", "Pin 4");
    save();

    expect(loggedToday()[0].setupNote).toBe("Pin 4");

    // And it carries forward to the next set, since the setup does not change
    // between them unless somebody changes it.
    tapRow(2);
    expect(editorValue("Setup note")).toBe("Pin 4");
  });

  it("corrects a note on a set already logged", () => {
    setup([{ exerciseId: BENCH.id, sets: 1, reps: "5" }]);
    openExercise("Bench Press");
    tapRow(1);
    type("Weight", "100");
    type("Setup note", "Pin 4");
    save();

    tapRow(1);
    type("Setup note", "Pin 6");
    save();

    expect(loggedToday()).toHaveLength(1);
    expect(loggedToday()[0].setupNote).toBe("Pin 6");
  });
});
