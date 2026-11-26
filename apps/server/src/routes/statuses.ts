import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AuthedEnv } from "../auth.js";
import {
  createStatus,
  deleteStatus,
  getStatus,
  updateStatus,
} from "../db/queries/statuses.js";
import {
  editStatusSchema,
  newStatusSchema,
  statusSchema,
} from "../db/schema/statuses.js";
import { describer, idParam, respond, validator } from "../lib/http.js";

const { describe, describeRaw } = describer("Statuses");

// A status is read either on its own by id or through a project that may use
// it — `GET /projects/:id/statuses` returns the globals plus that project's
// own, and is the only list.
const app = new Hono<AuthedEnv>();

app.get(
  "/:id",
  describe(
    "Get a status by id",
    { schema: statusSchema, description: "Status retrieved successfully" },
    400,
    404
  ),
  idParam(),
  async (c) => {
    const status = await getStatus(c.req.valid("param").id);
    // The mount's resolver has already turned an id naming no row into a 404;
    // this covers the row deleted between that lookup and this one.
    if (!status) throw new HTTPException(404);
    return respond(c, statusSchema, status);
  }
);

app.post(
  "/",
  describe(
    "Create a new status",
    {
      status: 201,
      schema: statusSchema,
      description: "Status created successfully",
    },
    400
  ),
  validator("json", newStatusSchema),
  async (c) =>
    respond(
      c,
      statusSchema,
      await createStatus(c.req.valid("json"), c.get("user").id),
      201
    )
);

app.patch(
  "/:id",
  describe(
    "Update a status. Global statuses cannot be changed.",
    { schema: statusSchema, description: "Status updated successfully" },
    400,
    403,
    404
  ),
  idParam(),
  validator("json", editStatusSchema),
  async (c) =>
    respond(
      c,
      statusSchema,
      await updateStatus(
        c.req.valid("param").id,
        c.req.valid("json"),
        c.get("user").id
      )
    )
);

app.delete(
  "/:id",
  describeRaw(
    "Delete a status. Global statuses cannot be deleted.",
    { status: 204, description: "Status deleted successfully" },
    400,
    403,
    404
  ),
  idParam(),
  async (c) => {
    await deleteStatus(c.req.valid("param").id, c.get("user").id);
    return c.body(null, 204);
  }
);

export default app;
