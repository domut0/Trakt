import { describe, expect, it } from "vitest";
import { estimate1RM } from "../onerm";
import {
  headlineRecord,
  personalRecordsFor,
  sessionRecords,
  PR_EPSILON,
  WARMUP_EFFORT_FLOOR,
  type PersonalRecord,
  type PRKind,
} from "../pr";
import type { WorkoutSession, WorkoutSet } from "../store";

let nextId = 0;

/**
 * Builds a WorkoutSet with sane defaults. `loggedAt` climbs on every call so
 * sets are chronological in creation order unless a test overrides it.
 */
function mkSet(overrides: Partial<WorkoutSet> & Pick<WorkoutSet, "weight" | "reps">): WorkoutSet {
  nextId += 1;
  return {
    id: `set-${nextId}`,
    sessionId: "session-old",
    exerciseId: "bench",
    loggedAt: nextId * 60_000,
    ...overrides,
  };
}

function mkSession(overrides: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: "session-today",
    splitSlotId: "push",
    startedAt: 1_000_000,
    ...overrides,
  };
}

function kinds(records: readonly PersonalRecord[]): PRKind[] {
  return records.map((r) => r.kind);
}

function e1rm(weight: number, reps: number): number {
  return estimate1RM(weight, reps).average;
}

describe("module constants", () => {
  it("compares with an epsilon small enough to be invisible and large enough to absorb noise", () => {
    expect(PR_EPSILON).toBeGreaterThan(0);
    expect(PR_EPSILON).toBeLessThan(0.001);
  });

  it("sets the warm-up floor below genuine back-off work", () => {
    expect(WARMUP_EFFORT_FLOOR).toBeGreaterThan(0);
    expect(WARMUP_EFFORT_FLOOR).toBeLessThan(1);
  });

  it("anchors the e1RM figures the rest of these tests are built on", () => {
    // Pinned so a change to onerm.ts cannot silently redefine what a record is.
    expect(e1rm(315, 3)).toBe(340);
    expect(e1rm(315, 5)).toBe(361);
  });
});

describe("personalRecordsFor: the first ever set", () => {
  it("celebrates nothing when there is no history at all", () => {
    // Everything is an all-time best on day one. Saying so is hollow praise.
    expect(personalRecordsFor(mkSet({ weight: 315, reps: 5 }), [])).toEqual([]);
  });

  it("celebrates nothing when the history is all of a different exercise", () => {
    const history = [mkSet({ exerciseId: "squat", weight: 405, reps: 5 })];
    expect(
      personalRecordsFor(mkSet({ exerciseId: "bench", weight: 225, reps: 5 }), history),
    ).toEqual([]);
  });

  it("starts reporting records on the exercise's second outing", () => {
    const history = [mkSet({ weight: 225, reps: 5 })];
    const records = personalRecordsFor(mkSet({ weight: 235, reps: 5 }), history);
    expect(kinds(records)).toContain("weight");
  });
});

describe("personalRecordsFor: each kind on its own", () => {
  it("reports a weight record for the heaviest load ever moved", () => {
    // 235x3 is heavier than anything before it but a weaker set than 225x5, so
    // the weight axis is the only one that can fire.
    const history = [mkSet({ weight: 225, reps: 5 })];
    const records = personalRecordsFor(mkSet({ weight: 235, reps: 3 }), history);

    expect(kinds(records)).toEqual(["weight"]);
    expect(records[0]).toEqual({ kind: "weight", value: 235, previous: 225 });
  });

  it("reports a rep record against every prior set at that weight or above", () => {
    // The 315x3 sits above 225, so it is inside the comparison pool: this is a
    // record over "8 reps", not merely over the other sets that were also 225.
    const history = [mkSet({ weight: 315, reps: 3 }), mkSet({ weight: 225, reps: 8 })];
    const records = personalRecordsFor(mkSet({ weight: 225, reps: 9 }), history);

    expect(kinds(records)).toEqual(["reps"]);
    expect(records[0]).toEqual({ kind: "reps", value: 9, previous: 8 });
  });

  it("reports an e1RM record when a high-rep set blocks the rep axis", () => {
    // 315x20 is beyond RELIABLE_REP_LIMIT, so it holds the rep record at 315 but
    // contributes nothing to the e1RM bar. 315x5 beats the honest 315x3 estimate.
    const history = [mkSet({ weight: 315, reps: 20 }), mkSet({ weight: 315, reps: 3 })];
    const records = personalRecordsFor(mkSet({ weight: 315, reps: 5 }), history);

    expect(kinds(records)).toEqual(["e1rm"]);
    expect(records[0]).toEqual({ kind: "e1rm", value: e1rm(315, 5), previous: e1rm(315, 3) });
  });
});

