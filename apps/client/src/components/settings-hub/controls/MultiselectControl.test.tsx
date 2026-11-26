import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { SETTINGS } from "@workspace/settings";
import { MultiselectControl } from "./MultiselectControl";

afterEach(cleanup);

const definition = SETTINGS["instance-limits.audioTypes"];

function mount(value: readonly string[]) {
  const onChange = mock<(value: readonly string[]) => void>();
  render(
    <MultiselectControl
      definition={
        definition as Parameters<typeof MultiselectControl>[0]["definition"]
      }
      value={value}
      onChange={onChange}
      disabled={false}
      id="types"
    />
  );
  return onChange;
}

describe("MultiselectControl", () => {
  it("presses the chosen options and hands up a selection in the options' order", () => {
    const onChange = mount([".mp3"]);

    expect(
      screen.getByRole("button", { name: ".mp3" }).getAttribute("aria-pressed")
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: ".wav" }));

    expect(onChange.mock.calls).toEqual([[[".wav", ".mp3"]]]);
  });

  it("hands up an empty list when the last chosen option is cleared", () => {
    const onChange = mount([".mp3"]);

    fireEvent.click(screen.getByRole("button", { name: ".mp3" }));

    expect(onChange.mock.calls).toEqual([[[]]]);
  });
});
