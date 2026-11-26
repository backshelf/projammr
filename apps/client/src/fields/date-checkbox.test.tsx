import { fieldKind } from "@/fields";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

afterEach(cleanup);

describe("the date editor", () => {
  const renderEditor = (value: string | null) => {
    const Editor = fieldKind("date").Editor!;
    const onCommit = mock();
    const onCancel = mock();
    const { container } = render(
      <Editor
        value={value}
        config={{}}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    );
    return {
      input: container.querySelector("input") as HTMLInputElement,
      onCommit,
      onCancel,
    };
  };

  it("is a date input that starts from the value and takes focus", () => {
    const { input } = renderEditor("2026-03-04");
    expect(input.type).toBe("date");
    expect(input.value).toBe("2026-03-04");
    expect(document.activeElement).toBe(input);
  });

  it("commits the date on Enter", () => {
    const { input, onCommit } = renderEditor("2026-03-04");
    fireEvent.change(input, { target: { value: "2026-05-06" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("2026-05-06");
  });

  it("commits null when the date is cleared", () => {
    const { input, onCommit } = renderEditor("2026-03-04");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("cancels on Escape", () => {
    const { input, onCommit, onCancel } = renderEditor(null);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("draws a date input in the draft row", () => {
    const Draft = fieldKind("date").DraftInput;
    const onChange = mock();
    const { container } = render(
      <Draft raw="" config={{}} onChange={onChange} invalid={false} id="due" />
    );
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.type).toBe("date");
    expect(input.id).toBe("due");
    fireEvent.change(input, { target: { value: "2026-03-04" } });
    expect(onChange).toHaveBeenCalledWith("2026-03-04");
  });
});

describe("the checkbox draft input", () => {
  const Draft = fieldKind("checkbox").DraftInput;

  it("reads its raw text as ticked or not", () => {
    const { rerender } = render(
      <Draft raw="true" config={{}} onChange={mock()} invalid={false} id="x" />
    );
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
      true
    );
    rerender(
      <Draft raw="false" config={{}} onChange={mock()} invalid={false} id="x" />
    );
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
      false
    );
  });

  it("reports a toggle as true or false", () => {
    const onChange = mock();
    render(
      <Draft
        raw="false"
        config={{}}
        onChange={onChange}
        invalid={false}
        id="x"
      />
    );
    const box = screen.getByRole("checkbox");
    expect(box.id).toBe("x");
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith("true");
  });
});

describe("the date and number displays", () => {
  it("shows a date in the formatter set's form, a day as that day", () => {
    const Display = fieldKind("date").Display!;
    render(<Display value="2026-08-03" config={{}} />);
    expect(screen.getByText("3 Aug 2026")).toBeTruthy();
  });

  it("shows a number grouped", () => {
    const Display = fieldKind("number").Display!;
    render(<Display value={12345} config={{}} />);
    expect(screen.getByText("12,345")).toBeTruthy();
  });
});

describe("the checkbox display", () => {
  const Display = fieldKind("checkbox").Display!;

  it("shows the value as a box that is not a control", () => {
    render(<Display value config={{}} />);
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.tabIndex).toBe(-1);
  });

  it("shows anything but true as unticked", () => {
    render(<Display value={null} config={{}} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
      false
    );
  });
});
