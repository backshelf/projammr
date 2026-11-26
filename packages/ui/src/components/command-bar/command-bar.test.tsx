import {
  CommandBar,
  CommandHint,
  type CommandBarPrompt,
} from "@workspace/ui/components/command-bar";
import type { KeymapState } from "@workspace/ui/lib/keymap";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

afterEach(cleanup);

const REST: KeymapState = {
  scope: ["global"],
  pending: [],
  count: null,
  candidates: [],
  conflicts: [],
};

const COMMANDS = [
  { id: "renders", keys: ["j", "k"], label: "Renders" },
  { id: "tracks", keys: ["shift+j", "shift+k"], label: "Tracks" },
  { id: "file", keys: ["Enter"], label: "File" },
];

function prompt(overrides: Partial<CommandBarPrompt> = {}): CommandBarPrompt {
  return {
    open: true,
    value: "",
    onChange: mock(),
    onSubmit: mock(),
    onClose: mock(),
    suggestions: [],
    placeholder: "merge, rename",
    ...overrides,
  };
}

describe("CommandBar", () => {
  it("shows each command's keys and label at rest", () => {
    render(
      <CommandBar
        state={REST}
        commands={COMMANDS}
        position="bottom"
        mode="always"
      />
    );

    const hints = screen
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(hints).toEqual(["j kRenders", "J KTracks", "↵File"]);
  });

  it("leaves out a command that has no keys", () => {
    render(
      <CommandBar
        state={REST}
        commands={[...COMMANDS, { id: "gone", keys: [], label: "Gone" }]}
        position="bottom"
        mode="always"
      />
    );

    expect(screen.queryByText("Gone")).toBeNull();
  });

  it("shows the pending chord and count, and what could follow", () => {
    render(
      <CommandBar
        state={{
          ...REST,
          pending: ["g"],
          count: 3,
          candidates: [{ id: "top", keys: ["g g"], label: "First render" }],
        }}
        commands={COMMANDS}
        position="bottom"
        mode="always"
      />
    );

    expect(screen.getByText("3g")).toBeTruthy();
    expect(screen.getByText("gg")).toBeTruthy();
    expect(screen.getByText("First render")).toBeTruthy();
    expect(screen.queryByText("Renders")).toBeNull();
  });

  it("shows a count on its own while it builds", () => {
    render(
      <CommandBar
        state={{
          ...REST,
          count: 5,
          candidates: [{ id: "down", keys: ["j"], label: "Next render" }],
        }}
        commands={COMMANDS}
        position="bottom"
        mode="always"
      />
    );

    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.queryByText("Next render")).toBeNull();
    expect(screen.queryByText("Renders")).toBeNull();
  });

  it("keeps its trailing content while a chord is pending", () => {
    render(
      <CommandBar
        state={{ ...REST, pending: ["g"] }}
        commands={COMMANDS}
        position="bottom"
        mode="always"
      >
        <CommandHint keys={["?"]} label="Keys" />
      </CommandBar>
    );

    expect(screen.getByText("Keys")).toBeTruthy();
  });

  it("draws no hint for a command with no keys", () => {
    const { container } = render(<CommandHint keys={[]} label="Undo" />);

    expect(container.firstChild).toBeNull();
  });

  it("renders nothing at rest in pending mode", () => {
    const { container } = render(
      <CommandBar
        state={REST}
        commands={COMMANDS}
        position="bottom"
        mode="pending"
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("appears in pending mode while a chord or a count is pending", () => {
    const { rerender } = render(
      <CommandBar
        state={{ ...REST, pending: ["g"] }}
        commands={COMMANDS}
        position="bottom"
        mode="pending"
      />
    );
    expect(screen.getByText("g")).toBeTruthy();

    rerender(
      <CommandBar
        state={{ ...REST, count: 4 }}
        commands={COMMANDS}
        position="bottom"
        mode="pending"
      />
    );
    expect(screen.getByText("4")).toBeTruthy();
  });

  it("sits on the edge it is given", () => {
    const { container, rerender } = render(
      <CommandBar
        state={REST}
        commands={COMMANDS}
        position="bottom"
        mode="always"
      />
    );
    expect(container.querySelector("footer")?.dataset.position).toBe("bottom");

    rerender(
      <CommandBar
        state={REST}
        commands={COMMANDS}
        position="top"
        mode="always"
      />
    );
    expect(container.querySelector("header")?.dataset.position).toBe("top");
  });
});

describe("CommandBar's prompt", () => {
  const suggestions = () => [
    { id: "merge", label: "merge", run: mock() },
    { id: "rename", label: "rename", hint: "Track", run: mock() },
  ];

  it("takes the bar's place and focuses its field", () => {
    render(
      <CommandBar
        state={REST}
        commands={COMMANDS}
        position="bottom"
        mode="pending"
        prompt={prompt()}
      />
    );

    const field = screen.getByRole("combobox", { name: "merge, rename" });
    expect(document.activeElement).toBe(field);
    expect(screen.queryByText("Renders")).toBeNull();
  });

  it("stays shut while it is not open", () => {
    render(
      <CommandBar
        state={REST}
        commands={COMMANDS}
        position="bottom"
        mode="always"
        prompt={prompt({ open: false })}
      />
    );

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("Renders")).toBeTruthy();
  });

  it("reports what is typed", () => {
    const onChange = mock();
    render(
      <CommandBar
        state={REST}
        commands={COMMANDS}
        position="bottom"
        mode="always"
        prompt={prompt({ onChange })}
      />
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "mer" },
    });

    expect(onChange).toHaveBeenCalledWith("mer");
  });

  it("runs the chosen suggestion on Enter and closes", () => {
    const items = suggestions();
    const onClose = mock();
    const onSubmit = mock();
    render(
      <CommandBar
        state={REST}
        commands={COMMANDS}
        position="bottom"
        mode="always"
        prompt={prompt({ suggestions: items, onClose, onSubmit })}
      />
    );

    const field = screen.getByRole("combobox");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(items[1]?.run).toHaveBeenCalledTimes(1);
    expect(items[0]?.run).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("marks the active suggestion for assistive technology", () => {
    render(
      <CommandBar
        state={REST}
        commands={COMMANDS}
        position="bottom"
        mode="always"
        prompt={prompt({ suggestions: suggestions() })}
      />
    );

    const field = screen.getByRole("combobox");
    const options = screen.getAllByRole("option");
    expect(field.getAttribute("aria-expanded")).toBe("true");
    expect(field.getAttribute("aria-activedescendant")).toBe(
      options[0]?.id ?? null
    );
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("submits the typed line on Enter when nothing is offered", () => {
    const onSubmit = mock();
    const onClose = mock();
    render(
      <CommandBar
        state={REST}
        commands={COMMANDS}
        position="bottom"
        mode="always"
        prompt={prompt({ value: "rename Night Bus", onSubmit, onClose })}
      />
    );

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith("rename Night Bus");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open on Enter with nothing offered and nothing to submit", () => {
    const onClose = mock();
    render(
      <CommandBar
        state={REST}
        commands={COMMANDS}
        position="bottom"
        mode="always"
        prompt={prompt({ onSubmit: undefined, onClose })}
      />
    );

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("completes the active suggestion on Tab", () => {
    const onChange = mock();
    render(
      <CommandBar
        state={REST}
        commands={COMMANDS}
        position="bottom"
        mode="always"
        prompt={prompt({ suggestions: suggestions(), onChange })}
      />
    );

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Tab" });

    expect(onChange).toHaveBeenCalledWith("merge");
  });

  it("closes on Escape", () => {
    const onClose = mock();
    render(
      <CommandBar
        state={REST}
        commands={COMMANDS}
        position="bottom"
        mode="always"
        prompt={prompt({ onClose })}
      />
    );

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("runs a suggestion picked with the pointer", () => {
    const items = suggestions();
    const onClose = mock();
    render(
      <CommandBar
        state={REST}
        commands={COMMANDS}
        position="bottom"
        mode="always"
        prompt={prompt({ suggestions: items, onClose })}
      />
    );

    fireEvent.mouseDown(screen.getByRole("option", { name: /rename/ }));

    expect(items[1]?.run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens its suggestions away from the edge it sits on", () => {
    const { rerender } = render(
      <CommandBar
        state={REST}
        commands={COMMANDS}
        position="bottom"
        mode="always"
        prompt={prompt({ suggestions: suggestions() })}
      />
    );
    expect(screen.getByRole("listbox").className).toContain("bottom-full");

    rerender(
      <CommandBar
        state={REST}
        commands={COMMANDS}
        position="top"
        mode="always"
        prompt={prompt({ suggestions: suggestions() })}
      />
    );
    expect(screen.getByRole("listbox").className).toContain("top-full");
  });
});
