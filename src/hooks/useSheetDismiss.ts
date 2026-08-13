import { useEffect, useRef } from "react";

/**
 * The dismiss behaviour every bottom sheet and centred popup in this app
 * shares: Escape closes the topmost open one, and while any of them is open the
 * document behind it is not allowed to scroll.
 *
 * WHY THIS IS ONE HOOK AND NOT A COPY OF THE EFFECT IN EACH SHEET
 *
 * Both behaviours are properties of the STACK of open sheets, not of any single
 * component, and a component cannot see what else is open. Repeating a local
 * effect gets the nested case wrong in two ways that are easy to miss in
 * review:
 *
 * - The first sheet's cleanup runs while a second is still open, so it hands
 *   scrolling back to the page too early.
 * - Every open sheet has its own key listener, so one Escape press closes all
 *   of them at once instead of peeling off the top one.
 *
 * The seven sheets drifted apart in layout, animation, backdrop tint, soft
 * keyboard handling and drag-to-dismiss, but they are identical on the only two
 * inputs this needs - `open` and a close callback - so there is no sheet being
 * forced into a shape that does not fit.
 *
 * SSR: module scope here touches no DOM at all, and everything that does is
 * inside an effect, which never runs during the server pass. Callers still need
 * their own `typeof document === "undefined"` guard before `createPortal`,
 * because that is a render-time call; this hook does not remove that need.
 */

/**
 * One open sheet. The object's identity is the whole point of it: it is the
 * handle a sheet uses to remove exactly itself from the stack, so two sheets
 * that happen to share a close callback still unwind independently.
 */
type OpenSheet = { dismiss: () => void };

/**
 * Every currently-open sheet, oldest first, so the last entry is the topmost.
 * That ordering is not an assumption: all these sheets portal into
 * document.body at the same z-index, so paint order is DOM order is mount
 * order, which is the order they push here.
 *
 * The array length doubles as the scroll-lock reference count. One source of
 * truth beats a separate counter that can drift away from the stack.
 *
 * Module-level mutable state in a React file is usually a smell. Here it is the
 * point: two sheets that know nothing about each other have to agree on who is
 * on top and on who owns the body's overflow, and there is exactly one document
 * for them to disagree about.
 */
const openSheets: OpenSheet[] = [];

/**
 * document.body's INLINE overflow from before the first sheet locked it, saved
 * once on the way in so the last sheet out can put back exactly that.
 *
 * Restoring a hardcoded "" or "auto" would silently overwrite whatever the app
 * had set. Today this reads "" every time, because the app-shell scroll lock
 * lives in a stylesheet rule (`html, body { overflow: hidden }` in styles.css)
 * rather than an inline style, and writing "" back drops our inline declaration
 * so that rule wins again. Reading the value is what makes that correct by
 * construction instead of by luck.
 *
 * Which also means the lock below is, right now, a no-op: the page behind a
 * sheet already cannot scroll, because the shell scrolls its own <main> and
 * never the document. It is kept anyway because a modal asserting its own
 * requirement is worth more than a modal that silently depends on a layout rule
 * three files away staying exactly as it is.
 */
let bodyOverflowBeforeLock: string | null = null;

/**
 * Fires for the whole stack, not per sheet, so a single press dismisses exactly
 * one sheet: the topmost.
 *
 * Two things are deliberately skipped:
 *
 * - `defaultPrevented`. This is the opt-out for anything inside a sheet that
 *   binds Escape itself, such as the rename field in HabitEditorSheet. React
 *   attaches its own listeners at or below the document, so a synthetic handler
 *   that calls preventDefault has already run by the time this one does, and
 *   the flag survives regardless of which node either listener sits on.
 *   stopPropagation would NOT be reliable here: on a same-node listener it does
 *   nothing.
 * - `isComposing`. Escape during IME composition cancels the composition. The
 *   user is editing text, not asking to throw the sheet away.
 */
function handleStackKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (event.defaultPrevented || event.isComposing) return;
  const topmost = openSheets[openSheets.length - 1];
  if (!topmost) return;
  // Mark the press consumed, so an outer listener added later cannot treat the
  // same Escape as its own and close a second sheet.
  event.preventDefault();
  topmost.dismiss();
}

function pushSheet(sheet: OpenSheet) {
  openSheets.push(sheet);
  // Only the transition from "nothing open" to "something open" touches the
  // document. Every sheet after the first inherits a lock and a listener that
  // are already in place.
  if (openSheets.length === 1) {
    bodyOverflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleStackKeyDown);
  }
}

function popSheet(sheet: OpenSheet) {
  const index = openSheets.lastIndexOf(sheet);
  if (index !== -1) openSheets.splice(index, 1);
  // Mirror of pushSheet: the last one out restores the document. Closing an
  // inner sheet while an outer one is still open must change nothing.
  if (openSheets.length === 0) {
    document.removeEventListener("keydown", handleStackKeyDown);
    document.body.style.overflow = bodyOverflowBeforeLock ?? "";
    bodyOverflowBeforeLock = null;
  }
}

/**
 * Join the sheet stack while `open`, which locks page scrolling and makes
 * Escape call `onClose` - but only while this sheet is the topmost one.
 *
 * Call it unconditionally and ABOVE the `if (!open) return null` guard every
 * sheet uses, or the hook order changes as the sheet opens.
 *
 * Note what is NOT here: no focus trap, and no `position: fixed` freeze of the
 * body. The freeze trick is the usual iOS workaround for a body that scrolls,
 * and it resets the scroll position to the top when the sheet closes, which is
 * a worse bug than the one it fixes.
 */
export function useSheetDismiss(open: boolean, onClose: () => void) {
  // `onClose` is an inline arrow in every caller, so it is a new function on
  // every render. The stack holds a stable wrapper and reads the callback
  // through this ref, so a re-render never has to leave and rejoin the stack -
  // which would otherwise reorder it and hand "topmost" to the wrong sheet.
  const onCloseRef = useRef(onClose);

  // No dependency array: this runs after every commit, which is soon enough,
  // because a keypress cannot be dispatched in the middle of a render.
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const sheet: OpenSheet = { dismiss: () => onCloseRef.current() };
    pushSheet(sheet);
    return () => popSheet(sheet);
  }, [open]);
}
