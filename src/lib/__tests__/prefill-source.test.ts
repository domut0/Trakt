import { describe, expect, it } from "vitest";
import {
  computePrefill,
  currentNoteKeyFor,
  findPrefillSource,
  setupNoteKey,
  suggestNextExercise,
  suggestSetupNote,
  useStore,
  type WorkoutSession,
  type WorkoutSet,
} from "../store";

/**
 * Where "last time" comes from.
 *
 * Prefill used to read its numbers off the last session sharing a Split Slot,
 * which meant a lift trained twice a week only ever saw its own weekday. These
 * cover the exercise-based lookup that replaced it, and the setup-note buckets
 * that keep a paused bench from borrowing a touch-and-go bench's numbers.
 *
 * The cardio exclusions have their own file (cardio.pure.test.ts); what is
 * covered here is that the NEW source selection did not reopen that door.
 */

const DAY = 86_400_000;
const t0 = 1_700_000_000_000;

/** A completed strength session on day `day`, in slot `slot`. */
function done(id: string, slot: string, day: number): WorkoutSession {
  return { id, splitSlotId: slot, startedAt: t0 + day * DAY, endedAt: t0 + day * DAY + 3_600_000 };
}

/** The session in progress: started, never ended. */
function open(id: string, slot: string, day: number): WorkoutSession {
  return { id, splitSlotId: slot, startedAt: t0 + day * DAY };
}

let setSeq = 0;
function set(
  sessionId: string,
  exerciseId: string,
  weight: number,
  reps: number,
  extra: Partial<WorkoutSet> = {},
): WorkoutSet {
  setSeq += 1;
  return {
    id: `set_${setSeq}`,
    sessionId,
    exerciseId,
    weight,
    reps,
    // Ordering within a session is all that matters, and every helper sorts by
    // this, so a monotonic counter is enough.
    loggedAt: t0 + setSeq,
    ...extra,
  };
}

describe("setupNoteKey (how two setup notes are compared)", () => {
  it("ignores surrounding whitespace and case, which are typing, not setup", () => {
    expect(setupNoteKey("  TNG ")).toBe(setupNoteKey("tng"));
    expect(setupNoteKey("Pause 2ct")).toBe("pause 2ct");
  });

  it("puts absent, empty and whitespace-only notes in one bucket", () => {
    expect(setupNoteKey(undefined)).toBe("");
    expect(setupNoteKey("")).toBe("");
    expect(setupNoteKey("   ")).toBe("");
  });

  it("keeps different setups apart", () => {
    expect(setupNoteKey("tng")).not.toBe(setupNoteKey("pause"));
    expect(setupNoteKey("tng")).not.toBe(setupNoteKey(""));
  });

  it("treats a non-string note from a malformed import as no note", () => {
    expect(setupNoteKey(42)).toBe("");
    expect(setupNoteKey(null)).toBe("");
    expect(setupNoteKey({ note: "tng" })).toBe("");
  });
});

describe("currentNoteKeyFor (what today already committed to)", () => {
  const sets = [
    set("today", "bench", 225, 5, { setupNote: "tng" }),
    set("today", "bench", 205, 8, { setupNote: "Pause" }),
    set("today", "row", 135, 10),
  ];

  it("is undefined when the exercise has not been touched today", () => {
    expect(currentNoteKeyFor(sets, "today", "squat")).toBeUndefined();
  });

  it("is the most recent set's note, so switching setup mid-session takes effect at once", () => {
    expect(currentNoteKeyFor(sets, "today", "bench")).toBe("pause");
  });

  it("is the empty bucket, not undefined, for an exercise logged today without a note", () => {
    // The difference matters: undefined means "search anything", "" means
    // "search un-noted history only".
    expect(currentNoteKeyFor(sets, "today", "row")).toBe("");
  });
});

