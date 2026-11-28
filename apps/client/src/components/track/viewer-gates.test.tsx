import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { MemberRole } from "@workspace/api/api";
import { SectionFold } from "@workspace/ui/components/layout/empty-section";

mock.module("server-only", () => ({}));

mock.module("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={src} />
  ),
}));

mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: mock(), push: mock(), replace: mock() }),
  useParams: () => ({}),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

mock.module("@/components/uploads/upload-client", () => ({
  uploadAsset: mock(),
  uploadImage: mock(),
  uploadLimit: mock(async () => null),
  tooBigMaximum: () => null,
}));

mock.module("sonner", () => ({
  toast: { success: mock(), error: mock() },
}));

mock.module("@/components/navigation/AppLink", () => ({
  AppLink: ({ href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props} />
  ),
}));

const { ProjectProvider } = await import("@/hooks/use-project-role");
const { TrackExplicitToggle } = await import("./TrackExplicitToggle");
const { LinkToDialog } =
  await import("@/components/product-linking/LinkToDialog");
const { TrackRelationsSection } = await import("./TrackRelationsSection");
const { DetectedMeta } = await import("@/components/track-audio/DetectedMeta");
const { FileUploader } = await import("@/components/uploads/FileUploader");
const { ImageUploader } = await import("@/components/uploads/ImageUploader");

afterEach(cleanup);

function wrap(role: MemberRole, ui: React.ReactNode) {
  return render(
    <ProjectProvider project={{ id: 3, name: "Studio", role }}>
      <SectionFold>{ui}</SectionFold>
    </ProjectProvider>
  );
}

describe("viewer role gates", () => {
  it("hides TrackExplicitToggle for viewers", () => {
    const { container } = wrap(
      "viewer",
      <TrackExplicitToggle trackId={1} explicit={false} />
    );
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("checkbox", { name: "Explicit" })).toBeNull();
  });

  it("hides LinkToDialog trigger for viewers", () => {
    wrap(
      "viewer",
      <LinkToDialog targetKind="track" targetId={1}>
        <button type="button">Link trigger</button>
      </LinkToDialog>
    );
    expect(screen.queryByRole("button", { name: "Link trigger" })).toBeNull();
  });

  it("hides add and remove controls on TrackRelationsSection for viewers", () => {
    wrap(
      "viewer",
      <TrackRelationsSection
        trackId={1}
        relations={[
          {
            id: 9,
            direction: "from",
            relationType: { id: 1, name: "remix" },
            otherTrack: { id: 2, title: "Original" },
          } as never,
        ]}
      />
    );
    expect(screen.getByText("Original")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add a relation" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Remove relation" })
    ).toBeNull();
  });

  it("hides Adopt buttons in DetectedMeta for viewers while keeping detected values", () => {
    wrap(
      "viewer",
      <DetectedMeta
        ownKey={{ tonic: null, scale: null }}
        ownBpm={null}
        detectedKey="C minor"
        keyConfidence={0.9}
        detectedBpm={128}
        bpmConfidence={0.9}
        mainSessionId={10}
      />
    );
    expect(screen.queryByRole("button", { name: "Adopt" })).toBeNull();
    expect(screen.getAllByText("detected").length).toBe(2);
  });

  it("hides FileUploader drop zone for viewers", () => {
    const { container } = wrap(
      "viewer",
      <FileUploader attachTo="track" parentId={1} />
    );
    expect(container.textContent).toBe("");
  });

  it("renders ImageUploader as a static image with no Replace/Remove controls for viewers", () => {
    wrap(
      "viewer",
      <ImageUploader kind="track" parentId={1} currentImage="img/cover.png" />
    );
    expect(screen.getByAltText("track image")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove image" })).toBeNull();
    expect(screen.queryByText("Replace")).toBeNull();
  });

  it("hides empty ImageUploader for viewers", () => {
    const { container } = wrap(
      "viewer",
      <ImageUploader kind="track" parentId={1} currentImage={null} />
    );
    expect(container.textContent).toBe("");
  });
});
