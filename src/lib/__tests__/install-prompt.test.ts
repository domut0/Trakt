import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetInstallPromptForTesting,
  initInstallPrompt,
  installMode,
  promptInstall,
  type BeforeInstallPromptEvent,
} from "../install-prompt";
import { loadTutorialState } from "../tutorial-state";

class MockBeforeInstallPromptEvent extends Event implements BeforeInstallPromptEvent {
  readonly platforms: string[] = ["web"];
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt = vi.fn().mockResolvedValue(undefined);

  constructor(outcome: "accepted" | "dismissed" = "accepted") {
    super("beforeinstallprompt", { cancelable: true });
    this.userChoice = Promise.resolve({ outcome, platform: "web" });
  }
}

describe("install-prompt", () => {
  const originalUserAgent = navigator.userAgent;
  let matchMediaMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    _resetInstallPromptForTesting();

    matchMediaMock = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: matchMediaMock,
    });

    Object.defineProperty(navigator, "userAgent", {
      writable: true,
      configurable: true,
      value:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    Object.defineProperty(navigator, "standalone", {
      writable: true,
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    _resetInstallPromptForTesting();
    Object.defineProperty(navigator, "userAgent", {
      writable: true,
      configurable: true,
      value: originalUserAgent,
    });
    vi.restoreAllMocks();
  });

  describe("the four InstallMode branches", () => {
    it("branch 1: mode is installed when display-mode is standalone", () => {
      matchMediaMock.mockImplementation((query: string) => ({
        matches: query === "(display-mode: standalone)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      initInstallPrompt();
      expect(installMode()).toEqual({ kind: "installed" });
      expect(loadTutorialState()?.installedSeen).toBe(true);
    });

    it("branch 1: mode is installed when navigator.standalone is true on iOS", () => {
      Object.defineProperty(navigator, "standalone", {
        writable: true,
        configurable: true,
        value: true,
      });

      initInstallPrompt();
      expect(installMode()).toEqual({ kind: "installed" });
      expect(loadTutorialState()?.installedSeen).toBe(true);
    });

    it("branch 1: mode becomes installed and marks seen when appinstalled fires", () => {
      initInstallPrompt();
      expect(installMode()).toEqual({ kind: "unavailable" });

      window.dispatchEvent(new Event("appinstalled"));
      expect(installMode()).toEqual({ kind: "installed" });
      expect(loadTutorialState()?.installedSeen).toBe(true);
    });

    it("branch 2: mode is prompt when beforeinstallprompt is held, and promptInstall resolves outcome", async () => {
      initInstallPrompt();

      const event = new MockBeforeInstallPromptEvent("accepted");
      const defaultPrevented = !window.dispatchEvent(event);
      // In DOM, preventDefault makes dispatchEvent return false
      expect(defaultPrevented).toBe(true);

      expect(installMode()).toEqual({ kind: "prompt" });

      const result = await promptInstall();
      expect(event.prompt).toHaveBeenCalled();
      expect(result).toBe(true);
      expect(loadTutorialState()?.installedSeen).toBe(true);
    });

    it("branch 2: promptInstall resolves false when user dismisses the prompt", async () => {
      initInstallPrompt();

      const event = new MockBeforeInstallPromptEvent("dismissed");
      window.dispatchEvent(event);
      expect(installMode()).toEqual({ kind: "prompt" });

      const result = await promptInstall();
      expect(result).toBe(false);
      expect(installMode()).not.toEqual({ kind: "prompt" });
    });

    it("branch 3: mode is manual-ios on iOS Safari without beforeinstallprompt", () => {
      Object.defineProperty(navigator, "userAgent", {
        writable: true,
        configurable: true,
        value:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      });

      initInstallPrompt();
      expect(installMode()).toEqual({ kind: "manual-ios" });
    });

    it("branch 4: mode is unavailable on desktop or non-installable browsers", () => {
      initInstallPrompt();
      expect(installMode()).toEqual({ kind: "unavailable" });
    });
  });

  describe("SSR safety", () => {
    it("does not touch window or navigator at module scope", async () => {
      const savedWindow = globalThis.window;
      const savedNavigator = globalThis.navigator;

      try {
        // Temporarily simulate an SSR environment where window and navigator are undefined
        // @ts-expect-error simulating SSR
        delete globalThis.window;
        // @ts-expect-error simulating SSR
        delete globalThis.navigator;

        // Importing in an environment without window/navigator must succeed without throwing
        let importedModule: typeof import("../install-prompt") | undefined;
        await expect(
          (async () => {
            importedModule = await import(`../install-prompt?ssr-test=${Date.now()}`);
          })(),
        ).resolves.not.toThrow();

        expect(importedModule?.installMode()).toEqual({ kind: "unavailable" });
      } finally {
        globalThis.window = savedWindow;
        globalThis.navigator = savedNavigator;
      }
    });
  });
});
