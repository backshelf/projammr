import { ART_FALLBACK_PROPERTY } from "@workspace/settings/appearance";
import { afterEach, describe, expect, it } from "bun:test";
import { effectiveSettings, type EffectiveSettings } from "./effective";
import { SettingsStore, type SettingsTransport } from "./store";

/** A transport whose writes land at once and whose reads answer `fresh`, counting each read. */
function fakeTransport(fresh: EffectiveSettings) {
  const reads: (number | null)[] = [];
  const transport: SettingsTransport = {
    send: async () => ({}),
    read: async (projectId) => {
      reads.push(projectId);
      return fresh;
    },
  };
  return { transport, reads };
}

/** Lets a read the store started answer and apply. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("SettingsStore mounted from a cached read", () => {
  const after = effectiveSettings({ "editor.rhymePrefix": "!" }, "after");

  it("reads a project's values again when a write has landed since that read", async () => {
    const { transport, reads } = fakeTransport(after);
    const root = new SettingsStore(
      effectiveSettings({}, "root"),
      null,
      null,
      transport
    );
    root.attach();

    // A project page mounts with its server read, and the caller leaves it.
    const cached = effectiveSettings({}, "project-before");
    new SettingsStore(cached, 5, root, transport).attach()();

    // A personal change lands elsewhere, then Back restores the project page's
    // payload from the router cache, old read and all.
    await root.queue.write("user", "someone", { "editor.rhymePrefix": "!" });
    const restored = new SettingsStore(cached, 5, root, transport);
    restored.attach();
    await settle();

    expect(reads).toEqual([5]);
    expect(restored.values["editor.rhymePrefix"]).toBe("!");
  });

  it("trusts a read it has not held before, and one no write has outdated", async () => {
    const { transport, reads } = fakeTransport(after);
    const root = new SettingsStore(
      effectiveSettings({}, "root"),
      null,
      null,
      transport
    );
    root.attach();

    // Back and Forth with no write between: the cached read still stands.
    const cached = effectiveSettings({}, "project-before");
    new SettingsStore(cached, 5, root, transport).attach()();
    new SettingsStore(cached, 5, root, transport).attach()();
    // After a write, a page the server renders afresh brings a new read.
    await root.queue.write("user", "someone", { "editor.rhymePrefix": "!" });
    new SettingsStore(
      effectiveSettings({}, "project-after"),
      5,
      root,
      transport
    ).attach();
    await settle();

    expect(reads).toEqual([]);
  });

  it("reads again after a change made outside the queue, such as a lock or an import", async () => {
    const { transport, reads } = fakeTransport(after);
    const root = new SettingsStore(
      effectiveSettings({}, "root"),
      null,
      null,
      transport
    );
    root.attach();

    const cached = effectiveSettings({}, "project-before");
    new SettingsStore(cached, 5, root, transport).attach()();
    // A lock or an import lands by its own request, then refreshes.
    await root.refresh();
    const restored = new SettingsStore(cached, 5, root, transport);
    restored.attach();
    await settle();

    expect(reads).toEqual([null, 5]);
  });

  it("keeps apart two projects' reads whose values, and so versions, agree", async () => {
    const reads: (number | null)[] = [];
    const transport: SettingsTransport = {
      send: async () => ({}),
      read: async (projectId) => {
        reads.push(projectId);
        return effectiveSettings({}, "same");
      },
    };
    const root = new SettingsStore(
      effectiveSettings({}, "root"),
      null,
      null,
      transport
    );
    root.attach();

    // Project 5 mounts and is left; a write outdates its read.
    const cached = effectiveSettings({}, "same");
    new SettingsStore(cached, 5, root, transport).attach()();
    await root.queue.write("project", 5, { "editor.rhymePrefix": "!" });
    // Project 6 reads fresh values that happen to match project 5's old ones.
    new SettingsStore(
      effectiveSettings({}, "same"),
      6,
      root,
      transport
    ).attach();
    // Back to project 5: its cached read is still the outdated one.
    new SettingsStore(cached, 5, root, transport).attach();
    await settle();

    expect(reads).toEqual([5]);
  });
});

describe("SettingsStore painting the document", () => {
  // Stored setting values, as the colour control writes them; nothing renders them.
  // eslint-disable-next-line no-restricted-syntax -- setting values under test
  const ROOT_COLOUR = "#112233";
  // eslint-disable-next-line no-restricted-syntax -- setting values under test
  const OTHER_COLOUR = "#ff8800";

  const property = () =>
    document.documentElement.style.getPropertyValue(ART_FALLBACK_PROPERTY);

  afterEach(() => {
    document.documentElement.style.removeProperty(ART_FALLBACK_PROPERTY);
  });

  it("repaints the accent property after adopt", () => {
    const { transport } = fakeTransport(effectiveSettings({}, "unused"));
    const root = new SettingsStore(
      effectiveSettings({ "appearance.accentFallback": ROOT_COLOUR }, "before"),
      null,
      null,
      transport
    );
    root.attach();
    expect(property()).toBe(ROOT_COLOUR);

    root.adopt(
      effectiveSettings({ "appearance.accentFallback": OTHER_COLOUR }, "after")
    );
    expect(property()).toBe(OTHER_COLOUR);
  });

  it("lets a nested project store claim the property and hand it back", () => {
    const { transport } = fakeTransport(effectiveSettings({}, "unused"));
    const root = new SettingsStore(
      effectiveSettings({ "appearance.accentFallback": ROOT_COLOUR }, "root"),
      null,
      null,
      transport
    );
    root.attach();
    expect(property()).toBe(ROOT_COLOUR);

    const detach = new SettingsStore(
      effectiveSettings(
        { "appearance.accentFallback": OTHER_COLOUR },
        "project"
      ),
      5,
      root,
      transport
    ).attach();
    expect(property()).toBe(OTHER_COLOUR);

    detach();
    expect(property()).toBe(ROOT_COLOUR);
  });
});
