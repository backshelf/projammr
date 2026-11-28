import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import type { Auth } from "../ipc";
import { argsOf, base, mockApp, renderScreen, teardown } from "../test-support";
import { SignIn } from "./sign-in";

afterEach(teardown);

const host = "https://projammr.example";

function auth(changes: Partial<Auth>): Auth {
  return { state: "signed-out", host: null, pending: null, ...changes };
}

describe("SignIn", () => {
  test("offers the instance address and Sign in when signed out, and signs in to what was typed", async () => {
    const calls = mockApp(base);
    renderScreen(<SignIn auth={auth({})} />);

    expect(screen.getByText("Not signed in.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Instance"), {
      target: { value: ` ${host} ` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(argsOf(calls, "sign_in")).toEqual([{ host }]));
  });

  test("signs in to the stored instance when the address is left blank", async () => {
    const calls = mockApp(base);
    renderScreen(<SignIn auth={auth({})} />);

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(argsOf(calls, "sign_in")).toEqual([{ host: null }])
    );
  });

  test("shows why the sign-in was refused", async () => {
    mockApp(base, (command) => {
      if (command === "sign_in") {
        throw `${host} uses a certificate this computer doesn't trust. Install the instance's certificate and try again.`;
      }
    });
    renderScreen(<SignIn auth={auth({ host })} />);

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "uses a certificate this computer doesn't trust"
    );
  });

  test("waits with the code, copies it, opens again, or cancels sign-in", async () => {
    const calls = mockApp(base);
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied = text;
        },
      },
    });
    renderScreen(
      <SignIn
        auth={auth({
          state: "signing-in",
          host,
          pending: { userCode: "WDJB-MJHT", verificationUri: `${host}/device` },
        })}
      />
    );

    expect(
      screen.getByText("Approve this computer in your browser.")
    ).toBeTruthy();
    expect(screen.getByText("WDJB-MJHT")).toBeTruthy();
    expect(screen.queryByLabelText("Instance")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await waitFor(() => expect(copied).toBe("WDJB-MJHT"));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open again" }));
    await waitFor(() => expect(argsOf(calls, "sign_in")).toEqual([{ host }]));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(argsOf(calls, "cancel_sign_in")).toHaveLength(1)
    );
  });

  test("says the hub signed this computer out and keeps the address to sign back in to", () => {
    mockApp(base);
    renderScreen(<SignIn auth={auth({ state: "revoked", host })} />);

    expect(
      screen.getByText(`Signed out of ${host}. Sign in to keep pushing.`)
    ).toBeTruthy();
    expect((screen.getByLabelText("Instance") as HTMLInputElement).value).toBe(
      host
    );
  });

  test("says the Keychain would not give the sign-in up", () => {
    mockApp(base);
    renderScreen(<SignIn auth={auth({ state: "keychain-locked" })} />);

    expect(
      screen.getByText("dit can't read its sign-in from the Keychain.")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  test("offers Quit alone in the menu, since nothing else can be reached yet", async () => {
    mockApp(base);
    renderScreen(<SignIn auth={auth({})} />);

    fireEvent.click(screen.getByRole("button", { name: "Menu" }));

    expect(await screen.findByRole("menuitem", { name: /^Quit/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Settings" })).toBeNull();
  });
});
