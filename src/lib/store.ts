import { create } from "zustand";

export type ExerciseType = "main" | "accessory";

export interface Exercise {
  id: string;
  name: string;
  type: ExerciseType;
  setupNote?: string;
}

export interface SplitSlot {
  id: string;
  name: string;
  rotationOrder: number;
  lastLoggedAt?: number;
}

export interface WorkoutSession {
  id: string;
  splitSlotId: string;
  startedAt: number;
  endedAt?: number;
}

export interface WorkoutSet {
  id: string;
  sessionId: string;
  exerciseId: string;
  weight: number;
  reps: number;
  rpe?: number;
  isDropsetOrPartial?: boolean;
  timeBetweenSetsSeconds?: number;
  blockGroupId?: string;
  loggedAt: number;
}

interface State {
  unit: "lbs" | "kg";
  motivationEnabled: boolean;
  exercises: Exercise[];
  slots: SplitSlot[];
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  activeSessionId?: string;
  currentExerciseId?: string;
  currentBlock?: { blockGroupId: string; targetSets: number; loggedInBlock: number; weight: number; reps: number; rpe?: number };

  startWorkout: (slotName: string) => string;
  endWorkout: () => void;
  setCurrentExercise: (exerciseId: string) => void;
  addExercise: (name: string, type: ExerciseType) => Exercise;
  logSet: (input: { exerciseId: string; weight: number; reps: number; rpe?: number; isDropsetOrPartial?: boolean; targetSets: number }) => void;
  logNextInBlock: (overrides?: { reps?: number }) => void;
  deleteSet: (setId: string) => void;
  updateSet: (setId: string, patch: Partial<WorkoutSet>) => void;
  toggleMotivation: () => void;
  setUnit: (u: "lbs" | "kg") => void;
  reorderSlots: (fromId: string, toId: string) => void;
  predictedNextSlotName: () => string | undefined;
  suggestedNextExerciseFor: (sessionId: string) => { exerciseId: string; weight?: number; reps?: number; rpe?: number } | undefined;
  prefillFor: (sessionId: string, exerciseId: string) => { weight?: number; reps?: number; rpe?: number };
}

const uid = () => Math.random().toString(36).slice(2, 10);

// Seed data — a couple of realistic sessions so the UI has something to render.
const now = Date.now();
const day = 86400000;

