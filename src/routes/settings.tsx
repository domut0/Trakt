import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Chevron } from "../components/icons";
import { useState } from "react";
import { AppShell } from "../components/AppShell";
import { CoachSettings } from "../components/CoachSettings";
import { SyncSettings } from "../components/SyncSettings";
import { Toggle } from "../components/Toggle";
import { dailyLogsToCsv } from "../lib/csv";
import { useTutorialStore } from "../lib/tutorial-store";
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
  const importData = useStore((s) => s.importData);
  const clearAllData = useStore((s) => s.clearAllData);
  // Read only so the import confirmation can compare the file against what is
  // already here. An import replaces each of these tables whole, so anything in
  // them that the file does not carry is deleted, not merged.
  const dailyLogs = useStore((s) => s.dailyLogs);
  const nutritionPhases = useStore((s) => s.nutritionPhases);
  const router = useRouter();

  // Import flow: a selected file is parsed and fully validated (parseBackup)
  // before anything is shown here. Nothing touches IndexedDB or the live
  // store until the user explicitly confirms the pending import below.
  const [pendingImport, setPendingImport] = useState<BackupData | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

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
      nutritionPhases,
      plannedDays,
      templates,
      nextSlotId,
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
      nutritionPhases,
      plannedDays,
      templates,
      nextSlotId,
      exercises,
      slots,
      sessions,
      sets,
      dailyLogs,
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
  const losses = pendingImport ? describeLosses(pendingImport, { dailyLogs, nutritionPhases }) : [];

  return (
    <AppShell>
      {/* Settings has no tab any more - it is reached by the gear in the corner
          of the four tab screens - so it needs the one thing a tab gave it for
          free: a way back. */}
      <div className="flex items-center px-4 pt-14 pb-2">
        <button
          onClick={() => router.history.back()}
          className="-my-[11px] flex min-h-[44px] items-center t-body font-medium t-action"
        >
          Back
        </button>
      </div>

      <header className="px-4 pb-4">
        <h1 className="t-title">Settings</h1>
      </header>

      <Section title="Units" delay={0}>
        <div className="m-3 flex overflow-hidden rounded-md border-[1.5px] border-ink divide-x-[1.5px] divide-ink">
          {(["lbs", "kg"] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnit(u)}
              className={
                "min-h-[44px] flex-1 t-body font-medium transition-colors " +
                (unit === u ? "bg-ink text-paper" : "text-ink-2")
              }
            >
              {u}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Coaching" delay={110}>
        <CoachSettings />
        {/* No second line. The row says what it opens, and this page had three
            description lines deleted from it for saying less than their label
            did. `start` refuses on its own terms - mid-workout, or while a
            coach is viewing a client - so a refusal is silence here rather than
            a disabled row that has to explain itself. */}
        <button
          type="button"
          onClick={() => {
            if (useTutorialStore.getState().start()) void router.navigate({ to: "/" });
          }}
          className="group-row group-row-sep w-full text-left"
        >
          <div className="t-body">Tutorial workout</div>
          <Chevron className="shrink-0 text-ink-2" size={16} />
        </button>
      </Section>

      <Section title="Google sheet" delay={120}>
        <SyncSettings />
      </Section>

      {/* LAST, because it is the section you need least often. It used to sit
          third, above the sheet, on no better reasoning than that it was
          written first. Exporting a backup is a thing you do twice a year;
          the unit toggle and the sheet are things you come here for. */}
      <Section title="Data" delay={160}>
        <button type="button" onClick={exportJson} className="group-row w-full text-left">
          <div className="t-body">Export backup</div>
          <Chevron className="shrink-0 text-ink-2" size={16} />
        </button>
        <label className="group-row group-row-sep w-full cursor-pointer text-left">
          <div className="t-body">Import backup</div>
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleFileChange}
          />
          <Chevron className="shrink-0 text-ink-2" size={16} />
        </label>
        <button
          type="button"
          onClick={exportDailyLogsCsv}
          className="group-row group-row-sep w-full text-left"
        >
          <div className="t-body">Export daily log (CSV)</div>
          <Chevron className="shrink-0 text-ink-2" size={16} />
        </button>

        {importError && (
          <div className="group-row-sep px-4 py-3 t-label text-signal">{importError}</div>
        )}

        {pendingImport && (
          <div className="group-row-sep space-y-3 p-4">
            <div className="t-label text-ink-2">
              Backup format v{pendingImport.version}
              {pendingImport.version < BACKUP_VERSION
                ? ", written by an older version of the app"
                : ""}
              . This file has {fileCounts}. Importing will replace all data currently on this
              device, along with your unit and feature switches. This cannot be undone.
            </div>
            {losses.length > 0 && (
              <div className="t-label text-signal">
                Importing this file deletes {joinList(losses)}. The file contains none of it. Export
                a backup first if you want to keep it.
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={cancelImport}
                className="flex-1 rounded-md bg-wash py-2 t-body font-medium text-ink-2"
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
                  "flex-1 py-2 t-body font-medium " +
                  (losses.length > 0 ? "bg-signal text-white" : "bg-ink text-paper")
                }
              >
                Replace all data
              </button>
            </div>
          </div>
        )}

        {importSuccess && (
          <div className="group-row-sep px-4 py-3 t-label text-ink-2">Backup imported</div>
        )}

        {/* Clearing everything lives WITH the data it clears. It had a section
            of its own called "Reset", which is a heading for one destructive
            button - the row says what it does, and a heading above it only
            said it again in a different word. */}
        {!showClearConfirm ? (
          <button
            type="button"
            onClick={() => setShowClearConfirm(true)}
            // Ruled off from the rows above it, which it was not when it had a
            // section to itself. It is the fourth row of a list now, and the
            // one row in it you must not hit by accident.
            className="group-row group-row-sep w-full text-left"
          >
            <div className="t-body text-signal">Clear all data</div>
            <span className="text-signal" aria-hidden="true"></span>
          </button>
        ) : (
          <div className="space-y-3 p-4">
            <div className="t-label text-ink-2">
              This permanently deletes every split, session, and set on this device and resets your
              settings. The exercise library is kept. This cannot be undone.
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 rounded-md bg-wash py-2 t-body font-medium text-ink-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmClear}
                className="flex-1 bg-signal py-2 t-body font-medium text-white rounded-md"
              >
                Clear all data
              </button>
            </div>
          </div>
        )}
      </Section>

      {/* Quiet, and at the very bottom. It is a legal page nobody opens twice,
          and it does not need a row and a chevron to be reachable. */}
      <div className="px-4 pb-8 pt-6">
        <a href="/privacy" className="t-label text-ink-3">
          Privacy
        </a>
      </div>
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
  ]);
}

