import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { argsOf, base, mockApp, renderScreen, teardown } from "../test-support";
import { MachineName } from "./machine-name";

afterEach(teardown);

describe("MachineName", () => {
  test("says which name clashed and sets the name picked instead", async () => {
    const calls = mockApp(base);
    renderScreen(<MachineName refused="Studio Mac" current="Studio Mac" />);

    expect(
      screen.getByText(
        "Another of your machines is called Studio Mac. Pick another name."
      )
    ).toBeTruthy();
    const use = screen.getByRole("button", { name: "Use this name" });
    expect((use as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Machine name"), {
      target: { value: "Laptop" },
    });
    fireEvent.click(use);

    await waitFor(() =>
      expect(argsOf(calls, "set_setting")).toEqual([
        { key: "machineName", value: "Laptop" },
      ])
    );
  });
});
