import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { useStore } from "../lib/store";
import { PwaUpdatePrompt } from "../components/PwaUpdatePrompt";
import { WriteErrorBanner } from "../components/WriteErrorBanner";
import { SyncEngine } from "../components/SyncEngine";
import { ToastProvider } from "../components/Toast";

/**
 * Both of the screens below previously styled themselves with `bg-primary`,
 * `text-primary-foreground`, `border-input` and `hover:bg-accent` -- shadcn
 * token names that left the tree with `src/components/ui/`. Tailwind silently
 * emits nothing for a class it cannot resolve, so these rendered as unstyled
 * black-on-white for as long as they have existed. Nobody noticed because you
 * have to break the router to see them.
 *
 * Set here as a timetable's own out-of-service notice: the page number in the
 * margin, a heavy rule, and the plain fact underneath it.
 */
function NoticePage({
  code,
  title,
  children,
  actions,
}: {
  code: string;
  title: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col justify-center bg-paper px-5">
      <div className="mx-auto w-full max-w-md">
        <p className="t-caption text-ink-3">{code}</p>
        <div className="mt-1.5 rule-heavy-t pt-3">
          <h1 className="t-heading text-ink">{title}</h1>
          <div className="mt-2 t-body text-ink-2">{children}</div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">{actions}</div>
      </div>
    </div>
  );
}

const noticeButton =
  "inline-flex min-h-11 items-center justify-center bg-ink px-4 t-body font-semibold text-paper";
const noticeButtonQuiet =
  "inline-flex min-h-11 items-center justify-center border border-rule-strong px-4 t-body text-ink";

function NotFoundComponent() {
  return (
    <NoticePage
      code="Not found"
      title="No page at this address"
      actions={
        <Link to="/" className={noticeButton}>
          Go to today
        </Link>
      }
    >
      Nothing is here. The link was probably typed by hand, or it pointed at something that has
      since been renamed.
    </NoticePage>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <NoticePage
      code="Error"
      title="This screen failed to render"
      actions={
        <>
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className={noticeButton}
          >
            Try again
          </button>
          <a href="/" className={noticeButtonQuiet}>
            Go to today
          </a>
        </>
      }
    >
      {/* The old copy said "something went wrong on our end". There is no our
          end: no account, no server, no network call in the critical path. The
          failure is on this device, and saying so is also the useful thing,
          because it tells him his data is not what broke. */}
      Your data is safe on this device. Nothing here talks to a server, so this is a bug in the
      screen itself rather than a lost connection.
    </NoticePage>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#F3F4F5" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      // "default" gives dark status-bar glyphs, which is what a paper ground
      // needs; "black" was correct only while the app was dark.
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: "ABTN Log" },
      { title: "Anything But The Notes App" },
      {
        name: "description",
        content:
          "A frictionless workout logger for lifters. Weight and reps, nothing else in the way.",
      },
      { property: "og:title", content: "Anything But The Notes App" },
      {
        property: "og:description",
        content:
          "A frictionless workout logger for lifters. Weight and reps, nothing else in the way.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      // No font CDN. This is an offline-first PWA and the previous build blocked
      // first paint on fonts.googleapis.com, which is a network dependency in an
      // app whose whole claim is that it has none. Archivo is served from
      // public/fonts and precached with the rest of the shell; preloading it
      // stops the swap flash on a cold start.
      {
        rel: "preload",
        href: "/fonts/archivo-variable.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {/* Emitted into the built markup on purpose: a contract only the source
            can see is a contract nobody can audit. Grep the build for the seed
            key to confirm it survived. */}
        <div
          dangerouslySetInnerHTML={{
            __html: `<!--
THESIS: A training day is a schedule, so print it as one. Planned is the scheduled
column, logged is the actual, and the gap between them is a delay. Refuses the stack
of floating rounded cards every tracker ships.
OWN-WORLD: Paper #F3F4F5, one slate ink #282D33, one signal red for the exception. Archivo
variable on its width axis. Rank comes from rule weight, never fill: hairline divides
rows, rule divides sections, 2px ink opens a table. No elevation and no gray ramp;
corners eased to 4px after the first build read as severe. State is carried by mark (filled square, struck rule), metric identity by hatch
angle. Tables bleed to the trim; the gutter lives on the cell.
STORY: He reads the day as scheduled against actual, logs a set in one tap, and the
figure flaps into place like a departure board committing.
FIRST VIEWPORT: No title card. The date sits in the top-left margin the way a
timetable names its page. One ruled table runs to both trims: narrow tabular hour
column at the left, the day's rows against it. The now line is a full-bleed 2px ink
rule with the time set into it. Macros are a ruled row of figures, not a ring. The
primary action sits in the bottom third, at thumb height.
FORM: The Printed Timetable. Candidate 5 of 7 on the grounded list; seed 95982b50.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish
review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
-->`,
          }}
        />
        {children}
        <Scripts />
      </body>
    </html>
  );
}

// Client-only: loads persisted state from IndexedDB (seeding it on first-ever
// run) after mount. useEffect never runs during SSR, so this never touches
// IndexedDB on the server. Renders nothing.
function StoreHydrator() {
  const hydrate = useStore((s) => s.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Mounted here, not in AppShell: the /workout route bypasses AppShell, so
          useToast() would return its no-op fallback there. Same reason
          WriteErrorBanner lives at this level. */}
      <ToastProvider>
        <StoreHydrator />
        <SyncEngine />
        <PwaUpdatePrompt />
        <WriteErrorBanner />
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
      </ToastProvider>
    </QueryClientProvider>
  );
}
