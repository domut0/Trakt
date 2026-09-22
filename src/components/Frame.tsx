import type { ReactNode } from "react";

/**
 * The full-screen frame a link lands on, and its one action.
 *
 * `Frame` is used by /join, which someone opens before the app means anything
 * to them: no nav, no tabs, one thing to do.
 *
 * `Primary` started here and is no longer only /join's -- it is the app's one
 * filled action button, wherever a screen has a single obvious thing to do.
 * Keeping it one definition is the point: a second hand-rolled copy of the
 * same six classes is how a design system starts drifting.
 */

export function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex h-[100dvh] max-w-md flex-col justify-center gap-4 bg-background px-6">
      <h1 className="t-title text-ink">{title}</h1>
      {children}
    </div>
  );
}

export function Primary({
  children,
  onClick,
  disabled,
  dataTutorial,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Marks this button as a tutorial target. See TutorialCursor. */
  dataTutorial?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-tutorial={dataTutorial}
      className="min-h-[44px] w-full bg-ink t-body font-semibold text-paper rounded-md"
    >
      {children}
    </button>
  );
}
