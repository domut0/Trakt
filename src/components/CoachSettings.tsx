import { useEffect, useMemo, useState } from "react";
import { useCoachStore } from "../lib/coach-store";
import {
  pickerAvailable,
  pickSharedSpreadsheet,
  type PickedSheet,
  type PickFailure,
} from "../lib/google-picker";
import { Chevron } from "./icons";
import { Toggle } from "./Toggle";
import { freshness } from "./ClientBanner";
import type { CoachClient } from "../lib/db";
import { inviteUrl, INVITE_VERSION } from "../lib/invite";
import { isLikelyEmail, loadCoachProfile, saveCoachProfile } from "../lib/coach-profile";

/**
 * Coach mode's Settings section: the client list, and the way into a client.
 *
 * What is stored per client is a pointer to their spreadsheet and a name to
 * show it under. Nothing about their training is kept here -- it is pulled when
 * their view opens and dropped when it closes, which is the whole reason this
 * feature needs no database anyone has to protect.
 */
export function CoachSettings() {
  const hydrate = useCoachStore((s) => s.hydrate);
  const enabled = useCoachStore((s) => s.enabled);
  const setEnabled = useCoachStore((s) => s.setEnabled);
  const clients = useCoachStore((s) => s.clients);
  const loading = useCoachStore((s) => s.loading);
  const lastError = useCoachStore((s) => s.lastError);
  const enterClientView = useCoachStore((s) => s.enterClientView);
  const removeClient = useCoachStore((s) => s.removeClient);

  const [adding, setAdding] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  // Re-read whenever the form closes: it is localStorage, not state anything
  // subscribes to.
  const profile = useMemo(() => loadCoachProfile(), [editingProfile]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <>
      <div className="group-row">
        <div className="min-w-0">
          <div className="t-body">Coach mode</div>
          <div className="t-label text-ink-2">Read a client&rsquo;s log and write their plan</div>
        </div>
        <Toggle checked={enabled} onChange={() => setEnabled(!enabled)} label="Coach mode" />
      </div>

      {enabled && (
        <>
          {clients.map((client) => (
            <div key={client.id} className="group-row group-row-sep">
              <button
                type="button"
                disabled={loading}
                onClick={() => void enterClientView(client.id)}
                className="flex min-w-0 flex-1 items-center justify-between text-left"
              >
                <span className="min-w-0">
                  <span className="block t-body text-ink">{client.name}</span>
                  <span className="block t-label text-ink-2">
                    {client.lastPulledAt === undefined
                      ? "Never opened"
                      : `Last opened ${freshness(client.lastPulledAt)}`}
                  </span>
                </span>
                <Chevron className="shrink-0 text-ink-2" size={16} />
              </button>
              <button
                type="button"
                onClick={() => void removeClient(client.id)}
                aria-label={`Remove ${client.name}`}
                className="ml-3 min-h-[44px] shrink-0 t-label text-ink-2"
              >
                Remove
              </button>
            </div>
          ))}

          {lastError && (
            <div className="group-row-sep px-4 py-3 t-label text-signal">
              {lastError === "not-configured"
                ? "This client's sheet cannot be opened yet."
                : lastError === "unreadable"
                  ? "Couldn't read that client's sheet. It may no longer be shared with you"
                  : lastError === "needs-consent"
                    ? "Google sign-in was closed before it finished"
                    : "Couldn't reach that client's sheet."}
            </div>
          )}

          {editingProfile ? (
            <CoachProfileForm onDone={() => setEditingProfile(false)} />
          ) : (
            <button
              type="button"
              onClick={() => setEditingProfile(true)}
              className="group-row group-row-sep w-full text-left"
            >
              <span className="min-w-0">
                <span className="block t-body text-ink">
                  {profile.name.trim() === "" ? "Your coach profile" : profile.name}
                </span>
                <span className="block truncate t-label text-ink-2">
                  {profile.email.trim() === ""
                    ? "The name and address your clients see"
                    : profile.email}
                </span>
              </span>
              <Chevron className="shrink-0 text-ink-2" size={16} />
            </button>
          )}

          {adding ? (
            <AddByPickerForm onDone={() => setAdding(false)} />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="group-row group-row-sep w-full text-left"
            >
              <div className="t-body">Add a client</div>
              <Chevron className="shrink-0 text-ink-2" size={16} />
            </button>
          )}

          {inviting ? (
            <InviteForm onDone={() => setInviting(false)} />
          ) : (
            <button
              type="button"
              onClick={() => setInviting(true)}
              className="group-row group-row-sep w-full text-left"
            >
              <div className="t-body">Invite a client</div>
              <Chevron className="shrink-0 text-ink-2" size={16} />
            </button>
          )}
        </>
      )}
    </>
  );
}

/**
 * The coach's own name and address, typed once.
 *
 * The name is what every client sees - on the invite, beside their shared
 * sheet, and on their locked Plan tab - and the address is the Google account
 * their sheet gets shared with, so it must be the one this app signs in as.
 */
