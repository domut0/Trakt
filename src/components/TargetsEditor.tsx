import { useState, type KeyboardEvent } from "react";
import {
  DEFAULT_GOAL_MODE,
  directionFor,
  GOAL_MODES,
  TARGET_FIELDS,
  type GoalMode,
  type TargetDirection,
  type TargetField,
} from "../lib/targets";
import { useStore, type TargetProfile } from "../lib/store";

/**
 * Self-contained editor for the daily nutrition and step targets.
 *
 * ONE set of numbers. This used to be a profile manager with a seven-chip
 * weekday assignment strip and a progressive reveal to open it, which is a
 * scheduling chore wearing the clothes of a feature: a target you have to
 * maintain across seven days goes stale the first week you do not, and a stale
 * target is worse than none.
 *
 * `weekdayTargets` still exists in the store and still points every weekday at
 * this one profile, so the backup and sheet formats did not churn. Nothing in
 * the UI can make those seven entries disagree any more.
 */
export function TargetsEditor() {
  const targetProfiles = useStore((s) => s.targetProfiles);
  const updateTargetProfile = useStore((s) => s.updateTargetProfile);

  const profile = targetProfiles[0];
  if (!profile) return null;

  return (
    <div className="space-y-4">
      <ProfileCard profile={profile} onUpdate={(patch) => updateTargetProfile(profile.id, patch)} />
    </div>
  );
}

function ProfileCard({
  profile,
  onUpdate,
}: {
  profile: TargetProfile;
  onUpdate: (patch: Partial<Omit<TargetProfile, "id">>) => void;
}) {
  return (
    <div className="space-y-4 bg-wash p-4">
      <GoalModeControl profile={profile} onUpdate={onUpdate} />

      <div className="grid grid-cols-2 gap-3">
        <TargetFieldInput
          id={`target-${profile.id}-calories`}
          label="Calories"
          suffix="kcal"
          value={profile.calories}
          onChange={(val) => onUpdate({ calories: val })}
        />
        <TargetFieldInput
          id={`target-${profile.id}-steps`}
          label="Steps"
          value={profile.steps}
          onChange={(val) => onUpdate({ steps: val })}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <TargetFieldInput
          id={`target-${profile.id}-protein`}
          label="Protein"
          suffix="g"
          value={profile.protein}
          onChange={(val) => onUpdate({ protein: val })}
        />
        <TargetFieldInput
          id={`target-${profile.id}-carbs`}
          label="Carbs"
          suffix="g"
          value={profile.carbs}
          onChange={(val) => onUpdate({ carbs: val })}
        />
        <TargetFieldInput
          id={`target-${profile.id}-fat`}
          label="Fat"
          suffix="g"
          value={profile.fat}
          onChange={(val) => onUpdate({ fat: val })}
        />
      </div>
    </div>
  );
}

/** How each mode names itself. Present participles because the user is picking
 * a description of what they are doing, not an action to perform now. */
const GOAL_MODE_LABELS: Record<GoalMode, string> = {
  cut: "Cutting",
  maintain: "Maintaining",
  gain: "Gaining",
};

/** Field names as they read mid-sentence, with the number the verb has to
 * agree with. "protein" and "fat" are mass nouns and take "is"; the rest are
 * plural. Without this the generated line says "fat sit near target". */
const FIELD_NOUNS: Record<TargetField, { text: string; plural: boolean }> = {
  calories: { text: "calories", plural: true },
  protein: { text: "protein", plural: false },
  carbs: { text: "carbs", plural: true },
  fat: { text: "fat", plural: false },
  steps: { text: "steps", plural: true },
};

/**
 * One clause per direction, in both numbers. Plain language on purpose: the
 * user should never have to learn the words floor, ceiling and band.
 *
 * "budget" carries "stay under" on its own, so spelling that out cost a third
 * wrapped line on the cut, which is the mode with the most to say. "goal to
 * beat" keeps its second half because a bare "goal" is the ambiguity this whole
 * module exists to remove.
 */
const DIRECTION_CLAUSES: Record<TargetDirection, { one: string; many: string }> = {
  ceiling: { one: "is a budget", many: "are budgets" },
  floor: { one: "is a goal to beat", many: "are goals to beat" },
  band: { one: "sits near target", many: "sit near target" },
};

/** Clause order. Budgets first because on a cut that is the constraint the
 * user came here for; the rest follows in the same order in every mode, so
 * switching modes rewrites the line rather than reshuffling it. */
const CLAUSE_ORDER: readonly TargetDirection[] = ["ceiling", "floor", "band"];

