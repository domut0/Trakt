import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "../lib/store";
import { useCoachStore } from "../lib/coach-store";
import { useTutorialStore } from "../lib/tutorial-store";
import { ClientBanner } from "./ClientBanner";
import { TutorialBanner } from "./TutorialBanner";
import { Gear } from "./icons";
import { StartWorkoutSheet } from "./StartWorkoutSheet";
import { WorkoutChooserSheet } from "./WorkoutChooserSheet";
import { CoachPlanPrompt } from "./CoachPlanPrompt";
import { useSyncStore } from "@/lib/sync-store";

type TabPath = "/" | "/plan" | "/history" | "/charts";
type TabItem = {
  to: TabPath;
  label: string;
  icon: "home" | "chart" | "calendar" | "plan";
};

/**
 * Four routed tabs, two either side of the Workout button.
 *
 * Settings is not among them. It was the fifth, and five routed tabs around a
 * centred action button cannot be balanced - one side always carries three, and
 * that was the lopsided bar. It is a screen visited rarely and never mid-set, so
 * it is a gear in the corner of every tab screen now (see AppShell), and History
 * moved into the slot it left.
 *
 * Order is Today, Plan | Charts, History: what you are about to do on the left
 * of the button, what you already did on the right.
 */
/**
 * Three, with the action in the middle.
 *
 * History and Charts left the bar for two icons on Today: they are places
 * you go to look at something, not places you log from, and a five-column
 * bar spent its width saying so. What is left is the three things the app
 * is for - the day, the plan, and training.
 */
const TABS: TabItem[] = [
  { to: "/", label: "Today", icon: "home" },
  { to: "/plan", label: "Plan", icon: "plan" },
];

function Icon({ name }: { name: TabItem["icon"] }) {
  const stroke = "currentColor";
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke,
    strokeWidth: 1.6,
    // Round again, matching src/components/icons.tsx. Square caps belonged to
    // the zero-radius build; with 4px corners everywhere they were the last
    // hard edge on the screen.
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    // Decorative: every tab renders its own visible text label right below the
    // icon, so exposing the glyph too would just double the announcement.
    "aria-hidden": true,
  };
  if (name === "home")
    return (
      <svg {...common}>
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5 10v10h14V10" />
      </svg>
    );
  if (name === "chart")
    return (
      <svg {...common}>
        <path d="M4 19h16" />
        <path d="M6 15l4-5 4 3 4-7" />
      </svg>
    );
  if (name === "plan")
    // A clipboard, not a second calendar: History already owns the dated grid,
    // and two date glyphs side by side in a five-tab bar are one glance apart.
    // A written-down list is what a weekly template actually is.
    return (
      <svg {...common}>
        <path d="M9 4.5H7.5A1.5 1.5 0 0 0 6 6v13.5A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H15" />
        <rect x="9" y="3" width="6" height="3" rx="1" />
        <path d="M9 11h6" />
        <path d="M9 15h4" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M7.5 13.5h3" />
      <path d="M13.5 13.5h3" />
    </svg>
  );
}

/**
 * The nav bar's Workout action button, filled (not stroked) rather than
 * picking up the outline treatment every routed tab icon uses - it's an
 * action, not a destination. Fill and weight carry that difference now;
 * colour does not, because colour is spoken for (see BottomNav). Sized to
 * match `Icon` above (22x22, viewBox 0 0 24 24).
 */
function FlameIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" />
    </svg>
  );
}

