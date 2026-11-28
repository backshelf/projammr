import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { MotionProvider } from "@workspace/ui/components/motion-provider";

const removeImageFromParent = mock(async () => ({ ok: true }));
mock.module("@/actions/images", () => ({
  removeImageFromParent,
  setImageOnParent: mock(),
}));

mock.module("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={src} />
  ),
}));

mock.module("@/components/uploads/upload-client", () => ({
  uploadImage: mock(),
  uploadLimit: mock(async () => null),
}));
mock.module("sonner", () => ({
  toast: { success: mock(), error: mock() },
}));
let coarsePointer = true;
mock.module("@workspace/ui/hooks/use-coarse-pointer", () => ({
  useCoarsePointer: () => coarsePointer,
}));

const { ProjectProvider } = await import("@/hooks/use-project-role");
const { ImageUploader } = await import("./ImageUploader");

beforeEach(() => {
  coarsePointer = true;
  removeImageFromParent.mockClear();
});

afterEach(cleanup);

describe("ImageUploader touch cover delete confirmation", () => {
  it("opens an AlertDialog before removing the cover on coarse pointers", async () => {
    render(
      <MotionProvider>
        <ProjectProvider project={{ id: 1, name: "Studio", role: "editor" }}>
          <ImageUploader
            kind="track"
            parentId={9}
            currentImage="img/cover.png"
          />
        </ProjectProvider>
      </MotionProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
    expect(removeImageFromParent).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Remove track cover?")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(removeImageFromParent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
    const confirmDialog = await screen.findByRole("alertdialog");
    await act(async () => {
      fireEvent.click(
        within(confirmDialog).getByRole("button", { name: "Remove" })
      );
    });

    expect(removeImageFromParent).toHaveBeenCalledWith("track", 9);
  });

  it("renders Replace and Remove as sibling buttons on fine pointers without nested interactive controls", async () => {
    coarsePointer = false;
    render(
      <MotionProvider>
        <ProjectProvider project={{ id: 1, name: "Studio", role: "editor" }}>
          <ImageUploader
            kind="track"
            parentId={9}
            currentImage="img/cover.png"
          />
        </ProjectProvider>
      </MotionProvider>
    );

    const replace = screen.getByRole("button", { name: "Replace track image" });
    const remove = screen.getByRole("button", { name: "Remove image" });
    expect(replace.contains(remove)).toBe(false);
    expect(remove.parentElement?.closest('[role="button"], button')).toBeNull();

    await act(async () => {
      fireEvent.click(remove);
    });
    expect(removeImageFromParent).toHaveBeenCalledWith("track", 9);
  });
});
