import type { JSX } from "react";

/**
 * The app's icon family. One family, drawn here, and the only one.
 *
 * Two things were wrong before. Five glyphs came from lucide at its own weight
 * and cap while the nav set was authored at 1.6px, so two icon families shipped
 * side by side on the same screens. And nine places used a Unicode arrow as an
 * icon, which is a character standing in for a mark: it takes the text colour
 * and the text metrics, it is a different shape in every font fallback, and it
 * is not part of any system.
 *
 * Everything here is flat and drawn from straight segments with round ends.
 * None of them uses an arc: the geometry stays honest to the ruled world even
 * though the strokes are no longer cut square.
 */

const BASE = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  // Round, not butt and miter. The zero-radius world justified square ends;
  // once the corners softened, square-cut strokes were the only hard edges
  // left and they read as the icons being angry at you.
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
} as const;

type IconProps = { className?: string; size?: number };

function svgProps({ className, size }: IconProps) {
  return {
    ...BASE,
    ...(size ? { width: size, height: size } : {}),
    ...(className ? { className } : {}),
  };
}

/** Disclosure. Replaces the "→" character used in nine settings and plan rows. */
export function Chevron(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M9 5 16 12 9 19" />
    </svg>
  );
}

/** A value that rose over the window. Replaces "↑ ". */
export function ArrowUp(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M12 20 12 4" />
      <path d="M5 11 12 4 19 11" />
    </svg>
  );
}

/** A value that fell over the window. Replaces "↓ ". */
export function ArrowDown(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M12 4 12 20" />
      <path d="M5 13 12 20 19 13" />
    </svg>
  );
}

/** A meal window or entry. A fork, drawn in straight lines. */
export function Meal(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M6 3 6 9" />
      <path d="M9 3 9 9" />
      <path d="M12 3 12 9" />
      <path d="M5 9 13 9" />
      <path d="M9 9 9 21" />
    </svg>
  );
}

/** A strength workout. */
export function Dumbbell(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M3 9 3 15" />
      <path d="M6.5 6 6.5 18" />
      <path d="M6.5 12 17.5 12" />
      <path d="M17.5 6 17.5 18" />
      <path d="M21 9 21 15" />
    </svg>
  );
}

/** A cardio workout. A trace, which is what the timeline is made of anyway. */
export function Cardio(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M2 12 8 12 10 6 14 18 16 12 22 12" />
    </svg>
  );
}

/** Confirmation. */
export function Check(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M4 12 9.5 17.5 20 7" />
    </svg>
  );
}

/** Add, log, commit. */
export function Plus(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M12 4 12 20" />
      <path d="M4 12 20 12" />
    </svg>
  );
}

/** Back, previous week. */
export function ChevronLeft(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M15 5 8 12 15 19" />
    </svg>
  );
}

/** Dismiss. */
export function Close(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M5 5 19 19" />
      <path d="M19 5 5 19" />
    </svg>
  );
}

/** Destructive. The one glyph in the set allowed to look like an object. */
export function Trash(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M4 6 20 6" />
      <path d="M9 6 9 3 15 3 15 6" />
      <path d="M6 6 7 21 17 21 18 6" />
      <path d="M10 10 10 17" />
      <path d="M14 10 14 17" />
    </svg>
  );
}
