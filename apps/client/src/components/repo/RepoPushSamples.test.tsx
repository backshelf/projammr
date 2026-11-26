import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

const setRepoPushSamples = mock<(id: number, on: boolean) => Promise<object>>(
  async () => ({})
);
mock.module("@/actions/repos", () => ({ setRepoPushSamples }));
mock.module("sonner", () => ({ toast: { error: mock(), success: mock() } }));

const { RepoPushSamples } = await import("./RepoPushSamples");

afterEach(() => {
  cleanup();
  setRepoPushSamples.mockClear();
});

const toggle = () =>
  screen.getByRole("switch", { name: "Push samples" }) as HTMLButtonElement;

describe("RepoPushSamples", () => {
  it("is on and locked, with its reason, when the instance forces it", () => {
    render(<RepoPushSamples repoId={4} pushSamples forced canEdit />);
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(toggle().disabled).toBe(true);
    expect(
      screen.getByText("On for every repository on this instance.")
    ).toBeTruthy();
    fireEvent.click(toggle());
    expect(setRepoPushSamples).not.toHaveBeenCalled();
  });

  it("shows a viewer the setting read-only", () => {
    render(
      <RepoPushSamples repoId={4} pushSamples forced={false} canEdit={false} />
    );
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(toggle().disabled).toBe(true);
    expect(screen.queryByText(/every repository/)).toBeNull();
    fireEvent.click(toggle());
    expect(setRepoPushSamples).not.toHaveBeenCalled();
  });

  it("writes the flip for an editor and shows it at once", async () => {
    render(
      <RepoPushSamples repoId={4} pushSamples={false} forced={false} canEdit />
    );
    fireEvent.click(toggle());
    expect(setRepoPushSamples).toHaveBeenCalledWith(4, true);
  });
});
