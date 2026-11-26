import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { PageSections } from "./PageSections";

afterEach(cleanup);

const sections = {
  notes: <p>Notes</p>,
  tracks: <p>Tracks</p>,
  comments: <p>Comments</p>,
};

const shown = (order: { id: keyof typeof sections; shown: boolean }[]) =>
  Array.from(
    render(<PageSections order={order} sections={sections} />).container
      .children
  ).map((element) => element.textContent);

describe("PageSections", () => {
  it("renders the sections in the list's order", () => {
    expect(
      shown([
        { id: "comments", shown: true },
        { id: "notes", shown: true },
        { id: "tracks", shown: true },
      ])
    ).toEqual(["Comments", "Notes", "Tracks"]);
  });

  it("leaves out a section the list hides, or does not name", () => {
    expect(
      shown([
        { id: "notes", shown: true },
        { id: "tracks", shown: false },
      ])
    ).toEqual(["Notes"]);
  });
});
