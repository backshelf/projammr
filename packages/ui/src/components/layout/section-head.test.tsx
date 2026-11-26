import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { SectionHead } from "./section-head";

afterEach(cleanup);

describe("SectionHead", () => {
  it("separates the title and count in the heading's accessible name", () => {
    render(<SectionHead count={2}>COMMENTS</SectionHead>);

    // A regression guard for a heading whose title and count ran together
    // with no separator ("COMMENTS2") because they were adjacent text nodes:
    // the accessible name must carry a comma between the two, whatever
    // whitespace the accessible-name join contributes around it.
    expect(
      screen.getByRole("heading", { name: /^COMMENTS\s*,\s*2$/ })
    ).toBeInstanceOf(HTMLHeadingElement);
  });

  it("names the heading by its title alone when there is no count", () => {
    render(<SectionHead>ATTACHMENTS</SectionHead>);

    expect(screen.getByRole("heading", { name: "ATTACHMENTS" })).toBeInstanceOf(
      HTMLHeadingElement
    );
  });

  it("heads a section at level 2, and a group inside one at level 3", () => {
    render(
      <>
        <SectionHead>SCHEDULE</SectionHead>
        <SectionHead as="h3">BATTERY</SectionHead>
      </>
    );

    expect(
      screen.getByRole("heading", { name: "SCHEDULE", level: 2 })
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "BATTERY", level: 3 })
    ).toBeTruthy();
  });

  it("heads a group inside a level-3 item at level 4", () => {
    render(<SectionHead as="h4">SCOPE</SectionHead>);

    expect(
      screen.getByRole("heading", { name: "SCOPE", level: 4 })
    ).toBeTruthy();
  });
});
