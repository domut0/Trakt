import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoachSettings } from "../CoachSettings";
import { useCoachStore } from "../../lib/coach-store";
import { decodeInvite } from "../../lib/invite";

/**
 * The coach's own details are a setting, not three fields retyped per invite.
 * Before, the invite form asked for "Their name" and "Your name" next to each
 * other, which is how a client ended up being greeted by their own name.
 */

function renderSettings() {
  render(<CoachSettings />);
}

beforeEach(() => {
  localStorage.clear();
  useCoachStore.setState({ enabled: true, clients: [], hydrated: true, viewing: undefined });
});

afterEach(() => vi.restoreAllMocks());

describe("the coach profile", () => {
  it("is what the invite is sent as, with no name to retype", async () => {
    const shared: { url?: string } = {};
    vi.stubGlobal("navigator", {
      ...navigator,
      share: (data: { url: string }) => {
        shared.url = data.url;
        return Promise.resolve();
      },
    });

    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /Your coach profile/ }));
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Marcus" } });
    fireEvent.change(screen.getByLabelText("Your Google email"), {
      target: { value: "marcus@gmail.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    fireEvent.click(screen.getByRole("button", { name: /Invite a client/ }));
    expect(screen.getByText("Sent as Marcus · marcus@gmail.com")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Their name"), { target: { value: "Bob" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    await vi.waitFor(() => expect(shared.url).toBeDefined());
    const payload = decodeInvite(new URL(shared.url!).hash);
    expect(payload).toMatchObject({
      kind: "join",
      coachName: "Marcus",
      coachEmail: "marcus@gmail.com",
      clientName: "Bob",
    });
  });

  it("refuses to send before the profile exists, rather than inviting as nobody", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /Invite a client/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    expect(screen.getByText("Fill in your coach profile first")).toBeInTheDocument();
  });

  it("will not save a profile with an address that cannot receive a share", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /Your coach profile/ }));
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Marcus" } });
    fireEvent.change(screen.getByLabelText("Your Google email"), { target: { value: "marcus" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("That email does not look right")).toBeInTheDocument();
  });
});

describe("adding a client via picker", () => {
  it("renders specific error and diagnostic line when Google rejects the API key", async () => {
    const googlePicker = await import("../../lib/google-picker");
    vi.spyOn(googlePicker, "pickSharedSpreadsheet").mockRejectedValue(new Error("bad-api-key"));
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "123456789-test.apps.googleusercontent.com");
    vi.stubEnv("VITE_GOOGLE_API_KEY", "test-api-key");

    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /Add a client/ }));
    fireEvent.click(screen.getByRole("button", { name: /Choose their sheet/ }));

    await vi.waitFor(() => {
      expect(
        screen.getByText(
          "Google rejected this build's API key. Check the Picker API is on and the key allows this site",
        ),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText("Client id present, API key present, app id 123456789"),
    ).toBeInTheDocument();
  });

  // The diagnostic is not tied to the key error. The failure it exists for --
  // the Picker rejecting the key behind its own iframe -- reaches us as an
  // ordinary cancel, so every failure has to carry the configuration with it.
  it("renders the diagnostic line on any picker failure, not just a key error", async () => {
    const googlePicker = await import("../../lib/google-picker");
    vi.spyOn(googlePicker, "pickSharedSpreadsheet").mockRejectedValue(new Error("needs-consent"));
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "987654321-test.apps.googleusercontent.com");
    vi.stubEnv("VITE_GOOGLE_API_KEY", "test-api-key");

    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /Add a client/ }));
    fireEvent.click(screen.getByRole("button", { name: /Choose their sheet/ }));

    await vi.waitFor(() => {
      expect(screen.getByText("Google sign-in was closed before it finished")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Client id present, API key present, app id 987654321"),
    ).toBeInTheDocument();
  });
});
