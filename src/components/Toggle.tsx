/**
 * The settings switch.
 *
 * Lived in settings.tsx until sheet sync needed one too. Shared from here rather
 * than duplicated: the 44px tap target below is easy to get subtly wrong, and
 * two copies would drift.
 */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  /** Names the switch for screen readers. The visible row title is a plain div,
   * not a <label>, so without this the control announces as unlabelled. */
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      // The pill stays 28px tall to keep rows compact, so the 44px tap target is
      // added as an absolutely positioned overlay rather than as padding, which
      // would make every settings row taller. shrink-0 keeps long descriptions
      // from squeezing the switch out of shape at 390px.
      className="relative h-7 w-12 shrink-0 transition-colors after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']"
      style={{ backgroundColor: checked ? "var(--color-accent)" : "var(--color-border)" }}
    >
      <span
        className="absolute top-0.5 h-6 w-6 bg-white transition-all"
        style={{ left: checked ? 22 : 2 }}
      />
    </button>
  );
}
