import { renderGrid } from "@/components/tables/test-support";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "bun:test";

// The grid tier is the `Grid` part: the wrapper and header around the body,
// and the empty state. `test-support` restores the globals and unmounts after
// each case.

/** The titles of the body's rows, top to bottom. */
const titles = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('tbody [data-cell$="::title"]')).map(
    (cell) => cell.textContent
  );

describe("Grid", () => {
  describe("header", () => {
    it("reorders the rows on a click of a sortable header and reverses them on the second", () => {
      // Genre is `Rock` then `Pop` in the data, so the first ascending click
      // is the one that moves them.
      const { container } = renderGrid();
      expect(titles(container)).toEqual(["One", "Two"]);

      const sortByGenre = screen.getByRole("button", { name: /Genre/ });
      fireEvent.click(sortByGenre);
      expect(titles(container)).toEqual(["Two", "One"]);

      fireEvent.click(sortByGenre);
      expect(titles(container)).toEqual(["One", "Two"]);
    });

    it("gives a column that cannot sort a plain heading rather than a button", () => {
      renderGrid(undefined, undefined, {
        columns: [
          {
            id: "title",
            header: "Title",
            accessorFn: (row) => row.title,
            enableSorting: false,
          },
        ],
      });

      expect(screen.queryByRole("button", { name: /Title/ })).toBeNull();
      expect(
        screen.getByRole("columnheader", { name: /Title/ })
      ).not.toBeNull();
    });

    it("adds the row-actions spacer only with a rowActions config", () => {
      const withoutActions = renderGrid();
      expect(screen.queryByText("Row actions")).toBeNull();
      withoutActions.unmount();

      renderGrid(undefined, undefined, { rowActions: {} });
      expect(screen.getByText("Row actions")).not.toBeNull();
    });
  });

  describe("empty state", () => {
    it("shows the empty text when the table has no rows", () => {
      const { container } = renderGrid(undefined, undefined, {
        data: [],
        emptyText: "Nothing here.",
      });

      expect(screen.getByText("Nothing here.")).not.toBeNull();
      expect(titles(container)).toEqual([]);
    });

    it("shows nothing of the kind while there are rows", () => {
      renderGrid(undefined, undefined, { emptyText: "Nothing here." });

      expect(screen.queryByText("Nothing here.")).toBeNull();
    });
  });
});