describe("personalRecordsFor: several kinds at once", () => {
  it("reports both the e1RM and the rep record for 315x5 over 315x3, ranked", () => {
    const history = [mkSet({ weight: 315, reps: 3 }), mkSet({ weight: 275, reps: 8 })];
    const records = personalRecordsFor(mkSet({ weight: 315, reps: 5 }), history);

    // Ranked, so a caller with room for one badge can take the first.
    expect(kinds(records)).toEqual(["e1rm", "reps"]);
    expect(records[0].value).toBe(e1rm(315, 5));
    expect(records[1]).toEqual({ kind: "reps", value: 5, previous: 3 });
  });

  it("pairs the weight and e1RM records when a new top weight is set", () => {
    const history = [mkSet({ weight: 315, reps: 3 })];
    const records = personalRecordsFor(mkSet({ weight: 325, reps: 3 }), history);

    expect(kinds(records)).toEqual(["weight", "e1rm"]);
  });

  it("never pairs a weight record with a rep record", () => {
    // A weight record means no prior set was ever this heavy, which leaves the
    // "at this weight or above" pool empty and the rep claim meaningless. The
    // two are mutually exclusive by construction, so one set can light up at
    // most two of the three axes.
    const history = [
      mkSet({ weight: 135, reps: 12 }),
      mkSet({ weight: 225, reps: 8 }),
      mkSet({ weight: 315, reps: 3 }),
    ];
    for (const reps of [1, 3, 5, 8, 15, 30]) {
      const found = kinds(personalRecordsFor(mkSet({ weight: 405, reps }), history));
      expect(found, `reps ${reps}`).toContain("weight");
      expect(found, `reps ${reps}`).not.toContain("reps");
    }
  });
});

describe("personalRecordsFor: ties", () => {
  it("does not call an exact repeat of a previous set a record", () => {
    const history = [mkSet({ weight: 315, reps: 3 })];
    expect(personalRecordsFor(mkSet({ weight: 315, reps: 3 }), history)).toEqual([]);
  });

  it("does not call equalling the top weight a weight record", () => {
    const history = [mkSet({ weight: 315, reps: 3 })];
    const records = personalRecordsFor(mkSet({ weight: 315, reps: 2 }), history);
    expect(kinds(records)).not.toContain("weight");
  });

  it("does not call equalling the rep count a rep record", () => {
    const history = [mkSet({ weight: 315, reps: 5 }), mkSet({ weight: 225, reps: 10 })];
    const records = personalRecordsFor(mkSet({ weight: 225, reps: 10 }), history);
    expect(kinds(records)).not.toContain("reps");
  });
});

describe("personalRecordsFor: float precision", () => {
  it("ignores a weight difference that is only binary noise", () => {
    const history = [mkSet({ weight: 100, reps: 5 })];
    expect(personalRecordsFor(mkSet({ weight: 100.0000001, reps: 5 }), history)).toEqual([]);
  });

  it("still reports a real half-plate increase", () => {
    const history = [mkSet({ weight: 100, reps: 5 })];
    const records = personalRecordsFor(mkSet({ weight: 102.5, reps: 5 }), history);
    expect(kinds(records)).toContain("weight");
    expect(records[0].value).toBe(102.5);
  });

  it("survives fractional kilo loads without inventing records", () => {
    const history = [mkSet({ weight: 62.5, reps: 5 }), mkSet({ weight: 60, reps: 8 })];
    expect(personalRecordsFor(mkSet({ weight: 0.1 + 0.2 + 62.2, reps: 5 }), history)).toEqual([]);
  });
});

