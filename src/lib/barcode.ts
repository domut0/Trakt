/**
 * Barcode scanning: hardware detection, BarcodeDetector fast path, and WASM fallback.
 *
 * Measured facts (plan §6):
 * - Safari/WebKit implements no BarcodeDetector, so iOS ALWAYS takes the WASM path.
 * - Chrome and Chromium-based browsers on Android have native BarcodeDetector.
 * - Therefore: detect at runtime, use BarcodeDetector where available, and fall
 *   back to zxing-wasm elsewhere.
 *
 * Performance requirement:
 * - zxing-wasm is loaded dynamically on demand so the WASM binary is never
 *   bundled into the app's initial paint payload.
 */

export type DecodeResult =
  | { ok: true; barcode: string }
  | {
      ok: false;
      reason: "unsupported" | "permissionDenied" | "noCamera" | "aborted";
      message: string;
    };

interface BarcodeDetectionResult {
  rawValue?: string;
  text?: string;
  format?: string;
}

interface NativeBarcodeDetector {
  detect(source: HTMLVideoElement | ImageBitmapSource): Promise<BarcodeDetectionResult[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats: string[] }): NativeBarcodeDetector;
}

/**
 * Checks whether native BarcodeDetector is available in the current browser.
 */
export function isBarcodeDetectorAvailable(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector !== "undefined"
  );
}

/** Helper to pause execution while listening for abort signals without leaking timers. */
function waitWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Continuously decodes frames from a video stream until a barcode is found or the signal is aborted.
 *
 * Native BarcodeDetector is tried first. If unavailable, zxing-wasm is dynamically imported.
 */
export async function decodeFromVideo(
  video: HTMLVideoElement,
  signal: AbortSignal,
): Promise<DecodeResult> {
  if (signal.aborted) {
    return { ok: false, reason: "aborted", message: "Barcode scan aborted." };
  }

  const hasNative = isBarcodeDetectorAvailable();
  const hasWasm =
    typeof WebAssembly !== "undefined" && typeof WebAssembly.instantiate === "function";

  if (!hasNative && !hasWasm) {
    return {
      ok: false,
      reason: "unsupported",
      message: "Barcode scanning is not supported on this device.",
    };
  }

  let nativeDetector: NativeBarcodeDetector | null = null;
  let canvas: HTMLCanvasElement | null = null;

  while (!signal.aborted) {
    // Only attempt decoding if the video element has received video data and dimensions.
    const isVideoReady =
      video.readyState >= (HTMLMediaElement.HAVE_CURRENT_DATA ?? 2) &&
      video.videoWidth > 0 &&
      video.videoHeight > 0;

    if (isVideoReady) {
      if (hasNative) {
        try {
          if (!nativeDetector) {
            const BarcodeDetectorClass = (
              globalThis as unknown as { BarcodeDetector: BarcodeDetectorConstructor }
            ).BarcodeDetector;
            try {
              nativeDetector = new BarcodeDetectorClass({
                formats: [
                  "ean_13",
                  "ean_8",
                  "upc_a",
                  "upc_e",
                  "code_128",
                  "code_39",
                  "itf",
                  "qr_code",
                  "data_matrix",
                ],
              });
            } catch {
              // Some implementations refuse options or format lists; instantiate default.
              nativeDetector = new BarcodeDetectorClass();
            }
          }

          const detected = await nativeDetector.detect(video);
          if (signal.aborted) break;

          if (detected && detected.length > 0) {
            const raw = detected[0]?.rawValue ?? detected[0]?.text;
            if (raw && typeof raw === "string" && raw.trim().length > 0) {
              return { ok: true, barcode: raw.trim() };
            }
          }
        } catch {
          // Native detector frame read error; continue polling or fallback.
        }
      } else {
        // Fallback: Lazy load zxing-wasm on demand.
        try {
          const { readBarcodes } = await import("zxing-wasm/reader");
          if (signal.aborted) break;

          if (!canvas && typeof document !== "undefined") {
            canvas = document.createElement("canvas");
          }

          if (canvas) {
            if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
            }

            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const results = await readBarcodes(imageData, {
                tryHarder: true,
                formats: [
                  "EAN-13",
                  "EAN-8",
                  "UPC-A",
                  "UPC-E",
                  "Code128",
                  "Code39",
                  "ITF",
                  "QRCode",
                  "DataMatrix",
                ],
              });

              if (signal.aborted) break;

              if (results && results.length > 0) {
                const match = results.find((r) => r.text && r.isValid !== false) ?? results[0];
                if (match?.text && match.text.trim().length > 0) {
                  return { ok: true, barcode: match.text.trim() };
                }
              }
            }
          }
        } catch {
          // If WASM fails to load in an unsupported runtime environment.
          if (typeof WebAssembly === "undefined") {
            return {
              ok: false,
              reason: "unsupported",
              message: "Barcode scanning is not supported on this device.",
            };
          }
        }
      }
    }

    if (signal.aborted) break;
    // Delay between frame scans (100ms) to conserve CPU and battery.
    await waitWithSignal(100, signal);
  }

  return { ok: false, reason: "aborted", message: "Barcode scan aborted." };
}
