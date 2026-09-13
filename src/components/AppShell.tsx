import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useStore } from "../lib/store";
import { Gear } from "./icons";
import { StartWorkoutSheet } from "./StartWorkoutSheet";
import { WorkoutChooserSheet } from "./WorkoutChooserSheet";

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
const TABS: TabItem[] = [
  { to: "/", label: "Today", icon: "home" },
  { to: "/plan", label: "Plan", icon: "plan" },
  { to: "/charts", label: "Charts", icon: "chart" },
  { to: "/history", label: "History", icon: "calendar" },
];

/**
 * Direction of the most recent tab-to-tab navigation, recorded right before
 * the navigate() call fires (a bottom-nav tap) and consumed once by
 * the next AppShell mount to pick its entrance animation. Module-level
 * because each tab page mounts a fresh AppShell instance, so this can't live
 * in component state. Never touched during SSR (only DOM event handlers
 * write to it), so it's always null on the server and on a fresh client
 * load - no hydration mismatch.
 */
type NavDirection = "forward" | "back" | null;
let lastNavDirection: NavDirection = null;

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
      // min-h-[44px] is not only the touch-target floor: AppShell already
      // reserves exactly pt-11 (44px) for this banner, and at py-2.5 the bar
      // measured ~38px, so the reserved gap never matched the real bar.
      className="fixed left-0 right-0 top-0 z-40 flex min-h-[44px] items-center justify-between gap-3 bg-accent px-4 py-2.5 text-accent-foreground"
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
  if (location.pathname === "/workout") return null;
  const items = TABS;
  const currentIndex = items.findIndex((it) => it.to === location.pathname);

  // Two routed tabs either side of the Workout button.
  //
  // The centring is exact because both <ul>s are `flex-1` - `flex: 1 1 0%`, a
  // zero basis and an equal grow factor - around a `shrink-0` centre, so the
  // free space is halved whatever width the button takes. With the tab count
  // now even, the four cells are also equal to each other, which is what the
  // five-tab bar could not do: it had to put three on one side.
  const splitAt = Math.ceil(items.length / 2);
  const leftItems = items.slice(0, splitAt);
  const rightItems = items.slice(splitAt);

  const renderTab = (it: TabItem, i: number) => {
    const active = location.pathname === it.to;
    return (
      <li key={it.to} className="flex-1">
        <Link
          to={it.to}
          onClick={() => {
            // Record travel direction before the route change so the
            // page we're about to mount knows which way to slide in.
            if (currentIndex !== -1 && i !== currentIndex) {
              lastNavDirection = i > currentIndex ? "forward" : "back";
            }
          }}
          // Full width of its flex-1 <li>, with an explicit height floor so the
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
          <Icon name={it.icon} />
          <span className="t-label font-medium">{it.label}</span>
        </Link>
      </li>
    );
  };

  return (
    <nav
      aria-label="Primary"
      className="relative z-30 shrink-0 bg-paper"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 8px)" }}
    >
      <div className="mx-auto flex max-w-md items-stretch justify-between px-2 pt-2">
        <ul className="flex flex-1 items-stretch justify-around">
          {leftItems.map((it, i) => renderTab(it, i))}
        </ul>
        <div className="flex shrink-0 items-center justify-center px-1">
          <button
            onClick={() =>
              activeSessionId ? router.navigate({ to: "/workout" }) : onOpenChooser()
            }
            aria-label={activeSessionId ? "Return to active workout" : "Start workout"}
            // Losing the old `w-full` when this moved out of a flex-1 <li> left
            // the button as wide as its label, and "Return" is only ~36px - under
            // the 44px minimum, in the exact state where the user most needs to
            // hit it. The floor also keeps the button from changing width when
            // the label swaps between "Workout" and "Return", which would
            // otherwise shift the whole nav mid-session.
            // Foreground, not accent. Accent in this bar now means exactly one
            // thing - the tab you are on - so the action button states its
            // rank with fill and weight instead: a solid glyph and a semibold
            // label against four muted outlined tabs. When it was accent too,
            // two items lit up at once and neither one told you where you were.
            // The inked cell, which is this app's one mark for "this one": the
            // selected day in the week strip and the current lift in the plan
            // list both wear it. Before this the action button was a 22px glyph
            // and a label at exactly the routed tabs' size and geometry,
            // differing only by fill and weight, so it read as a fifth tab
            // rather than as the thing the bar exists to launch.
            className="flex min-h-[44px] min-w-[56px] flex-col items-center justify-center gap-0.5 bg-ink px-3 py-1 text-paper rounded-md"
          >
            <span className="relative flex items-center justify-center">
              <FlameIcon />
              {/* Live-session marker: a badge on the glyph, in the same
                  dot-and-pulse language as the banner at the top of the
                  screen. Deliberately not a colour swap - the session is not
                  a selection, so it must not borrow selection's colour.
                  Reduced motion is handled globally in styles.css. */}
              {activeSessionId && (
                <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-2 w-2">
                  <span className="absolute inset-0 animate-ping bg-ink rounded-md" />
                  <span className="relative h-2 w-2 bg-ink ring-2 ring-paper rounded-md" />
                </span>
              )}
            </span>
            <span className="t-label font-semibold">{activeSessionId ? "Return" : "Workout"}</span>
          </button>
        </div>
        <ul className="flex flex-1 items-stretch justify-around">
          {rightItems.map((it, i) => renderTab(it, splitAt + i))}
        </ul>
      </div>
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

