import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { SETTINGS } from "@workspace/settings";
import { emptyMeaning, NumericInput } from "./NumericInput";

afterEach(cleanup);

function mount(value: number | null, empty?: string) {
  const onChange = mock<(value: number | null) => void>();
  render(
    <NumericInput
      id="n"
      value={value}
      onChange={onChange}
      disabled={false}
      empty={empty}
    />
  );
  return { onChange, field: screen.getByRole("textbox") as HTMLInputElement };
}

describe("NumericInput", () => {
  it("shows null as an empty field that says what empty means", () => {
    const { field } = mount(null, "No cap");

    expect(field.value).toBe("");
    expect(field.placeholder).toBe("No cap");
  });

  it("hands on null when a field that may be empty is cleared", () => {
    const { field, onChange } = mount(5, "No cap");

    fireEvent.change(field, { target: { value: "7" } });
    fireEvent.change(field, { target: { value: "" } });

    expect(onChange.mock.calls).toEqual([[7], [null]]);
    expect(field.getAttribute("aria-invalid")).toBeNull();
  });

  it("holds an empty field back, marked invalid, where a number is required", () => {
    const { field, onChange } = mount(5);

    fireEvent.change(field, { target: { value: "" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(field.getAttribute("aria-invalid")).toBe("true");
  });
});

describe("emptyMeaning", () => {
  it("is the placeholder of a setting that takes null, and nothing for one that does not", () => {
    expect(emptyMeaning(SETTINGS["instance-limits.projectCapGb"])).toBe(
      "No cap"
    );
    expect(emptyMeaning(SETTINGS["instance-jobs.activityRetentionDays"])).toBe(
      "Forever"
    );
    expect(
      emptyMeaning(SETTINGS["instance-limits.maxUploadMb"])
    ).toBeUndefined();
  });
});
