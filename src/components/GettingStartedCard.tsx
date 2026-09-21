import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Chevron } from "./icons";
import { TutorialRing } from "./TutorialRing";
import { takeHandoff } from "../lib/onboarding-handoff";
import { useInstallMode } from "../lib/install-prompt";
import { useStore } from "../lib/store";
import { loadTutorialState, saveTutorialState, updateTutorialState } from "../lib/tutorial-state";
import { useTutorialStore } from "../lib/tutorial-store";

/**
 * The three things a new client has to do, and how far through them they are.
 *
 * ## Three tasks, not four rows of setup
 *
 * It used to list the home screen, the sheet, the share and the tutorial - four
 * rows, two of which were locked behind the other two, and all four of which
 * the tutorial now walks somebody through itself. What is left is what the card
 * is for: the three habits the app exists to collect.
 *
 *   1. Complete tutorial - the whole guided run, sheet and share included.
 *   2. Log nutrition - one day's calories or macros, ever.
 *   3. Log steps - the same, for steps.
 *
 * ## It ends by leaving
 *
 * At three of three the ring fills, draws a tick, and the card takes itself off
 * the screen for good. The thing it replaced was a permanent block of prose
 * about what to do every morning and every night, sitting at the top of the one
 * screen this app is opened on.
 */

/** How long the finished ring is held before the card goes. */
const FAREWELL_MS = 1900;

export interface GettingStartedCardProps {
  /**
   * "today" is the dismissable card. "join" is the same checklist on the invite
   * screen, where it is born, before it flies here.
   */
  surface?: "today" | "join";
}

