import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import { DeepLinkProvider, useOpenDeepLink } from "./DeepLinkProvider";

function Trigger({ href }: { href: string }) {
  const open = useOpenDeepLink();
  return (
    <button type="button" onClick={() => open(href)}>
      Open {href}
    </button>
  );
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("DeepLinkProvider", () => {
  it("shares a single fallback dialog across multiple deep-link triggers", () => {
    render(
      <DeepLinkProvider>
        <Trigger href="projammr://session/1" />
        <Trigger href="projammr://session/2" />
      </DeepLinkProvider>
    );

    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Open projammr://session/1" })
    );
    act(() => {
      jest.advanceTimersByTime(1500);
    });

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      screen.getByText("This link needs dit running on this computer.")
    ).toBeTruthy();
  });
});