const seedExercises: Exercise[] = [
  { id: "e_bench", name: "Bench Press", type: "main" },
  { id: "e_squat", name: "Back Squat", type: "main" },
  { id: "e_dead", name: "Deadlift", type: "main" },
  { id: "e_flap", name: "Keenan Flaps", type: "accessory", setupNote: "seat: 4, pins: 12" },
  { id: "e_push", name: "Tricep Pushdown", type: "accessory" },
  { id: "e_curl", name: "Incline DB Curl", type: "accessory" },
  { id: "e_row", name: "Chest-Supported Row", type: "accessory" },

  // Chest
  { id: "e_incline_bench", name: "Incline Bench Press", type: "main" },
  { id: "e_decline_bench", name: "Decline Bench Press", type: "main" },
  { id: "e_close_grip_bench", name: "Close-Grip Bench Press", type: "main" },
  { id: "e_paused_bench", name: "Paused Bench Press", type: "main" },
  { id: "e_db_bench", name: "Dumbbell Bench Press", type: "accessory" },
  { id: "e_incline_db_press", name: "Incline Dumbbell Press", type: "accessory" },
  { id: "e_decline_db_press", name: "Decline Dumbbell Press", type: "accessory" },
  { id: "e_db_fly", name: "Dumbbell Fly", type: "accessory" },
  { id: "e_incline_db_fly", name: "Incline Dumbbell Fly", type: "accessory" },
  { id: "e_cable_fly", name: "Cable Fly", type: "accessory" },
  { id: "e_low_high_cable_fly", name: "Low-to-High Cable Fly", type: "accessory" },
  { id: "e_pec_deck", name: "Pec Deck", type: "accessory" },
  { id: "e_machine_chest_press", name: "Machine Chest Press", type: "accessory" },
  { id: "e_pushup", name: "Push-Up", type: "accessory" },
  { id: "e_chest_dip", name: "Chest Dip", type: "accessory" },
  { id: "e_landmine_press", name: "Landmine Press", type: "accessory" },
  { id: "e_smith_bench", name: "Smith Machine Bench Press", type: "accessory" },
  { id: "e_db_pullover", name: "Dumbbell Pullover", type: "accessory" },

  // Back
  { id: "e_rdl", name: "Romanian Deadlift", type: "main" },
  { id: "e_sumo_dead", name: "Sumo Deadlift", type: "main" },
  { id: "e_deficit_dead", name: "Deficit Deadlift", type: "main" },
  { id: "e_trap_bar_dead", name: "Trap Bar Deadlift", type: "main" },
  { id: "e_barbell_row", name: "Barbell Row", type: "accessory" },
  { id: "e_pendlay_row", name: "Pendlay Row", type: "accessory" },
  { id: "e_tbar_row", name: "T-Bar Row", type: "accessory" },
  { id: "e_seated_cable_row", name: "Seated Cable Row", type: "accessory" },
  { id: "e_lat_pulldown", name: "Lat Pulldown", type: "accessory" },
  { id: "e_wide_lat_pulldown", name: "Wide-Grip Lat Pulldown", type: "accessory" },
  { id: "e_close_lat_pulldown", name: "Close-Grip Lat Pulldown", type: "accessory" },
  { id: "e_single_db_row", name: "Single-Arm Dumbbell Row", type: "accessory" },
  { id: "e_pullup", name: "Pull-Up", type: "accessory" },
  { id: "e_chinup", name: "Chin-Up", type: "accessory" },
  { id: "e_straight_arm_pulldown", name: "Straight-Arm Pulldown", type: "accessory" },
  { id: "e_reverse_hyper", name: "Reverse Hyperextension", type: "accessory" },
  { id: "e_back_extension", name: "Back Extension", type: "accessory" },
  { id: "e_barbell_shrug", name: "Barbell Shrug", type: "accessory" },
  { id: "e_db_shrug", name: "Dumbbell Shrug", type: "accessory" },
  { id: "e_smith_row", name: "Smith Machine Row", type: "accessory" },

  // Shoulders
  { id: "e_ohp", name: "Overhead Press", type: "main" },
  { id: "e_push_press", name: "Push Press", type: "accessory" },
  { id: "e_seated_db_press", name: "Seated Dumbbell Shoulder Press", type: "accessory" },
  { id: "e_arnold_press", name: "Arnold Press", type: "accessory" },
  { id: "e_db_lateral_raise", name: "Dumbbell Lateral Raise", type: "accessory" },
  { id: "e_cable_lateral_raise", name: "Cable Lateral Raise", type: "accessory" },
  { id: "e_db_front_raise", name: "Dumbbell Front Raise", type: "accessory" },
  { id: "e_db_rear_delt_fly", name: "Dumbbell Rear Delt Fly", type: "accessory" },
  { id: "e_reverse_pec_deck", name: "Reverse Pec Deck", type: "accessory" },
  { id: "e_face_pull", name: "Face Pull", type: "accessory" },
  { id: "e_machine_shoulder_press", name: "Machine Shoulder Press", type: "accessory" },
  { id: "e_upright_row", name: "Upright Row", type: "accessory" },

  // Quads
  { id: "e_front_squat", name: "Front Squat", type: "main" },
  { id: "e_box_squat", name: "Box Squat", type: "main" },
  { id: "e_leg_press", name: "Leg Press", type: "accessory" },
  { id: "e_hack_squat", name: "Hack Squat", type: "accessory" },
  { id: "e_leg_extension", name: "Leg Extension", type: "accessory" },
  { id: "e_bulgarian_split_squat", name: "Bulgarian Split Squat", type: "accessory" },
  { id: "e_walking_lunge", name: "Walking Lunge", type: "accessory" },
  { id: "e_goblet_squat", name: "Goblet Squat", type: "accessory" },
  { id: "e_step_up", name: "Step-Up", type: "accessory" },
  { id: "e_safety_bar_squat", name: "Safety Bar Squat", type: "accessory" },
  { id: "e_smith_squat", name: "Smith Machine Squat", type: "accessory" },

  // Hamstrings / Glutes
  { id: "e_stiff_leg_dead", name: "Stiff-Leg Deadlift", type: "accessory" },
  { id: "e_lying_leg_curl", name: "Lying Leg Curl", type: "accessory" },
  { id: "e_seated_leg_curl", name: "Seated Leg Curl", type: "accessory" },
  { id: "e_glute_ham_raise", name: "Glute Ham Raise", type: "accessory" },
  { id: "e_hip_thrust", name: "Hip Thrust", type: "accessory" },
  { id: "e_cable_pull_through", name: "Cable Pull-Through", type: "accessory" },
  { id: "e_good_morning", name: "Good Morning", type: "accessory" },
  { id: "e_cable_glute_kickback", name: "Cable Glute Kickback", type: "accessory" },
  { id: "e_nordic_curl", name: "Nordic Curl", type: "accessory" },
  { id: "e_hip_abduction_machine", name: "Hip Abduction Machine", type: "accessory" },
  { id: "e_hip_adduction_machine", name: "Hip Adduction Machine", type: "accessory" },

  // Biceps
  { id: "e_barbell_curl", name: "Barbell Curl", type: "accessory" },
  { id: "e_ezbar_curl", name: "EZ-Bar Curl", type: "accessory" },
  { id: "e_db_curl", name: "Standing Dumbbell Curl", type: "accessory" },
  { id: "e_hammer_curl", name: "Hammer Curl", type: "accessory" },
  { id: "e_preacher_curl", name: "Preacher Curl", type: "accessory" },
  { id: "e_cable_curl", name: "Cable Curl", type: "accessory" },
  { id: "e_concentration_curl", name: "Concentration Curl", type: "accessory" },
  { id: "e_spider_curl", name: "Spider Curl", type: "accessory" },
  { id: "e_zottman_curl", name: "Zottman Curl", type: "accessory" },

  // Triceps
  { id: "e_skull_crusher", name: "Skull Crusher", type: "accessory" },
  { id: "e_overhead_tricep_ext", name: "Overhead Tricep Extension", type: "accessory" },
  { id: "e_cable_overhead_tricep_ext", name: "Cable Overhead Tricep Extension", type: "accessory" },
  { id: "e_tricep_dip", name: "Tricep Dip", type: "accessory" },
  { id: "e_tricep_kickback", name: "Tricep Kickback", type: "accessory" },
  { id: "e_jm_press", name: "JM Press", type: "accessory" },
  { id: "e_diamond_pushup", name: "Diamond Push-Up", type: "accessory" },

  // Calves
  { id: "e_standing_calf_raise", name: "Standing Calf Raise", type: "accessory" },
  { id: "e_seated_calf_raise", name: "Seated Calf Raise", type: "accessory" },
  { id: "e_leg_press_calf_raise", name: "Leg Press Calf Raise", type: "accessory" },

  // Core
  { id: "e_plank", name: "Plank", type: "accessory" },
  { id: "e_side_plank", name: "Side Plank", type: "accessory" },
  { id: "e_hanging_leg_raise", name: "Hanging Leg Raise", type: "accessory" },
  { id: "e_cable_crunch", name: "Cable Crunch", type: "accessory" },
  { id: "e_ab_wheel_rollout", name: "Ab Wheel Rollout", type: "accessory" },
  { id: "e_russian_twist", name: "Russian Twist", type: "accessory" },
  { id: "e_weighted_situp", name: "Weighted Sit-Up", type: "accessory" },
  { id: "e_machine_crunch", name: "Machine Crunch", type: "accessory" },
  { id: "e_cable_woodchopper", name: "Cable Woodchopper", type: "accessory" },
  { id: "e_bicycle_crunch", name: "Bicycle Crunch", type: "accessory" },
  { id: "e_v_up", name: "V-Up", type: "accessory" },
  { id: "e_dead_bug", name: "Dead Bug", type: "accessory" },
  { id: "e_pallof_press", name: "Pallof Press", type: "accessory" },

  // Forearms / Traps
  { id: "e_wrist_curl", name: "Wrist Curl", type: "accessory" },
  { id: "e_reverse_wrist_curl", name: "Reverse Wrist Curl", type: "accessory" },
  { id: "e_farmers_carry", name: "Farmer's Carry", type: "accessory" },
  { id: "e_reverse_curl", name: "Reverse Curl", type: "accessory" },

  // Machine variety
  { id: "e_assisted_pullup", name: "Assisted Pull-Up Machine", type: "accessory" },
  { id: "e_assisted_dip", name: "Assisted Dip Machine", type: "accessory" },
];

