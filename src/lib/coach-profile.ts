/**
 * Coach profile persisted in localStorage.
 *
 * The coach's own name and Google email are remembered on this device so they
 * are typed once.
 */

const STORAGE_KEY = "trakt.coachProfile";

export interface CoachProfile {
  name: string;
  email: string;
}

export function loadCoachProfile(): CoachProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { name: "", email: "" };
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return { name: "", email: "" };
    }
    const { name, email } = parsed as Record<string, unknown>;
    return {
      name: typeof name === "string" ? name : "",
      email: typeof email === "string" ? email : "",
    };
  } catch {
    return { name: "", email: "" };
  }
}

export function saveCoachProfile(p: CoachProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Storage access can throw in private browsing or when quota is exceeded.
  }
}

export function isLikelyEmail(s: string): boolean {
  const trimmed = s.trim();
  if (/\s/.test(trimmed)) return false;
  const parts = trimmed.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return local.length > 0 && domain.includes(".");
}
