import { useEffect, useSyncExternalStore } from "react";
import { markInstalledSeen } from "./tutorial-state";

/**
 * PWA installation detection and prompt management.
 *
 * ## The two installation paths
 *
 * - Android / Chrome: Fires a `beforeinstallprompt` event that can be captured
 *   and triggered later by user interaction. On accept, the `appinstalled` event
 *   fires.
 * - iOS Safari: Does not support `beforeinstallprompt` or programmatic install.
 *   The user must manually tap Share -> Add to Home Screen.
 *
 * ## Standalone detection
 *
 * When the app is launched from the home screen, either the CSS media query
 * `(display-mode: standalone)` matches or iOS Safari sets `navigator.standalone`.
 * Whenever either is observed, `markInstalledSeen()` is recorded so the checklist
 * reflects the install from then on.
 *
 * ## SSR safety
 *
 * This module touches `window` and `navigator` across its detection paths.
 * None of those APIs exist during server rendering. All globals are guarded
 * behind checks and evaluated inside functions only -- never at module scope.
 */

export type InstallMode =
  | { kind: "installed" } // already running from the home screen
  | { kind: "prompt" } // Android: we hold a deferred prompt
  | { kind: "manual-ios" } // iOS Safari: show the drawn frames
  | { kind: "unavailable" }; // desktop, or a browser that cannot install

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const MODE_INSTALLED: InstallMode = Object.freeze({ kind: "installed" });
const MODE_PROMPT: InstallMode = Object.freeze({ kind: "prompt" });
const MODE_MANUAL_IOS: InstallMode = Object.freeze({ kind: "manual-ios" });
const MODE_UNAVAILABLE: InstallMode = Object.freeze({ kind: "unavailable" });

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let appInstalledFired = false;
let listenersInstalled = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  if (appInstalledFired) return true;
  try {
    if (window.matchMedia?.("(display-mode: standalone)")?.matches) {
      return true;
    }
  } catch {
    // Ignore matchMedia issues in restricted environments
  }
  try {
    if ((navigator as { standalone?: boolean })?.standalone === true) {
      return true;
    }
  } catch {
    // Ignore navigator issues
  }
  return false;
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIos =
    /iPad|iPhone|iPod/i.test(ua) ||
    (typeof navigator.platform === "string" &&
      navigator.platform === "MacIntel" &&
      (navigator.maxTouchPoints ?? 0) > 1);
  if (!isIos) return false;

  // Be generous: on iOS, unless it is explicitly an identifiable third-party browser
  // without Add to Home Screen support, treat it as iOS Safari.
  const isOtherBrowser = /CriOS|FxiOS|EdgiOS/i.test(ua);
  return !isOtherBrowser;
}

function handleBeforeInstallPrompt(e: BeforeInstallPromptEvent) {
  e.preventDefault();
  deferredPrompt = e;
  notify();
}

function handleAppInstalled() {
  deferredPrompt = null;
  appInstalledFired = true;
  markInstalledSeen();
  notify();
}

function handleDisplayModeChange(e: MediaQueryListEvent) {
  if (e.matches) {
    markInstalledSeen();
    notify();
  }
}

/** Call once at app start (client only). Registers the listeners. */
export function initInstallPrompt(): void {
  if (typeof window === "undefined" || listenersInstalled) return;
  listenersInstalled = true;

  if (isInstalled()) {
    markInstalledSeen();
  }

  window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt as EventListener);
  window.addEventListener("appinstalled", handleAppInstalled);

  try {
    const mq = window.matchMedia?.("(display-mode: standalone)");
    mq?.addEventListener?.("change", handleDisplayModeChange);
  } catch {
    // Ignore unsupported matchMedia listener
  }
}

/** Current mode. Re-read after the events below fire. */
export function installMode(): InstallMode {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return MODE_UNAVAILABLE;
  }

  if (isInstalled()) {
    markInstalledSeen();
    return MODE_INSTALLED;
  }

  if (deferredPrompt !== null) {
    return MODE_PROMPT;
  }

  if (isIosSafari()) {
    return MODE_MANUAL_IOS;
  }

  return MODE_UNAVAILABLE;
}

/** Android only. Fires the held native prompt. Resolves true if accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  const promptEvent = deferredPrompt;
  deferredPrompt = null;
  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    const accepted = choice?.outcome === "accepted";
    if (accepted) {
      markInstalledSeen();
    }
    notify();
    return accepted;
  } catch {
    notify();
    return false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getServerSnapshot(): InstallMode {
  return MODE_UNAVAILABLE;
}

/** React hook wrapping the above, re-rendering on the events. */
export function useInstallMode(): InstallMode {
  useEffect(() => {
    initInstallPrompt();
  }, []);
  return useSyncExternalStore(subscribe, installMode, getServerSnapshot);
}

/** Internal reset helper for test suites only. */
export function _resetInstallPromptForTesting(): void {
  deferredPrompt = null;
  appInstalledFired = false;
  if (typeof window !== "undefined") {
    window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt as EventListener);
    window.removeEventListener("appinstalled", handleAppInstalled);
    try {
      const mq = window.matchMedia?.("(display-mode: standalone)");
      mq?.removeEventListener?.("change", handleDisplayModeChange);
    } catch {
      // Ignore
    }
  }
  listenersInstalled = false;
  listeners.clear();
}