function joinNouns(words: readonly string[]): string {
  if (words.length <= 2) return words.join(" and ");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * The plain-language consequence of a mode, one sentence per direction the
 * mode actually uses.
 *
 * DERIVED from `directionFor` rather than written out three times, so the
 * sentence cannot drift from the table that drives the rings and bars. If a
 * mode's directions change in targets.ts, this line changes with it and the
 * screen never explains a rule the app is not applying.
 */
function goalModeSummary(mode: GoalMode): string {
  const byDirection = new Map<TargetDirection, TargetField[]>();
  for (const field of TARGET_FIELDS) {
    const direction = directionFor(field, mode);
    const fields = byDirection.get(direction) ?? [];
    fields.push(field);
    byDirection.set(direction, fields);
  }

  return CLAUSE_ORDER.flatMap((direction) => {
    const fields = byDirection.get(direction);
    if (!fields || fields.length === 0) return [];
    const clause = DIRECTION_CLAUSES[direction];
    // A list of two or more always takes the plural verb; a lone subject keeps
    // its own number.
    const plural = fields.length > 1 || FIELD_NOUNS[fields[0]].plural;
    const nouns = joinNouns(fields.map((f) => FIELD_NOUNS[f].text));
    const sentence = `${nouns} ${plural ? clause.many : clause.one}.`;
    return [sentence.charAt(0).toUpperCase() + sentence.slice(1)];
  }).join(" ");
}

/**
 * The one dial that gives every field its direction.
 *
 * Deliberately ONE control rather than five per-field pickers. The user already
 * knows whether they are cutting, holding or gaining; nobody knows off-hand
 * whether fat should be a ceiling or a band on a bulk, and asking them five
 * times is exactly the configuration friction this app exists to avoid.
 * `directionFor` in targets.ts owns that expansion, and the summary line under
 * the control is generated from it so the user can see what they just chose.
 *
 * Reads through `DEFAULT_GOAL_MODE` and never writes on mount: a profile saved
 * before this control existed shows "Maintaining" and stays untouched in
 * storage until the user actually taps something.
 *
 * Follows the weekday strip above: a row of equal chips, current choice in
 * accent. It is single-select, so the semantics are a radio group with roving
 * tabindex and arrow keys, not the strip's plain buttons.
 */
function GoalModeControl({
  profile,
  onUpdate,
}: {
  profile: TargetProfile;
  onUpdate: (patch: Partial<Omit<TargetProfile, "id">>) => void;
}) {
  const mode = profile.goalMode ?? DEFAULT_GOAL_MODE;
  const summaryId = `goal-mode-summary-${profile.id}`;
  const profileName = profile.name.trim() || "this profile";

  /** Arrow keys move the selection, per the radio group pattern: focus and
   * checked state stay together, so there is no "focused but unselected" chip
   * a keyboard user has to press space on. */
  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    e.preventDefault();
    const nextIdx = (idx + step + GOAL_MODES.length) % GOAL_MODES.length;
    onUpdate({ goalMode: GOAL_MODES[nextIdx] });
    const next = e.currentTarget.parentElement?.children[nextIdx];
    if (next instanceof HTMLElement) next.focus();
  };

  return (
    <div>
      <div className="t-caption text-ink-2">Goal</div>
      <div
        role="radiogroup"
        aria-label={`Goal for ${profileName}`}
        aria-describedby={summaryId}
        className="mt-2 grid grid-cols-3 gap-2"
      >
        {GOAL_MODES.map((option, idx) => {
          const selected = option === mode;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              // Roving tabindex: one stop for the whole group, landing on the
              // current choice, so Tab does not have to walk three chips.
              tabIndex={selected ? 0 : -1}
              onClick={() => onUpdate({ goalMode: option })}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              className={
                "flex min-h-[44px] items-center justify-center px-2 text-center t-label font-medium transition-colors duration-150 " +
                (selected ? "bg-ink text-paper" : "text-ink-2")
              }
            >
              {GOAL_MODE_LABELS[option]}
            </button>
          );
        })}
      </div>
      <p id={summaryId} className="mt-2 t-label text-ink-2">
        {goalModeSummary(mode)}
      </p>
    </div>
  );
}

/**
 * One numeric target field.
 *
 * A blank field saves as `undefined`, never 0. `targetProgressFor` treats a
 * target of 0 as unset, so a stray zero would silently drop the row from
 * Today's progress list rather than showing a goal of nothing.
 *
 * The draft string is what makes that safe to type through. Without it the
 * committed number is the only source for the displayed value, so any keystroke
 * that does not parse to a positive number (a lone "-", a trailing ".") commits
 * undefined and is erased from under the cursor mid-typing.
 */
function TargetFieldInput({
  id,
  label,
  suffix,
  value,
  onChange,
}: {
  id: string;
  label: string;
  suffix?: string;
  value: number | undefined;
  onChange: (val: number | undefined) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value !== undefined ? String(value) : "");

  return (
    <div className="p-3">
      <label htmlFor={id} className="block t-caption text-ink-2">
        {label}
      </label>
      <div className="mt-1 flex items-baseline gap-1">
        <input
          id={id}
          inputMode="numeric"
          value={shown}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            const trimmed = raw.trim();
            const num = Number(trimmed);
            // Empty, unparseable and non-positive all mean "no target".
            // Number("") is 0, so the empty check has to come first.
            onChange(trimmed && Number.isFinite(num) && num > 0 ? num : undefined);
          }}
          onBlur={() => setDraft(null)}
          placeholder="No target"
          className="tnum min-h-[44px] w-full min-w-0 bg-transparent t-heading font-semibold outline-none placeholder:t-label placeholder:font-normal placeholder:text-ink-2"
        />
        {suffix && <span className="t-label text-ink-2">{suffix}</span>}
      </div>
    </div>
  );
}
