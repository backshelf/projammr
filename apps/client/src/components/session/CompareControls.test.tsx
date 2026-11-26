import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

mock.module("@/hooks/use-param-writer", () => ({
  useParamWriter: () => ({ write: mock() }),
}));

const { CompareControls } = await import("./CompareControls");

afterEach(cleanup);

describe("CompareControls", () => {
  it("associates accessible labels with the From and To selects", () => {
    render(
      <CompareControls
        options={[
          { id: 2, label: "Today · mix 2" },
          { id: 1, label: "Yesterday · mix 1" },
        ]}
        fromId={1}
        toId={2}
      />
    );

    expect(screen.getByRole("combobox", { name: "From" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "To" })).toBeTruthy();
  });
});