function CoachProfileForm({ onDone }: { onDone: () => void }) {
  const saved = loadCoachProfile();
  const [name, setName] = useState(saved.name);
  const [email, setEmail] = useState(saved.email);
  const [error, setError] = useState<string | undefined>();

  const save = () => {
    if (name.trim() === "") return setError("Add your name");
    if (!isLikelyEmail(email)) return setError("That email does not look right");
    saveCoachProfile({ name: name.trim(), email: email.trim() });
    onDone();
  };

  return (
    <div className="group-row-sep space-y-3 px-4 py-4">
      <Field label="Your name" value={name} onChange={setName} placeholder="Marcus" />
      <Field
        label="Your Google email"
        value={email}
        onChange={setEmail}
        placeholder="you@gmail.com"
      />
      <p className="t-label text-ink-2">Clients share their sheet with this address</p>
      {error && <p className="t-label text-signal">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          className="min-h-[44px] flex-1 bg-ink t-body font-medium text-paper rounded-md"
        >
          Save
        </button>
        <button type="button" onClick={onDone} className="min-h-[44px] flex-1 t-body text-ink-2">
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Adding a client: the client shares their sheet, and picking it is what grants
 * this app access to it (see google-picker.ts).
 */
const PICK_ERRORS: Record<PickFailure, string> = {
  "needs-consent": "Google sign-in was closed before it finished",
  "script-blocked": "Couldn't load Google. Check your connection or content blocker",
  "no-api-key": "This build has no Google API key",
  "no-client-id": "This build has no Google client id",
};

function AddByPickerForm({ onDone }: { onDone: () => void }) {
  const addClient = useCoachStore((s) => s.addClient);
  const [name, setName] = useState("");
  const [sheet, setSheet] = useState<PickedSheet | undefined>();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const pick = async () => {
    setPicking(true);
    setError(undefined);
    try {
      const picked = await pickSharedSpreadsheet();
      if (picked) {
        setSheet(picked);
        // A renamed sheet usually carries the client's name. The app's own
        // default, "Trakt — <date>", does not, and would be a useless prefill.
        if (name.trim() === "" && !picked.name.startsWith("Trakt")) setName(picked.name);
      }
    } catch (err) {
      const code = (err instanceof Error ? err.message : "") as PickFailure;
      setError(PICK_ERRORS[code] ?? PICK_ERRORS["script-blocked"]);
    } finally {
      setPicking(false);
    }
  };

  const submit = async () => {
    if (!sheet) return setError("Choose their sheet first");
    if (name.trim() === "") return setError("Give them a name");
    await addClient({
      id: `cc_${crypto.randomUUID()}`,
      name: name.trim(),
      kind: "google",
      spreadsheetId: sheet.id,
    });
    onDone();
  };

  return (
    <div className="group-row-sep space-y-3 px-4 py-4">
      <button
        type="button"
        disabled={picking}
        onClick={() => void pick()}
        className="flex min-h-[44px] w-full items-center justify-between border border-rule px-3 text-left rounded-md"
      >
        <span className="min-w-0 truncate t-body text-ink">
          {picking
            ? "Opening Google…"
            : sheet
              ? sheet.name || "Untitled sheet"
              : "Choose their sheet"}
        </span>
        <span className="shrink-0 pl-3 t-label text-ink-2">{sheet ? "Change" : ""}</span>
      </button>
      <Field label="Name" value={name} onChange={setName} placeholder="Bob" />
      {error && <p className="t-label text-signal">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          className="min-h-[44px] flex-1 bg-ink t-body font-medium text-paper rounded-md"
        >
          Add
        </button>
        <button type="button" onClick={onDone} className="min-h-[44px] flex-1 t-body text-ink-2">
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Inviting a new client. One field: who it is for. Who it is FROM comes from
 * the coach profile, so the two names can never be swapped.
 */
function InviteForm({ onDone }: { onDone: () => void }) {
  const profile = loadCoachProfile();
  const [clientName, setClientName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [status, setStatus] = useState<"copied" | "manual" | undefined>();
  const [manualUrl, setManualUrl] = useState<string | undefined>();

  const ready = profile.name.trim() !== "" && isLikelyEmail(profile.email);

  const submit = async () => {
    const theirName = clientName.trim();
    setStatus(undefined);
    setManualUrl(undefined);
    if (!ready) return setError("Fill in your coach profile first");
    setError(undefined);

    const url = inviteUrl(window.location.origin, {
      v: INVITE_VERSION,
      kind: "join",
      coachName: profile.name.trim(),
      coachEmail: profile.email.trim(),
      ...(theirName ? { clientName: theirName } : {}),
    });

    // The share sheet first, because on a phone that IS sending it. Closing the
    // sheet is an answer, not a failure, so it does not fall through to a copy.
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Join me on Trakt", url });
        return;
      } catch (err) {
        if ((err as { name?: string } | null)?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch {
      setStatus("manual");
      setManualUrl(url);
    }
  };

  return (
    <div className="group-row-sep space-y-3 px-4 py-4">
      <Field label="Their name" value={clientName} onChange={setClientName} placeholder="Bob" />
      {/* Who it will say it is from. The one thing worth checking before it is
          sent, and the reason the profile exists rather than three fields
          retyped per invite. */}
      <p className="truncate t-label text-ink-2">
        {ready ? `Sent as ${profile.name} · ${profile.email}` : "No coach profile yet"}
      </p>
      {error && <p className="t-label text-signal">{error}</p>}
      {status === "copied" && <p className="t-label text-ink-2">Link copied</p>}
      {status === "manual" && <p className="t-label text-ink-2">Copy this link</p>}
      {status === "manual" && manualUrl && (
        <input
          type="text"
          readOnly
          value={manualUrl}
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.currentTarget.select()}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="min-h-[44px] w-full border border-rule bg-transparent px-3 t-body text-ink rounded-md"
        />
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          className="min-h-[44px] flex-1 bg-ink t-body font-medium text-paper rounded-md"
        >
          Send invite
        </button>
        <button type="button" onClick={onDone} className="min-h-[44px] flex-1 t-body text-ink-2">
          Done
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="block pb-1 t-label text-ink-2">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="min-h-[44px] w-full border border-rule bg-transparent px-3 t-body text-ink rounded-md"
      />
    </label>
  );
}
