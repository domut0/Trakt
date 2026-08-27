/**
 * BarcodeScannerSheet
 *
 * IMPORTANT iOS CAVEAT: getUserMedia inside an iOS home-screen PWA is
 * documented as working since iOS 14.3 but has NOT been verified on the target
 * device. We state this plainly so nobody assumes it was tested in a standalone
 * home-screen environment.
 *
 * Lifecycle and privacy:
 * - Media tracks are stopped whenever the sheet is closed or unmounted to
 *   prevent background battery drain and privacy indicators remaining active.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetDismiss } from "../hooks/useSheetDismiss";
import { decodeFromVideo } from "../lib/barcode";

export type ScannerState =
  "requesting_permission" | "permission_denied" | "no_camera" | "scanning" | "decode_failed";

export interface BarcodeScannerSheetProps {
  open: boolean;
  onClose: () => void;
  onDetected: (barcode: string) => void;
}

function CameraIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

export function BarcodeScannerSheet({ open, onClose, onDetected }: BarcodeScannerSheetProps) {
  const [state, setState] = useState<ScannerState>("requesting_permission");
  const [errorMessage, setErrorMessage] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Stop active camera hardware immediately to prevent privacy bugs and battery drain.
  const stopTracks = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startScanning = useCallback(async () => {
    stopTracks();
    setState("requesting_permission");
    setErrorMessage("");

    const ac = new AbortController();
    abortControllerRef.current = ac;

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function"
    ) {
      setState("no_camera");
      return;
    }

    let stream: MediaStream;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
      } catch (firstErr) {
        // Fallback for webcams or devices that reject facingMode constraints.
        const isConstraintErr =
          firstErr instanceof DOMException &&
          (firstErr.name === "OverconstrainedError" ||
            firstErr.name === "ConstraintNotSatisfiedError");

        if (isConstraintErr) {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        } else {
          throw firstErr;
        }
      }
    } catch (err: unknown) {
      if (ac.signal.aborted) return;

      if (err instanceof DOMException) {
        if (
          err.name === "NotAllowedError" ||
          err.name === "PermissionDeniedError" ||
          err.name === "SecurityError"
        ) {
          setState("permission_denied");
          return;
        }
        if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          setState("no_camera");
          return;
        }
      }

      setState("decode_failed");
      setErrorMessage("Could not start camera on this device.");
      return;
    }

    if (ac.signal.aborted) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return;
    }

    streamRef.current = stream;
    setState("scanning");

    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      video.play().catch(() => {
        // Autoplay may be deferred until user gesture on some WebKit releases.
      });

      // Run frame decoding loop until barcode is found or aborted.
      decodeFromVideo(video, ac.signal)
        .then((result) => {
          if (result.ok) {
            stopTracks();
            onDetected(result.barcode);
            onClose();
          } else if (result.reason === "unsupported") {
            setState("decode_failed");
            setErrorMessage(result.message);
          }
        })
        .catch(() => {
          if (!ac.signal.aborted) {
            setState("decode_failed");
            setErrorMessage("Barcode scanning encountered an error.");
          }
        });
    }
  }, [stopTracks, onDetected, onClose]);

  useEffect(() => {
    if (open) {
      startScanning();
    } else {
      stopTracks();
    }

    return () => {
      stopTracks();
    };
  }, [open, startScanning, stopTracks]);

  useSheetDismiss(open, onClose);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      data-swipe-ignore
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5 anim-backdrop"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-sm flex-col bg-paper rule-heavy-t p-5 anim-popup"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 shrink-0 bg-border" />

        <div className="flex shrink-0 items-center justify-between pb-3">
          <h2 className="t-heading font-semibold tracking-tight">Scan barcode</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close barcode scanner"
            className="-mr-2 flex min-h-[44px] items-center px-2 t-label font-medium text-ink-2 hover:text-ink"
          >
            Close
          </button>
        </div>

        {state === "requesting_permission" && (
          <div className="flex min-h-[240px] flex-col items-center justify-center bg-wash p-5 text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center text-ink">
              <CameraIcon />
            </div>
            <p className="t-body font-semibold text-ink">Requesting camera access</p>
            <p className="mt-1 t-label text-ink-2">
              Please allow camera permissions to scan barcodes.
            </p>
          </div>
        )}

        {state === "permission_denied" && (
          <div className="flex min-h-[240px] flex-col items-center justify-center bg-wash p-5 text-center">
            <p className="t-body font-semibold text-signal">Camera permission denied</p>
            <p className="mt-1 t-label text-ink-2">
              Camera access was denied. Enable camera access in your device settings to scan
              barcodes.
            </p>
            <button
              type="button"
              onClick={startScanning}
              aria-label="Retry camera permission"
              className="mt-4 flex min-h-[44px] items-center justify-center bg-ink px-4 t-body font-semibold text-paper"
            >
              Try again
            </button>
          </div>
        )}

        {state === "no_camera" && (
          <div className="flex min-h-[240px] flex-col items-center justify-center bg-wash p-5 text-center">
            <p className="t-body font-semibold text-signal">No camera detected</p>
            <p className="mt-1 t-label text-ink-2">No usable camera was found on this device.</p>
          </div>
        )}

        {state === "decode_failed" && (
          <div className="flex min-h-[240px] flex-col items-center justify-center bg-wash p-5 text-center">
            <p className="t-body font-semibold text-signal">Scanner unavailable</p>
            <p className="mt-1 t-label text-ink-2">
              {errorMessage || "Barcode scanning could not be initialized on this device."}
            </p>
            <button
              type="button"
              onClick={startScanning}
              aria-label="Retry barcode scanner"
              className="mt-4 flex min-h-[44px] items-center justify-center bg-ink px-4 t-body font-semibold text-paper"
            >
              Try again
            </button>
          </div>
        )}

        {/* Video preview element stays in the DOM while scanning */}
        <div className={state === "scanning" ? "flex flex-col items-center space-y-3" : "hidden"}>
          <div className="relative aspect-square w-full overflow-hidden bg-black">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              aria-label="Camera feed for barcode scanning"
              className="h-full w-full object-cover"
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-5">
              <div className="h-44 w-44 ring-2 ring-ink" />
            </div>
          </div>
          <p className="text-center t-label text-ink-2">Point your camera at a barcode</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
