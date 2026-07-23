// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      VitePWA({
        // Controlled updates: the SW waits for an explicit user tap (see
        // PwaUpdatePrompt) before taking over -- never a silent skipWaiting
        // mid-session. Registered manually (injectRegister: false) via
        // virtual:pwa-register/react since this SSR app has no index.html
        // for the plugin to auto-inject a register script into.
        registerType: "prompt",
        injectRegister: false,
        // vite-plugin-pwa defaults to reading `viteConfig.build.outDir`, but
        // the tanstackStart/nitro preset sets the client build's outDir on a
        // Vite Environment the plugin doesn't see, so that resolves to
        // undefined and the plugin silently falls back to "dist" (a stray
        // top-level folder, not the real client output). Point it at nitro's
        // actual public output explicitly so the SW/manifest land where the
        // server serves them from and globPatterns can find the built assets.
        outDir: ".output/public",
        includeAssets: ["favicon.ico", "icon.svg", "apple-touch-icon.png"],
        manifest: {
          name: "Anything But The Notes App",
          short_name: "ABTN Log",
          description:
            "A frictionless workout logger for lifters. Weight and reps, nothing else in the way.",
          theme_color: "#1a1c1f",
          background_color: "#1a1c1f",
          display: "standalone",
          start_url: "/",
          icons: [
            { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
            { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
            { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
          ],
        },
        workbox: {
          // Precache the built app shell (hashed JS/CSS + local static assets).
          // NOTE: this is a real TanStack Start SSR app, not a static SPA -- the
          // production build emits no index.html/static HTML shell under
          // .output/public (every route is rendered by the server per-request),
          // so there is nothing valid to point a classic `navigateFallback` at.
          // A `navigateFallback` here would either 404 (pointing at a file that
          // doesn't exist) or, if faked by pointing at "/", would silently serve
          // a stale shell for EVERY navigation once the SW is active -- breaking
          // SSR for online users. Instead, navigation (HTML document) requests
          // are cached at runtime via NetworkFirst below: online users always
          // get the fresh server-rendered page, and previously-visited routes
          // remain available from cache when the network is unreachable.
          globPatterns: ["**/*.{js,css,svg,ico,png,woff2}"],
          // vite-plugin-pwa defaults workbox.navigateFallback to "index.html"
          // and shallow-merges our workbox object on top of that default, so
          // leaving this unset would silently keep it. There is no index.html
          // in the precache (see note above), so that default would register
          // a NavigationRoute bound to a file that was never cached -- it
          // would 404 on every navigation, AND (being registered before our
          // runtimeCaching rule below) would shadow it entirely. Explicitly
          // disabling it is required, not optional.
          navigateFallback: undefined,
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
                cacheName: "pages",
                networkTimeoutSeconds: 3,
                expiration: { maxEntries: 50 },
              },
            },
          ],
        },
        // No service worker under `npm run dev` -- keeps the dev loop clean.
        devOptions: { enabled: false },
      }),
    ],
  },
});