describe("the reported bug: a lift trained on two split slots", () => {
  // "if on FB1 I do tpd 70x5 and then FB3 I do tpd 80x5, next FB1 session
  // it'll auto fill 70x5 instead of 80x5."
  const sessions: WorkoutSession[] = [
    done("fb1_wk1", "fb1", 0),
    done("fb3_wk1", "fb3", 3),
    open("fb1_wk2", "fb1", 7),
  ];
  const sets: WorkoutSet[] = [
    set("fb1_wk1", "tpd", 70, 5),
    set("fb1_wk1", "squat", 185, 5),
    set("fb3_wk1", "tpd", 80, 5),
  ];

  it("prefills the heavier day three days ago, not the same slot a week ago", () => {
    expect(computePrefill(sessions, sets, "fb1_wk2", "tpd")).toEqual({
      weight: 80,
      reps: 5,
      rpe: undefined,
    });
  });

  it("sources from the session that actually contains the lift", () => {
    expect(findPrefillSource(sessions, sets, "fb1_wk2", "tpd")?.session.id).toBe("fb3_wk1");
  });

  it("still suggests the next exercise in THIS slot's order, only with fresher numbers", () => {
    // fb3 opened with a lift fb1 never does. If ordering had followed the
    // numbers, that is what would be suggested here.
    const withFb3Order: WorkoutSet[] = [
      ...sets,
      set("fb3_wk1", "incline", 95, 8),
      set("fb3_wk1", "curl", 30, 12),
    ];
    const sug = suggestNextExercise(sessions, withFb3Order, "fb1_wk2");
    expect(sug?.exerciseId).toBe("tpd");
    expect(sug?.weight).toBe(80);
    expect(sug?.reps).toBe(5);
  });

  it("advances through this slot's order while each lift keeps its own freshest numbers", () => {
    const alsoSquattedOnFb3: WorkoutSet[] = [...sets, set("fb3_wk1", "squat", 205, 5)];
    const done1: WorkoutSet[] = [...alsoSquattedOnFb3, set("fb1_wk2", "tpd", 80, 5)];
    const sug = suggestNextExercise(sessions, done1, "fb1_wk2");
    expect(sug?.exerciseId).toBe("squat");
    expect(sug?.weight).toBe(205);
  });
});

describe("setup notes decide which past session counts", () => {
  // Bench is done two ways. The paused day is more recent, so it wins any
  // lookup that does not know about setups.
  // Today is a third slot, so nothing here can be reached by slot matching:
  // whatever comes back was found by exercise and setup alone.
  const sessions: WorkoutSession[] = [
    done("tng_day", "fb1", 0),
    done("pause_day", "fb3", 3),
    open("today", "fb2", 7),
  ];
  const sets: WorkoutSet[] = [
    set("tng_day", "bench", 225, 5, { setupNote: "tng" }),
    set("tng_day", "bench", 205, 8, { setupNote: "tng" }),
    set("pause_day", "bench", 185, 3, { setupNote: "pause" }),
    set("pause_day", "bench", 165, 5, { setupNote: "pause" }),
  ];

  it("a touch-and-go bench does not prefill from a paused bench", () => {
    const todayIsTng: WorkoutSet[] = [...sets, set("today", "bench", 230, 5, { setupNote: "tng" })];
    // Second block today, so the second TNG block from the TNG day.
    expect(computePrefill(sessions, todayIsTng, "today", "bench")).toEqual({
      weight: 205,
      reps: 8,
      rpe: undefined,
    });
  });

  it("a paused bench does not prefill from a touch-and-go bench", () => {
    const todayIsPause: WorkoutSet[] = [
      ...sets,
      set("today", "bench", 190, 3, { setupNote: "pause" }),
    ];
    expect(computePrefill(sessions, todayIsPause, "today", "bench")).toEqual({
      weight: 165,
      reps: 5,
      rpe: undefined,
    });
  });

  it("walks past a more recent session in the wrong bucket rather than settling for it", () => {
    // Week-old numbers for the right setup beat fresh numbers for the wrong one.
    const source = findPrefillSource(sessions, sets, "today", "bench", "tng");
    expect(source?.session.id).toBe("tng_day");
  });

  it("matches a note typed but not yet logged, trimmed and case-folded", () => {
    expect(computePrefill(sessions, sets, "today", "bench", "  TNG  ")).toEqual({
      weight: 225,
      reps: 5,
      rpe: undefined,
    });
  });

  it("prefers an explicitly typed note over what today's earlier sets said", () => {
    // Switching setup mid-session: the sheet knows the next set is paused
    // before any paused set exists to read it off.
    const todayIsTng: WorkoutSet[] = [...sets, set("today", "bench", 230, 5, { setupNote: "tng" })];
    expect(computePrefill(sessions, todayIsTng, "today", "bench", "pause")).toEqual({
      weight: 185,
      reps: 3,
      rpe: undefined,
    });
  });

  it("starts the other setup's blocks from the top instead of resuming the first setup's count", () => {
    // One TNG block is logged today, but pause has its own block sequence and
    // this is its first, so the count must not carry over.
    const todayIsTng: WorkoutSet[] = [...sets, set("today", "bench", 230, 5, { setupNote: "tng" })];
    const source = findPrefillSource(sessions, todayIsTng, "today", "bench", "pause");
    expect(source?.sets[0].weight).toBe(185);
  });

  it("takes only the matching sets when one session mixed both setups", () => {
    const mixed: WorkoutSession[] = [done("mixed_day", "fb1", 5), open("today", "fb1", 7)];
    const mixedSets: WorkoutSet[] = [
      set("mixed_day", "bench", 225, 5, { setupNote: "tng" }),
      set("mixed_day", "bench", 135, 3, { setupNote: "pause" }),
    ];
    // The paused single at the end of that day is not the paused block to open
    // with, and the TNG top set is not a paused number at all.
    expect(computePrefill(mixed, mixedSets, "today", "bench", "pause")).toEqual({
      weight: 135,
      reps: 3,
      rpe: undefined,
    });
    // With nothing known today the bucket comes from how that session opened.
    expect(computePrefill(mixed, mixedSets, "today", "bench")).toEqual({
      weight: 225,
      reps: 5,
      rpe: undefined,
    });
  });
});

