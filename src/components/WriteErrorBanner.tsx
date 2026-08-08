import { X } from "lucide-react";
import { useStore } from "../lib/store";

/**
 * Surfaces a failed IndexedDB write. Rendered at the root (not inside
 * AppShell) so it is visible on every route, including /workout, which does
 * not use AppShell. Sits above ActiveSessionBanner (z-40) at z-50.
 */
export function WriteErrorBanner() {
  const writeFailed = useStore((s) => s.writeFailed);
  const dismissWriteError = useStore((s) => s.dismissWriteError);

  if (!writeFailed) return null;

  return (
    <div
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-3 bg-destructive px-4 py-2.5 text-white"
      style={{ paddingTop: "max(env(safe-area-inset-top), 10px)" }}
    >
      <span className="text-[13px] font-medium">
        Couldn't save to this device. Export a backup from Settings.
      </span>
      <button
        onClick={dismissWriteError}
        aria-label="Dismiss"
        className="shrink-0 rounded-full p-1 opacity-90"
      >
        <X size={16} />
      </button>
    </div>
  );
}
