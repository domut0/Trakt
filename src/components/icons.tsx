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
 * The one arc in the set is the Gear's hub, because a round hole is what a cog
 * has; its outline is still a polygon. Everything else stays ruled.
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

/** Two arrows chasing each other: the split going back to its first card. */
export function Repeat(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

/**
 * Settings, which left the bottom bar to sit in the corner of every tab screen.
 *
 * A cog, drawn as a cog: eight teeth on a ring around a hub. The version before
 * it was a hub with eight straight rays radiating off it and no ring to attach
 * them to, which is not a gear, it is a sun - and read as one.
 *
 * The outline is a plain polygon, 32 points alternating between an outer and an
 * inner radius, so this stays inside the family rule: straight segments, round
 * joins, no arc anywhere but the hub. Checked at 22px before shipping, which is
 * the only size it is ever drawn at.
 */
export function Gear(p: IconProps): JSX.Element {
  return (
    <svg {...svgProps(p)}>
      <path d="M10.84 4.69L11.13 1.94L12.87 1.94L13.16 4.69L16.35 6.01L18.5 4.27L19.73 5.5L17.99 7.65L19.31 10.84L22.06 11.13L22.06 12.87L19.31 13.16L17.99 16.35L19.73 18.5L18.5 19.73L16.35 17.99L13.16 19.31L12.87 22.06L11.13 22.06L10.84 19.31L7.65 17.99L5.5 19.73L4.27 18.5L6.01 16.35L4.69 13.16L1.94 12.87L1.94 11.13L4.69 10.84L6.01 7.65L4.27 5.5L5.5 4.27L7.65 6.01Z" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}
