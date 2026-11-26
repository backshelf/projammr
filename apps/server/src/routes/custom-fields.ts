import { Hono } from "hono";
import { z } from "zod";
import type { AuthedEnv } from "../auth.js";
import {
  createCustomField,
  customFieldsQuerySchema,
  deleteCustomField,
  editCustomFieldSchema,
  listCustomFields,
  listedCustomFieldSchema,
  newCustomFieldSchema,
  reorderCustomFieldsSchema,
  reorderCustomFields,
  updateCustomField,
} from "../db/queries/custom-fields.js";
import {
  describer,
  idParam,
  idParams,
  respond,
  validator,
} from "../lib/http.js";

const { describe, describeRaw } = describer("Custom fields");

const fieldsSchema = z.array(listedCustomFieldSchema);

/**
 * A project's custom fields, mounted under `/projects` beside its labels and
 * statuses, so the project mount's gate applies: a viewer reads, an editor
 * and above writes.
 */
const app = new Hono<AuthedEnv>();

app.get(
  "/:id/fields",
  describe(
    "List a project's custom fields: `kind`'s in their order, or every " +
      "kind's when it is absent. Each carries `valueCount`, how many " +
      "entities hold a value, and a select also `optionCounts`, that count " +
      "per option id (an option nobody holds is absent).",
    { schema: fieldsSchema, description: "Fields fetched" },
    400
  ),
  idParam(),
  validator("query", customFieldsQuerySchema),
  async (c) =>
    respond(
      c,
      fieldsSchema,
      await listCustomFields(c.req.valid("param").id, c.req.valid("query").kind)
    )
);

app.post(
  "/:id/fields",
  describe(
    "Create a custom field after the kind's last one. Its type is fixed " +
      "from here on. Only a select takes `options`; an option without an " +
      "`id` is given one. A name the kind already has is a 409.",
    {
      status: 201,
      schema: listedCustomFieldSchema,
      description: "Field created",
    },
    400,
    409
  ),
  idParam(),
  validator("json", newCustomFieldSchema),
  async (c) =>
    respond(
      c,
      listedCustomFieldSchema,
      await createCustomField(c.req.valid("param").id, c.req.valid("json")),
      201
    )
);

app.put(
  "/:id/fields/order",
  describe(
    "Order one kind's fields. `ids` lists every field of that kind once; " +
      "a missing or doubled field is a 400, a field of another project a 404.",
    { schema: fieldsSchema, description: "The kind's fields, reordered" },
    400,
    404
  ),
  idParam(),
  validator("json", reorderCustomFieldsSchema),
  async (c) =>
    respond(
      c,
      fieldsSchema,
      await reorderCustomFields(
        c.req.valid("param").id,
        c.req.valid("json").ids
      )
    )
);

app.patch(
  "/:id/fields/:fieldId",
  describe(
    "Rename a field or edit a select's options. `options` is the full " +
      "list, an existing option keeping its `id` and a new one having none. " +
      "The type cannot change. Values holding a removed option keep its id.",
    { schema: listedCustomFieldSchema, description: "Field updated" },
    400,
    404,
    409
  ),
  idParams("id", "fieldId"),
  validator("json", editCustomFieldSchema),
  async (c) => {
    const { id, fieldId } = c.req.valid("param");
    return respond(
      c,
      listedCustomFieldSchema,
      await updateCustomField(id, fieldId, c.req.valid("json"))
    );
  }
);

app.delete(
  "/:id/fields/:fieldId",
  describeRaw(
    "Delete a custom field and every value it holds. Saved views naming " +
      "its `cf_<id>` keep the parameter, which lists ignore from then on.",
    { status: 204, description: "Field deleted" },
    400,
    404
  ),
  idParams("id", "fieldId"),
  async (c) => {
    const { id, fieldId } = c.req.valid("param");
    await deleteCustomField(id, fieldId);
    return c.body(null, 204);
  }
);

export default app;