/**
 * What this device has that the backup does not, phrased as the thing the user
 * loses. Each clause fires independently, because a file can be short of any
 * subset: one written before daily logging has none, one written before the
 * planning timeline has no phases.
 *
 * Deliberately does NOT check exercises, splits, sessions or sets. Those four
 * exist in every format version and are validated hard by `parseBackup`, so a
 * file with none of them is a genuinely empty backup rather than an old one, and
 * the counts in the summary already say so plainly.
 */
function describeLosses(
  b: BackupData,
  current: { dailyLogs: unknown[]; nutritionPhases: unknown[] },
): string[] {
  const losses: string[] = [];
  if (b.dailyLogs.length === 0 && current.dailyLogs.length > 0) {
    losses.push(countOf(current.dailyLogs.length, "logged day"));
  }
  // A count rather than "your plan", because phases genuinely are a list and
  // losing four of them is a different sentence from losing one.
  if (b.nutritionPhases.length === 0 && current.nutritionPhases.length > 0) {
    losses.push(countOf(current.nutritionPhases.length, "nutrition phase"));
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
    <section className="section-gap" style={{ animationDelay: `${delay}ms` }}>
      {/* No px-4 on the header and no mx-4 on the list. group-list used to
          bleed itself to the trim with a -20px inline margin, so every caller
          had to cancel it; a card does not bleed, and group-header carries its
          own 16px so it lines up with the first word of the first row. */}
      <h2 className="group-header t-caption">{title}</h2>
      <div className="group-list mx-4">{children}</div>
    </section>
  );
}
