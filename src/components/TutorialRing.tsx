import { useEffect, useState, type ReactElement } from "react";

/**
 * How much of the checklist is done, as a ring that fills.
 *
 * ## Why a ring and not a list of ticks
 *
 * The card used to end its life as a block of prose about what to do every
 * morning and every night - four sentences nobody reads twice, sitting at the
 * top of the screen the app is opened on. What somebody wants from a checklist
 * they have half finished is one glance: how much is left. A ring says that
 * without being read.
 *
 * ## It finishes and then it goes
 *
 * At the last task the ring fills solid, draws a tick, holds a beat, and the
 * card removes itself. An onboarding card that stays after onboarding is over
 * is a permanent monument to a thing that took ten minutes once.
 */
export function TutorialRing({
  done,
  total,
  complete,
}: {
  done: number;
  total: number;
  /** True once every task is done: fills solid and draws the tick. */
  complete: boolean;
}): ReactElement {
  const size = 40;
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = total === 0 ? 0 : Math.min(1, done / total);

  // Held one frame at the previous value so the very first paint animates from
  // where it was rather than appearing already filled.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(fraction), 20);
    return () => window.clearTimeout(timer);
  }, [fraction]);

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={complete ? "All tasks complete" : `${done} of ${total} tasks complete`}
    >
      <svg width={size} height={size} aria-hidden="true" className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-rule"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - shown)}
          className={complete ? "stroke-complete" : "stroke-ink"}
          style={{ transition: "stroke-dashoffset 520ms cubic-bezier(0.2,0,0.2,1)" }}
        />
        {/* The solid fill, drawn as a fat stroke collapsing inward so the whole
            disc is one animated property rather than a second element fading
            over the first. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius / 2}
          fill="none"
          strokeWidth={complete ? radius : 0}
          className="stroke-complete"
          style={{ transition: "stroke-width 420ms cubic-bezier(0.2,0,0.2,1) 320ms" }}
        />
      </svg>

      <span className="absolute inset-0 flex items-center justify-center">
        {complete ? (
          <svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="text-paper"
            style={{
              animation: "tutorial-ring-tick 320ms cubic-bezier(0.2,0,0.2,1) 620ms both",
            }}
          >
            <path d="M5 12.5 10 17l9-10" />
          </svg>
        ) : (
          <span className="tnum t-label font-semibold text-ink">
            {done}/{total}
          </span>
        )}
      </span>

      <style>{`
        @keyframes tutorial-ring-tick {
          from { opacity: 0; transform: scale(0.6); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </span>
  );
}