describe("un-noted history is its own bucket", () => {
  it("does not prefill an un-noted exercise from a noted one", () => {
    const sessions: WorkoutSession[] = [done("noted", "fb1", 0), open("today", "fb1", 7)];
    const sets: WorkoutSet[] = [
      set("noted", "bench", 225, 5, { setupNote: "pause" }),
      set("noted", "bench", 205, 8, { setupNote: "pause" }),
      // Today's bench was logged with no note at all, which is a different
      // setup as far as this app can tell.
      set("today", "bench", 200, 5),
    ];
    expect(computePrefill(sessions, sets, "today", "bench")).toEqual({});
  });

  it("does not prefill a noted exercise from an un-noted one", () => {
    const sessions: WorkoutSession[] = [done("plain", "fb1", 0), open("today", "fb1", 7)];
    const sets: WorkoutSet[] = [
      set("plain", "bench", 300, 5),
      // A second block, so ignoring the bucket would have something to offer.
      set("plain", "bench", 250, 8),
      set("today", "bench", 190, 3, { setupNote: "pause" }),
    ];
    expect(computePrefill(sessions, sets, "today", "bench")).toEqual({});
  });

  it("still prefills the first block of the day from an un-noted session", () => {
    // Nothing is known yet on the first set, so no bucket is imposed and the
    // ordinary "last time you did this" answer applies.
    const sessions: WorkoutSession[] = [done("plain", "fb1", 0), open("today", "fb1", 7)];
    const sets: WorkoutSet[] = [set("plain", "bench", 300, 5)];
    expect(computePrefill(sessions, sets, "today", "bench")).toEqual({
      weight: 300,
      reps: 5,
      rpe: undefined,
    });
  });
});

describe("distinct-block matching across the new source", () => {
  // The blocks live on a different slot from the session asking for them.
  const sessions: WorkoutSession[] = [
    done("fb1_wk1", "fb1", 0),
    done("fb3_wk1", "fb3", 3),
    open("fb1_wk2", "fb1", 7),
  ];
  const sets: WorkoutSet[] = [
    // A week-old FB1 bench that must lose to the fresher FB3 one.
    set("fb1_wk1", "bench", 200, 1),
    set("fb1_wk1", "bench", 170, 3),
    // FB3: top single, then three backdown triples (one distinct block).
    set("fb3_wk1", "bench", 225, 1, { rpe: 9 }),
    set("fb3_wk1", "bench", 190, 3),
    set("fb3_wk1", "bench", 190, 3),
    set("fb3_wk1", "bench", 190, 3),
  ];

  it("offers the first distinct block first", () => {
    expect(computePrefill(sessions, sets, "fb1_wk2", "bench")).toEqual({
      weight: 225,
      reps: 1,
      rpe: 9,
    });
  });

  it("offers the second distinct block once the first is logged", () => {
    const after = [...sets, set("fb1_wk2", "bench", 225, 1)];
    expect(computePrefill(sessions, after, "fb1_wk2", "bench")).toEqual({
      weight: 190,
      reps: 3,
      rpe: undefined,
    });
  });

  it("does not invent a third block, and repeats within a block do not advance the count", () => {
    const after = [
      ...sets,
      set("fb1_wk2", "bench", 225, 1),
      set("fb1_wk2", "bench", 190, 3),
      set("fb1_wk2", "bench", 190, 3),
    ];
    expect(computePrefill(sessions, after, "fb1_wk2", "bench")).toEqual({});
  });
});

