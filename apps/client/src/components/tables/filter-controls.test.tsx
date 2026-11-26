import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { customField } from "@/fields/custom-field-fixture";
import { HIGH, LOW, URGENT } from "@/fields/priority-fixture";
import type { CustomField } from "@workspace/api/api";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { afterEach, describe, expect, it, mock } from "bun:test";

import { FilterSheet } from "./cards/FilterSheet";
import { customFieldFilterColumns } from "./custom-field-parts";
import {
  FilterMenu,
  filterSummary,
  rangeEnds,
  rangeValue,
  toggleMember,
} from "./filter-controls";
import { priorityFilterColumn } from "./Priority";
import type {
  ChoiceFilterConfig,
  FilterColumnConfig,
  RangeFilterConfig,
  TextFilterConfig,
} from "./generic-table-types";

afterEach(cleanup);

const energy: RangeFilterConfig = {
  id: "cf_2",
  label: "Energy",
  param: "cf_2",
  control: "range",
  input: "number",
};
const release: RangeFilterConfig = { ...energy, input: "date" };
const notes: TextFilterConfig = {
  id: "cf_6",
  label: "Notes",
  param: "cf_6",
  control: "text",
};
const mood: ChoiceFilterConfig = {
  id: "cf_1",
  label: "Mood",
  param: "cf_1",
  options: [
    { value: "a1", label: "Dark" },
    { value: "b2", label: "Mellow" },
  ],
  multiple: true,
};

function renderMenu(
  config: FilterColumnConfig,
  value: string | null = null,
  counts?: Record<string, number>
) {
  const onChange = mock();
  render(
    <FilterMenu
      config={config}
      value={value}
      counts={counts}
      onChange={onChange}
    />,
    { wrapper: MotionProvider }
  );
  return { onChange };
}

async function open(name: RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

describe("the range encoding", () => {
  it("reads both ends, either one open", () => {
    expect(rangeEnds("3..9")).toEqual({ from: "3", to: "9" });
    expect(rangeEnds("..9")).toEqual({ from: "", to: "9" });
    expect(rangeEnds("3..")).toEqual({ from: "3", to: "" });
    expect(rangeEnds(null)).toEqual({ from: "", to: "" });
  });

  it("writes nothing for two open ends", () => {
    expect(rangeValue(" 3 ", "")).toBe("3..");
    expect(rangeValue("", "")).toBeNull();
  });

  it("reads as both ends, or the bound it has", () => {
    expect(filterSummary(energy, "3..9")).toBe("3–9");
    expect(filterSummary(energy, "3..")).toBe("≥ 3");
    expect(filterSummary(energy, "..9")).toBe("≤ 9");
  });
});

describe("the membership encoding", () => {
  it("flips an option in and out of the set", () => {
    expect(toggleMember(null, "a1")).toBe("a1");
    expect(toggleMember("a1", "b2")).toBe("a1,b2");
    expect(toggleMember("a1,b2", "a1")).toBe("b2");
    expect(toggleMember("a1", "a1")).toBeNull();
  });

  it("reads as the first option's label and how many more", () => {
    expect(filterSummary(mood, "a1,b2")).toBe("Dark +1");
    expect(filterSummary(mood, "gone")).toBe("gone");
  });

  it("reads a single choice whole, comma and all", () => {
    const artist: ChoiceFilterConfig = {
      id: "artists",
      label: "Artist",
      param: "artist",
      options: [{ value: "Ada, Bob", label: "Ada, Bob" }],
    };
    expect(filterSummary(artist, "Ada, Bob")).toBe("Ada, Bob");
  });
});

describe("a range filter", () => {
  it("applies both ends as the server's range", async () => {
    const { onChange } = renderMenu(energy);
    await open(/Energy/);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "9" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });
    expect(onChange).toHaveBeenCalledWith("5..9");
  });

  it("leaves an empty end open", async () => {
    const { onChange } = renderMenu(release);
    await open(/Energy/);
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-11-01" },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole("form", { name: "Filter by Energy" }));
    });
    expect(onChange).toHaveBeenCalledWith("2026-11-01..");
  });

  it("refuses an end its kind does not read, and says so beside the inputs", async () => {
    const { onChange } = renderMenu(energy);
    await open(/Energy/);
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "loud" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "From: Must be a number"
    );
    expect(screen.getByLabelText("From").getAttribute("aria-invalid")).toBe(
      "true"
    );
  });

  it("refuses a From past the To", async () => {
    const { onChange } = renderMenu(energy);
    await open(/Energy/);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "5" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("From is after To");
  });

  it("opens on the range it holds, shows it on its trigger and clears it", async () => {
    const { onChange } = renderMenu(energy, "3..9");
    expect(screen.getByRole("button", { name: /Energy: 3–9/ })).toBeTruthy();
    await open(/Energy/);
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("3");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    });
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe("a text filter", () => {
  it("applies the text the column must contain", async () => {
    const { onChange } = renderMenu(notes);
    await open(/Notes/);
    fireEvent.change(screen.getByLabelText("Contains"), {
      target: { value: " vocal " },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });
    expect(onChange).toHaveBeenCalledWith("vocal");
  });
});