describe("personalRecordsFor: malformed data", () => {
  const garbage = [
    null,
    undefined,
    "225x5",
    42,
    [],
    {},
    { id: "a", sessionId: "s", exerciseId: "bench", weight: Number.NaN, reps: 5, loggedAt: 1 },
    { id: "b", sessionId: "s", exerciseId: "bench", weight: Number.POSITIVE_INFINITY, reps: 5 },
    { id: "c", sessionId: "s", exerciseId: "bench", weight: -225, reps: 5, loggedAt: 1 },
    { id: "d", sessionId: "s", exerciseId: "bench", weight: 225, reps: 0, loggedAt: 1 },
    { id: "", sessionId: "s", exerciseId: "bench", weight: 225, reps: 5, loggedAt: 1 },
    { sessionId: "s", exerciseId: "bench", weight: 225, reps: 5, loggedAt: 1 },
    { id: "f", sessionId: "s", weight: 225, reps: 5, loggedAt: 1 },
  ] as unknown as WorkoutSet[];

  it("degrades a fully corrupt history to no record rather than throwing", () => {
    expect(() => personalRecordsFor(mkSet({ weight: 315, reps: 5 }), garbage)).not.toThrow();
    expect(personalRecordsFor(mkSet({ weight: 315, reps: 5 }), garbage)).toEqual([]);
  });

  it("still finds the record hiding among the corrupt entries", () => {
    const history = [...garbage, mkSet({ weight: 225, reps: 5 })];
    const records = personalRecordsFor(mkSet({ weight: 315, reps: 5 }), history);
    expect(records).toEqual([
      { kind: "weight", value: 315, previous: 225 },
      { kind: "e1rm", value: e1rm(315, 5), previous: e1rm(225, 5) },
    ]);
  });

  it("returns nothing for a corrupt candidate set", () => {
    const history = [mkSet({ weight: 225, reps: 5 })];
    for (const bad of garbage) {
      expect(() => personalRecordsFor(bad, history)).not.toThrow();
      expect(personalRecordsFor(bad, history)).toEqual([]);
    }
  });

  it("tolerates a non-array history", () => {
    const set = mkSet({ weight: 315, reps: 5 });
    expect(personalRecordsFor(set, undefined as unknown as WorkoutSet[])).toEqual([]);
    expect(personalRecordsFor(set, null as unknown as WorkoutSet[])).toEqual([]);
  });
});

describe("personalRecordsFor: dropsets and partials", () => {
  it("refuses to award a record to a dropset or partial set", () => {
    const history = [mkSet({ weight: 225, reps: 5 })];
    const candidate = mkSet({ weight: 315, reps: 12, isDropsetOrPartial: true });
    expect(personalRecordsFor(candidate, history)).toEqual([]);
  });

  it("does not let a partial set block an honest rep record", () => {
    // 315x20 of partials must not stand as "the rep record at 315" forever.
    const history = [
      mkSet({ weight: 315, reps: 20, isDropsetOrPartial: true }),
      mkSet({ weight: 315, reps: 3 }),
    ];
    const records = personalRecordsFor(mkSet({ weight: 315, reps: 5 }), history);
    expect(kinds(records)).toEqual(["e1rm", "reps"]);
    expect(records[1]).toEqual({ kind: "reps", value: 5, previous: 3 });
  });
});

