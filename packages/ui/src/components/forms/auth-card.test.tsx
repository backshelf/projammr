import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { MotionProvider } from "../motion-provider";
import { AuthCard } from "./auth-card";
import {
  AuthCardGuest,
  AuthCardRegister,
  AuthCardSignIn,
} from "./auth-card-tabs";

afterEach(cleanup);

const renderCard = (ui: React.ReactElement) =>
  render(ui, { wrapper: MotionProvider });

const tabNames = () =>
  screen.queryAllByRole("tab").map((tab) => tab.textContent);

describe("AuthCard", () => {
  it("lays the tabs out in the children's order and selects the first", () => {
    renderCard(
      <AuthCard>
        <AuthCard.Register />
        <AuthCard.SignIn />
        <AuthCard.Guest />
      </AuthCard>
    );

    expect(tabNames()).toEqual(["Register", "Sign in", "Guest"]);
    expect(
      screen.getByRole("tab", { name: "Register" }).getAttribute("data-active")
    ).not.toBeNull();
    expect(
      screen.getByRole("tab", { name: "Sign in" }).getAttribute("data-active")
    ).toBeNull();
  });

  it("gives two tabs two columns and three tabs three, as literal classes", () => {
    const { unmount } = renderCard(
      <AuthCard>
        <AuthCard.SignIn />
        <AuthCard.Register />
      </AuthCard>
    );
    expect(screen.getByRole("tablist").className).toContain("grid-cols-2");
    unmount();

    renderCard(
      <AuthCard>
        <AuthCard.Guest />
        <AuthCard.SignIn />
        <AuthCard.Register />
      </AuthCard>
    );
    expect(screen.getByRole("tablist").className).toContain("grid-cols-3");
  });

  it("renders no tab bar for a single child", () => {
    renderCard(
      <AuthCard>
        <AuthCard.SignIn />
      </AuthCard>
    );

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).not.toBeNull();
  });

  it("skips a child that is conditionally absent", () => {
    renderCard(
      <AuthCard>
        <AuthCard.SignIn />
        {false}
      </AuthCard>
    );

    expect(screen.queryByRole("tablist")).toBeNull();
  });

  describe("heading", () => {
    const headingFor = (card: React.ReactElement) => {
      renderCard(card);
      const text = screen.getByRole("heading").textContent;
      cleanup();
      return text;
    };

    it("follows the tabs on offer when no title is given", () => {
      expect(
        headingFor(
          <AuthCard>
            <AuthCard.SignIn />
          </AuthCard>
        )
      ).toBe("Sign in");
      expect(
        headingFor(
          <AuthCard>
            <AuthCard.Guest />
            <AuthCard.SignIn />
          </AuthCard>
        )
      ).toBe("Sign in");
      expect(
        headingFor(
          <AuthCard>
            <AuthCard.Register />
          </AuthCard>
        )
      ).toBe("Create an account");
      expect(
        headingFor(
          <AuthCard>
            <AuthCard.SignIn />
            <AuthCard.Register />
          </AuthCard>
        )
      ).toBe("Sign in or create an account");
      expect(
        headingFor(
          <AuthCard>
            <AuthCard.Guest />
            <AuthCard.SignIn />
            <AuthCard.Register />
          </AuthCard>
        )
      ).toBe("Sign in or create an account");
    });

    it("lets an explicit title win", () => {
      renderCard(
        <AuthCard
          title="Create the first account"
          description="This account will administer the instance."
        >
          <AuthCard.Register />
        </AuthCard>
      );

      expect(
        screen.getByRole("heading", { name: "Create the first account" })
      ).not.toBeNull();
      expect(
        screen.getByText("This account will administer the instance.")
      ).not.toBeNull();
    });
  });

  it("describes only the tabs on offer when no description is given", () => {
    const descriptionFor = (card: React.ReactElement) => {
      renderCard(card);
      const text = screen.getByRole("heading").nextElementSibling?.textContent;
      cleanup();
      return text;
    };

    expect(
      descriptionFor(
        <AuthCard>
          <AuthCard.Guest />
          <AuthCard.SignIn />
        </AuthCard>
      )
    ).toBe("Sign in, or continue as a guest.");
    expect(
      descriptionFor(
        <AuthCard>
          <AuthCard.SignIn />
        </AuthCard>
      )
    ).toBe("Sign in to get started.");
    expect(
      descriptionFor(
        <AuthCard>
          <AuthCard.Register />
        </AuthCard>
      )
    ).toBe("Create an account to get started.");
    expect(
      descriptionFor(
        <AuthCard>
          <AuthCard.Register />
          <AuthCard.SignIn />
        </AuthCard>
      )
    ).toBe("Sign in, or create an account to get started.");
    expect(
      descriptionFor(
        <AuthCard>
          <AuthCard.Guest />
          <AuthCard.SignIn />
          <AuthCard.Register />
        </AuthCard>
      )
    ).toBe("Sign in, create an account, or continue as a guest.");
  });

  it("offers a link to the recovery page when the instance can mail one", () => {
    renderCard(
      <AuthCard>
        <AuthCard.SignIn
          recovery={{ kind: "link", href: "/forgot-password" }}
        />
      </AuthCard>
    );

    const link = screen.getByRole("link", { name: "Forgot password?" });
    expect(link.getAttribute("href")).toBe("/forgot-password");
  });

  it("names the instance admin instead of a link when the instance sends no mail", () => {
    renderCard(
      <AuthCard>
        <AuthCard.SignIn
          recovery={{
            kind: "message",
            text: "Ask your instance admin for a reset link.",
          }}
        />
      </AuthCard>
    );

    expect(screen.queryByRole("link", { name: /forgot password/i })).toBeNull();
    expect(
      screen.getByText("Ask your instance admin for a reset link.")
    ).not.toBeNull();
  });

  describe("email", () => {
    it("shows the locked address read-only", () => {
      renderCard(
        <AuthCard>
          <AuthCard.Register defaultEmail="ada@example.com" lockEmail />
        </AuthCard>
      );

      const email = screen.getByLabelText("Email") as HTMLInputElement;
      expect(email.value).toBe("ada@example.com");
      expect(email.readOnly).toBe(true);
    });

    it("leaves the field editable when there is no address to lock", () => {
      renderCard(
        <AuthCard>
          <AuthCard.SignIn lockEmail />
        </AuthCard>
      );

      const email = screen.getByLabelText("Email") as HTMLInputElement;
      expect(email.readOnly).toBe(false);
    });
  });

  describe("password rule", () => {
    it("describes the widest rule when the instance's is not handed in", () => {
      renderCard(
        <AuthCard>
          <AuthCard.Register />
        </AuthCard>
      );

      expect(screen.getByText("At least 8 characters")).not.toBeNull();
    });

    it("holds a new password to the rule it is handed", async () => {
      renderCard(
        <AuthCard>
          <AuthCard.Register
            passwordRule={{ passwordMin: 12, passwordMax: 64 }}
          />
        </AuthCard>
      );
      expect(screen.getByText("At least 12 characters")).not.toBeNull();

      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: "Rule Test" },
      });
      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: "rule@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "elevenchars" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create account" }));

      expect(
        await screen.findByText("Password must be at least 12 characters long")
      ).not.toBeNull();
    });
  });

  describe("children rule", () => {
    it("throws for a child that is not one of the three", () => {
      const error = spyOn(console, "error").mockImplementation(() => {});
      expect(() =>
        renderCard(
          <AuthCard>
            <AuthCard.SignIn />
            <div>stray</div>
          </AuthCard>
        )
      ).toThrow(/AuthCard\.Guest, AuthCard\.SignIn or AuthCard\.Register/);
      error.mockRestore();
    });

    it("throws when there are no children to make tabs from", () => {
      const error = spyOn(console, "error").mockImplementation(() => {});
      expect(() => renderCard(<AuthCard>{null}</AuthCard>)).toThrow(
        /at least one/
      );
      error.mockRestore();
    });

    it("throws when a kind of tab child is repeated", () => {
      const error = spyOn(console, "error").mockImplementation(() => {});
      expect(() =>
        renderCard(
          <AuthCard>
            <AuthCard.SignIn />
            <AuthCard.SignIn />
          </AuthCard>
        )
      ).toThrow(/at most once/);
      error.mockRestore();
    });
  });

  it("attaches the standalone tab components from auth-card-tabs as its members", () => {
    expect(AuthCard.Guest).toBe(AuthCardGuest);
    expect(AuthCard.SignIn).toBe(AuthCardSignIn);
    expect(AuthCard.Register).toBe(AuthCardRegister);
  });

  it("builds tabs from the standalone components, as a lazily loaded card's caller would", () => {
    renderCard(
      <AuthCard>
        <AuthCardSignIn />
        <AuthCardRegister />
      </AuthCard>
    );

    expect(tabNames()).toEqual(["Sign in", "Register"]);
  });
});
