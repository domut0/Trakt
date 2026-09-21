import type { ReactNode } from "react";

/**
 * The full-screen frame a link lands on, and its one action.
 *
 * Used by /join, which someone opens before the app means anything to them:
 * no nav, no tabs, one thing to do.
 */

export function Frame({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex h-[100dvh] max-w-md flex-col justify-center gap-4 bg-background px-6">
      {/* Optional, because not every screen this wraps has something to say
          above its contents. A checklist under a ring reading "0/3 tasks
          complete" does not need a sentence introducing it. */}
      {title && <h1 className="t-title text-ink">{title}</h1>}
      {children}
    </div>
  );
}

export function Primary({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-[44px] w-full bg-ink t-body font-semibold text-paper rounded-md"
    >
      {children}
    </button>
  );
}
