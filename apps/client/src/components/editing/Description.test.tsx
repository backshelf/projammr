import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AppThemeProvider } from "@/components/theme/AppThemeProvider";
import { DEFAULT_EFFECTIVE_SETTINGS } from "@/lib/settings/effective";
import { SettingsProvider } from "@/lib/settings/provider";
import type { BlockEditorProps } from "@workspace/ui/components/block-editor";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ReactNode } from "react";

let saveResult: unknown = { id: 1 };
const saveRichText = mock(async () => saveResult);
mock.module("@/actions/save-description", () => ({ saveRichText }));

const toastError = mock();
mock.module("sonner", () => ({ toast: { error: toastError } }));

let mayEdit = true;
mock.module("@/hooks/use-project-role", () => ({
  useProjectRole: () => ({
    role: mayEdit ? "editor" : "viewer",
    can: () => mayEdit,
  }),
}));

let mountedEditorCount = 0;
mock.module("next/dynamic", () => ({
  __esModule: true,
  default: () =>
    function StubDynamicEditor(props: BlockEditorProps) {
      mountedEditorCount++;
      return (
        <div data-testid="stub-block-editor" data-aria-label={props.ariaLabel}>
          <textarea
            aria-label="Rich editor"
            defaultValue={props.value}
            onChange={(e) => props.onChange?.(e.target.value)}
          />
        </div>
      );
    },
}));

const { default: Description } = await import("./Description");

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider initial={DEFAULT_EFFECTIVE_SETTINGS} userId={null}>
      <AppThemeProvider bindThemeHotkey={false}>{children}</AppThemeProvider>
    </SettingsProvider>
  );
}

const SAMPLE_DOC = JSON.stringify([
  {
    type: "paragraph",
    content: [
      { type: "text", text: "Chorus " },
      { type: "text", text: "lift", styles: { bold: true } },
    ],
  },
]);

afterEach(() => {
  cleanup();
  saveRichText.mockClear();
  toastError.mockClear();
  saveResult = { id: 1 };
  mayEdit = true;
  mountedEditorCount = 0;
});

describe("Description", () => {
  it("renders lightweight read-only prose at rest without min-h-40 or BlockNoteEditor", () => {
    const { container } = render(
      <Description
        entityType="collection"
        entityId={1}
        text={SAMPLE_DOC}
        label="NOTES"
      />,
      { wrapper: Wrapper }
    );

    expect(screen.queryByTestId("stub-block-editor")).toBeNull();
    expect(mountedEditorCount).toBe(0);
    expect(screen.getByText("lift").tagName).toBe("STRONG");
    expect(container.querySelector(".min-h-40")).toBeNull();
  });

  it("never mounts BlockNoteEditor for viewers", () => {
    mayEdit = false;
    render(
      <Description
        entityType="collection"
        entityId={1}
        text={SAMPLE_DOC}
        label="NOTES"
      />,
      { wrapper: Wrapper }
    );

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    fireEvent.click(screen.getByText("lift"));
    expect(screen.queryByTestId("stub-block-editor")).toBeNull();
    expect(mountedEditorCount).toBe(0);
  });

  it("lazy-mounts BlockNoteEditor on edit intent and tracks save state, retry, and beforeunload", async () => {
    render(
      <Description
        entityType="collection"
        entityId={1}
        text={SAMPLE_DOC}
        label="NOTES"
      />,
      { wrapper: Wrapper }
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editor = await screen.findByLabelText("Rich editor");
    expect(mountedEditorCount).toBe(1);

    saveResult = { error: "Network down", status: 500 };
    fireEvent.change(editor, {
      target: { value: JSON.stringify([{ type: "paragraph", content: [] }]) },
    });

    const dirtyEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);

    await waitFor(
      () => {
        expect(saveRichText).toHaveBeenCalledTimes(1);
      },
      { timeout: 3000 }
    );

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Error")).toBeTruthy();

    // Retry succeeds and clears dirty state
    saveResult = { id: 1 };
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });

    expect(saveRichText).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Saved")).toBeTruthy();

    const cleanEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);
  });

  it("retries saving when clicking the error toast Retry action after error re-render", async () => {
    render(
      <Description
        entityType="collection"
        entityId={1}
        text={SAMPLE_DOC}
        label="NOTES"
      />,
      { wrapper: Wrapper }
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editor = await screen.findByLabelText("Rich editor");

    saveResult = { error: "Socket hangup", status: 500 };
    fireEvent.change(editor, {
      target: { value: JSON.stringify([{ type: "paragraph", content: [] }]) },
    });

    await waitFor(
      () => {
        expect(saveRichText).toHaveBeenCalledTimes(1);
      },
      { timeout: 3000 }
    );

    // Wait for setSaveStatus("error") re-render and its effects to flush.
    await screen.findByText("Error");
    expect(toastError).toHaveBeenCalledTimes(1);

    const toastOptions = toastError.mock.calls[0]?.[1] as
      { action?: { label: string; onClick: () => void } } | undefined;
    expect(toastOptions?.action?.label).toBe("Retry");

    saveResult = { id: 1 };
    await act(async () => {
      toastOptions?.action?.onClick();
    });

    expect(saveRichText).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("passes contextual ariaLabel from label or fieldName to BlockNoteEditor", async () => {
    render(
      <Description
        entityType="project"
        entityId={1}
        fieldName="description"
        text={SAMPLE_DOC}
      />,
      { wrapper: Wrapper }
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      (await screen.findByTestId("stub-block-editor")).getAttribute(
        "data-aria-label"
      )
    ).toBe("Description");

    cleanup();
    render(
      <Description
        entityType="track"
        entityId={2}
        fieldName="notes"
        text={SAMPLE_DOC}
      />,
      { wrapper: Wrapper }
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      (await screen.findByTestId("stub-block-editor")).getAttribute(
        "data-aria-label"
      )
    ).toBe("Notes");
  });
});
