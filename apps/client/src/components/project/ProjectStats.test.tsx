import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { ArchivedCountNote } from "./ProjectStats";

describe("ArchivedCountNote", () => {
  test("renders nothing when no track is archived", () => {
    const { container } = render(<ArchivedCountNote live={12} archived={0} />);

    expect(container.textContent).toBe("");
  });

  test("shows the archived count and the live-plus-archived total", () => {
    const { container } = render(<ArchivedCountNote live={12} archived={3} />);

    expect(container.textContent).toBe("3 archived · 15 total");
  });
});
