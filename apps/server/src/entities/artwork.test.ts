import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { app } from "../app.js";
import {
  baseUrl,
  setParentImage,
  setupSuite,
  testImage,
  trustedOrigin,
} from "../test/fixtures.js";

const suite = setupSuite("Artwork");
const { owner, request } = suite;

describe("artwork", () => {
  /*
   * Every entity carries only an image *path*; the accent lives on the
   * `images` row. The read endpoints resolve the nearest cover in the
   * hierarchy — track → its collection → the project — and return the file
   * plus the accent bin, so the client neither fetches the project's image
   * list nor re-derives the colour maths.
   *
   * These run against their own project so the fallback rungs can be tested in
   * isolation: the shared suite project's covers would mask the empty cases.
   */
  let artProjectId = 0;

  const art = (path: string, init?: RequestInit) =>
    request("owner", path, init);

  const mkArtImage = async (name: string) => {
    const form = new FormData();
    form.append(
      "file",
      new File([await testImage()], name, { type: "image/jpeg" })
    );
    form.append("projectId", String(artProjectId));
    const res = await app.request(`${baseUrl}/images/upload`, {
      method: "POST",
      headers: { Cookie: owner.cookie, Origin: trustedOrigin },
      body: form,
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: number; assetPath: string };
  };

  const setCover = async (
    imageId: number,
    kind: "project" | "collection" | "track",
    parentId: number
  ) => {
    const res = await setParentImage(art, {
      imageId,
      kind,
      parentId,
      projectId: artProjectId,
    });
    expect(res.status).toBe(200);
  };

  const mkArtTrack = async (title: string) => {
    const res = await art("/tracks", {
      method: "POST",
      body: JSON.stringify({
        title,
        artists: [],
        projectId: artProjectId,
      }),
    });
    expect(res.status).toBe(201);
    return (await res.json()).id as number;
  };

  const mkArtCollection = async (title: string) => {
    const res = await art("/collections", {
      method: "POST",
      body: JSON.stringify({ title, projectId: artProjectId }),
    });
    expect(res.status).toBe(201);
    return (await res.json()).id as number;
  };

  const artworkOf = async (path: string) => {
    const res = await art(path);
    expect(res.status, path).toBe(200);
    return (await res.json()).artwork as {
      assetPath: string;
      accentHue: number | null;
      accentChroma: number | null;
    } | null;
  };

  beforeAll(async () => {
    const res = await request("owner", "/projects", {
      method: "POST",
      body: JSON.stringify({ name: `Artwork ${Date.now()}`, links: [] }),
    });
    expect(res.status).toBe(201);
    artProjectId = (await res.json()).id as number;
  });

  afterAll(async () => {
    if (artProjectId) {
      await request("owner", `/projects/${artProjectId}`, { method: "DELETE" });
    }
  });

  it("returns null everywhere when nothing in the hierarchy has a cover", async () => {
    const trackId = await mkArtTrack("Bare Track");
    const collectionId = await mkArtCollection("Bare Collection");
    const sessionRes = await art("/sessions", {
      method: "POST",
      body: JSON.stringify({
        name: "Bare Session",
        daw: "ableton",
        projectId: artProjectId,
        trackId,
      }),
    });
    expect(sessionRes.status).toBe(201);
    const sessionId = (await sessionRes.json()).id as number;

    expect(await artworkOf(`/projects/${artProjectId}`)).toBeNull();
    expect(await artworkOf(`/tracks/${trackId}`)).toBeNull();
    expect(await artworkOf(`/collections/${collectionId}`)).toBeNull();
    expect(await artworkOf(`/sessions/${sessionId}`)).toBeNull();
  });

  it("walks track → collection → project, preferring the nearest cover", async () => {
    const projectImage = await mkArtImage("art-project.jpeg");
    await setCover(projectImage.id, "project", artProjectId);

    const collectionId = await mkArtCollection("Art Collection");
    const collectionImage = await mkArtImage("art-collection.jpeg");
    await setCover(collectionImage.id, "collection", collectionId);

    const ownCover = await mkArtTrack("Track With Cover");
    const trackImage = await mkArtImage("art-track.jpeg");
    await setCover(trackImage.id, "track", ownCover);

    const inCollection = await mkArtTrack("Track In Collection");
    const bare = await mkArtTrack("Track With Nothing");
    for (const trackId of [ownCover, inCollection]) {
      const res = await art(`/collections/${collectionId}/tracks`, {
        method: "POST",
        body: JSON.stringify({ trackId }),
      });
      expect(res.status).toBe(200);
    }

    // The project falls back to its own cover, and carries the accent the
    // extractor stored rather than just the path.
    const project = await artworkOf(`/projects/${artProjectId}`);
    expect(project?.assetPath).toBe(projectImage.assetPath);
    expect(project).toHaveProperty("accentHue");
    expect(project).toHaveProperty("accentChroma");

    expect((await artworkOf(`/collections/${collectionId}`))?.assetPath).toBe(
      collectionImage.assetPath
    );
    expect((await artworkOf(`/tracks/${ownCover}`))?.assetPath).toBe(
      trackImage.assetPath
    );
    expect((await artworkOf(`/tracks/${inCollection}`))?.assetPath).toBe(
      collectionImage.assetPath
    );
    expect((await artworkOf(`/tracks/${bare}`))?.assetPath).toBe(
      projectImage.assetPath
    );
  });

  it("gives a session the cover its parent track would show", async () => {
    const collectionId = await mkArtCollection("Session Art Collection");
    const collectionImage = await mkArtImage("art-session-collection.jpeg");
    await setCover(collectionImage.id, "collection", collectionId);

    const trackId = await mkArtTrack("Session Art Track");
    const linked = await art(`/collections/${collectionId}/tracks`, {
      method: "POST",
      body: JSON.stringify({ trackId }),
    });
    expect(linked.status).toBe(200);

    const sessionRes = await art("/sessions", {
      method: "POST",
      body: JSON.stringify({
        name: "Inheriting Session",
        daw: "ableton",
        projectId: artProjectId,
        trackId,
      }),
    });
    expect(sessionRes.status).toBe(201);
    const sessionId = (await sessionRes.json()).id as number;

    expect((await artworkOf(`/sessions/${sessionId}`))?.assetPath).toBe(
      collectionImage.assetPath
    );
  });

  it("resolves the sidebar summaries' swatches too", async () => {
    const collections = (await (
      await art(`/projects/${artProjectId}/collections/summary`)
    ).json()) as { artwork: { assetPath: string } | null }[];
    expect(collections.length).toBeGreaterThan(0);
    expect(collections.every((c) => c.artwork !== undefined)).toBe(true);
    expect(collections.some((c) => c.artwork !== null)).toBe(true);

    const tracks = (await (
      await art(`/projects/${artProjectId}/tracks/summary`)
    ).json()) as { artwork: { assetPath: string } | null }[];
    expect(tracks.length).toBeGreaterThan(0);
    expect(tracks.every((t) => t.artwork !== null)).toBe(true);
  });

  it("walks the full chain for the sidebar's track swatches", async () => {
    const first = await mkArtCollection("Sidebar First");
    const firstImage = await mkArtImage("art-sidebar-first.jpeg");
    await setCover(firstImage.id, "collection", first);

    const second = await mkArtCollection("Sidebar Second");
    const secondImage = await mkArtImage("art-sidebar-second.jpeg");
    await setCover(secondImage.id, "collection", second);

    const ownCover = await mkArtTrack("Sidebar Own Cover");
    const trackImage = await mkArtImage("art-sidebar-track.jpeg");
    await setCover(trackImage.id, "track", ownCover);
    const onBoth = await mkArtTrack("Sidebar On Both");
    for (const [collectionId, trackId] of [
      [first, onBoth],
      [second, onBoth],
      [second, ownCover],
    ]) {
      const res = await art(`/collections/${collectionId}/tracks`, {
        method: "POST",
        body: JSON.stringify({ trackId }),
      });
      expect(res.status).toBe(200);
    }

    type Summary = { id: number; artwork: { assetPath: string } | null };
    const coverOf = (summaries: Summary[], id: number) =>
      summaries.find((s) => s.id === id)?.artwork?.assetPath;

    // The recents list falls back to the track's first collection before the
    // project, like the track page does.
    const recents = (await (
      await art(`/projects/${artProjectId}/tracks/summary`)
    ).json()) as Summary[];
    expect(coverOf(recents, onBoth)).toBe(firstImage.assetPath);
    expect(coverOf(recents, ownCover)).toBe(trackImage.assetPath);

    // Nested under a collection, a coverless track takes that collection's.
    const nested = (await (
      await art(`/collections/${second}/tracks/summary`)
    ).json()) as Summary[];
    expect(coverOf(nested, onBoth)).toBe(secondImage.assetPath);
    expect(coverOf(nested, ownCover)).toBe(trackImage.assetPath);
  });
});
