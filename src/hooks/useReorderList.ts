import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Geometric bounds of an item in the list, used to calculate where a dragged
 * row should drop.
 */
export interface ItemGeometry {
  top: number;
  bottom: number;
}

/**
 * Returns a new array with the item at `fromIndex` moved to `toIndex`.
 * Pure and non-mutating.
 */
export function reorderItems<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= items.length) {
    return [...items];
  }
  const clampedTo = Math.max(0, Math.min(items.length - 1, toIndex));
  const result = [...items];
  const [removed] = result.splice(fromIndex, 1);
  result.splice(clampedTo, 0, removed);
  return result;
}

/**
 * Determines which slot the dragged item should drop into, given the item bounding
 * boxes and the pointer's vertical coordinate.
 *
 * Each row's midpoint divides "insert before" from "insert after".
 */
export function computeDropIndex(
  geometries: readonly ItemGeometry[],
  fromIndex: number,
  pointerY: number,
): number {
  if (geometries.length === 0) return 0;
  const clampedFrom = Math.max(0, Math.min(geometries.length - 1, fromIndex));
  let target = clampedFrom;

  // Moving downwards: dragged row passes midpoint of rows below
  for (let i = clampedFrom + 1; i < geometries.length; i++) {
    const mid = (geometries[i].top + geometries[i].bottom) / 2;
    if (pointerY >= mid) {
      target = i;
    } else {
      break;
    }
  }

  // Moving upwards: dragged row passes midpoint of rows above
  for (let i = clampedFrom - 1; i >= 0; i--) {
    const mid = (geometries[i].top + geometries[i].bottom) / 2;
    if (pointerY <= mid) {
      target = i;
    } else {
      break;
    }
  }

  return target;
}

/**
 * Given the item list, the dragged item's index, and the current geometry + pointer position,
 * returns the reordered array. Enables testing the reordering logic without a real pointer.
 */
export function reorderFromGeometry<T>(
  items: readonly T[],
  fromIndex: number,
  geometries: readonly ItemGeometry[],
  pointerY: number,
): T[] {
  const toIndex = computeDropIndex(geometries, fromIndex, pointerY);
  return reorderItems(items, fromIndex, toIndex);
}

/**
 * Applies a session-local order of exercise ids onto a list of rows.
 *
 * Rows present in `order` take that relative order; any row not in `order`
 * (for example, a lift logged or added after the last reorder) retains its
 * natural relative position in the list. No row is ever dropped.
 */
export function applyOrder<T extends { exercise: { id: string } }>(
  rows: readonly T[],
  order: readonly string[],
): T[] {
  if (!order || order.length === 0) return [...rows];

  const presentOrder = order.filter((id) => rows.some((r) => r.exercise.id === id));
  if (presentOrder.length === 0) return [...rows];

  const orderedIndices: number[] = [];
  const orderedItems: T[] = [];
  const itemMap = new Map<string, T[]>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const id = row.exercise.id;
    if (presentOrder.includes(id)) {
      orderedIndices.push(i);
      const list = itemMap.get(id) || [];
      list.push(row);
      itemMap.set(id, list);
    }
  }

  for (const id of presentOrder) {
    const list = itemMap.get(id);
    if (list && list.length > 0) {
      orderedItems.push(list.shift()!);
    }
  }

  const result = [...rows];
  for (let i = 0; i < orderedIndices.length; i++) {
    result[orderedIndices[i]] = orderedItems[i];
  }

  return result;
}

export interface UseReorderListOptions<T> {
  items: readonly T[];
  getItemId: (item: T) => string;
  onReorder: (newItems: T[], newIds: string[]) => void;
  /** Long-press hold threshold in ms before drag begins (default: 400). */
  longPressDelay?: number;
  /** Movement in px before long-press cancels into a scroll (default: 8). */
  slopDistance?: number;
}

