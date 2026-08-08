import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "../components/AppShell";
import { parseBackup, useStore, type BackupData } from "../lib/store";

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
  const importData = useStore((s) => s.importData);
  const clearAllData = useStore((s) => s.clearAllData);
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
    const { exercises, slots, sessions, sets, unit } = useStore.getState();
    const blob = new Blob([JSON.stringify({ exercises, slots, sessions, sets, unit }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workout-log-${new Date().toISOString().slice(0, 10)}.json`;
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

  return (
    <AppShell>
      <header className="px-5 pb-4 pt-14">
        <h1 className="text-[30px] font-semibold tracking-tight">Settings</h1>
      </header>

      <Section title="Units" delay={0}>
        <div className="flex gap-2 px-5 py-3">
          {(["lbs", "kg"] as const).map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              className={
                "flex-1 rounded-full py-2.5 text-[14px] font-medium transition-colors " +
                (unit === u ? "bg-foreground text-background" : "bg-muted text-muted-foreground")
              }
            >
              {u}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Tabs" delay={40}>
        <div className="flex items-center justify-between px-5 py-3.5 hairline-t">
          <div>
            <div className="text-[15px]">Charts tab</div>
            <div className="text-[12px] text-muted-foreground">Show the Charts tab in the nav.</div>
          </div>
          <Toggle checked={chartsEnabled} onChange={() => setChartsEnabled(!chartsEnabled)} />
        </div>
      </Section>

      <Section title="Data" delay={80}>
        <button
          onClick={exportJson}
          className="flex w-full items-center justify-between px-5 py-3.5 text-left hairline-t"
        >
          <div>
            <div className="text-[15px]">Export backup</div>
            <div className="text-[12px] text-muted-foreground">Download all data as JSON.</div>
          </div>
          <span className="text-accent">→</span>
        </button>
        <label className="flex w-full items-center justify-between px-5 py-3.5 text-left hairline-t">
          <div>
            <div className="text-[15px]">Import backup</div>
            <div className="text-[12px] text-muted-foreground">Restore from a previous export.</div>
          </div>
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleFileChange}
          />
          <span className="text-accent">→</span>
        </label>

        {importError && (
          <div className="px-5 py-3 text-[13px] text-destructive hairline-t">{importError}</div>
        )}

        {pendingImport && (
          <div className="px-5 py-3.5 hairline-t">
            <div className="text-[13px] text-muted-foreground">
              This file has {pendingImport.exercises.length} exercises,{" "}
              {pendingImport.sessions.length} sessions and {pendingImport.sets.length} sets.
              Importing will replace all data currently on this device. This cannot be undone.
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={cancelImport}
                className="flex-1 rounded-full bg-muted py-2.5 text-[14px] font-medium text-muted-foreground"
              >
                Cancel
              </button>
              <button
                onClick={confirmImport}
                className="flex-1 rounded-full bg-foreground py-2.5 text-[14px] font-medium text-background"
              >
                Replace all data
              </button>
            </div>
          </div>
        )}

        {importSuccess && (
          <div className="px-5 py-3 text-[13px] text-muted-foreground hairline-t">
            Backup imported.
          </div>
        )}
      </Section>

      <Section title="Reset" delay={120}>
        {!showClearConfirm ? (
          <button
            onClick={() => setShowClearConfirm(true)}
            className="flex w-full items-center justify-between px-5 py-3.5 text-left"
          >
            <div>
              <div className="text-[15px] text-destructive">Clear all data</div>
              <div className="text-[12px] text-muted-foreground">
                Wipe all workouts and start fresh.
              </div>
            </div>
            <span className="text-destructive">→</span>
          </button>
        ) : (
          <div className="px-5 py-3.5">
            <div className="text-[13px] text-muted-foreground">
              This permanently deletes every split, session, and set on this device and resets your
              settings. The exercise library is kept. This cannot be undone.
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 rounded-full bg-muted py-2.5 text-[14px] font-medium text-muted-foreground"
              >
                Cancel
              </button>
              <button
                onClick={confirmClear}
                className="flex-1 rounded-full bg-destructive py-2.5 text-[14px] font-medium text-white"
              >
                Clear all data
              </button>
            </div>
          </div>
        )}
      </Section>

      <p className="px-5 pt-6 text-[12px] text-muted-foreground">
        v0.1 · local only · no accounts, no sync.
      </p>
    </AppShell>
  );
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
    <section className="mt-6 anim-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <div className="px-5 pb-2 text-[12px] font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      <div className="bg-surface hairline-t hairline-b">{children}</div>
    </section>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className="relative h-7 w-12 rounded-full transition-colors"
      style={{ backgroundColor: checked ? "var(--color-accent)" : "var(--color-border)" }}
    >
      <span
        className="absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all"
        style={{ left: checked ? 22 : 2 }}
      />
    </button>
  );
}
