import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export interface ToastOptions {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
}

export type ShowToast = (options: ToastOptions) => void;

interface ActiveToast extends ToastOptions {
  id: number;
}

const ToastContext = createContext<ShowToast | null>(null);

/**
 * Access the global toast notification trigger. Safe to call anywhere under
 * ToastProvider. Returns a no-op fallback when unmounted so callers don't
 * throw during early renders.
 */
export function useToast(): ShowToast {
  const context = useContext(ToastContext);
  if (!context) {
    return () => {};
  }
  return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [activeToast, setActiveToast] = useState<ActiveToast | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A monotonic counter, not Date.now(): two toasts raised in the same
  // millisecond would share an id, and the auto-dismiss below identifies its
  // own toast by id.
  const nextIdRef = useRef(0);

  const dismiss = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setActiveToast(null);
  }, []);

  const showToast: ShowToast = useCallback(
    ({ message, actionLabel, onAction, durationMs = 4000 }) => {
      // Replaces any currently active toast immediately so rapid successive
      // actions never stack notifications or push content offscreen. Clearing
      // the old timer here is what stops it from dismissing the REPLACEMENT.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      nextIdRef.current += 1;
      const id = nextIdRef.current;
      setActiveToast({ id, message, actionLabel, onAction, durationMs });

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setActiveToast((current) => (current?.id === id ? null : current));
      }, durationMs);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {/* Keyed by id so a replacement toast gets a FRESH element: without it
          React reuses the node and the outgoing toast's drag state (mid-drag
          offset, dangling isDragging) carries over onto the new message. */}
      {activeToast && <ToastElement key={activeToast.id} toast={activeToast} onDismiss={dismiss} />}
    </ToastContext.Provider>
  );
}

function ToastElement({ toast, onDismiss }: { toast: ActiveToast; onDismiss: () => void }) {
  const [offsetY, setOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [entered, setEntered] = useState(false);
  const startYRef = useRef(0);

  // Slide up on mount. Driven by a CSS transition rather than a keyframe
  // animation so the same `transform` can be handed over to the drag below,
  // and so styles.css's global prefers-reduced-motion clamp (which flattens
  // transition-duration) already covers it.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // SSR guard matching sheet components in the app: never attempt createPortal
  // during the server pass when document is undefined.
  if (typeof document === "undefined") return null;

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    startYRef.current = e.clientY;
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const deltaY = e.clientY - startYRef.current;
    // Allow dragging down to dismiss, damping upward drags to maintain resistance
    setOffsetY(deltaY > 0 ? deltaY : deltaY * 0.2);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    // Dismiss if swiped down past 25px threshold or clicked without a drag
    if (offsetY > 25) {
      onDismiss();
    } else {
      setOffsetY(0);
    }
  };

  const handlePointerCancel = () => {
    setIsDragging(false);
    setOffsetY(0);
  };

  const handleAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    toast.onAction?.();
    onDismiss();
  };

  // Note the absence of a `-translate-x-1/2` class below. Tailwind v4 compiles
  // translate utilities to the standalone `translate` property, which composes
  // WITH `transform` rather than being overridden by it, so pairing the two
  // shifted this a full 100% of its own width left of centre, half of it off
  // screen. The -50% in the inline transform is the only horizontal centring.
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={() => {
        if (Math.abs(offsetY) < 5) {
          onDismiss();
        }
      }}
      className="fixed left-1/2 z-[60] flex min-h-[44px] w-[calc(100%-2rem)] max-w-sm items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3 text-foreground shadow-lg hairline-t hairline-b touch-none cursor-pointer"
      style={{
        bottom: "max(calc(env(safe-area-inset-bottom) + 68px), 76px)",
        transform: `translate(-50%, ${offsetY + (entered ? 0 : 18)}px)`,
        transition: isDragging
          ? "none"
          : "transform 0.2s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.2s ease",
        opacity: entered ? (offsetY > 0 ? Math.max(0, 1 - offsetY / 120) : 1) : 0,
      }}
    >
      <span className="text-[14px] font-medium leading-snug">{toast.message}</span>
      {toast.actionLabel && toast.onAction && (
        <button
          type="button"
          onClick={handleAction}
          className="flex min-h-[44px] shrink-0 items-center justify-center px-2 text-[14px] font-semibold text-accent active:scale-95"
          aria-label={toast.actionLabel}
        >
          {toast.actionLabel}
        </button>
      )}
    </div>,
    document.body,
  );
}
