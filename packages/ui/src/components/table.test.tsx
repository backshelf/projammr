import {
  Meter,
  MeterCell,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TableScroll,
} from "@workspace/ui/components/table";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";

afterEach(cleanup);

describe("Table", () => {
  it("locks entity table body cells to --table-row-h without altering default tables", () => {
    const { container: entityContainer } = render(
      <Table variant="entity">
        <TableBody>
          <TableRow>
            <TableCell>Track</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    const entityWrapper = entityContainer.querySelector(
      '[data-slot="table-container"]'
    );
    expect(entityWrapper?.className).toContain("[&_td]:h-(--table-row-h)");
    expect(entityWrapper?.className).toContain("[&_td]:py-0");
    expect(entityWrapper?.className).toContain("[&_td]:align-middle");

    const { container: defaultContainer } = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Plain</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    const defaultWrapper = defaultContainer.querySelector(
      '[data-slot="table-container"]'
    );
    expect(defaultWrapper?.className).not.toContain("[&_td]:h-(--table-row-h)");
  });

  it("keeps data-slot=table-cell when data-slot is undefined while allowing pinned", () => {
    const { container } = render(
      <Table variant="entity">
        <TableBody>
          <TableRow>
            <TableCell data-slot={undefined}>Regular</TableCell>
            <TableCell data-slot="pinned">Pinned</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    const cells = container.querySelectorAll("td");
    expect(cells[0]?.getAttribute("data-slot")).toBe("table-cell");
    expect(cells[1]?.getAttribute("data-slot")).toBe("pinned");
  });
});

describe("Meter", () => {
  it("prints no figure by default", () => {
    render(<Meter value={42} aria-label={"job progress"} />);

    expect(screen.queryByText("42%")).toBeNull();
  });

  it("prints the rounded percentage when showValue is set", () => {
    render(<Meter value={41.6} showValue aria-label={"job progress"} />);

    expect(screen.getByText("42%")).not.toBeNull();
  });
});

describe("MeterCell", () => {
  it("shows the figure by default, one primitive owning the readout", () => {
    render(<MeterCell value={75} />);

    expect(screen.getByText("75%")).not.toBeNull();
  });

  it("hides the figure when told to", () => {
    render(<MeterCell value={75} showValue={false} />);

    expect(screen.queryByText("75%")).toBeNull();
  });
});

describe("TableScroll", () => {
  it("is a keyboard-focusable scroll region", () => {
    render(
      <TableScroll>
        <table>
          <tbody>
            <tr>
              <td>Row</td>
            </tr>
          </tbody>
        </table>
      </TableScroll>
    );

    const region = screen.getByRole("region", { name: "Scrollable table" });
    expect(region.tabIndex).toBe(0);
  });

  it("defers to aria-labelledby without injecting a duplicate default aria-label", () => {
    render(
      <>
        <h2 id="tracks-heading">Tracks</h2>
        <TableScroll aria-labelledby="tracks-heading">
          <table />
        </TableScroll>
      </>
    );

    const region = screen.getByRole("region", { name: "Tracks" });
    expect(region.hasAttribute("aria-label")).toBe(false);
  });
});