describe("the numbers and the setup note come from one session", () => {
  it("suggests the source session's note alongside the source session's numbers", () => {
    const sessions: WorkoutSession[] = [
      done("old", "fb1", 0),
      done("recent", "fb3", 3),
      open("today", "fb1", 7),
    ];
    const sets: WorkoutSet[] = [
      set("old", "bench", 225, 5, { setupNote: "tng" }),
      set("recent", "bench", 185, 3, { setupNote: "pause 2ct" }),
    ];
    expect(computePrefill(sessions, sets, "today", "bench")).toEqual({
      weight: 185,
      reps: 3,
      rpe: undefined,
    });
    expect(suggestSetupNote(sessions, sets, "today", "bench")).toBe("pause 2ct");
  });

  it("suggests no note when the session the numbers came from had none", () => {
    // The exact disagreement this rule exists to stop: reaching further back
    // for a note would put "pause" next to numbers that were not paused.
    const sessions: WorkoutSession[] = [
      done("old", "fb1", 0),
      done("recent", "fb3", 3),
      open("today", "fb1", 7),
    ];
    const sets: WorkoutSet[] = [
      set("old", "bench", 225, 5, { setupNote: "pause" }),
      set("recent", "bench", 185, 3),
    ];
    expect(computePrefill(sessions, sets, "today", "bench")).toEqual({
      weight: 185,
      reps: 3,
      rpe: undefined,
    });
    expect(suggestSetupNote(sessions, sets, "today", "bench")).toBeUndefined();
  });

  it("falls back to the most recent note anywhere when there is no source at all", () => {
    // No workout open, which is how the cardio card asks.
    const sets: WorkoutSet[] = [set("whenever", "bike", 0, 1, { setupNote: "level 8" })];
    expect(suggestSetupNote([], sets, undefined, "bike")).toBe("level 8");
  });

  it("falls back to today's own note when the setup has never been logged before", () => {
    const sessions: WorkoutSession[] = [open("today", "fb1", 7)];
    const sets: WorkoutSet[] = [set("today", "bench", 225, 5, { setupNote: "tng" })];
    expect(suggestSetupNote(sessions, sets, "today", "bench")).toBe("tng");
  });
});

describe("what is not a source", () => {
  it("the first ever occurrence of an exercise prefills nothing", () => {
    const sessions: WorkoutSession[] = [done("prev", "fb1", 0), open("today", "fb1", 7)];
    const sets: WorkoutSet[] = [set("prev", "bench", 225, 5)];
    expect(findPrefillSource(sessions, sets, "today", "deadlift")).toBeUndefined();
    expect(computePrefill(sessions, sets, "today", "deadlift")).toEqual({});
  });

  it("the current session never sources itself", () => {
    const sessions: WorkoutSession[] = [open("today", "fb1", 7)];
    const sets: WorkoutSet[] = [set("today", "bench", 225, 5)];
    expect(computePrefill(sessions, sets, "today", "bench")).toEqual({});
  });

  it("an unfinished session is not last time", () => {
    // Two sessions open at once should not happen, but an abandoned one that
    // was never ended can sit in the array forever.
    const sessions: WorkoutSession[] = [
      done("finished", "fb1", 0),
      open("abandoned", "fb3", 3),
      open("today", "fb1", 7),
    ];
    const sets: WorkoutSet[] = [
      set("finished", "bench", 225, 5),
      set("abandoned", "bench", 999, 1),
    ];
    expect(computePrefill(sessions, sets, "today", "bench")).toEqual({
      weight: 225,
      reps: 5,
      rpe: undefined,
    });
  });

  it("a cardio session is neither a source nor a target, even carrying strength sets", () => {
    // parseBackup validates kind and splitSlotId independently, so a
    // hand-edited file can put lifting sets on a cardio session. It is the most
    // recent session here, which is what would win if the guard failed.
    const sessions: WorkoutSession[] = [
      done("prev", "fb1", 0),
      {
        id: "run",
        splitSlotId: "fb3",
        startedAt: t0 + 5 * DAY,
        endedAt: t0 + 5 * DAY + 1000,
        kind: "cardio",
        cardioExerciseId: "treadmill",
      },
      open("today", "fb1", 7),
    ];
    const sets: WorkoutSet[] = [
      set("prev", "bench", 225, 5),
      set("run", "bench", 5, 99, { setupNote: "tng" }),
    ];
    expect(findPrefillSource(sessions, sets, "today", "bench")?.session.id).toBe("prev");
    expect(computePrefill(sessions, sets, "today", "bench")).toEqual({
      weight: 225,
      reps: 5,
      rpe: undefined,
    });
    // And nothing is offered to the run itself.
    expect(computePrefill(sessions, sets, "run", "bench")).toEqual({});
    expect(findPrefillSource(sessions, sets, "run", "bench")).toBeUndefined();
  });

  it("an unknown session id prefills nothing", () => {
    expect(computePrefill([], [], "does-not-exist", "bench")).toEqual({});
  });
});

