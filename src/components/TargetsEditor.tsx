import { useState } from "react";
import { isUniformWeek, WEEKDAY_LABELS } from "../lib/targets";
import { useStore, type TargetProfile } from "../lib/store";

/**
 * Self-contained editor for nutrition and step target profiles and their
 * per-weekday assignments.
 *
 * Built around a progressive reveal. While the whole week resolves to one
 * profile there is nothing to assign, so the seven day chips are NOT RENDERED
 * AT ALL: the user sees one plain set of goals plus a quiet action to start
 * varying them. The chip strip appears only once the week has something to say,
 * which is either more than one profile existing or the week already being
 * non-uniform.
 *
 * `isUniformWeek` in targets.ts is the single source of truth for that rule.
 * Do not re-derive it here with an inline Set comparison.
 */
export function TargetsEditor() {
  const targetProfiles = useStore((s) => s.targetProfiles);
  const weekdayTargets = useStore((s) => s.weekdayTargets);
  const addTargetProfile = useStore((s) => s.addTargetProfile);
  const updateTargetProfile = useStore((s) => s.updateTargetProfile);
  const deleteTargetProfile = useStore((s) => s.deleteTargetProfile);
  const assignWeekdayTarget = useStore((s) => s.assignWeekdayTarget);

  /**
   * Gate for the seven-chip strip and the summary.
   *
   * The `!isUniformWeek` half is not redundant with the profile count. It
   * catches the case where a user-edited backup left the week pointing at ids
   * that no longer resolve: the week is non-uniform, Today shows no target, and
   * the chips are the only way to repair it. The profile-count half is what
   * opens the strip immediately after "use different targets on some days",
   * where a second profile exists but every day still points at the first.
   */
  const showDayAssignments = targetProfiles.length > 1 || !isUniformWeek(weekdayTargets);

  /** deleteTargetProfile refuses to remove the last profile, so surface that as
   * a disabled control rather than a tap that silently does nothing. */
  const canDeleteProfiles = targetProfiles.length > 1;

  /**
   * One-tap day target rotation: advances the selected weekday to the next
   * profile in the list.
   *
   * `weekdayIndex` is MONDAY FIRST (0 = Mon, 6 = Sun), matching
   * `weekdayTargets` and `WEEKDAY_LABELS`. It comes from the position in
   * WEEKDAY_LABELS, never from a Date, so there is no `getDay()` rotation to do
   * here.
   */
  const handleRotateDayTarget = (weekdayIndex: number) => {
    if (targetProfiles.length === 0) return;
    const currentId = weekdayTargets[weekdayIndex];
    const currentIdx = targetProfiles.findIndex((p) => p.id === currentId);
    // findIndex returns -1 for a stale id, so the next index lands on the first
    // profile, which is what repairing a broken assignment should do.
    const nextIdx = (currentIdx + 1) % targetProfiles.length;
    assignWeekdayTarget(weekdayIndex, targetProfiles[nextIdx].id);
  };

  /**
   * Action for "use different targets on some days": adds a second profile,
   * renaming the placeholder first one so the training/rest distinction reads
   * immediately.
   */
  const handleSplitTargets = () => {
    if (targetProfiles.length !== 1) return;
    const first = targetProfiles[0];
    if (first.name === "Every day" || first.name === "Untitled") {
      updateTargetProfile(first.id, { name: "Training" });
    }
    addTargetProfile("Rest");
  };

  /**
   * Live plain-language summary, one line per profile, so a chip assignment is
   * legible without decoding chips: "Training: 3,200 kcal on Mon, Wed, Fri".
   */
  const summaryLines = targetProfiles.map((profile) => {
    const days = WEEKDAY_LABELS.filter((_, idx) => weekdayTargets[idx] === profile.id);

    let where: string;
    if (days.length === 0) where = "not used on any day";
    else if (days.length === 7) where = "on every day";
    else where = `on ${days.join(", ")}`;

    const calories =
      profile.calories !== undefined && profile.calories > 0
        ? `${profile.calories.toLocaleString()} kcal `
        : "";

    return { key: profile.id, text: `${profile.name}: ${calories}${where}` };
  });

  /** Days whose assigned id resolves to nothing, which is what a bad import
   * looks like. Those days get no target on Today, so say so out loud. */
  const orphanDays = WEEKDAY_LABELS.filter(
    (_, idx) => !targetProfiles.some((p) => p.id === weekdayTargets[idx]),
  );

  return (
    <div className="space-y-6">
      {showDayAssignments && (
        <>
          <div className="rounded-2xl bg-muted p-4">
            <div className="t-caption text-muted-foreground">This week</div>
            <div className="tnum mt-1.5 space-y-1 t-label font-medium text-foreground">
              {summaryLines.map((line) => (
                <div key={line.key}>{line.text}</div>
              ))}
              {orphanDays.length > 0 && (
                <div className="text-destructive">No target on {orphanDays.join(", ")}</div>
              )}
            </div>
          </div>

          <div>
            <h2 className="mb-1 t-caption text-muted-foreground">Day assignments</h2>
            <p className="mb-2 t-label text-muted-foreground">
              Tap a day to cycle through your profiles.
            </p>
            <div
              role="group"
              aria-label="Weekday target assignments"
              className="grid grid-cols-7 gap-1.5"
            >
              {WEEKDAY_LABELS.map((label, idx) => {
                const assigned = targetProfiles.find((p) => p.id === weekdayTargets[idx]);
                // Never fall back to profiles[0] for display: claiming an
                // assignment the resolver will not honour is how a stale id
                // stays invisible while Today quietly shows no target.
                const assignedName = assigned?.name ?? "Not set";
                return (
                  <button
                    key={label}
                    type="button"
                    aria-label={`${label}, currently ${assignedName}. Tap to change.`}
                    onClick={() => handleRotateDayTarget(idx)}
                    className="flex min-h-[52px] min-w-0 flex-col items-center justify-center rounded-xl bg-muted p-1 text-center transition-transform active:scale-95"
                  >
                    <span aria-hidden="true" className="t-caption text-muted-foreground">
                      {label}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 max-w-full truncate px-0.5 t-caption ${
                        assigned ? "text-accent" : "text-muted-foreground"
                      }`}
                    >
                      {assignedName}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      <div className="space-y-4">
        {showDayAssignments && (
          <div className="flex items-center justify-between">
            <h2 className="t-caption text-muted-foreground">Target profiles</h2>
            <button
              type="button"
              onClick={() => addTargetProfile("New profile")}
              className="flex min-h-[44px] items-center t-body font-medium text-accent"
            >
              + Add profile
            </button>
          </div>
        )}

        {targetProfiles.map((profile) => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            canDelete={canDeleteProfiles}
            onUpdate={(patch) => updateTargetProfile(profile.id, patch)}
            onDelete={() => deleteTargetProfile(profile.id)}
          />
        ))}

        {!canDeleteProfiles && (
          <p className="t-label text-muted-foreground">
            At least one profile is required while targets are on. Turn targets off to remove them
            all.
          </p>
        )}

        {!showDayAssignments && (
          <button
            type="button"
            onClick={handleSplitTargets}
            className="flex min-h-[44px] w-full items-center t-body font-medium text-accent"
          >
            Use different targets on some days
          </button>
        )}
      </div>
    </div>
  );
}

function ProfileCard({
  profile,
  canDelete,
  onUpdate,
  onDelete,
}: {
  profile: TargetProfile;
  canDelete: boolean;
  onUpdate: (patch: Partial<Omit<TargetProfile, "id">>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-4 rounded-2xl bg-muted p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1">
          <label htmlFor={`profile-name-${profile.id}`} className="sr-only">
            Profile name
          </label>
          <input
            id={`profile-name-${profile.id}`}
            type="text"
            value={profile.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder="Profile name"
            className="min-h-[44px] w-full border-b border-transparent bg-transparent t-heading font-semibold outline-none focus:border-border"
          />
        </div>
        <button
          type="button"
          aria-label={
            canDelete
              ? `Delete profile ${profile.name}`
              : `Delete profile ${profile.name}, unavailable because at least one profile is required`
          }
          title={canDelete ? "Delete profile" : "At least one profile is required"}
          disabled={!canDelete}
          onClick={onDelete}
          className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-muted-foreground"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>

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
    <div className="rounded-xl bg-surface p-3">
      <label htmlFor={id} className="block t-caption text-muted-foreground">
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
          className="tnum min-h-[44px] w-full min-w-0 bg-transparent t-heading font-semibold outline-none placeholder:t-label placeholder:font-normal placeholder:text-muted-foreground"
        />
        {suffix && <span className="t-label text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}
