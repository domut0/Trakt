import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

// Renders the actual "update available" banner. Only ever mounted client-side
// (see PwaUpdatePrompt below) -- useRegisterSW touches `navigator` as soon as
// it runs, so it must never render during SSR.
function UpdateBanner() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit max-w-[calc(100vw-32px)] items-center gap-3 bg-ink px-4 py-2.5 t-label text-paper"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <span>A new version is available.</span>
      <button
        type="button"
        onClick={() => updateServiceWorker(true)}
        className="shrink-0 bg-paper px-3 py-1.5 t-label font-semibold text-ink transition-colors"
      >
        Reload
      </button>
    </div>
  );
}

// Client-only wrapper: the app is server-rendered, and useRegisterSW must
// never run during that server render (it isn't SSR-safe -- it calls into
// `navigator` immediately). Mirrors the StoreHydrator pattern in __root.tsx:
// server and first client render both produce null, so hydration matches;
// the real banner only mounts after a client-side effect confirms we're in
// the browser.
export function PwaUpdatePrompt() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;
  return <UpdateBanner />;
}
