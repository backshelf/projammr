import { describe, expect, it } from "bun:test";

import { createBreadcrumbs, imageUrl, initials } from "./utils";

describe("imageUrl", () => {
  it("routes a stored path through the media proxy", () => {
    expect(imageUrl("./static/images/a.jpg")).toBe("/media/images/a.jpg");
  });

  it("asks the API for the width the caller renders at", () => {
    expect(imageUrl("./static/images/a.jpg", 64)).toBe(
      "/media/images/a.jpg?w=64"
    );
    expect(imageUrl("images/a.jpg", 256)).toBe("/media/images/a.jpg?w=256");
  });

  it("leaves an absolute or inline source alone", () => {
    expect(imageUrl("https://cdn.example/a.jpg", 256)).toBe(
      "https://cdn.example/a.jpg"
    );
    expect(imageUrl("blob:abc", 64)).toBe("blob:abc");
  });

  it("has nothing to point at without a path", () => {
    expect(imageUrl(null, 64)).toBe("");
    expect(imageUrl(undefined)).toBe("");
  });
});

describe("createBreadcrumbs", () => {
  const project = { id: 1, name: "My Project" };

  it("links a raw session's track crumb to the track's own page instead of the session's", () => {
    // Regression: a session with an assigned track but no track segment in
    // its own URL used to lose its session crumb entirely, with the track's
    // title mislabeling the session's URL instead.
    const track = { id: 7, title: "My Track" };
    const session = { id: 9, name: "session.als" };

    expect(createBreadcrumbs(project, { track, session })).toEqual([
      { label: "My Project", href: "/project/1" },
      { label: "My Track", href: "/project/1/track/7" },
      { label: "session.als", href: "/project/1/track/7/session/9" },
    ]);
  });

  it("keeps the collection in a track's href when reached alongside one", () => {
    const collection = { id: 5, title: "My Collection" };
    const track = { id: 7, title: "My Track" };

    expect(createBreadcrumbs(project, { collection, track })).toEqual([
      { label: "My Project", href: "/project/1" },
      { label: "My Collection", href: "/project/1/collection/5" },
      { label: "My Track", href: "/project/1/collection/5/track/7" },
    ]);
  });

  it("is just the project when reached with no descendant entity", () => {
    expect(createBreadcrumbs(project)).toEqual([
      { label: "My Project", href: "/project/1" },
    ]);
  });

  it("builds a crumb per entity with its parents in the href", () => {
    const collection = { id: 5, title: "My Collection" };
    const track = { id: 7, title: "My Track" };
    const session = { id: 9, name: "session.als" };

    expect(createBreadcrumbs(project, { collection, track, session })).toEqual([
      { label: "My Project", href: "/project/1" },
      { label: "My Collection", href: "/project/1/collection/5" },
      { label: "My Track", href: "/project/1/collection/5/track/7" },
      {
        label: "session.als",
        href: "/project/1/collection/5/track/7/session/9",
      },
    ]);
  });

  it("omits absent parents", () => {
    const session = { id: 9, name: "session.als" };

    expect(createBreadcrumbs(project, { session })).toEqual([
      { label: "My Project", href: "/project/1" },
      { label: "session.als", href: "/project/1/session/9" },
    ]);
  });
});

describe("initials", () => {
  it("joins letters with no separator, so a screen reader reads a word", () => {
    expect(initials("Chris Doe")).toBe("CD");
  });

  it("uppercases a lowercase name", () => {
    expect(initials("chris doe")).toBe("CD");
  });

  it("handles a single name", () => {
    expect(initials("Chris")).toBe("C");
  });

  it("stops at the two letters an avatar fits", () => {
    expect(initials("Chris Dana Doe")).toBe("CD");
  });
});
