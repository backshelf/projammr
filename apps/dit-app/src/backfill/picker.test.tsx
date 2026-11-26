import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { useState, type JSX } from "react";

import { Picker, type PickerOption } from "./picker";

afterEach(cleanup);

const TRACKS: PickerOption[] = [
  { value: "1", label: "Science" },
  { value: "2", label: "Halogen" },
  { value: "new", label: "New track: science" },
];

function Harness({
  onChange,
}: {
  onChange: (value: string) => void;
}): JSX.Element {
  const [value, setValue] = useState<string | null>("1");
  return (
    <MotionProvider>
      <Picker
        label="Track for science123"
        options={TRACKS}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    </MotionProvider>
  );
}

function field(): HTMLInputElement {
  return screen.getByRole("combobox", {
    name: "Track for science123",
  }) as HTMLInputElement;
}

describe("Picker", () => {
  test("shows the chosen option's label in a field named for its row", () => {
    render(<Harness onChange={() => {}} />);

    expect(field().value).toBe("Science");
  });

  test("lists every option when opened, whatever is chosen, and hands back the one picked", async () => {
    const picked: string[] = [];
    render(<Harness onChange={(value) => picked.push(value)} />);

    fireEvent.keyDown(field(), { key: "ArrowDown" });
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Science",
      "Halogen",
      "New track: science",
    ]);

    fireEvent.pointerDown(options[1]!);
    fireEvent.click(options[1]!);
    expect(picked).toEqual(["2"]);
    expect(field().value).toBe("Halogen");
  });

  test("narrows the list as you type", async () => {
    render(<Harness onChange={() => {}} />);

    fireEvent.keyDown(field(), { key: "ArrowDown" });
    await screen.findAllByRole("option");
    fireEvent.change(field(), { target: { value: "new" } });

    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "New track: science",
    ]);
  });
});