const seedSlots: SplitSlot[] = [
  { id: "s_hb", name: "Heavy Bench", rotationOrder: 0, lastLoggedAt: now - 3 * day },
  { id: "s_sq", name: "Squat", rotationOrder: 1, lastLoggedAt: now - 2 * day },
  { id: "s_vb", name: "Volume Bench", rotationOrder: 2, lastLoggedAt: now - day },
  { id: "s_arms", name: "Arms", rotationOrder: 3, lastLoggedAt: now - 5 * day },
];

const seedSessions: WorkoutSession[] = [
  { id: "sess_1", splitSlotId: "s_hb", startedAt: now - 3 * day, endedAt: now - 3 * day + 3600_000 },
  { id: "sess_2", splitSlotId: "s_sq", startedAt: now - 2 * day, endedAt: now - 2 * day + 3900_000 },
  { id: "sess_3", splitSlotId: "s_vb", startedAt: now - day, endedAt: now - day + 3400_000 },
];

const b1 = uid(), b2 = uid(), b3 = uid(), b4 = uid(), b5 = uid();
const seedSets: WorkoutSet[] = [
  // Heavy Bench 3 days ago
  { id: uid(), sessionId: "sess_1", exerciseId: "e_bench", weight: 225, reps: 3, rpe: 7, blockGroupId: b1, loggedAt: now - 3 * day + 600_000 },
  { id: uid(), sessionId: "sess_1", exerciseId: "e_bench", weight: 190, reps: 5, rpe: 6, blockGroupId: b2, timeBetweenSetsSeconds: 240, loggedAt: now - 3 * day + 900_000 },
  { id: uid(), sessionId: "sess_1", exerciseId: "e_bench", weight: 190, reps: 5, rpe: 7, blockGroupId: b2, timeBetweenSetsSeconds: 220, loggedAt: now - 3 * day + 1130_000 },
  { id: uid(), sessionId: "sess_1", exerciseId: "e_bench", weight: 190, reps: 5, rpe: 8, blockGroupId: b2, timeBetweenSetsSeconds: 235, loggedAt: now - 3 * day + 1370_000 },
  { id: uid(), sessionId: "sess_1", exerciseId: "e_bench", weight: 190, reps: 4, rpe: 9, blockGroupId: b2, timeBetweenSetsSeconds: 250, loggedAt: now - 3 * day + 1625_000 },
  { id: uid(), sessionId: "sess_1", exerciseId: "e_flap", weight: 57.5, reps: 6, rpe: 10, blockGroupId: b3, timeBetweenSetsSeconds: 300, loggedAt: now - 3 * day + 2000_000 },
  { id: uid(), sessionId: "sess_1", exerciseId: "e_flap", weight: 57.5, reps: 6, rpe: 10, blockGroupId: b3, timeBetweenSetsSeconds: 280, loggedAt: now - 3 * day + 2290_000 },
  { id: uid(), sessionId: "sess_1", exerciseId: "e_push", weight: 60, reps: 12, rpe: 9, blockGroupId: b4, timeBetweenSetsSeconds: 200, loggedAt: now - 3 * day + 2600_000 },
  { id: uid(), sessionId: "sess_1", exerciseId: "e_push", weight: 60, reps: 10, rpe: 10, blockGroupId: b4, timeBetweenSetsSeconds: 210, loggedAt: now - 3 * day + 2820_000 },
  // Squat 2 days ago
  { id: uid(), sessionId: "sess_2", exerciseId: "e_squat", weight: 275, reps: 3, rpe: 8, blockGroupId: uid(), loggedAt: now - 2 * day + 600_000 },
  { id: uid(), sessionId: "sess_2", exerciseId: "e_squat", weight: 245, reps: 5, rpe: 7, blockGroupId: b5, timeBetweenSetsSeconds: 260, loggedAt: now - 2 * day + 900_000 },
  { id: uid(), sessionId: "sess_2", exerciseId: "e_squat", weight: 245, reps: 5, rpe: 8, blockGroupId: b5, timeBetweenSetsSeconds: 245, loggedAt: now - 2 * day + 1160_000 },
  { id: uid(), sessionId: "sess_2", exerciseId: "e_squat", weight: 245, reps: 5, rpe: 9, blockGroupId: b5, timeBetweenSetsSeconds: 255, loggedAt: now - 2 * day + 1415_000 },
  // Volume Bench yesterday
  { id: uid(), sessionId: "sess_3", exerciseId: "e_bench", weight: 175, reps: 6, rpe: 7, blockGroupId: uid(), loggedAt: now - day + 600_000 },
  { id: uid(), sessionId: "sess_3", exerciseId: "e_bench", weight: 175, reps: 6, rpe: 8, blockGroupId: uid(), timeBetweenSetsSeconds: 200, loggedAt: now - day + 800_000 },
  { id: uid(), sessionId: "sess_3", exerciseId: "e_row", weight: 90, reps: 10, rpe: 8, blockGroupId: uid(), timeBetweenSetsSeconds: 190, loggedAt: now - day + 1100_000 },
  { id: uid(), sessionId: "sess_3", exerciseId: "e_row", weight: 90, reps: 10, rpe: 9, blockGroupId: uid(), timeBetweenSetsSeconds: 200, loggedAt: now - day + 1300_000 },
];

