import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { HubNavSection } from "@/components/settings-hub/HubNav";

const push = mock();

// `mock.module` is not hoisted: it must run before `HubNav` is imported, since
// that import is what evaluates `next/link` and `next/navigation`.
mock.module("next/link", () => ({
  __esModule: true,
  default: function StubLink({
    href,
    children,
    ...rest
  }: ComponentProps<"a"> & { href: unknown }) {
    return (
      <a href={String(href)} {...rest}>
        {children}
      </a>
    );
  },
  useLinkStatus: () => ({ pending: false }),
}));

mock.module("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const { HubNav } = await import("@/components/settings-hub/HubNav");

const sections: HubNavSection[] = [
  {
    id: "personal",
    label: "Personal",
    href: "/settings/personal",
    entries: [
      {
        id: "appearance",
        label: "Appearance",
        href: "/settings/personal/appearance",
      },
      {
        id: "playback",
        label: "Playback",
        href: "/settings/personal/playback",
      },
    ],
    hasPanes: false,
  },
  {
    id: "project",
    label: "Project",
    detail: "Night Drive",
    href: "/settings/project/1",
    entries: [
      {
        id: "members",
        label: "Members",
        href: "/settings/project/1/members",
      },
      {
        id: "statuses",
        label: "Statuses",
        href: "/settings/project/1/statuses",
      },
    ],
    hasPanes: true,
  },
];

describe("HubNav", () => {
  afterEach(() => {
    cleanup();
    push.mockClear();
  });

  it("draws a section's detail in soft ink, dark enough to read at its size", () => {
    render(<HubNav sections={sections} place={{ section: "project" }} />);

    const detail = screen.getByText("Night Drive");
    expect(detail.className).toContain("text-ink-soft");
    expect(detail.className).not.toContain("text-ink-faint");
  });

  it("expands only the active desktop section by default and toggles others on demand", () => {
    render(<HubNav sections={sections} place={{ section: "personal" }} />);

    expect(screen.getByRole("link", { name: "Appearance" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Members" })).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Expand Project sections" })
    );
    expect(screen.getByRole("link", { name: "Members" })).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Project sections" })
    );
    expect(screen.queryByRole("link", { name: "Members" })).toBeNull();
  });

  it("renders a Jump to section picker for Personal and Project scopes on mobile", () => {
    const { rerender } = render(
      <HubNav
        sections={sections}
        place={{ section: "personal", entry: "appearance" }}
      />
    );

    const trigger = screen.getByRole("button", { name: "Jump to section" });
    expect(trigger.textContent).toContain("Appearance");

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Playback" }));
    expect(push).toHaveBeenCalledWith("/settings/personal/playback");

    rerender(
      <HubNav
        sections={sections}
        place={{ section: "project", entry: "members" }}
      />
    );
    const projectTrigger = screen.getByRole("button", {
      name: "Jump to section",
    });
    expect(projectTrigger.textContent).toContain("Members");
  });
});
