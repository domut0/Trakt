import { useState } from "react";
import {
  isUniformWeek,
  WEEKDAY_LABELS,
} from "../lib/targets";
import { useStore, type TargetProfile } from "../lib/store";

/**
 * Self-contained editor for nutrition and step target profiles and their per-weekday assignments.
 *
 * Designed around a progressive reveal: a user who wants the same targets every day
 * sees a single profile editor and a quiet action to use different targets on some days.
 * Only once multiple target profiles exist does the 7-day weekday assignment strip appear.
 */
export function TargetsEditor() {
  const targetProfiles = useStore((s) => s.targetProfiles);
  const weekdayTargets = useStore((s) => s.weekdayTargets);
  const addTargetProfile = useStore((s) => s.addTargetProfile);
  const updateTargetProfile = useStore((s) => s.updateTargetProfile);
  const deleteTargetProfile = useStore((s) => s.deleteTargetProfile);
  const assignWeekdayTarget = useStore((s) => s.assignWeekdayTarget);

  const hasMultipleProfiles = targetProfiles.length > 1;

  /**
   * One-tap day target rotation: advances the selected weekday's target profile
   * to the next profile in the rotation order.
   *
   * Index is Monday-first (0 = Mon, 6 = Sun) matching the app-wide convention.
   */
  const handleRotateDayTarget = (weekdayIndex: number) => {
    if (targetProfiles.length <= 1) return;
    const currentId = weekdayTargets[weekdayIndex];
    const currentIdx = targetProfiles.findIndex((p) => p.id === currentId);
    const nextIdx = (currentIdx + 1) % targetProfiles.length;
    assignWeekdayTarget(weekdayIndex, targetProfiles[nextIdx].id);
  };

  /**
   * Action for "Use different targets on some days": creates a second profile if
   * only one exists, renaming the first profile from "Every day" to "Training" so
   * the distinction between training and rest days is immediately clear.
   */
  const handleSplitTargets = () => {
    if (targetProfiles.length === 1) {
      const first = targetProfiles[0];
      if (first.name === "Every day" || first.name === "Untitled") {
        updateTargetProfile(first.id, { name: "Training" });
      }
      addTargetProfile("Rest");
    }
  };

  /** Live readable schedule summary lines for current profile assignments. */
  const summaryLines = targetProfiles.map((p) => {
    const assignedIndices = weekdayTargets
      .map((id, idx) => (id === p.id ? idx : -1))
      .filter((idx) => idx !== -1);

    let daysSummary: string;
    if (assignedIndices.length === 0) {
      daysSummary = "no days";
    } else if (assignedIndices.length === 7) {
      daysSummary = "every day";
    } else {
      daysSummary = assignedIndices.map((i) => WEEKDAY_LABELS[i]).join(", ");
    }

    const calStr = p.calories ? `${p.calories.toLocaleString()} kcal` : "Custom targets";
    return `${p.name}: ${calStr} on ${daysSummary}`;
  });

  return (
    <div className="space-y-6">
      {!hasMultipleProfiles ? (
        <div className="rounded-2xl bg-surface p-4 border border-border/40">
          <div className="flex flex-col gap-2">
            <h3 className="text-[15px] font-semibold tracking-tight">Target Profile</h3>
            <p className="text-[12px] text-muted-foreground">
              Set your daily nutrition and step targets.
            </p>
            <button
              type="button"
              onClick={handleSplitTargets}
              className="mt-1 flex min-h-[44px] items-center justify-start text-[13px] font-medium text-accent hover:underline focus:outline-none"
            >
              Use different targets on some days
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Live readable summary of target assignments */}
          <div className="rounded-2xl bg-surface p-4 border border-border/50">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Schedule Summary
            </div>
            <div className="mt-1 text-[13px] font-medium text-foreground space-y-1">
              {summaryLines.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </div>

          {/* 7-Day Assignment Strip */}
          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-widest text-muted-foreground">
              Day Assignments
            </div>
            <p className="mb-2 text-[12px] text-muted-foreground">
              Tap a day to cycle through your target profiles.
            </p>
            <div className="grid grid-cols-7 gap-1.5">
              {WEEKDAY_LABELS.map((label, idx) => {
                const assignedId = weekdayTargets[idx];
                const assignedProfile =
                  targetProfiles.find((p) => p.id === assignedId) ?? targetProfiles[0];
                return (
                  <button
                    key={label}
                    type="button"
                    aria-label={`Assign target for ${label}, currently ${assignedProfile.name}`}
                    onClick={() => handleRotateDayTarget(idx)}
                    className="flex min-h-[52px] flex-col items-center justify-center rounded-xl bg-surface p-1 text-center transition-transform active:scale-95 border border-border/40"
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {label}
                    </span>
                    <span className="mt-0.5 max-w-full truncate px-0.5 text-[11px] font-bold text-accent">
                      {assignedProfile.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Target Profiles List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[12px] font-semibold uppercase tracking-widest text-muted-foreground">
            Target Profiles
          </h2>
          {hasMultipleProfiles && (
            <button
              type="button"
              onClick={() => addTargetProfile("New Profile")}
              className="flex min-h-[44px] items-center text-[13px] font-medium text-accent hover:underline focus:outline-none"
            >
              + Add profile
            </button>
          )}
        </div>

        {targetProfiles.map((profile) => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            canDelete={targetProfiles.length > 1}
            onUpdate={(patch) => updateTargetProfile(profile.id, patch)}
            onDelete={() => deleteTargetProfile(profile.id)}
          />
        ))}

        {!hasMultipleProfiles && (
          <p className="text-[12px] text-muted-foreground">
            At least one target profile is required while targets are active.
          </p>
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
    <div className="rounded-2xl bg-surface p-4 space-y-4 border border-border/40">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1">
          <label htmlFor={`profile-name-${profile.id}`} className="sr-only">
            Profile name
          </label>
          <input
            id={`profile-name-${profile.id}`}
            type="text"
            aria-label="Profile name"
            value={profile.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder="Profile name"
            className="w-full bg-transparent text-[18px] font-semibold tracking-tight outline-none border-b border-transparent focus:border-border"
          />
        </div>
        <button
          type="button"
          aria-label={`Delete profile ${profile.name}`}
          disabled={!canDelete}
          onClick={onDelete}
          className="flex h-[44px] w-[44px] items-center justify-center rounded-xl text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:hover:text-muted-foreground disabled:cursor-not-allowed"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
          label="Calories"
          suffix="kcal"
          value={profile.calories}
          onChange={(val) => onUpdate({ calories: val })}
        />
        <TargetFieldInput
          label="Steps"
          value={profile.steps}
          onChange={(val) => onUpdate({ steps: val })}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <TargetFieldInput
          label="Protein"
          suffix="g"
          value={profile.protein}
          onChange={(val) => onUpdate({ protein: val })}
        />
        <TargetFieldInput
          label="Carbs"
          suffix="g"
          value={profile.carbs}
          onChange={(val) => onUpdate({ carbs: val })}
        />
        <TargetFieldInput
          label="Fat"
          suffix="g"
          value={profile.fat}
          onChange={(val) => onUpdate({ fat: val })}
        />
      </div>
    </div>
  );
}

function TargetFieldInput({
  label,
  suffix,
  value,
  onChange,
}: {
  label: string;
  suffix?: string;
  value: number | undefined;
  onChange: (val: number | undefined) => void;
}) {
  const strVal = value !== undefined ? String(value) : "";

  return (
    <div className="rounded-xl bg-muted p-3">
      <label
        htmlFor={`target-field-${label}`}
        className="block text-[11px] uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </label>
      <div className="mt-1 flex items-baseline gap-1">
        <input
          id={`target-field-${label}`}
          inputMode="numeric"
          aria-label={label}
          value={strVal}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (!raw) {
              onChange(undefined);
            } else {
              const num = Number(raw);
              if (Number.isFinite(num) && num > 0) {
                onChange(num);
              } else {
                // Blank or 0 translates to undefined, preventing stray zeros from corrupting progress
                onChange(undefined);
              }
            }
          }}
          placeholder="No target"
          className="tnum w-full min-w-0 bg-transparent text-[18px] font-semibold outline-none placeholder:text-[13px] placeholder:font-normal placeholder:text-muted-foreground"
        />
        {suffix && <span className="text-[12px] text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}