describe("personalRecordsFor: warm-ups", () => {
  // The data model has no warm-up flag, so this is the effort floor standing in
  // for one. These are a low-rep lifter's sets: nothing in history reaches 10
  // reps, which would otherwise make an empty-bar warm-up a "rep record".
  const lowRepHistory = [
    mkSet({ weight: 315, reps: 3 }),
    mkSet({ weight: 225, reps: 5 }),
    mkSet({ weight: 135, reps: 5 }),
  ];

  it("does not celebrate 45x10 on the way up to a 315 top set", () => {
    expect(personalRecordsFor(mkSet({ weight: 45, reps: 10 }), lowRepHistory)).toEqual([]);
  });

  it("does not celebrate a 135x10 second warm-up either", () => {
    // 180 estimated against a 340 best is 0.53, under the floor, even though 10
    // reps beats anything in this lifter's history at 135 or above.
    expect(personalRecordsFor(mkSet({ weight: 135, reps: 10 }), lowRepHistory)).toEqual([]);
  });

  it("still celebrates a genuine rep-out at a working weight", () => {
    // 225x12 clears the floor comfortably: this is real work, not a warm-up.
    const records = personalRecordsFor(mkSet({ weight: 225, reps: 12 }), lowRepHistory);
    expect(records).toEqual([{ kind: "reps", value: 12, previous: 5 }]);
  });

  it("still celebrates a 135x25 burnout, which the floor must not mistake for a warm-up", () => {
    const records = personalRecordsFor(mkSet({ weight: 135, reps: 25 }), lowRepHistory);
    expect(records).toEqual([{ kind: "reps", value: 25, previous: 5 }]);
  });

  it("never suppresses a weight record, which no warm-up can reach anyway", () => {
    const records = personalRecordsFor(mkSet({ weight: 335, reps: 1 }), lowRepHistory);
    expect(kinds(records)).toContain("weight");
  });

  it("cannot tell a warm-up from a working set without the rest of the session", () => {
    // The honest limit of a context-free comparison, and the reason
    // sessionRecords exists. For a lifter whose best is 225x3, a 135x10 warm-up
    // scores 0.74 and clears the floor. Only knowing that 225 came afterwards
    // settles it, which is what sessionRecords does.
    const weakerHistory = [mkSet({ weight: 225, reps: 3 }), mkSet({ weight: 205, reps: 5 })];
    expect(kinds(personalRecordsFor(mkSet({ weight: 135, reps: 10 }), weakerHistory))).toEqual([
      "reps",
    ]);
  });
});

describe("sessionRecords: warm-ups", () => {
  const history = [mkSet({ weight: 225, reps: 3 }), mkSet({ weight: 205, reps: 5 })];

  it("ignores a set that a heavier set followed later in the same session", () => {
    // The exact rule the effort floor can only approximate: nobody warms up
    // after their top set.
    const session = mkSession();
    const sets = [
      mkSet({ sessionId: session.id, weight: 135, reps: 10, loggedAt: 100 }),
      mkSet({ sessionId: session.id, weight: 205, reps: 5, loggedAt: 200 }),
      mkSet({ sessionId: session.id, weight: 225, reps: 3, loggedAt: 300 }),
    ];
    expect(sessionRecords(session, sets, history)).toEqual([]);
  });

  it("celebrates the same set when nothing heavier follows it", () => {
    const session = mkSession();
    const sets = [
      mkSet({ sessionId: session.id, weight: 225, reps: 3, loggedAt: 100 }),
      mkSet({ sessionId: session.id, weight: 135, reps: 10, loggedAt: 200 }),
    ];
    const records = sessionRecords(session, sets, history);
    expect(records).toEqual([
      { kind: "reps", value: 10, previous: 5, exerciseId: "bench", setId: sets[1].id },
    ]);
  });

  it("does not let straight sets at one weight supersede each other", () => {
    const session = mkSession();
    const sets = [
      mkSet({ sessionId: session.id, weight: 225, reps: 4, loggedAt: 100 }),
      mkSet({ sessionId: session.id, weight: 225, reps: 4, loggedAt: 200 }),
    ];
    expect(kinds(sessionRecords(session, sets, history))).toContain("reps");
  });

  it("keeps a warm-up in the comparison pool even though it cannot win", () => {
    // The 135x12 warm-up is not a candidate, but it did happen, so the 135x11
    // back-off afterwards has to beat 12 reps and does not.
    const session = mkSession();
    const sets = [
      mkSet({ sessionId: session.id, weight: 135, reps: 12, loggedAt: 100 }),
      mkSet({ sessionId: session.id, weight: 225, reps: 3, loggedAt: 200 }),
      mkSet({ sessionId: session.id, weight: 135, reps: 11, loggedAt: 300 }),
    ];
    expect(kinds(sessionRecords(session, sets, history))).not.toContain("reps");
  });
});

