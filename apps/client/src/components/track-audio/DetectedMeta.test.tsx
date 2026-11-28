import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import type { MemberRole } from "@workspace/api/api";
import { stubGlobal } from "@workspace/test/globals";
import { MotionProvider } from "@workspace/ui/components/motion-provider";

const refresh = mock();
mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
mock.module("sonner", () => ({ toast: { error: mock() } }));

const { defineMutation } = await import("@/lib/mutation");
const patchEntityFields = mock(
  (_kind: string, _id: number, body: Record<string, unknown>) =>
    defineMutation(async () => body, ["route"])
);
mock.module("@/entities/mutations", () => ({ patchEntityFields }));

const { ProjectProvider } = await import("@/hooks/use-project-role");
const { DetectedMeta } = await import("./DetectedMeta");

beforeEach(() => {
  patchEntityFields.mockClear();
  refresh.mockClear();
});

afterEach(cleanup);

function renderMeta({
  role = "editor" as MemberRole,
  mainSessionId = 42,
  ownKey = { tonic: null as string | null, scale: null as string | null },
  ownBpm = null as string | null,
}: {
  role?: MemberRole;
  mainSessionId?: number | null;
  ownKey?: { tonic: string | null; scale: string | null };
  ownBpm?: string | null;
} = {}) {
  return render(
    <MotionProvider>
      <ProjectProvider project={{ id: 1, name: "Studio", role }}>
        <DetectedMeta
          ownKey={ownKey}
          ownBpm={ownBpm}
          detectedKey={null}
          keyConfidence={null}
          detectedBpm={null}
          bpmConfidence={null}
          mainSessionId={mainSessionId}
        />
      </ProjectProvider>
    </MotionProvider>
  );
}

describe("DetectedMeta direct Key and BPM editing", () => {
  it("picks a key via ResponsivePicker targeting mainSessionId without showing Clear key when unset", async () => {
    renderMeta();

    const trigger = screen.getByRole("button", { name: /Edit key/ });
    expect(trigger.getAttribute("aria-label")).toBe("Add key — Edit key");
    await act(async () => {
      fireEvent.click(trigger);
    });
    expect(screen.queryByRole("button", { name: "Clear key" })).toBeNull();

    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "C# Minor" }));
    });

    expect(patchEntityFields).toHaveBeenCalledWith("session", 42, {
      rootNote: "C#",
      scale: "Minor",
    });
  });

  it("clears the existing key on mainSessionId", async () => {
    renderMeta({ ownKey: { tonic: "C#", scale: "Minor" } });

    const trigger = screen.getByRole("button", { name: /Edit key/ });
    expect(trigger.getAttribute("aria-label")).toBe("C# Minor — Edit key");
    await act(async () => {
      fireEvent.click(trigger);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear key" }));
    });

    expect(patchEntityFields).toHaveBeenCalledWith("session", 42, {
      rootNote: null,
      scale: null,
    });
  });

  it("edits BPM numerically targeting mainSessionId", async () => {
    renderMeta({ ownBpm: "120" });

    const bpmTrigger = screen.getByRole("button", { name: /Edit BPM/ });
    expect(bpmTrigger.getAttribute("aria-label")).toBe("120 — Edit BPM");
    fireEvent.click(bpmTrigger);
    const input = screen.getByLabelText("BPM") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "128" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save BPM" }));
    });

    expect(patchEntityFields).toHaveBeenCalledWith("session", 42, {
      tempo: "128",
    });
  });

  it("renders read-only when mainSessionId is null", () => {
    renderMeta({
      mainSessionId: null,
      ownKey: { tonic: "A", scale: "Minor" },
      ownBpm: "110",
    });

    expect(screen.queryByRole("button", { name: /Edit key/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit BPM/ })).toBeNull();
  });

  it("uses a native button for the low-confidence mark on coarse pointers", () => {
    stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <MotionProvider>
          <ProjectProvider project={{ id: 1, name: "Studio", role: "editor" }}>
            <DetectedMeta
              ownKey={{ tonic: null, scale: null }}
              ownBpm={null}
              detectedKey={null}
              keyConfidence={null}
              detectedBpm={118}
              bpmConfidence={0.05}
              mainSessionId={42}
            />
          </ProjectProvider>
        </MotionProvider>
      );

      const mark = screen.getByRole("button", { name: "Low confidence" });
      expect(mark.tagName).toBe("BUTTON");
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