describe("the priority filter", () => {
  const priority = priorityFilterColumn([LOW, HIGH, URGENT]);
  const optionValue = (level: { id: number }) => String(level.id);

  it("toggles levels into a comma list and back out to none", async () => {
    const first = renderMenu(priority);
    await open(/Priority/);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /High/ }));
    });
    expect(first.onChange).toHaveBeenCalledWith(optionValue(HIGH));
    cleanup();

    const second = renderMenu(priority, optionValue(HIGH));
    await open(/Priority/);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Low/ }));
    });
    expect(second.onChange).toHaveBeenCalledWith(
      `${optionValue(HIGH)},${optionValue(LOW)}`
    );
    cleanup();

    const third = renderMenu(
      priority,
      `${optionValue(HIGH)},${optionValue(LOW)}`
    );
    await open(/Priority/);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Low/ }));
    });
    expect(third.onChange).toHaveBeenCalledWith(optionValue(HIGH));
    cleanup();

    const fourth = renderMenu(priority, optionValue(HIGH));
    await open(/Priority/);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /High/ }));
    });
    expect(fourth.onChange).toHaveBeenCalledWith(null);
  });

  it("names every chosen level in the scale's order, not the order clicked", () => {
    const value = `${optionValue(URGENT)},${optionValue(LOW)}`;
    expect(filterSummary(priority, value)).toBe(`${LOW.name}, ${URGENT.name}`);
  });

  it("reads a level the scale no longer has as its raw id", () => {
    expect(filterSummary(priority, `${optionValue(HIGH)},999`)).toBe(
      `${HIGH.name}, 999`
    );
  });
});

describe("a membership filter", () => {
  it("adds an option to the set it holds, with each option's count", async () => {
    const { onChange } = renderMenu(mood, "a1", { a1: 4, b2: 2 });
    await open(/Mood: Dark/);
    const mellow = screen.getByRole("menuitemcheckbox", { name: /Mellow/ });
    expect(mellow.textContent).toContain("2");
    await act(async () => {
      fireEvent.click(mellow);
    });
    expect(onChange).toHaveBeenCalledWith("a1,b2");
  });

  it("shows no counts for a filter the server keeps none for", async () => {
    const [cleared] = customFieldFilterColumns([
      customField(4, "Cleared", "checkbox"),
    ]);
    renderMenu(cleared!);
    await open(/Cleared/);
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Yes" }).textContent
    ).toBe("Yes");
  });
});

describe("customFieldFilterColumns", () => {
  const field = (
    id: number,
    type: CustomField["type"],
    options: CustomField["options"] = []
  ) => customField(id, `F${id}`, type, options);

  it("gives each type the filter its encoding takes, keyed cf_<id>", () => {
    const [text, number, date, select, checkbox, url] =
      customFieldFilterColumns([
        field(1, "text"),
        field(2, "number"),
        field(3, "date"),
        field(4, "select", [{ id: "x9", label: "Loud" }]),
        field(5, "checkbox"),
        field(6, "url"),
      ]);
    expect(text).toMatchObject({ param: "cf_1", control: "text" });
    expect(number).toMatchObject({ control: "range", input: "number" });
    expect(date).toMatchObject({ control: "range", input: "date" });
    expect(select).toMatchObject({
      param: "cf_4",
      multiple: true,
      options: [{ value: "x9", label: "Loud" }],
    });
    expect(checkbox).toMatchObject({
      counted: false,
      options: [
        { value: "true" },
        { value: "false" },
        { value: "unset", label: "Not set" },
      ],
    });
    expect(url).toMatchObject({
      counted: false,
      options: [{ value: "set" }, { value: "unset" }],
    });
  });
});

describe("a typed filter in the phone sheet", () => {
  it("opens onto its form and applies through it", async () => {
    const onFilterChange = mock();
    render(
      <FilterSheet
        open
        onOpenChange={mock()}
        filterColumns={[energy]}
        columnFilters={{ cf_2: "..9" }}
        onFilterChange={onFilterChange}
        sortColumns={[]}
        activeGroupKey={null}
        onGroupChange={mock()}
        onApplyView={mock()}
        viewQuery={() => ""}
        selectMode={false}
        onToggleSelectMode={mock()}
      />,
      { wrapper: MotionProvider }
    );
    const row = screen.getByRole("button", { name: /Energy/ });
    expect(within(row).getByText("≤ 9")).toBeTruthy();
    await act(async () => {
      fireEvent.click(row);
    });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });
    expect(onFilterChange).toHaveBeenCalledWith("cf_2", "2..9");
  });
});