describe("personalRecordsFor: the reliable rep limit", () => {
  it("refuses to claim an e1RM record from a set the app itself will not vouch for", () => {
    // 225x20 estimates far above the 315x3, but onerm.ts says the formulas drift
    // badly past 12 reps. The rep record is real; the 1RM claim is not.
    const history = [mkSet({ weight: 315, reps: 3 })];
    const records = personalRecordsFor(mkSet({ weight: 225, reps: 20 }), history);
    expect(kinds(records)).toEqual(["reps"]);
  });

  it("does not let a high-rep set inflate the bar for a later honest single", () => {
    const history = [mkSet({ weight: 225, reps: 20 }), mkSet({ weight: 315, reps: 3 })];
    const records = personalRecordsFor(mkSet({ weight: 315, reps: 4 }), history);
    expect(kinds(records)).toContain("e1rm");
    expect(records.find((r) => r.kind === "e1rm")?.previous).toBe(e1rm(315, 3));
  });
});

describe("personalRecordsFor: defensive filtering", () => {
  it("ignores history belonging to other exercises", () => {
    const history = [
      mkSet({ exerciseId: "squat", weight: 500, reps: 8 }),
      mkSet({ exerciseId: "bench", weight: 225, reps: 5 }),
    ];
    const records = personalRecordsFor(
      mkSet({ exerciseId: "bench", weight: 315, reps: 3 }),
      history,
    );
    expect(records[0]).toEqual({ kind: "weight", value: 315, previous: 225 });
  });

  it("does not let a set beat itself when the caller passes an unfiltered slice", () => {
    const candidate = mkSet({ weight: 315, reps: 5 });
    const history = [mkSet({ weight: 225, reps: 5 }), candidate];
    const records = personalRecordsFor(candidate, history);
    expect(kinds(records)).toEqual(["weight", "e1rm"]);
  });
});

describe("headlineRecord", () => {
  it("returns undefined when nothing was set", () => {
    expect(headlineRecord([])).toBeUndefined();
    expect(headlineRecord(undefined as unknown as PersonalRecord[])).toBeUndefined();
  });

  it("prefers weight, then e1RM, then reps, whatever order it is handed", () => {
    const weight: PersonalRecord = { kind: "weight", value: 315, previous: 305 };
    const strength: PersonalRecord = { kind: "e1rm", value: 361, previous: 340 };
    const reps: PersonalRecord = { kind: "reps", value: 5, previous: 3 };

    expect(headlineRecord([reps, strength, weight])?.kind).toBe("weight");
    expect(headlineRecord([reps, strength])?.kind).toBe("e1rm");
    expect(headlineRecord([reps])?.kind).toBe("reps");
  });

  it("takes the first record straight off personalRecordsFor", () => {
    const history = [mkSet({ weight: 315, reps: 3 })];
    const records = personalRecordsFor(mkSet({ weight: 315, reps: 5 }), history);
    expect(headlineRecord(records)).toBe(records[0]);
  });
});

