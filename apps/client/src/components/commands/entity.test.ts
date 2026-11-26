import {
  ENTITY_COMMANDS,
  type EntitySurface,
} from "@/components/commands/entity";
import type {
  ActionContext,
  CommandContext,
} from "@/components/commands/types";
import { describe, expect, it, mock } from "bun:test";

function makeContext(
  surface: Partial<EntitySurface>,
  push: () => void = () => {}
): CommandContext<EntitySurface> {
  return {
    router: { push } as unknown as ActionContext["router"],
    count: 1,
    surface: {
      previousHref: null,
      nextHref: null,
      handler: () => undefined,
      ...surface,
    },
  } as unknown as CommandContext<EntitySurface>;
}

const command = (id: string) => {
  const found = ENTITY_COMMANDS.find((c) => c.id === id)!;
  return found as unknown as {
    keys?: string[];
    when(ctx: CommandContext<EntitySurface>): boolean;
    run(ctx: CommandContext<EntitySurface>): void;
  };
};

describe("control commands", () => {
  const CONTROLS = [
    ["rename-track", "rename", "r"],
    ["comment-on-audio", "comment", "c"],
    ["upload-audio", "upload", "a"],
    ["delete-track", "delete", "mod+Backspace"],
  ] as const;

  it.each(CONTROLS)(
    "%s is bound to %s's key in the Track group",
    (id, _n, key) => {
      expect(command(id).keys).toEqual([key]);
      const found = ENTITY_COMMANDS.find((c) => c.id === id)!;
      expect(found.group).toBe("Track");
      expect(found.repeatable).toBeFalsy();
      expect(found.countable).toBeFalsy();
    }
  );

  it.each(CONTROLS)(
    "%s is present only with a registered handler",
    (id, name) => {
      const handler = mock();
      expect(
        command(id).when(
          makeContext({ handler: (n) => (n === name ? handler : undefined) })
        )
      ).toBe(true);
      expect(command(id).when(makeContext({}))).toBe(false);
    }
  );

  it.each(CONTROLS)(
    "%s runs the handler its control registered",
    (id, name) => {
      const handler = mock();
      const other = mock();
      command(id).run(
        makeContext({ handler: (n) => (n === name ? handler : other) })
      );
      expect(handler).toHaveBeenCalledTimes(1);
      expect(other).not.toHaveBeenCalled();
    }
  );
});

describe("running order commands", () => {
  const surface = {
    previousHref: "/project/1/collection/2/track/4",
    nextHref: "/project/1/collection/2/track/6",
  };

  it("binds `{` and `}` in the Track group", () => {
    expect(command("previous-track").keys).toEqual(["{"]);
    expect(command("next-track").keys).toEqual(["}"]);
    expect(
      ENTITY_COMMANDS.filter((c) => c.scope === "entity").every(
        (c) => c.group === "Track"
      )
    ).toBe(true);
  });

  it("navigates to the previous and next track's href", () => {
    const push = mock();
    const ctx = makeContext(surface, push);
    command("previous-track").run(ctx);
    command("next-track").run(ctx);
    expect(push.mock.calls).toEqual([
      ["/project/1/collection/2/track/4"],
      ["/project/1/collection/2/track/6"],
    ]);
  });

  it("is present in the middle of the running order", () => {
    const ctx = makeContext(surface);
    expect(command("previous-track").when(ctx)).toBe(true);
    expect(command("next-track").when(ctx)).toBe(true);
  });

  it("drops `{` on the first track and `}` on the last", () => {
    expect(
      command("previous-track").when(
        makeContext({ nextHref: surface.nextHref })
      )
    ).toBe(false);
    expect(
      command("next-track").when(
        makeContext({ previousHref: surface.previousHref })
      )
    ).toBe(false);
  });

  it("is absent both ways when the track sits in no collection", () => {
    const ctx = makeContext({});
    expect(command("previous-track").when(ctx)).toBe(false);
    expect(command("next-track").when(ctx)).toBe(false);
  });

  it("does not navigate when there is no neighbour", () => {
    const push = mock();
    const ctx = makeContext({}, push);
    command("previous-track").run(ctx);
    command("next-track").run(ctx);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("palette commands", () => {
  const PALETTE = [
    ["set-status", "s", "status "],
    ["set-priority", "!", "priority "],
    ["set-labels", "t", "label "],
  ] as const;

  const trackPage = (over: Partial<ActionContext> = {}) => {
    const openWith = mock();
    const ctx = {
      ...makeContext({}),
      canEdit: true,
      projectId: 1,
      route: { kind: "track" },
      palette: { openWith },
      ...over,
    } as unknown as CommandContext<EntitySurface>;
    return { ctx, openWith };
  };

  it.each(PALETTE)("%s is bound to %s in the Track group", (id, key) => {
    expect(command(id).keys).toEqual([key]);
    const found = ENTITY_COMMANDS.find((c) => c.id === id)!;
    expect(found.group).toBe("Track");
    expect(found.repeatable).toBeFalsy();
    expect(found.countable).toBeFalsy();
  });

  it.each(PALETTE)(
    "%s opens the palette seeded with its prefix",
    (id, _key, seed) => {
      const { ctx, openWith } = trackPage();
      command(id).run(ctx);
      expect(openWith).toHaveBeenCalledWith(seed);
    }
  );

  it.each(PALETTE)("%s is present for an editor on a track page", (id) => {
    expect(command(id).when(trackPage().ctx)).toBe(true);
  });

  it.each(PALETTE)("%s is absent for a viewer", (id) => {
    expect(command(id).when(trackPage({ canEdit: false }).ctx)).toBe(false);
  });

  it.each(PALETTE)("%s is absent off a track page", (id) => {
    expect(
      command(id).when(trackPage({ route: { kind: "home" } as never }).ctx)
    ).toBe(false);
    expect(command(id).when(trackPage({ projectId: null }).ctx)).toBe(false);
  });
});