export function AppShell({ children }: { children: ReactNode }) {
  const activeSessionId = useStore((s) => s.activeSessionId);
  const location = useLocation();
  const router = useRouter();
  const showBanner = activeSessionId && location.pathname !== "/workout";
  const onTab = TABS.some((t) => t.to === location.pathname);

  // Workout chooser + strength start flow, owned here so the nav's Workout
  // button works from every tab. StartWorkoutSheet is mounted from AppShell
  // (not a route) specifically so it survives index.tsx's own mount of it
  // being removed elsewhere - this is now the flow's only entry point that
  // doesn't require an active session already existing.
  const [chooserOpen, setChooserOpen] = useState(false);
  const [startSheetOpen, setStartSheetOpen] = useState(false);

  // Picked once per mount from whatever direction the bottom-nav tap or
  // swipe recorded right before navigating here; null (fresh load / deep
  // link) falls back to a plain fade with no horizontal slide.
  const [routeAnimClass] = useState(() => {
    const dir = lastNavDirection;
    lastNavDirection = null;
    if (dir === "forward") return "anim-route-in-right";
    if (dir === "back") return "anim-route-in-left";
    return "anim-route-fade";
  });

  return (
    <div className="relative mx-auto flex h-[100dvh] max-w-md flex-col overflow-hidden bg-background">
      <ActiveSessionBanner />
      {onTab && (
        // Settings, in the corner of every tab screen.
        //
        // Positioned against the shell rather than repeated in four route
        // headers, so it cannot drift between them - and outside <main>, so it
        // does not scroll away. 49px puts its 44px box on the centre line of a
        // 28px t-title sitting under pt-14, and the banner pushes it down by
        // exactly the pt-11 the banner reserves. Every tab header carries pr-12
        // so a long title wraps rather than running underneath it.
        <Link
          to="/settings"
          aria-label="Settings"
          className="absolute right-1.5 z-30 flex h-11 w-11 items-center justify-center text-ink-3"
          style={{ top: showBanner ? 93 : 49 }}
        >
          <Gear size={22} />
        </Link>
      )}
      <main
        className={
          "min-h-0 flex-1 overflow-y-auto overscroll-contain " +
          (showBanner ? "pt-11 " : "") +
          routeAnimClass
        }
      >
        {children}
      </main>
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
