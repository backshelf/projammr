import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { stubGlobal } from "@workspace/test/globals";

const toastSuccess = mock();
const toastError = mock();
mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

const { AssetProvenance, AssetProvenancePopover, provenanceLine } =
  await import("./AssetProvenance");
type ProvenanceAsset = import("./AssetProvenance").ProvenanceAsset;

const FINGERPRINT = `1024:${"ab".repeat(20)}`;

const localFile: ProvenanceAsset = {
  id: 42,
  name: "bounce.wav",
  createdAt: "2026-03-01T10:00:00.000Z",
  localFilepath: "/Music/Bounces/bounce.wav",
  localFileCreatedAt: "2026-02-20T09:00:00.000Z",
  localFileUpdatedAt: "2026-02-21T09:00:00.000Z",
  localFileMachineName: "Studio Mac",
  fingerprint: FINGERPRINT,
};

const webUpload: ProvenanceAsset = {
  ...localFile,
  localFilepath: null,
  localFileCreatedAt: null,
  localFileUpdatedAt: null,
  localFileMachineName: null,
  fingerprint: null,
  uploadedBy: { id: "u1", name: "Mira", image: null },
};

afterEach(() => {
  cleanup();
  for (const fn of [toastSuccess, toastError]) fn.mockClear();
});

describe("provenanceLine", () => {
  it("names the machine for a local file", () => {
    expect(provenanceLine(localFile)).toBe("RENDERED ON STUDIO MAC");
  });

  it("drops the machine when it is unknown", () => {
    expect(provenanceLine({ ...localFile, localFileMachineName: null })).toBe(
      "RENDERED"
    );
  });

  it("names the uploader for a web upload", () => {
    expect(provenanceLine(webUpload)).toBe("UPLOADED BY MIRA");
  });

  it("drops the uploader when it is unknown or absent", () => {
    expect(provenanceLine({ ...webUpload, uploadedBy: null })).toBe("UPLOADED");
    expect(provenanceLine({ ...webUpload, uploadedBy: undefined })).toBe(
      "UPLOADED"
    );
  });
});

describe("AssetProvenance", () => {
  it("lists the five rows and the mark for a local file", () => {
    const { container } = render(<AssetProvenance asset={localFile} />);
    for (const label of ["Path", "On", "Modified", "Created", "Mark"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText("/Music/Bounces/bounce.wav")).toBeTruthy();
    expect(screen.getByText("Studio Mac")).toBeTruthy();
    expect(
      container.querySelector("[data-slot='fingerprint-mark']")
    ).toBeTruthy();
  });

  it("shows only the uploader line and date for a web upload", () => {
    const { container } = render(<AssetProvenance asset={webUpload} />);
    expect(screen.getByText("UPLOADED BY MIRA")).toBeTruthy();
    expect(screen.getByText(/2026/)).toBeTruthy();
    for (const label of ["Path", "On", "Modified", "Created", "Mark"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(
      container.querySelector("[data-slot='fingerprint-mark']")
    ).toBeNull();
  });

  it("says Not set for each empty field of a local file", () => {
    render(
      <AssetProvenance
        asset={{
          ...localFile,
          localFileMachineName: null,
          localFileCreatedAt: null,
          localFileUpdatedAt: null,
          fingerprint: null,
        }}
      />
    );
    expect(screen.getAllByText("Not set")).toHaveLength(4);
  });
});

describe("AssetProvenancePopover", () => {
  const renderPopover = (asset: ProvenanceAsset) =>
    render(
      <AssetProvenancePopover asset={asset} open onOpenChange={() => {}}>
        <button type="button">tile</button>
      </AssetProvenancePopover>
    );

  it("offers Copy path for a local file", async () => {
    renderPopover(localFile);
    expect(await screen.findByText("Copy path")).toBeTruthy();
  });

  it("offers no Copy path for a web upload", async () => {
    renderPopover(webUpload);
    expect(await screen.findByText("UPLOADED BY MIRA")).toBeTruthy();
    expect(screen.queryByText("Copy path")).toBeNull();
  });

  it("writes the path to the clipboard and toasts", async () => {
    const writeText = mock(async () => {});
    stubGlobal("navigator", { clipboard: { writeText } });
    renderPopover(localFile);
    fireEvent.click(await screen.findByText("Copy path"));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Path copied")
    );
    expect(writeText).toHaveBeenCalledWith("/Music/Bounces/bounce.wav");
  });

  it("toasts an error when the path cannot be copied", async () => {
    stubGlobal("navigator", {
      clipboard: {
        writeText: mock(async () => {
          throw new Error("denied");
        }),
      },
    });
    renderPopover(localFile);
    fireEvent.click(await screen.findByText("Copy path"));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
