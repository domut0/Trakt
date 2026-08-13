import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "../lib/store";
import { StartWorkoutSheet } from "./StartWorkoutSheet";
import { WorkoutChooserSheet } from "./WorkoutChooserSheet";

type TabPath = "/" | "/history" | "/charts" | "/settings";
type TabItem = {
  to: TabPath;
  label: string;
  icon: "home" | "chart" | "calendar" | "settings";
  requires?: "charts";
};

const ALL_TABS: TabItem[] = [
  { to: "/", label: "Today", icon: "home" },
  { to: "/history", label: "History", icon: "calendar" },
  { to: "/charts", label: "Charts", icon: "chart", requires: "charts" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

/**
 * Ordered list of tabs currently shown in the bottom nav, respecting the
 * Charts toggle in Settings. Shared by BottomNav (rendering) and AppShell
 * (swipe navigation + directional transitions) so both always agree on tab
 * order.
 */
function getEnabledTabs(chartsEnabled: boolean): TabItem[] {
  return ALL_TABS.filter((t) => {
    if (t.requires === "charts") return chartsEnabled;
    return true;
  });
}

/**
 * Direction of the most recent tab-to-tab navigation, recorded right before
 * the navigate() call fires (bottom-nav tap or swipe) and consumed once by
 * the next AppShell mount to pick its entrance animation. Module-level
 * because each tab page mounts a fresh AppShell instance, so this can't live
 * in component state. Never touched during SSR (only DOM event handlers
 * write to it), so it's always null on the server and on a fresh client
 * load - no hydration mismatch.
 */
type NavDirection = "forward" | "back" | null;
let lastNavDirection: NavDirection = null;

/**
 * True if a swipe gesture should be left alone: it started inside an
 * explicitly-marked container (e.g. the Charts chip row), or inside any
 * element that's actually horizontally scrollable.
 */
function shouldIgnoreSwipe(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  if (el.closest("[data-swipe-ignore]")) return true;
  let node: HTMLElement | null = el;
  while (node && node !== document.body) {
    if (node.scrollWidth > node.clientWidth) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
    node = node.parentElement;
  }
  return false;
}

function Icon({ name }: { name: "home" | "chart" | "calendar" | "settings" }) {
  const stroke = "currentColor";
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke,
    strokeWidth: 1.6,
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
  if (name === "calendar")
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
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

/**
 * The nav bar's Workout action button, filled (not stroked) so it reads as
 * the accent colour rather than picking up the outline treatment every
 * routed tab icon uses - it's an action, not a destination. Sized to match
 * `Icon` above (22x22, viewBox 0 0 24 24).
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
          <span className="absolute inset-0 animate-ping rounded-full bg-accent-foreground/60" />
          <span className="relative h-2 w-2 rounded-full bg-accent-foreground" />
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
  const chartsEnabled = useStore((s) => s.chartsEnabled);
  if (location.pathname === "/workout") return null;
  const items = getEnabledTabs(chartsEnabled);
  const currentIndex = items.findIndex((it) => it.to === location.pathname);

  // Split the ROUTED tabs (never the Workout button) into two halves that sit
  // either side of it.
  //
  // The centring does NOT depend on this split being even, which is what was
  // wrong before: an odd routed-tab count (Charts off) left the button off by
  // half a slot. It is exact because the two <ul>s are `flex-1` - that is
  // `flex: 1 1 0%`, so both have a zero flex basis and an equal grow factor -
  // around a `shrink-0` centre. Whatever width the centre takes, the remaining
  // free space is split into two equal halves, so the centre lands on the axis
  // for 3 routed tabs (2 left, 1 right) exactly as it does for 4.
  //
  // The tabs themselves are then distributed WITHIN their half, so with Charts
  // off the lone right-hand tab is centred in the right half rather than being
  // evenly spaced against the left pair. That is a deliberate trade: the action
  // button is the thing a thumb hunts for, and it must not move when a setting
  // in another screen is toggled.
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
          className="flex min-h-[44px] w-full flex-col items-center justify-center gap-0.5 py-1"
          aria-current={active ? "page" : undefined}
          style={{ color: active ? "var(--color-accent)" : "var(--color-muted-foreground)" }}
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
      className="relative z-30 shrink-0 hairline-t bg-surface"
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
            className="flex min-h-[44px] min-w-[56px] flex-col items-center justify-center gap-0.5 py-1"
            style={{ color: "var(--color-accent)" }}
          >
            <FlameIcon />
            <span className="t-label font-semibold">
              {activeSessionId ? "Return" : "Workout"}
            </span>
          </button>
        </div>
        <ul className="flex flex-1 items-stretch justify-around">
          {rightItems.map((it, i) => renderTab(it, splitAt + i))}
        </ul>
      </div>
      {activeSessionId && (
        <div className="pointer-events-none absolute inset-x-0 -top-px h-px bg-accent/40" />
      )}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const activeSessionId = useStore((s) => s.activeSessionId);
  const chartsEnabled = useStore((s) => s.chartsEnabled);
  const location = useLocation();
  const router = useRouter();
  const showBanner = activeSessionId && location.pathname !== "/workout";

  // Workout chooser + strength start flow, owned here so the nav's Workout
  // button works from every tab. StartWorkoutSheet is mounted from AppShell
  // (not a route) specifically so it survives index.tsx's own mount of it
  // being removed elsewhere - this is now the flow's only entry point that
  // doesn't require an active session already existing.
  const [chooserOpen, setChooserOpen] = useState(false);
  const [startSheetOpen, setStartSheetOpen] = useState(false);

  // Ordered enabled-tab paths, for both swipe navigation and figuring out
  // whether the current page is a tab at all (swipes only act on tabs,
  // e.g. never on /session/$id, which has its own row swipe gestures).
  const tabPaths = useMemo(() => getEnabledTabs(chartsEnabled).map((t) => t.to), [chartsEnabled]);
  const tabIndex = tabPaths.findIndex((p) => p === location.pathname);

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

  const touchStartRef = useRef<{ x: number; y: number; time: number; ignore: boolean } | null>(
    null,
  );

  const onTouchStart = (e: React.TouchEvent) => {
    if (tabIndex === -1) return;
    const t = e.touches[0];
    touchStartRef.current = {
      x: t.clientX,
      y: t.clientY,
      time: Date.now(),
      ignore: shouldIgnoreSwipe(e.target),
    };
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || start.ignore || tabIndex === -1) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const dt = Date.now() - start.time;
    const isDeliberateSwipe = Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8 && dt < 600;
    if (!isDeliberateSwipe) return;
    if (dx < 0 && tabIndex < tabPaths.length - 1) {
      // Swipe left -> next tab.
      lastNavDirection = "forward";
      router.navigate({ to: tabPaths[tabIndex + 1] });
    } else if (dx > 0 && tabIndex > 0) {
      // Swipe right -> previous tab.
      lastNavDirection = "back";
      router.navigate({ to: tabPaths[tabIndex - 1] });
    }
  };

  return (
    <div className="mx-auto flex h-[100dvh] max-w-md flex-col overflow-hidden bg-background">
      <ActiveSessionBanner />
      <main
        className={
          "min-h-0 flex-1 overflow-y-auto overscroll-contain " +
          (showBanner ? "pt-11 " : "") +
          routeAnimClass
        }
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
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
