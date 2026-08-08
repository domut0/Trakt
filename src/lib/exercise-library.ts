/**
 * Default exercise preset library seeded into IndexedDB on first run.
 * Extracted from store.ts to keep that module focused on state logic.
 */
import type { Exercise } from "./store";

export const seedExercises: Exercise[] = [
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
