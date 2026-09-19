import { useStore } from "./store";
import { useCoachStore } from "./coach-store";

/**
 * Whether the Plan tab on screen is someone's coach-managed plan.
 *
 * False while a coach is viewing a client: the store then holds the client's
 * plan with the flag swapped off, and the coach is exactly who should edit it.
 */
export function usePlanLocked(): boolean {
  const managed = useStore((s) => s.coachManaged);
  const viewingClient = useCoachStore((s) => s.viewing !== undefined);
  return managed && !viewingClient;
}
