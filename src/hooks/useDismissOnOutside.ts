import { useEffect, type RefObject } from "react";

/**
 * Dismiss something when the next press lands outside it.
 *
 * The behaviour a popover needs and a sheet does not. A sheet has a backdrop -
 * a full-screen element that catches the press and closes it - so it needs no
 * document listener at all (see `useSheetDismiss`, which owns Escape and the
 * scroll lock for those). A selection inside a chart has no backdrop: the page
 * around it stays live and scrollable, which is the point, so the only way to
 * notice a press that was not meant for it is to listen on the document.
 *
 * `pointerdown`, not `click`:
 *
 * - It fires on the press rather than the release, which is when a person has
 *   decided the thing should go away.
 * - It fires for a press that turns into a page scroll, which never becomes a
 *   click at all - and scrolling away from a popover is exactly a case where it
 *   should close.
 *
 * The listener is added from an effect, which React runs after the commit that
 * followed the opening press. So the press that OPENED the popover has already
 * finished dispatching and cannot immediately close it again. Belt and braces,
 * that press lands inside `ref` anyway, where `contains` ignores it.
 */
export function useDismissOnOutside(
  ref: RefObject<Element | null>,
  active: boolean,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      const el = ref.current;
      // A target detached from the document by the same interaction - a row
      // that just unmounted - would report false from `contains` and close
      // something the user never pressed away from.
      const target = e.target as Node | null;
      if (!el || !target || !target.isConnected) return;
      if (!el.contains(target)) onDismiss();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [ref, active, onDismiss]);
}