interface PointerSession {
  startX: number;
  startY: number;
  pointerId: number;
  targetElement: HTMLElement;
  index: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Pointer-event drag-and-drop reordering with long-press threshold.
 *
 * Designed specifically for phone lists where tap opens an item, scroll moves
 * the page, and only a steady hold picks a row up to reorder.
 */
export function useReorderList<T>({
  items,
  getItemId,
  onReorder,
  longPressDelay = 400,
  slopDistance = 8,
}: UseReorderListOptions<T>) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [rowHeight, setRowHeight] = useState(48);

  const listRef = useRef<HTMLUListElement | null>(null);
  const sessionRef = useRef<PointerSession | null>(null);
  const suppressClickRef = useRef(false);

  // Cached layout coordinates measured at drag start to constrain drag bounds
  // and compute gaps without layout thrashing during pointer movement.
  const layoutRef = useRef<{
    listTop: number;
    listBottom: number;
    itemTop: number;
    geometries: ItemGeometry[];
  } | null>(null);

  const cancelDrag = useCallback(() => {
    if (sessionRef.current?.timer) {
      clearTimeout(sessionRef.current.timer);
    }
    if (sessionRef.current?.targetElement && sessionRef.current.pointerId !== undefined) {
      try {
        sessionRef.current.targetElement.releasePointerCapture?.(sessionRef.current.pointerId);
      } catch {
        // Ignored if capture was already released
      }
    }
    sessionRef.current = null;
    layoutRef.current = null;
    setDragIndex(null);
    setOverIndex(null);
    setDragOffsetY(0);
  }, []);