describe("malformed imported data", () => {
  it("sources from a session with no split slot, since the slot is no longer consulted", () => {
    // Only cardio is supposed to lack a slot. A strength session that lost one
    // in an import still holds real sets, and exercise matching cannot confuse
    // two slot-less sessions the way slot matching could.
    const sessions: WorkoutSession[] = [
      { id: "slotless", startedAt: t0, endedAt: t0 + 1000 },
      open("today", "fb1", 7),
    ];
    const sets: WorkoutSet[] = [set("slotless", "bench", 135, 10)];
    expect(computePrefill(sessions, sets, "today", "bench")).toEqual({
      weight: 135,
      reps: 10,
      rpe: undefined,
    });
  });

  it("treats a non-string setup note as no note instead of throwing", () => {
    const sessions: WorkoutSession[] = [done("prev", "fb1", 0), open("today", "fb1", 7)];
    const junk = set("prev", "bench", 225, 5) as unknown as Record<string, unknown>;
    junk.setupNote = 12;
    const sets = [junk as unknown as WorkoutSet];
    expect(computePrefill(sessions, sets, "today", "bench")).toEqual({
      weight: 225,
      reps: 5,
      rpe: undefined,
    });
    expect(suggestSetupNote(sessions, sets, "today", "bench")).toBeUndefined();
  });

  it("ignores sets pointing at sessions that no longer exist", () => {
    const sessions: WorkoutSession[] = [done("prev", "fb1", 0), open("today", "fb1", 7)];
    const sets: WorkoutSet[] = [set("deleted", "bench", 405, 1), set("prev", "bench", 225, 5)];
    expect(computePrefill(sessions, sets, "today", "bench")).toEqual({
      weight: 225,
      reps: 5,
      rpe: undefined,
    });
  });
});

describe("store: the grey note hint and the prefilled numbers stay in step", () => {
  const sessions: WorkoutSession[] = [
    done("old", "fb1", 0),
    done("recent", "fb3", 3),
    open("today", "fb1", 7),
  ];

  it("hints the note from the same session the numbers came from", () => {
    useStore.setState({
      exercises: [{ id: "bench", name: "Bench", type: "main" }],
      sessions,
      sets: [
        set("old", "bench", 225, 5, { setupNote: "tng" }),
        set("recent", "bench", 185, 3, { setupNote: "pause" }),
      ],
      activeSessionId: "today",
    });
    expect(useStore.getState().prefillFor("today", "bench")).toEqual({
      weight: 185,
      reps: 3,
      rpe: undefined,
    });
    expect(useStore.getState().lastSetupNoteFor("bench")).toBe("pause");
  });

  it("does not hint a note the source session did not have", () => {
    useStore.setState({
      exercises: [{ id: "bench", name: "Bench", type: "main" }],
      sessions,
      sets: [set("old", "bench", 225, 5, { setupNote: "tng" }), set("recent", "bench", 185, 3)],
      activeSessionId: "today",
    });
    expect(useStore.getState().lastSetupNoteFor("bench")).toBeUndefined();
  });

  it("still falls back to the exercise's own note when nothing has been logged", () => {
    useStore.setState({
      exercises: [{ id: "bench", name: "Bench", type: "main", setupNote: "seat 4, pins 12" }],
      sessions: [open("today", "fb1", 7)],
      sets: [],
      activeSessionId: "today",
    });
    expect(useStore.getState().lastSetupNoteFor("bench")).toBe("seat 4, pins 12");
  });
});