export const useStore = create<State>((set, get) => ({
  unit: "lbs",
  motivationEnabled: true,
  exercises: seedExercises,
  slots: seedSlots,
  sessions: seedSessions,
  sets: seedSets,
  activeSessionId: undefined,
  currentExerciseId: undefined,
  currentBlock: undefined,

  predictedNextSlotName: () => {
    const slots = [...get().slots].sort((a, b) => a.rotationOrder - b.rotationOrder);
    if (slots.length === 0) return undefined;
    const lastLogged = slots
      .filter((s) => s.lastLoggedAt)
      .sort((a, b) => (b.lastLoggedAt ?? 0) - (a.lastLoggedAt ?? 0))[0];
    if (!lastLogged) return slots[0].name;
    const idx = slots.findIndex((s) => s.id === lastLogged.id);
    return slots[(idx + 1) % slots.length].name;
  },

  startWorkout: (slotName) => {
    const trimmed = slotName.trim();
    const key = trimmed.toLowerCase();
    let slot = get().slots.find((s) => s.name.toLowerCase() === key);
    if (!slot) {
      const maxOrder = Math.max(-1, ...get().slots.map((s) => s.rotationOrder));
      slot = { id: uid(), name: trimmed, rotationOrder: maxOrder + 1 };
      set({ slots: [...get().slots, slot] });
    }
    const sessionId = uid();
    const session: WorkoutSession = { id: sessionId, splitSlotId: slot.id, startedAt: Date.now() };
    set({
      sessions: [...get().sessions, session],
      activeSessionId: sessionId,
      currentExerciseId: undefined,
      currentBlock: undefined,
    });
    return sessionId;
  },

  endWorkout: () => {
    const id = get().activeSessionId;
    if (!id) return;
    set({
      sessions: get().sessions.map((s) => (s.id === id ? { ...s, endedAt: Date.now() } : s)),
      slots: get().slots.map((sl) => {
        const sess = get().sessions.find((s) => s.id === id);
        return sess && sl.id === sess.splitSlotId ? { ...sl, lastLoggedAt: Date.now() } : sl;
      }),
      activeSessionId: undefined,
      currentExerciseId: undefined,
      currentBlock: undefined,
    });
  },

  setCurrentExercise: (exerciseId) => set({ currentExerciseId: exerciseId, currentBlock: undefined }),

  addExercise: (name, type) => {
    const ex: Exercise = { id: uid(), name: name.trim(), type };
    set({ exercises: [...get().exercises, ex] });
    return ex;
  },

  logSet: ({ exerciseId, weight, reps, rpe, isDropsetOrPartial, targetSets }) => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    const blockGroupId = uid();
    const setsInSession = get().sets.filter((s) => s.sessionId === sessionId);
    const lastLogged = setsInSession.sort((a, b) => b.loggedAt - a.loggedAt)[0];
    const tbs = lastLogged ? Math.round((Date.now() - lastLogged.loggedAt) / 1000) : undefined;
    const newSet: WorkoutSet = {
      id: uid(),
      sessionId,
      exerciseId,
      weight,
      reps,
      rpe,
      isDropsetOrPartial,
      timeBetweenSetsSeconds: tbs,
      blockGroupId,
      loggedAt: Date.now(),
    };
    set({
      sets: [...get().sets, newSet],
      currentExerciseId: exerciseId,
      currentBlock: targetSets > 1 ? { blockGroupId, targetSets, loggedInBlock: 1, weight, reps, rpe } : undefined,
    });
  },

  logNextInBlock: (overrides) => {
    const { activeSessionId, currentBlock, sets } = get();
    if (!activeSessionId || !currentBlock) return;
    const lastLogged = [...sets].filter((s) => s.sessionId === activeSessionId).sort((a, b) => b.loggedAt - a.loggedAt)[0];
    const tbs = lastLogged ? Math.round((Date.now() - lastLogged.loggedAt) / 1000) : undefined;
    const exerciseId = lastLogged?.exerciseId ?? get().currentExerciseId!;
    const newSet: WorkoutSet = {
      id: uid(),
      sessionId: activeSessionId,
      exerciseId,
      weight: currentBlock.weight,
      reps: overrides?.reps ?? currentBlock.reps,
      rpe: currentBlock.rpe,
      timeBetweenSetsSeconds: tbs,
      blockGroupId: currentBlock.blockGroupId,
      loggedAt: Date.now(),
    };
    const nextCount = currentBlock.loggedInBlock + 1;
    set({
      sets: [...sets, newSet],
      currentBlock: { ...currentBlock, loggedInBlock: nextCount },
    });
  },

  deleteSet: (setId) => set({ sets: get().sets.filter((s) => s.id !== setId) }),

  updateSet: (setId, patch) =>
    set({ sets: get().sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) }),

  toggleMotivation: () => set({ motivationEnabled: !get().motivationEnabled }),
  setUnit: (u) => set({ unit: u }),

  reorderSlots: (fromId, toId) => {
    const slots = [...get().slots].sort((a, b) => a.rotationOrder - b.rotationOrder);
    const fromIdx = slots.findIndex((s) => s.id === fromId);
    const toIdx = slots.findIndex((s) => s.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = slots.splice(fromIdx, 1);
    slots.splice(toIdx, 0, moved);
    set({ slots: slots.map((s, i) => ({ ...s, rotationOrder: i })) });
  },

  suggestedNextExerciseFor: (sessionId) => {
    const sess = get().sessions.find((s) => s.id === sessionId);
    if (!sess) return undefined;
    const doneExerciseIds = new Set(
      get().sets.filter((s) => s.sessionId === sessionId).map((s) => s.exerciseId),
    );
    // Last session of this slot (excluding current)
    const lastSess = get()
      .sessions.filter((s) => s.splitSlotId === sess.splitSlotId && s.id !== sessionId && s.endedAt)
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
    if (!lastSess) return undefined;
    const setsInLast = get().sets.filter((s) => s.sessionId === lastSess.id).sort((a, b) => a.loggedAt - b.loggedAt);
    const order: string[] = [];
    for (const s of setsInLast) if (!order.includes(s.exerciseId)) order.push(s.exerciseId);
    const next = order.find((id) => !doneExerciseIds.has(id));
    if (!next) return undefined;
    const firstSet = setsInLast.find((s) => s.exerciseId === next);
    return { exerciseId: next, weight: firstSet?.weight, reps: firstSet?.reps, rpe: firstSet?.rpe };
  },

  prefillFor: (sessionId, exerciseId) => {
    const sess = get().sessions.find((s) => s.id === sessionId);
    if (!sess) return {};
    const setsToday = get().sets.filter((s) => s.sessionId === sessionId && s.exerciseId === exerciseId);
    const distinctToday = new Set(setsToday.map((s) => `${s.weight}x${s.reps}`)).size;
    const lastSess = get()
      .sessions.filter((s) => s.splitSlotId === sess.splitSlotId && s.id !== sessionId && s.endedAt)
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
    if (!lastSess) return {};
    const lastSets = get()
      .sets.filter((s) => s.sessionId === lastSess.id && s.exerciseId === exerciseId)
      .sort((a, b) => a.loggedAt - b.loggedAt);
    const distinctBlocks: WorkoutSet[] = [];
    const seen = new Set<string>();
    for (const s of lastSets) {
      const k = `${s.weight}x${s.reps}`;
      if (!seen.has(k)) {
        seen.add(k);
        distinctBlocks.push(s);
      }
    }
    const target = distinctBlocks[distinctToday];
    if (!target) return {};
    return { weight: target.weight, reps: target.reps, rpe: target.rpe };
  },
}));

export function estimated1RM(weight: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weight;
  // Epley
  return Math.round(weight * (1 + reps / 30));
}
