import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { SidebarProvider, SidebarTrigger } from "./sidebar";

afterEach(cleanup);

describe("SidebarTrigger", () => {
  it("uses a caller's aria-label without injecting conflicting sr-only Toggle Sidebar text", () => {
    render(
      <SidebarProvider>
        <SidebarTrigger aria-label="Hide sidebar" />
      </SidebarProvider>
    );

    const button = screen.getByRole("button", { name: "Hide sidebar" });
    expect(button.textContent).toBe("");
    expect(screen.queryByText("Toggle Sidebar")).toBeNull();
  });

  it("falls back to Toggle Sidebar when no aria-label is supplied", () => {
    render(
      <SidebarProvider>
        <SidebarTrigger />
      </SidebarProvider>
    );

    expect(screen.getByRole("button", { name: "Toggle Sidebar" })).toBeTruthy();
  });
});
