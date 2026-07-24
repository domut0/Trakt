import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";

export function StartWorkoutSheet({ open, onClose, onStart }: { open: boolean; onClose: () => void; onStart: (sessionId: string) => void }) {
  const slots = useStore((s) => s.slots);
  const predicted = useStore((s) => s.predictedNextSlotName());
  const startWorkout = useStore((s) => s.startWorkout);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, predicted]);

  if (!open) return null;

  const trimmed = value.trim();
  const suggestions = trimmed
    ? slots.filter((s) => s.name.toLowerCase().includes(trimmed.toLowerCase()) && s.name.toLowerCase() !== trimmed.toLowerCase()).slice(0, 4)
    : [];

  const handleStart = (name?: string) => {
    const n = (name ?? value).trim() || (predicted ?? "");
    if (!n) return;
    const id = startWorkout(n);
    onStart(id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/25" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl bg-surface p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 24px)" }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
        <h2 className="text-[15px] font-medium text-muted-foreground">Today's session</h2>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={predicted ? `suggested: ${predicted}` : "Heavy Bench, D2, Arms…"}
          className="mt-2 w-full bg-transparent text-[26px] font-semibold tracking-tight outline-none placeholder:text-muted-foreground"
          onKeyDown={(e) => { if (e.key === "Enter") handleStart(); }}
        />
        {suggestions.length > 0 && (
          <ul className="mt-3 space-y-1">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button onClick={() => handleStart(s.name)} className="w-full rounded-md px-2 py-1.5 text-left text-[15px] hover:bg-muted">
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-6 flex items-center gap-2">
          <button onClick={onClose} className="flex-1 rounded-full py-3 text-[15px] font-medium text-muted-foreground hairline-t">Cancel</button>
          <button
            onClick={() => handleStart()}
            disabled={!(trimmed || predicted)}
            className="flex-[2] rounded-full bg-accent py-3 text-[15px] font-semibold text-accent-foreground disabled:opacity-40"
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
