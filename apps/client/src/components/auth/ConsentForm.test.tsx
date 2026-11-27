import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

type Reply = { data?: unknown; error?: unknown };
type Call = (...args: unknown[]) => Promise<Reply>;

const publicClient = mock<Call>(async () => ({
  data: { client_name: "Claude Code" },
}));
const consent = mock<Call>(async () => ({}));

mock.module("@workspace/api/lib/auth-client", () => ({
  authClient: {
    oauth2: { publicClient, consent },
  },
}));

const { ConsentForm } = await import("./ConsentForm");

beforeEach(() => {
  publicClient.mockReset();
  consent.mockReset();
  publicClient.mockResolvedValue({ data: { client_name: "Claude Code" } });
  consent.mockResolvedValue({ data: {} });
});

afterEach(cleanup);

async function mountConsent(scope = "read write offline_access") {
  render(<ConsentForm clientId="client-1" scope={scope} claims={undefined} />);
  await screen.findByText("Claude Code");
}

describe("ConsentForm", () => {
  it("shows friendly labels and descriptions for read, write, and offline_access", async () => {
    await mountConsent();

    const read = screen.getByLabelText("Read") as HTMLInputElement;
    const write = screen.getByLabelText("Write") as HTMLInputElement;
    const stayConnected = screen.getByLabelText(
      "Stay connected"
    ) as HTMLInputElement;

    expect(read.checked).toBe(true);
    expect(read.disabled).toBe(true);
    expect(write.checked).toBe(true);
    expect(write.disabled).toBe(false);
    expect(stayConnected.checked).toBe(true);
    expect(stayConnected.disabled).toBe(false);

    expect(
      screen.getByText(
        "Refresh its connection automatically in the background without asking you to sign in every day."
      )
    ).toBeTruthy();
  });

  it("grants offline_access by default when Allow is clicked", async () => {
    await mountConsent();

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));

    await waitFor(() =>
      expect(consent).toHaveBeenCalledWith({
        accept: true,
        scope: "read write offline_access",
        claims: undefined,
      })
    );
  });

  it("omits offline_access when Stay connected is unticked", async () => {
    await mountConsent();

    fireEvent.click(screen.getByLabelText("Stay connected"));
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));

    await waitFor(() =>
      expect(consent).toHaveBeenCalledWith({
        accept: true,
        scope: "read write",
        claims: undefined,
      })
    );
  });
});
