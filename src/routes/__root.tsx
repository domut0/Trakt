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
import { TutorialRail } from "../components/TutorialRail";
import { useCoachStore } from "../lib/coach-store";

/**
 * Both of the screens below previously styled themselves with `bg-primary`,
 * `text-primary-foreground`, `border-input` and `hover:bg-accent` -- shadcn
 * token names that left the tree with `src/components/ui/`. Tailwind silently
 * emits nothing for a class it cannot resolve, so these rendered as unstyled
 * black-on-white for as long as they have existed. Nobody noticed because you
 * have to break the router to see them.
 *
 * Styled here as an ordinary card with the plain fact on it, so a route that
 * only appears when something is broken still looks like the rest of the app.
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
    <div className="flex min-h-screen flex-col justify-center bg-paper px-4">
      <div className="mx-auto w-full max-w-md">
        <p className="t-caption text-ink-3">{code}</p>
        <div className="mt-4 rounded-lg bg-surface p-4">
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
      // "default" gives DARK status-bar glyphs, which was right for a paper
      // ground and is invisible on this one. black-translucent lets the app
      // ground run under the status bar, which is what a true-black app wants.
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Trakt" },
      { title: "Trakt" },
      {
        name: "description",
        content:
          "Bodyweight, macros and training, logged once a day and mirrored to your own Google Sheet.",
      },
      { property: "og:title", content: "Trakt" },
      {
        property: "og:description",
        content:
          "Bodyweight, macros and training, logged once a day and mirrored to your own Google Sheet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      // No font file at all, and so nothing to preload or precache. The app is
      // set in ui-rounded, which is SF Pro Rounded on the phone this runs on:
      // already resident, zero bytes, and no swap flash on a cold start because
      // there is nothing to swap. The build before this self-hosted Archivo for
      // its width axis, and the one before THAT blocked first paint on
      // fonts.googleapis.com - a network dependency in an app whose whole claim
      // is that it has none.
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
  const hydrateCoach = useCoachStore((s) => s.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  useEffect(() => {
    void hydrateCoach().catch(() => {});
  }, [hydrateCoach]);
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
        <TutorialRail />
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
      </ToastProvider>
    </QueryClientProvider>
  );
}
