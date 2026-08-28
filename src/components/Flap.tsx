import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A figure that rolls into place when it changes.
 *
 * This is the app's one authored motion, and it is the product's own claim made
 * physical: logging here is confirming rather than typing, so a value that has
 * just been committed should LAND rather than fade. It is borrowed from the
 * split-flap board the day view's world derives from, where a departure changes
 * by flipping rather than by dissolving.
 *
 * It fires on change only, never on mount. Keying a figure by its own value
 * would flap every number on the screen at once on first paint, which is a
 * loading animation pretending to be a confirmation, and it would fire again on
 * every remount for reasons the user did not cause. The first render is
 * therefore a plain wrapper and only the second and later values animate.
 *
 * The wrapper is always present, and always `inline-block`, so that turning the
 * animation on cannot shift the layout underneath it.
 *
 * Reduced motion is handled globally in styles.css; nothing is needed here.
 */
export function Flap({ value, children }: { value: string | number; children: ReactNode }) {
  const [nonce, setNonce] = useState(0);
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current !== value) {
      previous.current = value;
      setNonce((n) => n + 1);
    }
  }, [value]);

  return (
    <span key={nonce} className={nonce === 0 ? "inline-block" : "anim-flap"}>
      {children}
    </span>
  );
}