describe("sessionRecords: guards", () => {
  it("returns nothing for a cardio session", () => {
    const session = mkSession({ kind: "cardio", splitSlotId: undefined });
    const sets = [mkSet({ sessionId: session.id, weight: 315, reps: 5 })];
    const history = [mkSet({ weight: 225, reps: 5 })];
    expect(sessionRecords(session, sets, history)).toEqual([]);
  });

  it("treats a session with no kind as strength, the way every pre-cardio record reads", () => {
    const session = mkSession();
    const sets = [mkSet({ sessionId: session.id, weight: 315, reps: 5 })];
    const history = [mkSet({ weight: 225, reps: 5 })];
    expect(kinds(sessionRecords(session, sets, history))).toContain("weight");
  });

  it("returns nothing for a missing or malformed session", () => {
    const sets = [mkSet({ sessionId: "session-today", weight: 315, reps: 5 })];
    const history = [mkSet({ weight: 225, reps: 5 })];
    expect(sessionRecords(undefined, sets, history)).toEqual([]);
    expect(sessionRecords({} as WorkoutSession, sets, history)).toEqual([]);
    expect(sessionRecords(null as unknown as WorkoutSession, sets, history)).toEqual([]);
  });

  it("returns nothing for an empty session", () => {
    expect(sessionRecords(mkSession(), [], [mkSet({ weight: 225, reps: 5 })])).toEqual([]);
  });

  it("tolerates non-array set arguments", () => {
    const bad = undefined as unknown as WorkoutSet[];
    expect(sessionRecords(mkSession(), bad, bad)).toEqual([]);
  });
});

describe("sessionRecords: first session of an exercise", () => {
  it("reports nothing at all, even though later sets beat earlier ones", () => {
    // Three ascending sets of an exercise never performed before. The session is
    // the baseline being established, not a run of three records.
    const session = mkSession();
    const sets = [
      mkSet({ sessionId: session.id, weight: 135, reps: 5 }),
      mkSet({ sessionId: session.id, weight: 155, reps: 8 }),
      mkSet({ sessionId: session.id, weight: 175, reps: 10 }),
    ];
    expect(sessionRecords(session, sets, [])).toEqual([]);
  });

  it("suppresses only the exercise that is new, not the whole session", () => {
    const session = mkSession();
    const sets = [
      mkSet({ sessionId: session.id, exerciseId: "bench", weight: 315, reps: 5 }),
      mkSet({ sessionId: session.id, exerciseId: "incline", weight: 135, reps: 10 }),
    ];
    const history = [mkSet({ exerciseId: "bench", weight: 225, reps: 5 })];

    const records = sessionRecords(session, sets, history);
    expect(records.map((r) => r.exerciseId)).toEqual(["bench", "bench"]);
  });
});

describe("sessionRecords: a record beating one set earlier the same session", () => {
  const previousBest = mkSet({ sessionId: "session-old", weight: 315, reps: 3 });

  it("counts the second one and reports only the session's best", () => {
    const session = mkSession();
    const four = mkSet({ sessionId: session.id, weight: 315, reps: 4 });
    const five = mkSet({ sessionId: session.id, weight: 315, reps: 5 });

    const records = sessionRecords(session, [four, five], [previousBest]);

    // One entry per axis, not one per qualifying set.
    expect(kinds(records)).toEqual(["e1rm", "reps"]);
    expect(records.every((r) => r.setId === five.id)).toBe(true);
    expect(records.find((r) => r.kind === "reps")).toEqual({
      kind: "reps",
      value: 5,
      // Measured from before the session: "up from 3 last week", not "up from
      // the 4 you did forty minutes ago".
      previous: 3,
      exerciseId: "bench",
      setId: five.id,
    });
    expect(records.find((r) => r.kind === "e1rm")?.previous).toBe(e1rm(315, 3));
  });

  it("credits the earliest set to reach a value, since ties do not displace", () => {
    const session = mkSession();
    const first = mkSet({ sessionId: session.id, weight: 315, reps: 5 });
    const second = mkSet({ sessionId: session.id, weight: 315, reps: 5 });

    const records = sessionRecords(session, [first, second], [previousBest]);
    expect(records.every((r) => r.setId === first.id)).toBe(true);
  });

  it("orders sets by loggedAt, not by array position", () => {
    const session = mkSession();
    const four = mkSet({ sessionId: session.id, weight: 315, reps: 4, loggedAt: 2_000 });
    const five = mkSet({ sessionId: session.id, weight: 315, reps: 5, loggedAt: 3_000 });

    const shuffled = sessionRecords(session, [five, four], [previousBest]);
    expect(shuffled.find((r) => r.kind === "reps")).toMatchObject({ value: 5, setId: five.id });
  });
});

