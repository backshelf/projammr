import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { ComponentProps } from "react";

const replace = mock();
let mobile = false;

mock.module("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));
mock.module("@workspace/ui/hooks/use-mobile", () => ({
  useIsMobile: () => mobile,
}));
mock.module("@/components/navigation/AppLink", () => ({
  AppLink: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

const { DesktopNoteIndex } = await import("./DesktopNoteIndex");

beforeEach(() => {
  mobile = false;
});

afterEach(() => {
  cleanup();
  replace.mockClear();
});

describe("DesktopNoteIndex", () => {
  it("auto-opens the latest note on desktop", () => {
    render(<DesktopNoteIndex latestNoteId={42} />);
    expect(replace).toHaveBeenCalledWith("/notes/42");
  });

  it("does not redirect on mobile so the note list stays visible", () => {
    mobile = true;
    render(<DesktopNoteIndex latestNoteId={42} />);
    expect(replace).not.toHaveBeenCalled();
  });

  it("renders a quick-compose empty prompt when there are no notes", () => {
    render(<DesktopNoteIndex latestNoteId={null} />);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText("Start a note")).toBeTruthy();
    const link = screen.getByRole("link", { name: "New note" });
    expect(link.getAttribute("href")).toBe("/notes/new");
  });
});
