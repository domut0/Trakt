import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "../components/AppShell";
import { ImportMfpSheet } from "../components/ImportMfpSheet";
import { MealsEditorSheet } from "../components/MealsEditorSheet";
import { OneRmCalculatorSheet } from "../components/OneRmCalculatorSheet";
import { PlateCalculatorSheet } from "../components/PlateCalculatorSheet";
import { SyncSettings } from "../components/SyncSettings";
import { TargetsEditor } from "../components/TargetsEditor";
import { Toggle } from "../components/Toggle";
import { dailyLogsToCsv, setsToCsv } from "../lib/csv";
import { isEmptyPlan, type PlannedWeek } from "../lib/plan";
import {
  BACKUP_VERSION,
  parseBackup,
  useStore,
  type BackupData,
  type TargetProfile,
} from "../lib/store";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings" },
      { name: "description", content: "Units, feedback and backup." },
      { property: "og:title", content: "Settings" },
      { property: "og:description", content: "Units, feedback and backup." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const unit = useStore((s) => s.unit);
  const setUnit = useStore((s) => s.setUnit);
  const chartsEnabled = useStore((s) => s.chartsEnabled);
  const setChartsEnabled = useStore((s) => s.setChartsEnabled);
  const targetsEnabled = useStore((s) => s.targetsEnabled);
  const setTargetsEnabled = useStore((s) => s.setTargetsEnabled);
  const habitsEnabled = useStore((s) => s.habitsEnabled);
  const setHabitsEnabled = useStore((s) => s.setHabitsEnabled);
  const toolsEnabled = useStore((s) => s.toolsEnabled);
  const setToolsEnabled = useStore((s) => s.setToolsEnabled);
  const planEnabled = useStore((s) => s.planEnabled);
  const setPlanEnabled = useStore((s) => s.setPlanEnabled);
  const foodEnabled = useStore((s) => s.foodEnabled);
  const setFoodEnabled = useStore((s) => s.setFoodEnabled);
  const seedMealsIfEmpty = useStore((s) => s.seedMealsIfEmpty);
  const importData = useStore((s) => s.importData);
  const clearAllData = useStore((s) => s.clearAllData);
  // Read only so the import confirmation can compare the file against what is
  // already here. An import replaces each of these tables whole, so anything in
  // them that the file does not carry is deleted, not merged.
  const dailyLogs = useStore((s) => s.dailyLogs);
  const habits = useStore((s) => s.habits);
  const habitEntries = useStore((s) => s.habitEntries);
  const targetProfiles = useStore((s) => s.targetProfiles);
  const plannedWeek = useStore((s) => s.plannedWeek);
  const router = useRouter();

  // Import flow: a selected file is parsed and fully validated (parseBackup)
  // before anything is shown here. Nothing touches IndexedDB or the live
  // store until the user explicitly confirms the pending import below.
  const [pendingImport, setPendingImport] = useState<BackupData | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [plateSheetOpen, setPlateSheetOpen] = useState(false);
  const [oneRmSheetOpen, setOneRmSheetOpen] = useState(false);
  const [mealsSheetOpen, setMealsSheetOpen] = useState(false);
  const [importMfpSheetOpen, setImportMfpSheetOpen] = useState(false);

  const confirmClear = async () => {
    await clearAllData();
    setShowClearConfirm(false);
    router.navigate({ to: "/" });
  };

  const exportJson = () => {
    const {
      exercises,
      slots,
      sessions,
      sets,
      dailyLogs,
      habits,
      habitEntries,
      foods,
      foodEntries,
      meals,
      recipes,
      recipeIngredients,
      targetProfiles,
      weekdayTargets,
      targetsEnabled,
      habitsEnabled,
      toolsEnabled,
      planEnabled,
      foodEnabled,
      plannedWeek,
      unit,
    } = useStore.getState();
    // Annotated as BackupData on purpose. This object literal used to be built
    // inline inside JSON.stringify, where an excess/missing key is invisible to
    // the type checker: when BackupData grew to v4 the export quietly kept
    // writing v3 files, so restoring a backup wiped the user's habits and
    // targets. The annotation makes the next widening of BackupData a build
    // error here instead of silent data loss for whoever restores the file.
    const backup: BackupData = {
      version: BACKUP_VERSION,
      exercises,
      slots,
      sessions,
      sets,
      dailyLogs,
      habits,
      habitEntries,
      foods,
      foodEntries,
      meals,
      recipes,
      recipeIngredients,
      targetProfiles,
      weekdayTargets,
      targetsEnabled,
      habitsEnabled,
      toolsEnabled,
      planEnabled,
      foodEnabled,
      plannedWeek,
      unit,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workout-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportSetsCsv = () => {
    const { sets, sessions, exercises, slots, unit } = useStore.getState();
    const csv = setsToCsv(sets, sessions, exercises, slots, unit);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `abtn-sets-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportDailyLogsCsv = () => {
    const { dailyLogs, unit } = useStore.getState();
    const csv = dailyLogsToCsv(dailyLogs, unit);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `abtn-daily-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so re-selecting the same file re-triggers change
    if (!file) return;
    setImportSuccess(false);
    setPendingImport(null);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setImportError("Could not read that file.");
      return;
    }
    const result = parseBackup(text);
    if (!result.ok) {
      setImportError(result.error);
      return;
    }
    setImportError(null);
    setPendingImport(result.data);
  };

  const confirmImport = async () => {
    if (!pendingImport) return;
    try {
      await importData(pendingImport);
      setPendingImport(null);
      setImportError(null);
      setImportSuccess(true);
    } catch {
      setImportError("Import failed. Existing data was not changed.");
    }
  };

  const cancelImport = () => {
    setPendingImport(null);
  };

  // Derived for the confirmation below, and deliberately two separate things.
  // A per-table count of what is in the FILE is not enough on its own: after
  // parseBackup, a file that predates a feature is indistinguishable from a file
  // written by someone who never used it, because both arrive as an empty array
  // (habits) or as the seeded single profile (targets). A count of "0 habits"
  // therefore reads as "nothing changes" at exactly the moment it means "all of
  // your habits are about to be deleted". So the losses are computed by
  // comparing against live state instead, which also means a user who has never
  // used habits is told nothing about them.
  const fileCounts = pendingImport ? summarizeBackup(pendingImport) : "";
  const losses = pendingImport
    ? describeLosses(pendingImport, {
        dailyLogs,
        habits,
        habitEntries,
        targetProfiles,
        plannedWeek,
      })
    : [];

  return (
    <AppShell>
      <header className="px-5 pb-4 pt-14">
        <h1 className="t-title">Settings</h1>
      </header>

      <Section title="Units" delay={0}>
        <div className="flex gap-2 p-3">
          {(["lbs", "kg"] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnit(u)}
              className={
                "flex-1 rounded-full py-2.5 t-body font-medium transition-colors " +
                (unit === u ? "bg-foreground text-background" : "bg-muted text-muted-foreground")
              }
            >
              {u}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Tabs" delay={40}>
        <div className="group-row">
          <div>
            <div className="t-body">Charts tab</div>
            <div className="t-label text-muted-foreground">Show the Charts tab in the nav.</div>
          </div>
          <Toggle
            checked={chartsEnabled}
            onChange={() => setChartsEnabled(!chartsEnabled)}
            label="Charts tab"
          />
        </div>

        {/* Off by default, like every other opt-in surface. The subtitle says
            what the tab IS rather than repeating "show it in the nav" from the
            row above: the switch's own position already covers that, and a
            reader who has never planned a week needs the other half. */}
        <div className="group-row group-row-sep">
          <div>
            <div className="t-body">Plan tab</div>
            <div className="t-label text-muted-foreground">
              A weekly template for your main lifts.
            </div>
          </div>
          <Toggle
            checked={planEnabled}
            onChange={() => setPlanEnabled(!planEnabled)}
            label="Plan tab"
          />
        </div>
      </Section>

      <Section title="Features" delay={80}>
        <div className="group-row">
          <div>
            <div className="t-body">Daily targets</div>
            <div className="t-label text-muted-foreground">
              Show goal progress on the daily log.
            </div>
          </div>
          <Toggle
            checked={targetsEnabled}
            onChange={() => setTargetsEnabled(!targetsEnabled)}
            label="Daily targets"
          />
        </div>
        {/* Inline editor, not a sheet: the profiles only mean anything while
            targets are on, so they live under the switch that turns them on. */}
        {targetsEnabled && (
          <div className="group-row-sep px-5 py-4">
            <TargetsEditor />
          </div>
        )}

        <div className="group-row group-row-sep">
          <div>
            <div className="t-body">Habits</div>
            <div className="t-label text-muted-foreground">
              Adds a daily checklist to the Today tab.
            </div>
          </div>
          <Toggle
            checked={habitsEnabled}
            onChange={() => setHabitsEnabled(!habitsEnabled)}
            label="Habits"
          />
        </div>

        <div className="group-row group-row-sep">
          <div>
            <div className="t-body">Food logging</div>
            <div className="t-label text-muted-foreground">
              Track meals, foods, and daily macros.
            </div>
          </div>
          <Toggle
            checked={!!foodEnabled}
            onChange={() => {
              const next = !foodEnabled;
              if (next) {
                seedMealsIfEmpty();
              }
              setFoodEnabled(next);
            }}
            label="Food logging"
          />
        </div>
        {foodEnabled && (
          <button
            type="button"
            onClick={() => setMealsSheetOpen(true)}
            className="group-row group-row-sep w-full text-left"
          >
            <div>
              <div className="t-body">Manage meals</div>
              <div className="t-label text-muted-foreground">
                Customise meal names, order, and times.
              </div>
            </div>
            <span className="text-accent" aria-hidden="true">
              →
            </span>
          </button>
        )}

        <div className="group-row group-row-sep">
          <div>
            <div className="t-body">Calculators</div>
            <div className="t-label text-muted-foreground">
              Add plate loading and 1RM tools here.
            </div>
          </div>
          <Toggle
            checked={toolsEnabled}
            onChange={() => setToolsEnabled(!toolsEnabled)}
            label="Calculators"
          />
        </div>
        {toolsEnabled && (
          <>
            <button
              type="button"
              onClick={() => setPlateSheetOpen(true)}
              className="group-row group-row-sep w-full text-left"
            >
              <div>
                <div className="t-body">Plate calculator</div>
                <div className="t-label text-muted-foreground">Work out what to load per side.</div>
              </div>
              <span className="text-accent" aria-hidden="true">
                →
              </span>
            </button>
            <button
              type="button"
              onClick={() => setOneRmSheetOpen(true)}
              className="group-row group-row-sep w-full text-left"
            >
              <div>
                <div className="t-body">1RM estimator</div>
                <div className="t-label text-muted-foreground">
                  Estimate a max from a weight and reps.
                </div>
              </div>
              <span className="text-accent" aria-hidden="true">
                →
              </span>
            </button>
          </>
        )}
      </Section>

      <Section title="Data" delay={120}>
        <button type="button" onClick={exportJson} className="group-row w-full text-left">
          <div>
            <div className="t-body">Export backup</div>
            <div className="t-label text-muted-foreground">Download all data as JSON.</div>
          </div>
          <span className="text-accent" aria-hidden="true">
            →
          </span>
        </button>
        <button
          type="button"
          onClick={exportSetsCsv}
          className="group-row group-row-sep w-full text-left"
        >
          <div>
            <div className="t-body">Export sets (CSV)</div>
            <div className="t-label text-muted-foreground">
              Download set history for spreadsheets.
            </div>
          </div>
          <span className="text-accent" aria-hidden="true">
            →
          </span>
        </button>
        <button
          type="button"
          onClick={exportDailyLogsCsv}
          className="group-row group-row-sep w-full text-left"
        >
          <div>
            <div className="t-body">Export daily log (CSV)</div>
            <div className="t-label text-muted-foreground">
              Download nutrition and bodyweight history.
            </div>
          </div>
          <span className="text-accent" aria-hidden="true">
            →
          </span>
        </button>
        <label className="group-row group-row-sep w-full cursor-pointer text-left">
          <div>
            <div className="t-body">Import backup</div>
            <div className="t-label text-muted-foreground">Restore from a previous export.</div>
          </div>
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleFileChange}
          />
          <span className="text-accent" aria-hidden="true">
            →
          </span>
        </label>
        <button
          type="button"
          onClick={() => setImportMfpSheetOpen(true)}
          className="group-row group-row-sep w-full text-left"
        >
          <div>
            <div className="t-body">Import MyFitnessPal diary</div>
            <div className="t-label text-muted-foreground">
              Load foods and macros from an HTML export.
            </div>
          </div>
          <span className="text-accent" aria-hidden="true">
            →
          </span>
        </button>

        {importError && (
          <div className="group-row-sep px-5 py-3 t-label text-destructive">{importError}</div>
        )}

        {pendingImport && (
          <div className="group-row-sep space-y-3 p-4">
            <div className="t-label text-muted-foreground">
              Backup format v{pendingImport.version}
              {pendingImport.version < BACKUP_VERSION
                ? ", written by an older version of the app"
                : ""}
              . This file has {fileCounts}. Importing will replace all data currently on this
              device, along with your unit and feature switches. This cannot be undone.
            </div>
            {losses.length > 0 && (
              <div className="t-label text-destructive">
                Importing this file deletes {joinList(losses)}. The file contains none of it. Export
                a backup first if you want to keep it.
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={cancelImport}
                className="flex-1 rounded-full bg-muted py-2.5 t-body font-medium text-muted-foreground"
              >
                Cancel
              </button>
              {/* Reads as destructive only when it actually destroys something the
                  user still has, so the red is a signal rather than the permanent
                  colour of the import button. Geometry is untouched on purpose:
                  the hit area stays exactly the visible pill, since widening the
                  tap target of a confirm this final only makes it easier to hit
                  by mistake. */}
              <button
                type="button"
                onClick={confirmImport}
                className={
                  "flex-1 rounded-full py-2.5 t-body font-medium " +
                  (losses.length > 0
                    ? "bg-destructive text-white"
                    : "bg-foreground text-background")
                }
              >
                Replace all data
              </button>
            </div>
          </div>
        )}

        {importSuccess && (
          <div className="group-row-sep px-5 py-3 t-label text-muted-foreground">
            Backup imported.
          </div>
        )}
      </Section>

      <Section title="Google sheet" delay={160}>
        <SyncSettings />
      </Section>

      <Section title="Reset" delay={200}>
        {!showClearConfirm ? (
          <button
            type="button"
            onClick={() => setShowClearConfirm(true)}
            className="group-row w-full text-left"
          >
            <div>
              <div className="t-body text-destructive">Clear all data</div>
              <div className="t-label text-muted-foreground">
                Wipe all workouts and start fresh.
              </div>
            </div>
            <span className="text-destructive" aria-hidden="true">
              →
            </span>
          </button>
        ) : (
          <div className="space-y-3 p-4">
            <div className="t-label text-muted-foreground">
              This permanently deletes every split, session, and set on this device and resets your
              settings. The exercise library is kept. This cannot be undone.
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 rounded-full bg-muted py-2.5 t-body font-medium text-muted-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmClear}
                className="flex-1 rounded-full bg-destructive py-2.5 t-body font-medium text-white"
              >
                Clear all data
              </button>
            </div>
          </div>
        )}
      </Section>

      <p className="px-5 pt-6 t-label text-muted-foreground">
        v0.1 · local first · no accounts, sync optional.
      </p>

      {/* Gated on toolsEnabled as well as their own open state, so switching
          Calculators off while a sheet is up cannot leave it stranded. */}
      {toolsEnabled && (
        <>
          <PlateCalculatorSheet open={plateSheetOpen} onClose={() => setPlateSheetOpen(false)} />
          <OneRmCalculatorSheet open={oneRmSheetOpen} onClose={() => setOneRmSheetOpen(false)} />
        </>
      )}

      {foodEnabled && (
        <MealsEditorSheet open={mealsSheetOpen} onClose={() => setMealsSheetOpen(false)} />
      )}

      <ImportMfpSheet open={importMfpSheetOpen} onClose={() => setImportMfpSheetOpen(false)} />
    </AppShell>
  );
}

/** `${n} thing` / `${n} things`, the same idiom CalendarView and WeeklyView use.
 * Worth a helper here because a confirmation that says "1 habits" reads like the
 * file is malformed rather than like a count. */
function countOf(n: number, singular: string): string {
  return `${n} ${n === 1 ? singular : `${singular}s`}`;
}

/** "a", "a and b", "a, b and c". */
function joinList(items: string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Every table `replaceAllData` clears, in the order the backup file itself
 * lists them. All of them are cleared whole, so any table missing from this list
 * is data the user is never warned about losing. */
function summarizeBackup(b: BackupData): string {
  return joinList([
    countOf(b.exercises.length, "exercise"),
    countOf(b.slots.length, "split"),
    countOf(b.sessions.length, "session"),
    countOf(b.sets.length, "set"),
    countOf(b.dailyLogs.length, "logged day"),
    countOf(b.habits.length, "habit"),
    countOf(b.habitEntries.length, "habit check-off"),
    countOf(b.targetProfiles.length, "target profile"),
  ]);
}

/** True when the target setup is something the user built, as opposed to the
 * single empty "Every day" profile that `defaultTargets` seeds on first run and
 * that `parseBackup` substitutes for any file older than v4.
 *
 * Content, not version number: a v4 file exported before its author ever opened
 * the targets editor carries that same empty default, and importing it destroys
 * the reader's profiles just as thoroughly as a v1 file does. More than one
 * profile also covers a non-uniform weekday assignment, since seven days can
 * only differ if there is more than one profile to point at. */
function hasTargetData(profiles: TargetProfile[]): boolean {
  if (profiles.length > 1) return true;
  return profiles.some(
    (p) =>
      p.calories !== undefined ||
      p.protein !== undefined ||
      p.carbs !== undefined ||
      p.fat !== undefined ||
      p.steps !== undefined,
  );
}

/**
 * What this device has that the backup does not, phrased as the thing the user
 * loses. Each clause fires independently, because the format grew one feature at
 * a time and a file can be short of any subset: a v1 file has no daily logs, a
 * v1-v3 file has no habits and no real targets, and a hand-trimmed v4 file can
 * be missing habit history while still carrying the habits themselves.
 *
 * Deliberately does NOT check exercises, splits, sessions or sets. Those four
 * exist in every format version and are validated hard by `parseBackup`, so a
 * file with none of them is a genuinely empty backup rather than an old one, and
 * the counts in the summary already say so plainly.
 */
function describeLosses(
  b: BackupData,
  current: {
    dailyLogs: unknown[];
    habits: unknown[];
    habitEntries: unknown[];
    targetProfiles: TargetProfile[];
    plannedWeek: PlannedWeek | undefined;
  },
): string[] {
  const losses: string[] = [];
  if (b.dailyLogs.length === 0 && current.dailyLogs.length > 0) {
    losses.push(countOf(current.dailyLogs.length, "logged day"));
  }
  if (b.habits.length === 0 && current.habits.length > 0) {
    losses.push(countOf(current.habits.length, "habit"));
  }
  if (b.habitEntries.length === 0 && current.habitEntries.length > 0) {
    losses.push(countOf(current.habitEntries.length, "recorded habit check-off"));
  }
  if (!hasTargetData(b.targetProfiles) && hasTargetData(current.targetProfiles)) {
    losses.push(countOf(current.targetProfiles.length, "daily target profile"));
  }
  // Not a count, because a plan is one thing rather than a list of them, and
  // "7 planned days" would read as seven separate losses. `isEmptyPlan` on both
  // sides for the same reason the target check goes through `hasTargetData`: a
  // file whose week is seven rest days destroys a real plan exactly as
  // thoroughly as a file written before planning existed.
  if (isEmptyPlan(b.plannedWeek) && !isEmptyPlan(current.plannedWeek)) {
    losses.push("your weekly plan");
  }
  return losses;
}

function Section({
  title,
  children,
  delay = 0,
}: {
  title: string;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <section className="section-gap anim-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <h2 className="group-header t-caption">{title}</h2>
      <div className="group-list mx-5">{children}</div>
    </section>
  );
}
