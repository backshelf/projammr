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

const lookUp = mock<Call>(async () => ({}));
const approve = mock<Call>(async () => ({}));
const deny = mock<Call>(async () => ({}));

mock.module("@workspace/api/lib/auth-client", () => ({
  authClient: { device: Object.assign(lookUp, { approve, deny }) },
}));

const { DeviceApproval } = await import("./DeviceApproval");

const pending = { status: "pending", client_id: "dit", user_code: "ABCD1234" };

beforeEach(() => {
  lookUp.mockReset();
  approve.mockReset();
  deny.mockReset();
  lookUp.mockResolvedValue({ data: pending });
  approve.mockResolvedValue({ data: { success: true } });
  deny.mockResolvedValue({ data: { success: true } });
});
afterEach(cleanup);

/** The closing message, which must be a live region so it is announced. */
const settled = async () => {
  const message = await screen.findByText(/You can close this tab/);
  expect(message.getAttribute("role")).toBe("status");
  return message.textContent;
};

const arrive = async (code = "ABCD1234") => {
  render(<DeviceApproval initialCode={code} />);
  await screen.findByRole("button", { name: "Approve" });
};

describe("DeviceApproval with a code from the link", () => {
  it("looks the code up on arrival and shows it with Approve and Deny", async () => {
    await arrive();

    expect(lookUp).toHaveBeenCalledWith({ query: { user_code: "ABCD1234" } });
    expect(screen.getByText("ABCD1234")).toBeTruthy();
    expect(screen.getByText(/matches the code in your terminal/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deny" })).toBeTruthy();
  });

  it("approves the code and says dit is signed in", async () => {
    await arrive();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(await settled()).toBe("dit is signed in. You can close this tab.");
    expect(approve).toHaveBeenCalledWith({ userCode: "ABCD1234" });
    expect(deny).not.toHaveBeenCalled();
  });

  it("denies the code and says dit was not signed in", async () => {
    await arrive();

    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    expect(await settled()).toContain("dit was not signed in");
    expect(deny).toHaveBeenCalledWith({ userCode: "ABCD1234" });
    expect(approve).not.toHaveBeenCalled();
  });

  it("goes straight to the approved state for a code already approved", async () => {
    lookUp.mockResolvedValue({ data: { ...pending, status: "approved" } });
    render(<DeviceApproval initialCode="ABCD1234" />);

    expect(await settled()).toBe("dit is signed in. You can close this tab.");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("goes straight to the denied state for a code already denied", async () => {
    lookUp.mockResolvedValue({ data: { ...pending, status: "denied" } });
    render(<DeviceApproval initialCode="ABCD1234" />);

    expect(await settled()).toContain("dit was not signed in");
  });

  it("keeps the code on screen with Approve live when a retry could succeed", async () => {
    approve.mockResolvedValue({ error: { status: 502, statusText: "Bad" } });
    await arrive();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Something went wrong (502). Try again."
    );
    expect(screen.getByText("ABCD1234")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it.each([
    ["approve", "Approve"],
    ["deny", "Deny"],
  ] as const)(
    "returns to the code field with the expiry copy when %s finds the code expired",
    async (which, name) => {
      (which === "approve" ? approve : deny).mockResolvedValue({
        error: { error: "expired_token", error_description: "raw" },
      });
      await arrive();
      lookUp.mockResolvedValue({ error: { error: "expired_token" } });

      fireEvent.click(screen.getByRole("button", { name }));

      expect((await screen.findByRole("alert")).textContent).toContain(
        "That code has expired"
      );
      expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
      expect(screen.getByLabelText("Code")).toBeTruthy();
    }
  );

  it("shows the real outcome when the code was already decided in another tab", async () => {
    approve.mockResolvedValue({
      error: {
        error: "invalid_request",
        error_description: "Device code already processed",
      },
    });
    await arrive();
    lookUp.mockResolvedValue({ data: { ...pending, status: "approved" } });

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(await settled()).toBe("dit is signed in. You can close this tab.");
    expect(lookUp).toHaveBeenCalledTimes(2);
  });

  it("returns to the code field when the refused code no longer exists", async () => {
    approve.mockResolvedValue({ error: { error: "invalid_request" } });
    await arrive();
    lookUp.mockResolvedValue({ error: { error: "invalid_request" } });

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "not valid"
    );
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it.each([
    ["approve", "Approve"],
    ["deny", "Deny"],
  ] as const)(
    "says another account holds the code when %s is refused with access_denied",
    async (which, name) => {
      (which === "approve" ? approve : deny).mockResolvedValue({
        error: { error: "access_denied" },
      });
      await arrive();
      lookUp.mockResolvedValue({ error: { error: "access_denied" } });

      fireEvent.click(screen.getByRole("button", { name }));

      expect((await screen.findByRole("alert")).textContent).toContain(
        "different account"
      );
      expect(screen.getByLabelText("Code")).toBeTruthy();
    }
  );

  it("shows the server's reason when a retryable approve failure carries one", async () => {
    approve.mockResolvedValue({
      error: { status: 503, error_description: "Try again in a minute" },
    });
    await arrive();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Try again in a minute"
    );
  });

  it("shows the server's message when a refusal has a message and a status", async () => {
    approve.mockResolvedValue({
      error: {
        status: 403,
        message: "Sign in to an account to authorize a device",
      },
    });
    await arrive();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Sign in to an account to authorize a device"
    );
  });

  it("announces the lookup and spells the code out for a screen reader", async () => {
    let finish: (reply: Reply) => void = () => {};
    lookUp.mockReturnValue(new Promise<Reply>((resolve) => (finish = resolve)));
    render(<DeviceApproval initialCode="ABCD1234" />);

    expect(screen.getByText("Checking the code…").getAttribute("role")).toBe(
      "status"
    );
    finish({ data: pending });
    await screen.findByRole("button", { name: "Approve" });

    expect(screen.getByText("ABCD1234").getAttribute("aria-hidden")).toBe(
      "true"
    );
    expect(screen.getByText("A B C D 1 2 3 4").className).toContain("sr-only");
  });

  it("looks a code up once when the effect runs twice", async () => {
    const { StrictMode } = await import("react");
    render(
      <StrictMode>
        <DeviceApproval initialCode="ABCD1234" />
      </StrictMode>
    );
    await screen.findByRole("button", { name: "Approve" });

    expect(lookUp).toHaveBeenCalledTimes(1);
  });

  it("asks for the code again when it is invalid", async () => {
    lookUp.mockResolvedValue({ error: { error: "invalid_request" } });
    render(<DeviceApproval initialCode="WRONG123" />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "not valid"
    );
    expect((screen.getByLabelText("Code") as HTMLInputElement).value).toBe(
      "WRONG123"
    );
  });

  it("asks for a new code when it has expired", async () => {
    lookUp.mockResolvedValue({ error: { error: "expired_token" } });
    render(<DeviceApproval initialCode="OLDCODE1" />);

    expect((await screen.findByRole("alert")).textContent).toContain("expired");
  });

  it("says another account holds a code it cannot review", async () => {
    lookUp.mockResolvedValue({
      data: { status: "pending", user_code: "ABCD1234" },
    });
    render(<DeviceApproval initialCode="ABCD1234" />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "different account"
    );
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("tells the person to wait when the server rate-limits the lookup", async () => {
    lookUp.mockResolvedValue({
      error: { status: 429, error: "Too many requests" },
    });
    render(<DeviceApproval initialCode="ABCD1234" />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Too many attempts"
    );
  });

  it("reports a bodiless HTTP error by its status, not as an unreachable server", async () => {
    lookUp.mockResolvedValue({ error: { status: 500, statusText: "Oops" } });
    render(<DeviceApproval initialCode="ABCD1234" />);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Something went wrong (500). Try again."
    );
  });

  it("reports an unreachable server instead of hanging on the lookup", async () => {
    lookUp.mockRejectedValue(new Error("offline"));
    render(<DeviceApproval initialCode="ABCD1234" />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not reach"
    );
  });
});

describe("DeviceApproval with no code in the link", () => {
  it("asks for the code and looks up what was typed, upper-cased", async () => {
    render(<DeviceApproval />);
    const submit = screen.getByRole("button", {
      name: "Continue",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(lookUp).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Code"), {
      target: { value: " abcd1234 " },
    });
    fireEvent.click(submit);

    await screen.findByRole("button", { name: "Approve" });
    await waitFor(() =>
      expect(lookUp).toHaveBeenCalledWith({ query: { user_code: "ABCD1234" } })
    );
  });
});
