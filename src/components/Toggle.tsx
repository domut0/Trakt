/**
 * The settings switch.
 *
 * Lived in settings.tsx until sheet sync needed one too. Shared from here rather
 * than duplicated: the 44px tap target below is easy to get subtly wrong, and
 * two copies would drift.
 *
 * On paper it is drawn as a printed switch rather than an iOS one. The version
 * this replaces filled its track with `--border` when off, which is #d8d6ce on
 * #f3f2ee paper: a contrast of 1.3:1, so the whole control disappeared into the
 * page and the only way to read its state was to notice which end the white
 * knob was at. Against a dark ground that had been fine, because the track was
 * lighter than the page behind it.
 *
 * The fix is a rule. The track is outlined in ink in both states, so the control
 * is always visibly there, and the fill then says which way it is set: inked and
 * knob-right for on, paper and knob-left for off. That is legible without
 * colour, at arm's length, and it is the same filled-versus-open logic as a
 * ticked habit or a met target.
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
      // The track stays 28px tall to keep rows compact, so the 44px tap target
      // is added as an absolutely positioned overlay rather than as padding,
      // which would make every settings row taller. shrink-0 keeps long
      // descriptions from squeezing the switch out of shape at 390px.
      className={`relative h-7 w-12 shrink-0 border-[1.5px] border-ink transition-colors after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] ${
        checked ? "bg-ink" : "bg-paper"
      }`}
    >
      <span
        className={`absolute top-[3px] h-[19px] w-[19px] transition-all ${
          checked ? "bg-paper" : "bg-ink"
        }`}
        style={{ left: checked ? 22 : 3 }}
      />
    </button>
  );
}