export function ActiveSessionBanner() {
  const activeSessionId = useStore((s) => s.activeSessionId);
  const sessions = useStore((s) => s.sessions);
  const slots = useStore((s) => s.slots);
  const location = useLocation();
  const router = useRouter();
  if (!activeSessionId) return null;
  if (location.pathname === "/workout") return null;
  const session = sessions.find((s) => s.id === activeSessionId);
  const slot = slots.find((sl) => sl.id === session?.splitSlotId);
  return (
    <button
      onClick={() => router.navigate({ to: "/workout" })}
      // In flow, not fixed over the top of the page: the app runs under a
      // translucent status bar (apple-mobile-web-app-status-bar-style), so a
      // bar pinned to top-0 sits beneath the clock and its button cannot be
      // tapped. In flow it also needs no reserved gap in <main> to match.
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      className="relative z-40 flex min-h-[44px] w-full shrink-0 items-center justify-between gap-3 bg-accent px-4 py-2.5 text-accent-foreground"
    >
      <span className="flex min-w-0 items-center gap-2 t-label font-medium">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inset-0 animate-ping bg-paper" />
          <span className="relative h-2 w-2 bg-paper" />
        </span>
        <span className="truncate">Workout in progress · {slot?.name}</span>
      </span>
      <span className="shrink-0 t-label font-medium opacity-90">Return →</span>
    </button>
  );
}

export function BottomNav({ onOpenChooser }: { onOpenChooser: () => void }) {
  const location = useLocation();
  const router = useRouter();
  const activeSessionId = useStore((s) => s.activeSessionId);
  // Logging is the one thing coach mode cannot offer: the data on screen is a
  // client's, and the read-only latch would refuse the write anyway. Better to
  // say so on the button than to let it open a sheet that silently does nothing.
  const viewingClient = useCoachStore((s) => s.viewing !== undefined);
  // A plan waiting to be reviewed marks the tab that holds it, so dismissing
  // the card does not hide the fact that something is waiting.
  const planWaiting = useSyncStore((s) => s.pendingCoachPlan !== undefined);
  if (location.pathname === "/workout") return null;
  const items = TABS;

  const renderTab = (it: TabItem) => {
    const active = location.pathname === it.to;
    return (
      <li key={it.to}>
        <Link
          to={it.to}

          // Full width of its grid cell, with an explicit height floor so the
          // 22px icon plus 11px label can never fall under 44px if either is
          // restyled later.
          //
          // The active tab is white, the rest are grey. That is all.
          //
          // It used to be a 2px rule across the top of the active cell, which
          // was the printed index this app was modelled on marking the section
          // your thumb is in. On a dark ground there is a real brightness step
          // between ink and ink-3, so the colour swap says "you are here" on
          // its own, and the rule was a second mark for a fact already stated.
          className={`flex min-h-[44px] w-full flex-col items-center justify-center gap-0.5 py-1 ${
            active ? "text-ink" : "text-ink-3"
          }`}
          aria-current={active ? "page" : undefined}
        >
          <span className="relative">
            <Icon name={it.icon} />
            {planWaiting && it.to === "/plan" && (
              <span
                aria-hidden="true"
                className="absolute -right-1.5 -top-0.5 h-2 w-2 rounded-full bg-accent"
              />
            )}
          </span>
          <span className="t-label font-medium">{it.label}</span>
        </Link>
      </li>
    );
  };

  return (
    <nav
      aria-label="Primary"
      className="relative z-30 shrink-0 bg-paper"
      // CLAMPED, not simply honoured. On the phone this app is actually used on
      // - Android, gesture navigation, the hint bar switched off - the inset
      // comes back at around 85px and nothing whatsoever is drawn in it, so the
      // bar floated a thumb's width above the bottom of a screen that had no
      // system furniture to clear. A sheet can afford to be generous here; the
      // nav is the one bar that is always on screen, and an inset it cannot see
      // is not a reason to spend an eighth of the display on black.
      //
      // The floor keeps the labels off the very edge. The ceiling is set below
      // an iOS home indicator's 34px on purpose: this bar's rows are 44px, so
      // an indicator drawn over the last few pixels of it costs nothing you can
      // tap, and the alternative is reserving space for a device nobody here
      // runs.
      style={{ paddingBottom: "clamp(8px, env(safe-area-inset-bottom, 0px), 16px)" }}
    >
      {/* THREE EQUAL COLUMNS, with the button in the middle one.

          An even grid has no halves to be unequal about: every cell is the
          same width and the middle one is the axis by construction. The
          labels still differ in width, so the GAPS between words differ -
          which is why the active tab is marked by colour alone and never by
          weight, since a bolder label is a wider one and would shift. */}
      <ul className="mx-auto grid max-w-md grid-cols-3 items-stretch px-2 pt-2">
        {items.map((it) => renderTab(it))}
        {/* Last in DOM order rather than placed by grid-column: an explicitly
            placed item still takes its own auto ROW. */}
        <li className="flex items-center justify-center">
          <button
            onClick={() => {
              if (viewingClient) return;
              if (activeSessionId) router.navigate({ to: "/workout" });
              else onOpenChooser();
            }}
            disabled={viewingClient}
            aria-label={
              viewingClient
                ? "Starting a workout is unavailable while viewing a client"
                : activeSessionId
                  ? "Return to active workout"
                  : "Start workout"
            }
            // Foreground, not accent. Accent in this bar means exactly one
            // thing - the tab you are on - so the action button states its rank
            // with fill and weight instead: a solid glyph and a semibold label
            // against two muted outlined tabs.
            className={
              "flex min-h-[44px] w-full flex-col items-center justify-center gap-0.5 px-1 py-1 rounded-md " +
              // Muted rather than hidden. A button that vanishes moves the tabs
              // on either side of it, and the bar's whole geometry is three equal
              // columns with the action in the middle one.
              (viewingClient ? "bg-ink-3 text-paper" : "bg-ink text-paper")
            }
          >
            <span className="relative flex items-center justify-center">
              <FlameIcon />
              {/* Live-session marker: a badge on the glyph, in the same
                  dot-and-pulse language as the banner at the top of the
                  screen. Deliberately not a colour swap - the session is not a
                  selection, so it must not borrow selection's colour. Reduced
                  motion is handled globally in styles.css. */}
              {activeSessionId && (
                <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-2 w-2">
                  <span className="absolute inset-0 animate-ping bg-ink rounded-md" />
                  <span className="relative h-2 w-2 bg-ink ring-2 ring-paper rounded-md" />
                </span>
              )}
            </span>
            <span className="t-label font-semibold">{activeSessionId ? "Return" : "Workout"}</span>
          </button>
        </li>
      </ul>
      {activeSessionId && (
        // A real rule, not ink at 40%. Opacity variants are the thing this
        // system bans outright, and one had survived here because it sits on a
        // decorative hairline nobody reads as text. --rule-strong is the tone
        // it was approximating, and it is a named colour rather than a value
        // that changes with whatever happens to be behind it.
        <div className="pointer-events-none absolute inset-x-0 -top-px h-px bg-rule-strong" />
      )}
    </nav>
  );
}

