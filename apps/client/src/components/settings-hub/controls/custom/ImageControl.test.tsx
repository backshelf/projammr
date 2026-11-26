import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

type Result = { data?: unknown; error?: unknown; response: Response };
const GET = mock<(path: string, init: unknown) => Promise<Result>>();
mock.module("@/lib/browser-api", () => ({ browserApi: { GET } }));

// Only the network call is replaced; the failure readers are the real ones.
const uploadClient = await import("@/components/uploads/upload-client");
const uploadInstanceImage = mock<(file: File) => Promise<unknown>>();
mock.module("@/components/uploads/upload-client", () => ({
  ...uploadClient,
  uploadInstanceImage,
}));

const { SETTINGS } = await import("@workspace/settings");
const { ImageControl } = await import("./ImageControl");

const LOGO = SETTINGS["instance-branding.logoImageId"];

function mount(value: number | null) {
  const onChange = mock<(value: unknown) => void>();
  render(
    <>
      <span id="logo-label">Logo</span>
      <ImageControl
        definition={LOGO as never}
        value={value}
        onChange={onChange}
        disabled={false}
        id="logo"
      />
    </>
  );
  return onChange;
}

/** Lets the image read or the upload settle. */
const settle = () => act(async () => {});

beforeEach(() => {
  GET.mockReset();
  uploadInstanceImage.mockReset();
});

afterEach(cleanup);

describe("ImageControl", () => {
  it("offers an upload while no image is set, and reads nothing", () => {
    mount(null);

    expect(
      screen.getByRole("button", { name: "Upload an image" })
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(GET).not.toHaveBeenCalled();
  });

  it("shows the current image and clears the setting on Remove", async () => {
    GET.mockResolvedValue({
      data: { id: 5, assetPath: "images/mark.png" },
      response: new Response(null, { status: 200 }),
    });
    const onChange = mount(5);
    await settle();

    expect(GET.mock.calls[0]?.[1]).toEqual({ params: { path: { id: "5" } } });
    const image = screen.getByRole("img", { name: "The current logo" });
    expect(image.getAttribute("src")).toBe("/media/images/mark.png?w=256");
    expect(screen.getByRole("button", { name: "Replace" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove the logo" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("says so when the image the setting names has been deleted", async () => {
    GET.mockResolvedValue({
      error: { error: "Image not found" },
      response: new Response(null, { status: 404 }),
    });
    mount(5);
    await settle();

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/This image has been deleted/)).toBeTruthy();
  });

  it("uploads a chosen file as an instance image and takes its id", async () => {
    uploadInstanceImage.mockResolvedValue({
      id: 9,
      assetPath: "images/new.png",
    });
    const onChange = mount(null);
    const file = new File(["png"], "mark.png", { type: "image/png" });

    fireEvent.change(document.getElementById("logo")!, {
      target: { files: [file] },
    });
    await settle();

    expect(uploadInstanceImage.mock.calls[0]?.[0]).toBe(file);
    expect(onChange).toHaveBeenCalledWith(9);
  });

  it("keeps the setting and says the limit when the image is too big", async () => {
    // The envelope `uploadBodyLimit` and the route's validator answer with.
    uploadInstanceImage.mockResolvedValue({
      error: "Invalid request",
      details: {
        issues: [{ code: "too_big", maximum: 2 * 1024 * 1024, path: ["file"] }],
      },
    });
    const onChange = mount(null);

    fireEvent.change(document.getElementById("logo")!, {
      target: { files: [new File(["png"], "big.png", { type: "image/png" })] },
    });
    await settle();

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "That image is over the 2 MB upload limit"
    );
  });

  it("shows the validator's reason for a refused type", async () => {
    uploadInstanceImage.mockResolvedValue({
      error: "Invalid request",
      details: {
        issues: [{ code: "custom", message: "That file type is not allowed" }],
      },
    });
    mount(null);

    fireEvent.change(document.getElementById("logo")!, {
      target: { files: [new File(["gif"], "a.gif", { type: "image/gif" })] },
    });
    await settle();

    expect(screen.getByRole("alert").textContent).toBe(
      "That file type is not allowed"
    );
  });
});
