import { diffSave } from "@workspace/session-diff";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { resolveState } from "../db/queries/commits.js";
import { db } from "../db/index.js";
import { sessions } from "../db/schema/sessions.js";
import { eq } from "drizzle-orm";

const chipSchema = z.object({
  kind: z.string(),
  label: z.string(),
  sign: z.enum(["add", "remove"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

const readoutSchema = z.discriminatedUnion("gauge", [
  z.object({
    gauge: z.literal("ruler"),
    label: z.string(),
    /** The ruler's own geometry; how it words a stop is the client's. */
    min: z.number(),
    max: z.number(),
    stops: z.array(z.number()),
    unit: z.string().optional(),
    from: z.number().nullable(),
    to: z.number(),
  }),
  z.object({
    gauge: z.literal("meters"),
    label: z.string(),
    meters: z.array(
      z.object({ label: z.string(), from: z.number(), to: z.number() })
    ),
  }),
  z.object({
    gauge: z.literal("transition"),
    label: z.string(),
    from: z.string().nullable(),
    to: z.string(),
  }),
]);

const deviceRowSchema = z.object({
  name: z.string(),
  status: z.enum(["same", "added", "removed"]),
  origin: z.enum(["builtin", "plugin"]),
  host: z.string().optional(),
});

const trackRowSchema = z.object({
  key: z.string(),
  kind: z.string(),
  name: z.string(),
  was: z.string().optional(),
  status: z.enum(["same", "added", "removed", "renamed", "changed"]),
  devices: z.array(deviceRowSchema),
  id: z.number().optional(),
  groupId: z.number().optional(),
  color: z.string().optional(),
});

/**
 * `@workspace/session-diff`'s `SaveDiff` as it crosses the wire: the same
 * model the client draws, with each ruler readout reduced to its geometry
 * (its formatting functions do not serialise).
 */
export const saveDiffSchema = z.object({
  /** The save ids the two state references resolved to. */
  from: z.number().int(),
  to: z.number().int(),
  first: z.boolean(),
  changed: z.boolean(),
  chips: z.array(chipSchema),
  readouts: z.array(readoutSchema),
  structure: z
    .object({ rows: z.array(trackRowSchema), truncated: z.boolean() })
    .nullable(),
  samples: z.object({
    added: z.array(z.string()),
    removed: z.array(z.string()),
  }),
  colors: z.boolean(),
});

export type SaveDiffWire = z.infer<typeof saveDiffSchema>;

/**
 * The diff of two states of a session, `from` against `to`, across branches.
 * Either reference not belonging to the session answers 404; a save recorded
 * without metadata has nothing to compare and answers 409.
 */
export async function diffStates(
  sessionId: number,
  fromRef: string,
  toRef: string
): Promise<SaveDiffWire> {
  const [from, to, session] = await Promise.all([
    resolveState(sessionId, fromRef),
    resolveState(sessionId, toRef),
    db
      .select({ dawCapabilities: sessions.dawCapabilities })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .then((rows) => rows[0]),
  ]);
  if (!from) throw new HTTPException(404, { message: `${fromRef} not found` });
  if (!to) throw new HTTPException(404, { message: `${toRef} not found` });
  if (!from.meta || !to.meta) {
    throw new HTTPException(409, {
      message: "A save with no recorded metadata cannot be compared",
    });
  }

  const diff = diffSave(from.meta, to.meta, session?.dawCapabilities ?? []);
  return {
    ...diff,
    from: from.saveId,
    to: to.saveId,
    readouts: diff.readouts.map((readout) => {
      if (readout.gauge !== "ruler") return readout;
      const { ruler, ...rest } = readout;
      return {
        ...rest,
        min: ruler.min,
        max: ruler.max,
        stops: [...ruler.stops],
        unit: ruler.unit,
      };
    }),
  };
}
