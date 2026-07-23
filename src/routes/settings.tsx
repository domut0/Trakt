import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "../components/AppShell";
import { useStore } from "../lib/store";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings" },
      { name: "description", content: "Units, feedback, rotation and backup." },
      { property: "og:title", content: "Settings" },
      { property: "og:description", content: "Units, feedback, rotation and backup." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const unit = useStore((s) => s.unit);
  const setUnit = useStore((s) => s.setUnit);
  const motivationEnabled = useStore((s) => s.motivationEnabled);
  const toggleMotivation = useStore((s) => s.toggleMotivation);
  const slots = [...useStore((s) => s.slots)].sort((a, b) => a.rotationOrder - b.rotationOrder);
  const reorderSlots = useStore((s) => s.reorderSlots);

  const exportJson = () => {
    const { exercises, slots, sessions, sets, unit, motivationEnabled } = useStore.getState();
    const blob = new Blob([JSON.stringify({ exercises, slots, sessions, sets, unit, motivationEnabled }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workout-log-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell>
      <header className="px-5 pb-4 pt-14">
        <h1 className="text-[30px] font-semibold tracking-tight">Settings</h1>
      </header>

      <Section title="Units">
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

      <Section title="Feedback">
        <div className="flex items-center justify-between px-5 py-3.5 hairline-t">
          <div>
            <div className="text-[15px]">Motivational messages</div>
            <div className="text-[12px] text-muted-foreground">In-app toasts after qualifying sets.</div>
          </div>
          <Toggle checked={motivationEnabled} onChange={toggleMotivation} />
        </div>
      </Section>

      <Section title="Split rotation">
        <ul className="bg-surface">
          {slots.map((s, i) => (
            <li key={s.id} className="flex items-center justify-between px-5 py-3.5 hairline-t">
              <div className="flex items-baseline gap-3">
                <span className="tnum w-5 text-[13px] text-muted-foreground">{i + 1}</span>
                <span className="text-[15px]">{s.name}</span>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => i > 0 && reorderSlots(s.id, slots[i - 1].id)}
                  disabled={i === 0}
                  className="h-8 w-8 rounded-full bg-muted text-[14px] disabled:opacity-30"
                >↑</button>
                <button
                  onClick={() => i < slots.length - 1 && reorderSlots(s.id, slots[i + 1].id)}
                  disabled={i === slots.length - 1}
                  className="h-8 w-8 rounded-full bg-muted text-[14px] disabled:opacity-30"
                >↓</button>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Data">
        <button onClick={exportJson} className="flex w-full items-center justify-between px-5 py-3.5 text-left hairline-t">
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
          <input type="file" accept="application/json" className="hidden" />
          <span className="text-accent">→</span>
        </label>
      </Section>

      <p className="px-5 pt-6 text-[12px] text-muted-foreground">v0.1 · local only · no accounts, no sync.</p>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="px-5 pb-2 text-[12px] font-semibold uppercase tracking-widest text-muted-foreground">{title}</div>
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