  // Escape key cancels drag and restores previous order immediately
  useEffect(() => {
    if (dragIndex === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cancelDrag();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dragIndex, cancelDrag]);

  /**
   * Stops the list scrolling under the finger for as long as a row is held.
   *
   * `touch-action` cannot do this job. A browser decides whether a touch
   * gesture scrolls at the START of that gesture, so a row that only becomes
   * `touch-action: none` once the long press has fired is deciding 400ms too
   * late -- by then the page is already scrolling and the drag never happens.
   * Setting it on every row instead would break scrolling the list at all,
   * since a finger landing anywhere on this list lands on a row.
   *
   * So the gesture is claimed imperatively instead: a NON-PASSIVE touchmove
   * listener, which is the only kind allowed to call preventDefault, attached
   * only while a row is actually held. React's own onTouchMove is registered
   * passively and cannot do this.
   */
  useEffect(() => {
    if (dragIndex === null) return;
    const swallow = (e: TouchEvent) => e.preventDefault();
    document.addEventListener("touchmove", swallow, { passive: false });
    return () => document.removeEventListener("touchmove", swallow);
  }, [dragIndex]);

  const startDrag = useCallback(
    (index: number, startY: number, pointerId: number, targetElement: HTMLElement) => {
      suppressClickRef.current = true;

      // Measure list and row geometries
      const listEl = listRef.current;
      const listRect = listEl?.getBoundingClientRect();
      const targetRect = targetElement.getBoundingClientRect();

      const measuredHeight = targetRect.height || targetElement.offsetHeight || 48;
      setRowHeight(measuredHeight);

      const geometries: ItemGeometry[] = [];
      const children = listEl ? Array.from(listEl.children) : [];

      if (children.length === items.length && listRect && listRect.height > 0) {
        for (const child of children) {
          const rect = child.getBoundingClientRect();
          geometries.push({ top: rect.top, bottom: rect.bottom });
        }
      } else {
        // Fallback for headless environments (jsdom) where layout is zero
        const baseTop = listRect?.top ?? 0;
        for (let i = 0; i < items.length; i++) {
          geometries.push({
            top: baseTop + i * measuredHeight,
            bottom: baseTop + (i + 1) * measuredHeight,
          });
        }
      }

      const listTop = listRect && listRect.height > 0 ? listRect.top : (geometries[0]?.top ?? 0);
      const listBottom =
        listRect && listRect.height > 0
          ? listRect.bottom
          : (geometries[geometries.length - 1]?.bottom ?? items.length * measuredHeight);

      const itemTop = geometries[index]?.top ?? listTop + index * measuredHeight;

      layoutRef.current = {
        listTop,
        listBottom,
        itemTop,
        geometries,
      };

      try {
        targetElement.setPointerCapture?.(pointerId);
      } catch {
        // Ignored if unsupported in test environment
      }

      setDragIndex(index);
      setOverIndex(index);
      setDragOffsetY(0);
    },
    [items.length],
  );

  const getItemProps = useCallback(
    (index: number) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0 && e.pointerType === "mouse") return;

        const startX = e.clientX;
        const startY = e.clientY;
        const pointerId = e.pointerId;
        const targetElement = e.currentTarget as HTMLElement;

        const timer = setTimeout(() => {
          startDrag(index, startY, pointerId, targetElement);
        }, longPressDelay);

        sessionRef.current = {
          startX,
          startY,
          pointerId,
          targetElement,
          index,
          timer,
        };
      },
      onPointerMove: (e: React.PointerEvent) => {
        const session = sessionRef.current;
        if (!session) return;

        if (dragIndex === null) {
          // Check if user moved beyond slop threshold before 400ms: cancel into a scroll
          const dx = e.clientX - session.startX;
          const dy = e.clientY - session.startY;
          if (Math.hypot(dx, dy) > slopDistance) {
            if (session.timer) clearTimeout(session.timer);
            sessionRef.current = null;
          }
          return;
        }

        // Active drag: constrain movement to the list boundaries
        const layout = layoutRef.current;
        if (!layout) return;

        const rawOffset = e.clientY - session.startY;
        const minOffset = layout.listTop - layout.itemTop;
        const maxOffset = layout.listBottom - layout.itemTop - rowHeight;
        const clampedOffset = Math.max(minOffset, Math.min(maxOffset, rawOffset));

        setDragOffsetY(clampedOffset);

        // Calculate drop gap index based on the dragged row's midpoint
        const draggedMid = layout.itemTop + clampedOffset + rowHeight / 2;
        const nextOver = computeDropIndex(layout.geometries, index, draggedMid);
        setOverIndex(nextOver);
      },
      onPointerUp: (e: React.PointerEvent) => {
        const session = sessionRef.current;
        if (session?.timer) {
          clearTimeout(session.timer);
        }

        if (dragIndex !== null) {
          const listRect = listRef.current?.getBoundingClientRect();
          let isOutside = false;
          if (listRect && (listRect.width > 0 || listRect.height > 0)) {
            isOutside =
              e.clientX < listRect.left ||
              e.clientX > listRect.right ||
              e.clientY < listRect.top ||
              e.clientY > listRect.bottom;
          } else if (layoutRef.current) {
            // Headless / jsdom fallback when getBoundingClientRect() is not mocked
            const { listTop, listBottom } = layoutRef.current;
            isOutside =
              e.clientX < 0 || e.clientX > 1000 || e.clientY < listTop || e.clientY > listBottom;
          }

          if (isOutside) {
            cancelDrag();
          } else {
            const finalOver = overIndex;
            const from = dragIndex;
            cancelDrag();
            if (finalOver !== null && finalOver !== from) {
              const newItems = reorderItems(items, from, finalOver);
              const newIds = newItems.map(getItemId);
              onReorder(newItems, newIds);
            }
          }

          // Suppress the synthetic click that follows pointerup
          suppressClickRef.current = true;
          setTimeout(() => {
            suppressClickRef.current = false;
          }, 100);
          return;
        }

        sessionRef.current = null;
      },
      onPointerCancel: () => {
        cancelDrag();
      },
    }),
    [
      dragIndex,
      overIndex,
      rowHeight,
      items,
      getItemId,
      onReorder,
      longPressDelay,
      slopDistance,
      startDrag,
      cancelDrag,
    ],
  );

  const isClickSuppressed = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return true;
    }
    return false;
  }, []);

  return {
    dragIndex,
    overIndex,
    dragOffsetY,
    rowHeight,
    listRef,
    getItemProps,
    isClickSuppressed,
    cancelDrag,
  };
}
