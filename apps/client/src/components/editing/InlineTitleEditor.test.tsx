import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { MotionProvider } from "@workspace/ui/components/motion-provider";

const patchField = mock(async () => ({ id: 1, title: "Updated" }));
mock.module("@/actions/patch-field", () => ({ patchField }));
mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: mock(), push: mock() }),
  usePathname: () => "/",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

const { ProjectProvider } = await import("@/hooks/use-project-role");
const { default: InlineTitleEditor } = await import("./InlineTitleEditor");

const originalWidth = window.innerWidth;
function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

beforeEach(() => {
  setViewportWidth(1024);
  patchField.mockClear();
});

afterEach(() => {
  cleanup();
  setViewportWidth(originalWidth);
});

function renderEditor() {
  return render(
    <MotionProvider>
      <ProjectProvider project={{ id: 1, name: "Studio", role: "editor" }}>
        <InlineTitleEditor
          value="Nightfall"
          entityType="track"
          entityId={4}
          fieldName="title"
        />
      </ProjectProvider>
    </MotionProvider>
  );
}

describe("InlineTitleEditor", () => {
  it("pads the trigger on coarse pointers so the pencil never overlaps the title", () => {
    renderEditor();

    const trigger = screen.getByRole("button", { name: "Nightfall" });
    expect(trigger.className).toContain("coarse:pr-8");
  });

  it("renders explicit touch Save and Cancel controls and skips autoFocus on mobile", async () => {
    setViewportWidth(390);
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Nightfall" }));

    const input = screen.getByLabelText("Title") as HTMLInputElement;
    expect(document.activeElement).not.toBe(input);

    const save = screen.getByRole("button", { name: "Save title" });
    const cancel = screen.getByRole("button", { name: "Cancel editing title" });
    expect(save.textContent).toBe("Save");
    expect(cancel.textContent).toBe("Cancel");
    expect(save.className).toContain("min-h-11");

    fireEvent.change(input, { target: { value: "Daybreak" } });
    await act(async () => {
      fireEvent.click(save);
    });

    expect(patchField).toHaveBeenCalledWith("track", 4, "title", "Daybreak");
  });
});
