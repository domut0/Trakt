import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFromVideo, isBarcodeDetectorAvailable } from "../barcode";

describe("isBarcodeDetectorAvailable", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true when BarcodeDetector is present on globalThis", () => {
    class MockBarcodeDetector {
      detect = vi.fn();
    }
    vi.stubGlobal("BarcodeDetector", MockBarcodeDetector);
    expect(isBarcodeDetectorAvailable()).toBe(true);
  });

  it("returns false when BarcodeDetector is absent or undefined", () => {
    vi.stubGlobal("BarcodeDetector", undefined);
    expect(isBarcodeDetectorAvailable()).toBe(false);
  });
});

describe("decodeFromVideo", () => {
  let mockVideo: HTMLVideoElement;

  beforeEach(() => {
    mockVideo = {
      readyState: 4, // HAVE_ENOUGH_DATA
      videoWidth: 640,
      videoHeight: 480,
    } as unknown as HTMLVideoElement;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resolves to aborted immediately when passed an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await decodeFromVideo(mockVideo, controller.signal);
    expect(result).toEqual({
      ok: false,
      reason: "aborted",
      message: "Barcode scan aborted.",
    });
  });

  it("resolves to aborted when signal aborts during scanning rather than hanging", async () => {
    vi.stubGlobal("BarcodeDetector", undefined);
    // Unready video keeps scanner in polling loop
    const unreadyVideo = {
      readyState: 0,
      videoWidth: 0,
      videoHeight: 0,
    } as unknown as HTMLVideoElement;

    const controller = new AbortController();
    const decodePromise = decodeFromVideo(unreadyVideo, controller.signal);

    // Abort shortly after
    setTimeout(() => controller.abort(), 20);

    const result = await decodePromise;
    expect(result).toEqual({
      ok: false,
      reason: "aborted",
      message: "Barcode scan aborted.",
    });
  });

  it("returns unsupported cleanly when neither BarcodeDetector nor WebAssembly exists", async () => {
    vi.stubGlobal("BarcodeDetector", undefined);
    vi.stubGlobal("WebAssembly", undefined);

    const controller = new AbortController();
    const result = await decodeFromVideo(mockVideo, controller.signal);

    expect(result).toEqual({
      ok: false,
      reason: "unsupported",
      message: "Barcode scanning is not supported on this device.",
    });
  });

  it("successfully decodes a barcode via native BarcodeDetector fast path", async () => {
    const mockDetect = vi.fn().mockResolvedValue([{ rawValue: "9312345678901" }]);
    class MockBarcodeDetector {
      detect = mockDetect;
    }
    vi.stubGlobal("BarcodeDetector", MockBarcodeDetector);

    const controller = new AbortController();
    const result = await decodeFromVideo(mockVideo, controller.signal);

    expect(result).toEqual({
      ok: true,
      barcode: "9312345678901",
    });
    expect(mockDetect).toHaveBeenCalledWith(mockVideo);
  });
});
