import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { OpenInLiveFlag } from "./OpenInLiveFlag";

afterEach(cleanup);

describe("OpenInLiveFlag", () => {
  it("names the machine that has the set open", () => {
    render(
      <OpenInLiveFlag
        openOn={{ machine: "Studio Mac", owner: { id: "u1", name: "Alex" } }}
      />
    );
    expect(screen.getByText("Open in Live on Studio Mac")).toBeTruthy();
  });

  it("shows nothing while no machine has it open", () => {
    const { container } = render(<OpenInLiveFlag openOn={null} />);
    expect(container.textContent).toBe("");
  });
});
