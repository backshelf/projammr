import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { z } from "zod";
import { defineSetting } from "@workspace/settings";
import { DeleteConfirmsControl } from "./delete-confirms";
import type { ControlOf, SettingControlProps } from "../types";

afterEach(cleanup);

const KINDS = ["project", "collection", "track"] as const;
const OPTIONS = [
  { value: "project", label: "Projects" },
  { value: "collection", label: "Collections" },
  { value: "track", label: "Tracks" },
] as const;

const definition = defineSetting({
  key: "fixture.deleteConfirms",
  group: "fixture",
  label: "Ask before deleting",
  description: "Which deletes ask first.",
  keywords: [],
  scopes: ["user"],
  schema: z.partialRecord(z.enum(KINDS), z.boolean()),
  default: {},
  control: {
    kind: "custom",
    component: "delete-confirms",
    options: OPTIONS,
  },
  audience: "all",
});

type Props = SettingControlProps<unknown, ControlOf<"custom">>;
const DEFINITION = definition as unknown as Props["definition"];

function mount(value: unknown, disabled = false) {
  const onChange = mock<(value: unknown) => void>();
  render(
    <DeleteConfirmsControl
      definition={DEFINITION}
      value={value}
      onChange={onChange}
      disabled={disabled}
      id="fixture-delete-confirms"
    />
  );
  return onChange;
}

describe("DeleteConfirmsControl", () => {
  it("renders a missing kind on", () => {
    mount({ collection: false });

    expect(
      screen
        .getByRole("switch", { name: "Projects" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen
        .getByRole("switch", { name: "Collections" })
        .getAttribute("aria-checked")
    ).toBe("false");
  });

  it("toggling one writes a record with all three kinds and that one false", () => {
    const onChange = mount({});

    fireEvent.click(screen.getByRole("switch", { name: "Collections" }));

    expect(onChange).toHaveBeenCalledWith({
      project: true,
      collection: false,
      track: true,
    });
  });

  it("toggling one back on keeps the rest of the record as stored", () => {
    const onChange = mount({ collection: false, track: false });

    fireEvent.click(screen.getByRole("switch", { name: "Collections" }));

    expect(onChange).toHaveBeenCalledWith({
      project: true,
      collection: true,
      track: false,
    });
  });
});