export function GettingStartedCard({ surface = "today" }: GettingStartedCardProps) {
  const router = useRouter();
  const install = useInstallMode();
  const dailyLogs = useStore((s) => s.dailyLogs);
  const tutorialActive = useTutorialStore((s) => s.active);

  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return loadTutorialState()?.cardDismissedAt !== undefined;
  });
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  /**
   * The flight from /join.
   *
   * A real FLIP rather than a clone: the card mounts where it belongs, is
   * offset back to where it stood on the invite screen without a transition,
   * and then released. Nothing is duplicated, so nothing can arrive and find
   * the real one already sitting there.
   */
  const cardRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<string | undefined>();
  const [flying, setFlying] = useState(false);

  useEffect(() => {
    if (surface !== "today" || typeof window === "undefined") return;
    const from = takeHandoff();
    const el = cardRef.current;
    if (!from || !el) return;

    const to = el.getBoundingClientRect();
    const scale = to.width > 0 ? from.width / to.width : 1;
    setOffset(
      `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${scale.toFixed(4)})`,
    );

    // Two frames: one for the offset to paint, one to turn the transition on
    // before removing it. One frame and the browser coalesces both into no
    // animation at all.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        setFlying(true);
        setOffset(undefined);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [surface]);

  const tutorialState = typeof window === "undefined" ? undefined : loadTutorialState();

  const tutorialDone = tutorialState?.doneAt !== undefined;
  const nutritionDone = dailyLogs.some(
    (l) =>
      l.calories !== undefined ||
      l.protein !== undefined ||
      l.carbs !== undefined ||
      l.fat !== undefined,
  );
  const stepsDone = dailyLogs.some((l) => l.steps !== undefined);

  const rows = [
    {
      id: "tutorial",
      title: tutorialDone ? "Tutorial done" : "Complete the tutorial",
      done: tutorialDone,
      onClick: () => {
        if (tutorialDone || tutorialActive) return;
        const started = useTutorialStore.getState().start({
          canInstall: install.kind === "prompt" || install.kind === "manual-ios",
          resume: true,
        });
        if (started) void router.navigate({ to: "/" });
      },
    },
    {
      id: "nutrition",
      title: "Log a day's nutrition",
      done: nutritionDone,
      onClick: () => focusOnToday(router, "stat-calories"),
    },
    {
      id: "steps",
      title: "Log a day's steps",
      done: stepsDone,
      onClick: () => focusOnToday(router, "stat-steps"),
    },
  ];

  const doneCount = rows.filter((r) => r.done).length;
  const allDone = doneCount === rows.length;

  /**
   * The exit. Only on Today, and only once: the card is not a thing that comes
   * back to congratulate you again on your next visit.
   */
  useEffect(() => {
    if (surface !== "today" || !allDone) return;
    // `leaving` is deliberately NOT a dependency. It was, and setting it
    // re-ran this effect, whose cleanup cancelled the timer it had just set -
    // so the card played its farewell and then stayed forever.
    setLeaving(true);
    const timer = window.setTimeout(() => {
      updateTutorialState({ cardDismissedAt: Date.now() });
      setGone(true);
    }, FAREWELL_MS);
    return () => window.clearTimeout(timer);
  }, [surface, allDone]);

  if (surface === "today" && (dismissed || gone)) return null;

  const handleDismiss = () => {
    const current = loadTutorialState() ?? { joinedAt: Date.now() };
    saveTutorialState({ ...current, cardDismissedAt: Date.now() });
    setDismissed(true);
  };

  const checklist = (
    <div className="group-list">
      {rows.map((row, idx) => (
        <button
          key={row.id}
          type="button"
          data-done={row.done ? "true" : "false"}
          onClick={row.onClick}
          className={
            "group-row w-full text-left " + (idx === 0 ? "" : "group-row-sep ") + "cursor-pointer"
          }
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="w-4 shrink-0 tabular-nums t-label text-ink-2">{idx + 1}</span>
            <span className={"truncate t-body " + (row.done ? "text-ink-2" : "text-ink")}>
              {row.title}
            </span>
          </div>

          {row.done ? (
            <>
              <span
                aria-hidden="true"
                data-testid="status-met"
                className="h-2.5 w-2.5 shrink-0 rounded-sm bg-ink"
              />
              <span className="sr-only">Done</span>
            </>
          ) : (
            <Chevron className="shrink-0 text-ink-2" size={16} />
          )}
        </button>
      ))}
    </div>
  );

  const header = (
    <div className="flex items-center gap-3 px-4 pb-2 pt-1">
      <TutorialRing done={doneCount} total={rows.length} complete={allDone} />
      <span className="min-w-0 flex-1 t-label text-ink-2">
        {allDone ? "All set" : "tasks complete"}
      </span>
      {surface === "today" && !allDone && (
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="-mr-2 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center text-ink-2"
        >
          <span className="t-label">Dismiss</span>
        </button>
      )}
    </div>
  );

  if (surface === "join") {
    return (
      <div data-onboarding-card className="space-y-1 py-2">
        {header}
        {checklist}
      </div>
    );
  }

  const exiting = leaving && allDone;

  return (
    <div
      ref={cardRef}
      data-onboarding-card
      className="mx-4 mb-4"
      style={{
        transformOrigin: "top left",
        transform: offset ?? (exiting ? "scale(0.98)" : "none"),
        opacity: exiting ? 0 : 1,
        transition: offset
          ? "none"
          : flying
            ? "transform 560ms cubic-bezier(0.2,0,0.2,1), opacity 560ms ease"
            : "opacity 420ms ease, transform 420ms ease",
        transitionDelay: exiting ? `${FAREWELL_MS - 420}ms` : "0ms",
      }}
      onTransitionEnd={() => setFlying(false)}
    >
      {header}
      {checklist}
    </div>
  );
}

/**
 * Take the user to the field the row is about.
 *
 * A checklist row that only says a thing is undone, without offering to go and
 * do it, is a to-do list the app wrote for somebody else.
 */
function focusOnToday(router: ReturnType<typeof useRouter>, fieldId: string) {
  void router.navigate({ to: "/" });
  window.setTimeout(() => {
    const field = document.getElementById(fieldId);
    if (field instanceof HTMLInputElement) {
      field.scrollIntoView({ block: "center", behavior: "smooth" });
      field.focus();
    }
  }, 120);
}
