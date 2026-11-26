import { Hono } from "hono";
import { z } from "zod";
import type { AuthedEnv } from "../auth.js";
import {
  deleteRejection,
  listNotABounce,
  listRejections,
  writeRejections,
} from "../db/queries/machine-rejections.js";
import {
  assertMachineAvailable,
  listMachines,
  recordMachineBeat,
  removeMachine,
  sessionPresence,
} from "../db/queries/machines.js";
import {
  notABounceSchema,
  rejectionsSchema,
  writeRejectionsSchema,
  writtenRejectionsSchema,
} from "../db/schema/machine-rejections.js";
import {
  deviceIdSchema,
  machineBeatSchema,
  machineListItemSchema,
  machineSchema,
  sessionPresenceSchema,
} from "../db/schema/machines.js";
import { describer, idParam, params, respond, validator } from "../lib/http.js";
import { spendToken } from "../middleware/rate-limit.js";

const { describe, describeRaw } = describer("Machines");

/**
 * The caller's own machines. Every route that names a machine checks the
 * path's id against the caller, as the device routes do.
 */
const app = new Hono<AuthedEnv>();

const machinesSchema = z.object({
  machines: z.array(machineListItemSchema),
  notABounce: z.array(notABounceSchema),
});

const machineParam = () => params({ id: deviceIdSchema });

app.get(
  "/",
  describe(
    "List your machines. Most recently seen first, each with whether it is " +
      "online (a beat within 90 s), the session it has open, the repos it " +
      "tracks, the repos it has pushed to (of projects you are a member of) " +
      'and its "Never here" folders. `notABounce` holds the files you ' +
      "marked as not a bounce, which every machine of yours shares.",
    { schema: machinesSchema, description: "Your machines" }
  ),
  async (c) => {
    const userId = c.get("user").id;
    const [machines, notABounce] = await Promise.all([
      listMachines(userId),
      listNotABounce(userId),
    ]);
    return respond(c, machinesSchema, { machines, notABounce });
  }
);

app.get(
  "/rejections",
  describe(
    "The render rejections you have made: files that are not a bounce, " +
      "which hold on every machine of yours, and the folders each machine is " +
      "never to look for renders in.",
    { schema: rejectionsSchema, description: "Your rejections" }
  ),
  async (c) =>
    respond(c, rejectionsSchema, await listRejections(c.get("user").id))
);

app.post(
  "/rejections",
  describe(
    "Record render rejections. Answers the stored rows of those named. One " +
      "already recorded is kept as it was, so a write is safe to repeat; at most 1000 " +
      "per write. A folder of another account's machine is a 403 and of an " +
      "unknown or removed machine a 404, and refuses the whole write.",
    {
      schema: writtenRejectionsSchema,
      description: "The rejections as stored",
    },
    400,
    403,
    404
  ),
  validator("json", writeRejectionsSchema),
  async (c) =>
    respond(
      c,
      writtenRejectionsSchema,
      await writeRejections(c.get("user").id, c.req.valid("json").items)
    )
);

app.delete(
  "/rejections/:id",
  describeRaw(
    'Delete one of your rejections. It is a "Not a bounce" file or a ' +
      '"Never here" folder; another account\'s, like none, is a 404.',
    { status: 204, description: "Rejection deleted" },
    400,
    404
  ),
  idParam(),
  async (c) => {
    await deleteRejection(c.req.valid("param").id, c.get("user").id);
    return c.body(null, 204);
  }
);

app.put(
  "/:id",
  describe(
    "Report a machine. Sent by the app on each beat; the first beat of a new " +
      "id registers the machine, and each beat notes the sign-in it came " +
      "from. The open session is kept only when the caller is a member of " +
      "its project. A name another of the caller's machines holds is a 409 " +
      "`machine_name_taken`; a machine removed from the web is a 401, the " +
      "answer a signed-out app acts on.",
    { schema: machineSchema, description: "The machine, as recorded" },
    400,
    401,
    403,
    409,
    429
  ),
  machineParam(),
  validator("json", machineBeatSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const userId = c.get("user").id;
    // Refused before the allowance is spent, so naming another account's
    // machine cannot drain the beats its owner has.
    await assertMachineAvailable(id, userId);
    spendToken("machine-heartbeat", id);
    return respond(
      c,
      machineSchema,
      await recordMachineBeat(
        id,
        userId,
        c.req.valid("json"),
        c.get("session").id
      )
    );
  }
);

app.delete(
  "/:id",
  describeRaw(
    "Remove one of your machines. It is signed out of dit: the sign-in of " +
      "its last beat is revoked, so its next request is a 401. Its saves, " +
      "commits and segments stay under its last name, and its name is free " +
      "to reuse.",
    { status: 204, description: "Machine removed" },
    400,
    403,
    404
  ),
  machineParam(),
  async (c) => {
    await removeMachine(c.req.valid("param").id, c.get("user").id);
    return c.body(null, 204);
  }
);

/**
 * The caller's machines on one session. The session's mount has already gated
 * `/sessions/*` on the session in the path, so a viewer reads.
 */
export function sessionPresenceRoutes(): Hono<AuthedEnv> {
  const presence = new Hono<AuthedEnv>();

  presence.get(
    "/:id/presence",
    describe(
      "Machines online on the session. The caller's machines with a beat " +
        "within 90 s, each with whether it has the session open and whether " +
        "it tracks the session's repo. Those opening the session come first, " +
        "then those tracking its repo, then the most recently seen.",
      { schema: sessionPresenceSchema, description: "Machines on the session" },
      400,
      404
    ),
    idParam(),
    async (c) =>
      respond(c, sessionPresenceSchema, {
        machines: await sessionPresence(
          c.req.valid("param").id,
          c.get("user").id
        ),
      })
  );

  return presence;
}

export default app;
