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
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-3 bg-signal px-4 py-2.5 text-white"
      style={{ paddingTop: "max(env(safe-area-inset-top), 10px)" }}
    >
      <span className="t-label font-medium">
        Couldn't save to this device. Export a backup from Settings.
      </span>
      <button
        onClick={dismissWriteError}
        aria-label="Dismiss"
        // 44px hit area from an inset overlay rather than padding: this banner
        // is position-fixed over the app's own header, so growing it would
        // cover content rather than move it.
        className="relative shrink-0 p-1 opacity-90 after:absolute after:-inset-2.5 after:content-['']"
      >
        <X size={16} />
      </button>
    </div>
  );
}