describe("sessionRecords: where previous comes from", () => {
  it("falls back to the in-session value when the baseline says nothing about that axis", () => {
    // The baseline has only 135x10, so "most reps at 225 or above" has no
    // pre-session answer at all. The 225x3 earlier today is the honest thing to
    // say the 225x5 beat.
    const session = mkSession();
    const baseline = [mkSet({ weight: 135, reps: 10 })];
    const three = mkSet({ sessionId: session.id, weight: 225, reps: 3 });
    const five = mkSet({ sessionId: session.id, weight: 225, reps: 5 });

    const records = sessionRecords(session, [three, five], baseline);

    expect(kinds(records)).toEqual(["weight", "e1rm", "reps"]);
    expect(records.find((r) => r.kind === "weight")).toMatchObject({
      value: 225,
      previous: 135,
      setId: three.id,
    });
    expect(records.find((r) => r.kind === "e1rm")).toMatchObject({
      value: e1rm(225, 5),
      previous: e1rm(135, 10),
      setId: five.id,
    });
    expect(records.find((r) => r.kind === "reps")).toMatchObject({
      value: 5,
      previous: 3,
      setId: five.id,
    });
  });
});

describe("sessionRecords: which sets it looks at", () => {
  it("ignores sets belonging to other sessions", () => {
    const session = mkSession();
    const sets = [
      mkSet({ sessionId: session.id, weight: 315, reps: 3 }),
      mkSet({ sessionId: "someone-elses-session", weight: 405, reps: 5 }),
    ];
    const records = sessionRecords(session, sets, [mkSet({ weight: 225, reps: 5 })]);
    expect(records.find((r) => r.kind === "weight")?.value).toBe(315);
  });

  it("accepts the same unfiltered array for both sets and history", () => {
    // The store keeps one flat sets array. Handing it over twice must not let
    // today's sets become their own baseline.
    const session = mkSession();
    const older = mkSet({ weight: 225, reps: 5 });
    const today = mkSet({ sessionId: session.id, weight: 315, reps: 3 });
    const all = [older, today];

    expect(sessionRecords(session, all, all)).toEqual(sessionRecords(session, all, [older]));
    expect(sessionRecords(session, all, all).find((r) => r.kind === "weight")).toMatchObject({
      value: 315,
      previous: 225,
    });
  });

  it("skips dropsets and partials logged during the session", () => {
    const session = mkSession();
    const sets = [
      mkSet({ sessionId: session.id, weight: 405, reps: 12, isDropsetOrPartial: true }),
    ];
    expect(sessionRecords(session, sets, [mkSet({ weight: 225, reps: 5 })])).toEqual([]);
  });

  it("does not throw on a session full of corrupt sets", () => {
    const session = mkSession();
    const sets = [
      { id: "x", sessionId: session.id, exerciseId: "bench", weight: Number.NaN, reps: 5 },
      null,
    ] as unknown as WorkoutSet[];
    expect(() => sessionRecords(session, sets, [mkSet({ weight: 225, reps: 5 })])).not.toThrow();
    expect(sessionRecords(session, sets, [mkSet({ weight: 225, reps: 5 })])).toEqual([]);
  });
});

