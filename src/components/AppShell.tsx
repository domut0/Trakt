import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { type ReactNode } from "react";
import { useStore } from "../lib/store";

function Icon({ name }: { name: "home" | "chart" | "calendar" | "settings" }) {
  const stroke = "currentColor";
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke, strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "home") return (<svg {...common}><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/></svg>);
  if (name === "chart") return (<svg {...common}><path d="M4 19h16"/><path d="M6 15l4-5 4 3 4-7"/></svg>);
  if (name === "calendar") return (<svg {...common}><rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M7.5 13.5h3"/><path d="M13.5 13.5h3"/></svg>);
  return (<svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>);
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
      className="fixed left-0 right-0 top-0 z-40 flex items-center justify-between bg-accent px-4 py-2.5 text-accent-foreground"
    >
      <span className="flex items-center gap-2 text-[13px] font-medium">
        <span className="relative flex h-2 w-2">
          <span className="absolute inset-0 animate-ping rounded-full bg-accent-foreground/60"/>
          <span className="relative h-2 w-2 rounded-full bg-accent-foreground"/>
        </span>
        Workout in progress · {slot?.name}
      </span>
      <span className="text-[13px] font-medium opacity-90">Return →</span>
    </button>
  );
}

export function BottomNav() {
  const location = useLocation();
  const activeSessionId = useStore((s) => s.activeSessionId);
  const chartsEnabled = useStore((s) => s.chartsEnabled);
  const calendarEnabled = useStore((s) => s.calendarEnabled);
  if (location.pathname === "/workout") return null;
  const items = [
    { to: "/", label: "Home", icon: "home" as const },
    ...(chartsEnabled ? [{ to: "/charts", label: "Charts", icon: "chart" as const }] : []),
    ...(calendarEnabled ? [{ to: "/calendar", label: "Calendar", icon: "calendar" as const }] : []),
    { to: "/settings", label: "Settings", icon: "settings" as const },
  ];
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 hairline-t bg-background/95 backdrop-blur"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 8px)" }}
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around px-2 pt-2">
        {items.map((it) => {
          const active = location.pathname === it.to;
          return (
            <li key={it.to} className="flex-1">
              <Link
                to={it.to}
                className="flex flex-col items-center gap-0.5 py-1"
                style={{ color: active ? "var(--color-accent)" : "var(--color-muted-foreground)" }}
              >
                <Icon name={it.icon} />
                <span className="text-[11px] font-medium tracking-tight">{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {activeSessionId && <div className="pointer-events-none absolute inset-x-0 -top-px h-px bg-accent/40"/>}
    </nav>
  );
}

export function AppShell({ children, bottomPad = true }: { children: ReactNode; bottomPad?: boolean }) {
  const activeSessionId = useStore((s) => s.activeSessionId);
  const location = useLocation();
  const showBanner = activeSessionId && location.pathname !== "/workout";
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-background">
      <ActiveSessionBanner />
      <main className={showBanner ? "flex-1 pt-11" : "flex-1"} style={{ paddingBottom: bottomPad ? 88 : 0 }}>
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
