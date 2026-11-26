import { afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Toaster } from "./sonner";

afterEach(() => {
  act(() => toast.dismiss());
  cleanup();
});

/** Shows a toast and reads the theme the toaster rendered it in. */
async function toastTheme(ui: ReactNode) {
  render(ui);
  act(() => {
    toast("Saved");
  });
  // Sonner adds a published toast to its list on a timer.
  const list = await waitFor(() => {
    const found = document.querySelector("[data-sonner-theme]");
    if (!found) throw new Error("no toast list yet");
    return found;
  });
  return list.getAttribute("data-sonner-theme");
}

describe("Toaster", () => {
  it("follows next-themes' theme when given none", async () => {
    expect(
      await toastTheme(
        <ThemeProvider attribute="class" defaultTheme="dark">
          <Toaster />
        </ThemeProvider>
      )
    ).toBe("dark");
  });

  it("follows next-themes' theme when given an undefined one", async () => {
    expect(
      await toastTheme(
        <ThemeProvider attribute="class" defaultTheme="dark">
          <Toaster theme={undefined} />
        </ThemeProvider>
      )
    ).toBe("dark");
  });

  it("takes the theme it is given over next-themes'", async () => {
    expect(
      await toastTheme(
        <ThemeProvider attribute="class" defaultTheme="dark">
          <Toaster theme="light" />
        </ThemeProvider>
      )
    ).toBe("light");
  });
});
