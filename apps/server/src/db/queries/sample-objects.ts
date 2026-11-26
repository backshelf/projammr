import { and, eq, inArray } from "drizzle-orm";
import { bindParamLimit, chunk } from "../../lib/chunk.js";
import { db } from "../index.js";
import { objects, repoObjects, saveSampleObjects } from "../schema/objects.js";
import type { SampleRef } from "../schema/samples.js";
import { saves } from "../schema/saves.js";
import { sessions } from "../schema/sessions.js";

/** A held sample's kind byte and the name its reference gives it. */
type HeldSample = { kind: number; name: string };

/** The last segment of a path as a set writes it, which may use either separator. */
const baseName = (path: string) => path.split(/[\\/]/).at(-1) || "sample";

/**
 * The sample `hash` names as a repo holds it, or undefined. It is held when a
 * save of a session in the repo lists the object as a sample, its own
 * reference names the object, and the repo still holds the object: any other
 * hash, the objects a set rebuilds from or a sample's chunks, is not a sample
 * a caller may fetch by name.
 */
export async function heldSample(
  repoId: number,
  hash: string
): Promise<HeldSample | undefined> {
  const rows = await db
    .select({ kind: objects.kind, meta: saves.meta })
    .from(saveSampleObjects)
    .innerJoin(saves, eq(saves.id, saveSampleObjects.saveId))
    .innerJoin(sessions, eq(sessions.id, saves.sessionId))
    .innerJoin(objects, eq(objects.hash, saveSampleObjects.objectHash))
    .innerJoin(
      repoObjects,
      and(
        eq(repoObjects.repoId, sessions.repoId),
        eq(repoObjects.objectHash, saveSampleObjects.objectHash)
      )
    )
    .where(
      and(eq(sessions.repoId, repoId), eq(saveSampleObjects.objectHash, hash))
    );
  for (const { kind, meta } of rows) {
    const ref = meta?.samples?.find((candidate) => candidate.object === hash);
    if (ref) return { kind, name: baseName(ref.path) };
  }
  return undefined;
}

/** What a save's references need to be served: the objects it links, with their kinds. */
export async function linkedSampleKinds(
  saveId: number,
  refs: SampleRef[]
): Promise<Map<string, number>> {
  const wanted = [
    ...new Set(refs.flatMap((ref) => (ref.object ? [ref.object] : []))),
  ];
  const kinds = new Map<string, number>();
  for (const batch of chunk(wanted, Math.max(1, bindParamLimit() - 1))) {
    const rows = await db
      .select({ hash: objects.hash, kind: objects.kind })
      .from(saveSampleObjects)
      .innerJoin(objects, eq(objects.hash, saveSampleObjects.objectHash))
      .where(
        and(
          eq(saveSampleObjects.saveId, saveId),
          inArray(saveSampleObjects.objectHash, batch)
        )
      );
    for (const row of rows) kinds.set(row.hash, row.kind);
  }
  return kinds;
}