/**
 * Spends a rest day once it is over.
 *
 * A rest is the only card the clock can consume - there is nothing to finish -
 * so something has to notice midnight. Three triggers, because no single one of
 * them is enough on a phone:
 *
 *   ON MOUNT, which covers the ordinary case: the app was closed overnight and
 *   is opened the next morning.
 *
 *   ON RETURNING TO THE FOREGROUND, because a PWA left open in a background tab
 *   is not reloaded when you come back to it the next day.
 *
 *   ON A TIMER SET FOR THE NEXT LOCAL MIDNIGHT, for the app left open across
 *   it. Scheduled to the actual boundary rather than polled, and rescheduled
 *   each time it fires, so a device asleep through midnight still settles on
 *   the next wake through one of the two above.
 *
 * The store's own check is the real guard: all three of these do nothing unless
 * the date has genuinely moved past the day the rest was taken.
 */
function useRestDaySettles() {
  const settleRestDay = useStore((s) => s.settleRestDay);
  const hydrated = useStore((s) => s.hydrated);

  useEffect(() => {
    if (!hydrated) return;
    settleRestDay();

    const onVisible = () => {
      if (document.visibilityState === "visible") settleRestDay();
    };
    document.addEventListener("visibilitychange", onVisible);

    let timer: ReturnType<typeof setTimeout>;
    const atMidnight = () => {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
      timer = setTimeout(() => {
        settleRestDay();
        atMidnight();
      }, next.getTime() - now.getTime());
    };
    atMidnight();

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(timer);
    };
  }, [hydrated, settleRestDay]);
}