describe("sessionRecords: several exercises", () => {
  it("groups by exercise in order of first appearance and ranks within each", () => {
    // Bench is interleaved with a row, and its back-off 275x8 carries the rep
    // record: lighter than the top set, but nothing heavier follows it, so it is
    // work rather than a warm-up.
    const session = mkSession();
    const sets = [
      mkSet({ sessionId: session.id, exerciseId: "bench", weight: 315, reps: 5 }),
      mkSet({ sessionId: session.id, exerciseId: "row", weight: 225, reps: 10 }),
      mkSet({ sessionId: session.id, exerciseId: "bench", weight: 275, reps: 8 }),
    ];
    const history = [
      mkSet({ exerciseId: "bench", weight: 315, reps: 3 }),
      mkSet({ exerciseId: "row", weight: 225, reps: 8 }),
    ];

    const records = sessionRecords(session, sets, history);

    expect(records.map((r) => `${r.exerciseId}:${r.kind}`)).toEqual([
      "bench:e1rm",
      "bench:reps",
      "row:e1rm",
      "row:reps",
    ]);
    expect(records.find((r) => r.exerciseId === "bench" && r.kind === "reps")).toMatchObject({
      value: 8,
      previous: 3,
      setId: sets[2].id,
    });
    expect(records.find((r) => r.exerciseId === "row" && r.kind === "reps")).toMatchObject({
      value: 10,
      previous: 8,
    });
  });
});

describe("sessionRecords: a realistic progression", () => {
  it("tracks bench press across four sessions", () => {
    const history: WorkoutSet[] = [];

    // Week 1: first time benching. Nothing to beat.
    const week1 = mkSession({ id: "w1", startedAt: 1 });
    const week1Sets = [
      mkSet({ sessionId: "w1", weight: 185, reps: 5, loggedAt: 100 }),
      mkSet({ sessionId: "w1", weight: 205, reps: 5, loggedAt: 200 }),
      mkSet({ sessionId: "w1", weight: 225, reps: 3, loggedAt: 300 }),
    ];
    expect(sessionRecords(week1, week1Sets, history)).toEqual([]);
    history.push(...week1Sets);

    // Week 2: warm-ups plus an extra rep at the top weight. The 135x10 warm-up
    // must stay silent even though nothing in history reaches 10 reps.
    const week2 = mkSession({ id: "w2", startedAt: 2 });
    const week2Sets = [
      mkSet({ sessionId: "w2", weight: 135, reps: 10, loggedAt: 1100 }),
      mkSet({ sessionId: "w2", weight: 205, reps: 5, loggedAt: 1200 }),
      mkSet({ sessionId: "w2", weight: 225, reps: 4, loggedAt: 1300 }),
    ];
    const week2Records = sessionRecords(week2, week2Sets, history);
    expect(week2Records.map((r) => `${r.kind}:${r.value}`)).toEqual([
      `e1rm:${e1rm(225, 4)}`,
      "reps:4",
    ]);
    expect(week2Records.find((r) => r.kind === "reps")?.previous).toBe(3);
    history.push(...week2Sets);

    // Week 3: a new top single. Heaviest ever, but NOT an e1RM record: a single
    // is reported at the weight actually lifted rather than inflated, and 245
    // does not reach the 250.3 that week 2's 225x4 estimates. The axes are
    // separate precisely so this reads as the one honest record it is.
    const week3 = mkSession({ id: "w3", startedAt: 3 });
    const week3Sets = [
      mkSet({ sessionId: "w3", weight: 225, reps: 3, loggedAt: 2100 }),
      mkSet({ sessionId: "w3", weight: 245, reps: 1, loggedAt: 2200 }),
    ];
    const week3Records = sessionRecords(week3, week3Sets, history);
    expect(kinds(week3Records)).toEqual(["weight"]);
    expect(week3Records[0]).toMatchObject({ value: 245, previous: 225 });
    expect(e1rm(245, 1)).toBeLessThan(e1rm(225, 4));
    history.push(...week3Sets);

    // Week 4: a repeat of week 3's session, exactly. Nothing is beaten, so the
    // summary stays quiet rather than congratulating a maintained lift.
    const week4 = mkSession({ id: "w4", startedAt: 4 });
    const week4Sets = [
      mkSet({ sessionId: "w4", weight: 225, reps: 4, loggedAt: 3100 }),
      mkSet({ sessionId: "w4", weight: 245, reps: 1, loggedAt: 3200 }),
    ];
    expect(sessionRecords(week4, week4Sets, history)).toEqual([]);
  });
});
