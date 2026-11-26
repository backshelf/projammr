import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AuthedEnv } from "../auth.js";
import { cancelJobOrThrow, getJob, retryJob } from "../db/queries/jobs.js";
import { jobSchema } from "../db/schema/jobs.js";
import { describer, idParam, respond } from "../lib/http.js";

const { describe } = describer("Jobs");

const app = new Hono<AuthedEnv>({ strict: false });

app.get(
  "/:id",
  describe(
    "Get a background job's progress and result. Polled by whatever queued it.",
    { schema: jobSchema, description: "The job as it stands" },
    400,
    404
  ),
  idParam(),
  async (c) => respond(c, jobSchema, await getJob(c.req.valid("param").id))
);

app.post(
  "/:id/retry",
  describe(
    "Retry a failed job: resets it to queued with a clean attempt count.",
    { schema: jobSchema, description: "The job, queued again" },
    400,
    404,
    409
  ),
  idParam(),
  async (c) => {
    const { id } = c.req.valid("param");
    // 404s an id that names no job, so the 409 below only ever means "this
    // job exists and is not failed".
    await getJob(id);

    const job = await retryJob(id);
    if (!job) throw new HTTPException(409, { message: "Job is not failed" });

    return respond(c, jobSchema, job);
  }
);

app.post(
  "/:id/cancel",
  describe(
    "Cancel a job that has not finished. A queued job is cancelled at once. " +
      "A running job is asked to stop: it reads `cancelRequested` until its " +
      "run gives up, then `cancelled`.",
    { schema: jobSchema, description: "The job, cancelled or stopping" },
    400,
    404,
    409
  ),
  idParam(),
  async (c) =>
    respond(c, jobSchema, await cancelJobOrThrow(c.req.valid("param").id))
);

export default app;