export function AppShell({ children }: { children: ReactNode }) {
  const activeSessionId = useStore((s) => s.activeSessionId);
  const viewingClient = useCoachStore((s) => s.viewing !== undefined);
  const tutorialActive = useTutorialStore((s) => s.active);
  const location = useLocation();
  const router = useRouter();
  // Exactly one banner occupies the top slot, and only 44px is reserved for it.
  // The priority order is: tutorial banner, then client banner, then active-session
  // banner. Whichever wins takes the slot, and only one is ever shown.
  const showTutorialBanner = tutorialActive;
  const showClientBanner = !showTutorialBanner && viewingClient;
  const showBanner = !showTutorialBanner && !showClientBanner && activeSessionId && location.pathname !== "/workout";
  const onTab = TABS.some((t) => t.to === location.pathname);

  useRestDaySettles();

  // Workout chooser + strength start flow, owned here so the nav's Workout
  // button works from every tab. StartWorkoutSheet is mounted from AppShell
  // (not a route) specifically so it survives index.tsx's own mount of it
  // being removed elsewhere - this is now the flow's only entry point that
  // doesn't require an active session already existing.
  const [chooserOpen, setChooserOpen] = useState(false);
  const [startSheetOpen, setStartSheetOpen] = useState(false);

  return (
    <div className="relative mx-auto flex h-[100dvh] max-w-md flex-col overflow-hidden bg-background">
      {showTutorialBanner ? (
        <TutorialBanner />
      ) : showClientBanner ? (
        <ClientBanner />
      ) : (
        <ActiveSessionBanner />
      )}
      <main
        // A plain fade, and deliberately no slide. A 24px horizontal travel on
        // every tab tap is the most app-template motion there was, and its
        // `both` fill left a transform on this element forever - which made it
        // the containing block for every fixed overlay inside it and put the
        // Accept button on a client's new plan off the bottom of the screen.
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain anim-route-fade"
      >
        {onTab && (
          // The corner where you go elsewhere: History and Charts on Today,
          // and Settings on every tab. One rule for the whole app rather than
          // two toolbars on one screen.
          //
          // Positioned against the shell rather than repeated in four route
          // headers, so it cannot drift between them - but INSIDE the scroll
          // container, so it travels with the header it belongs to instead of
          // hovering over whatever you have scrolled to. 49px puts its 44px box
          // on the centre line of a 28px t-title sitting under pt-14, and the
          // banners are in flow above <main>, so it needs no offset. Every
          // tab header carries pr-12 so a long title wraps rather than running
          // underneath it.
          <div
            className="absolute right-1.5 z-30 flex items-center justify-end"
            style={{ top: 49 }}
          >
            {location.pathname === "/" && (
              <>
                <Link
                  to="/history"
                  aria-label="History"
                  className="flex h-11 w-11 items-center justify-center text-ink-3"
                >
                  <Icon name="calendar" />
                </Link>
                <Link
                  to="/charts"
                  aria-label="Charts"
                  className="flex h-11 w-11 items-center justify-center text-ink-3"
                >
                  <Icon name="chart" />
                </Link>
              </>
            )}
            <Link
              to="/settings"
              aria-label="Settings"
              className="flex h-11 w-11 items-center justify-center text-ink-3"
            >
              <Gear size={22} />
            </Link>
          </div>
        )}
        {children}
      </main>
      {/* Mounted once, above everything: a plan can arrive while the person is
          on any tab, and the launch sync opens this itself. */}
      <CoachPlanPrompt />
      <BottomNav onOpenChooser={() => setChooserOpen(true)} />
      <WorkoutChooserSheet
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        onChooseStrength={() => {
          setChooserOpen(false);
          setStartSheetOpen(true);
        }}
      />
      <StartWorkoutSheet
        open={startSheetOpen}
        onClose={() => setStartSheetOpen(false)}
        onStart={() => {
          setStartSheetOpen(false);
          router.navigate({ to: "/workout" });
        }}
      />
    </div>
  );
}
