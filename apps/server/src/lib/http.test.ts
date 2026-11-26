import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  afterEach,
  describe as suite,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import { stubEnv, unstubAllEnvs } from "@workspace/test/env";
import { generateSpecs } from "hono-openapi";
import { z } from "zod";
import {
  defaultErrorMessage,
  describer,
  errors,
  errorSchema,
  idParam,
  idParams,
  jsonErrorHandler,
  messageSchema,
  respond,
  respondMessage,
  summarise,
  validator,
} from "./http.js";

const userSchema = z.object({ id: z.number(), name: z.string() });

/** A route's answer, whatever it is, as a status plus a parsed JSON body. */
async function call(app: Hono, path: string, init?: RequestInit) {
  const res = await app.request(path, init);
  return { status: res.status, body: await res.json().catch(() => null) };
}

function appWithHandler() {
  const app = new Hono();
  app.onError(jsonErrorHandler);
  return app;
}

afterEach(() => {
  unstubAllEnvs();
  mock.restore();
});

suite("respond", () => {
  it("sends the payload with its status when it matches the schema", async () => {
    const app = appWithHandler();
    app.get("/", (c) => respond(c, userSchema, { id: 1, name: "Ada" }, 201));

    expect(await call(app, "/")).toEqual({
      status: 201,
      body: { id: 1, name: "Ada" },
    });
  });

  it("defaults to 200", async () => {
    const app = appWithHandler();
    app.get("/", (c) => respond(c, userSchema, { id: 1, name: "Ada" }));

    expect((await call(app, "/")).status).toBe(200);
  });

  it("fails outside production when the payload does not match", async () => {
    stubEnv("NODE_ENV", "test");
    spyOn(console, "error").mockImplementation(() => {});

    const app = appWithHandler();
    app.get("/", (c) =>
      // The route documents a user and answers with an acknowledgement — the
      // drift this check exists to catch.
      respond(c, userSchema, { message: "Updated" } as never)
    );

    const { status, body } = await call(app, "/");
    expect(status).toBe(500);
    expect(body).toEqual({ error: "Internal Server Error" });
  });

  it("names the route and the schema failure in the thrown error", async () => {
    stubEnv("NODE_ENV", "test");

    let thrown: Error | undefined;
    const app = new Hono();
    app.onError((err, c) => {
      thrown = err;
      return c.body(null, 500);
    });
    app.get("/users/1", (c) => respond(c, userSchema, { id: 1 } as never));

    await app.request("/users/1");

    expect(thrown?.message).toMatch(
      /^GET \/users\/1 response does not match its schema/
    );
    expect(thrown?.message).toContain("name");
  });

  it("skips the check in production", async () => {
    stubEnv("NODE_ENV", "production");

    const app = appWithHandler();
    app.get("/", (c) =>
      respond(c, userSchema, { message: "Updated" } as never)
    );

    expect(await call(app, "/")).toEqual({
      status: 200,
      body: { message: "Updated" },
    });
  });
});

suite("respondMessage", () => {
  it("answers in the shared message shape", async () => {
    const app = appWithHandler();
    app.delete("/", (c) => respondMessage(c, "Deleted"));

    const { status, body } = await call(app, "/", { method: "DELETE" });
    expect(status).toBe(200);
    expect(messageSchema.parse(body)).toEqual({ message: "Deleted" });
  });
});

suite("validator", () => {
  const bodySchema = z.object({
    name: z.string().min(1),
    tags: z.array(z.object({ label: z.string() })),
    note: z.string().max(3).optional(),
  });
  const app = appWithHandler();
  app.post("/", validator("json", bodySchema), (c) =>
    c.json(c.req.valid("json"))
  );
  app.get("/search", validator("query", z.object({ q: z.string() })), (c) =>
    c.json(c.req.valid("query"))
  );

  const post = (body: unknown) =>
    call(app, "/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("hands a valid body to the handler", async () => {
    const body = { name: "a", tags: [{ label: "x" }] };
    expect(await post(body)).toEqual({ status: 200, body });
  });

  it("answers an invalid body with the shared envelope and its issues", async () => {
    const { status, body } = await post({ name: "", tags: [{ label: 1 }] });

    expect(status).toBe(400);
    expect(errorSchema.parse(body)).toMatchObject({
      error: "Invalid request",
      code: "invalid_request",
    });
    expect(body).not.toHaveProperty("success");
    const { issues } = (body as { details: { issues: unknown[] } }).details;
    expect(issues).toEqual([
      { path: ["name"], message: expect.any(String), code: "too_small" },
      {
        path: ["tags", 0, "label"],
        message: expect.any(String),
        code: "invalid_type",
      },
    ]);
  });

  it("carries the maximum of a too_big issue and nothing else from it", async () => {
    const { body } = await post({ name: "a", tags: [], note: "abcd" });

    expect((body as { details: { issues: unknown[] } }).details.issues).toEqual(
      [
        {
          path: ["note"],
          message: expect.any(String),
          code: "too_big",
          maximum: 3,
        },
      ]
    );
  });

  it("answers an invalid query in the same envelope", async () => {
    const { status, body } = await call(app, "/search");

    expect(status).toBe(400);
    expect(body).toMatchObject({
      error: "Invalid request",
      code: "invalid_request",
      details: { issues: [{ path: ["q"], code: "invalid_type" }] },
    });
  });

  it("keeps the request schema in the OpenAPI document", async () => {
    const { paths } = await generateSpecs(app);

    expect(paths?.["/"]?.post).toMatchObject({
      requestBody: {
        content: {
          "application/json": {
            schema: { properties: { name: { type: "string" } } },
          },
        },
      },
    });
    expect(paths?.["/search"]?.get?.parameters).toMatchObject([
      { name: "q", in: "query", required: true },
    ]);
  });
});

suite("idParam", () => {
  const app = appWithHandler();
  app.get("/:id", idParam(), (c) =>
    c.json({ id: c.req.valid("param" as never) })
  );
  app.get("/:id/relations/:relationId", idParams("id", "relationId"), (c) =>
    c.json(c.req.valid("param"))
  );

  it("coerces a valid id to a number", async () => {
    const { status, body } = await call(app, "/42");
    expect(status).toBe(200);
    expect(body).toEqual({ id: { id: 42 } });
  });

  it("validates every named parameter at once", async () => {
    expect(await call(app, "/7/relations/9")).toEqual({
      status: 200,
      body: { id: 7, relationId: 9 },
    });
  });

  it.each(["/abc", "/0", "/-3", "/1.5"])(
    "rejects %s with a 400 in the envelope",
    async (path) => {
      const { status, body } = await call(app, path);
      expect(status).toBe(400);
      expect(errorSchema.parse(body).error).toMatch(/Invalid path parameter/);
    }
  );

  it("rejects a bad second parameter too", async () => {
    const { status } = await call(app, "/7/relations/abc");
    expect(status).toBe(400);
  });
});

suite("errors", () => {
  it("gives every code a JSON body in the shared envelope", () => {
    const documented = errors(400, 404);

    expect(Object.keys(documented)).toEqual(["400", "404"]);
    for (const code of ["400", "404"] as const) {
      expect(documented[code]).toMatchObject({
        description: expect.any(String),
        content: { "application/json": { schema: expect.anything() } },
      });
    }
  });

  it("is empty when a route documents no failures", () => {
    expect(errors()).toEqual({});
  });
});

suite("summarise", () => {
  it("summarises by the first sentence and keeps the whole description", () => {
    expect(
      summarise("Delete a project. Its files go with it. Owners only.")
    ).toEqual({
      summary: "Delete a project",
      description: "Delete a project. Its files go with it. Owners only.",
    });
  });

  it("ends the first sentence at a colon or a semicolon too", () => {
    expect(summarise("Storage across the instance: used, capped.")).toEqual({
      summary: "Storage across the instance",
      description: "Storage across the instance: used, capped.",
    });
    expect(summarise("One measurement; lazily served").summary).toBe(
      "One measurement"
    );
  });

  it("leaves out a description that says nothing past the summary", () => {
    expect(summarise("Delete a project.")).toEqual({
      summary: "Delete a project",
    });
    expect(summarise("Get a project")).toEqual({ summary: "Get a project" });
  });

  it("does not end a sentence at a stop inside a word or a path", () => {
    expect(summarise("Read `v1.d.ts` from disk").summary).toBe(
      "Read `v1.d.ts` from disk"
    );
  });
});

suite("describer", () => {
  it("registers the success body and the error envelope on the route", async () => {
    const { describe } = describer("Users");
    const app = appWithHandler();
    app.get(
      "/",
      describe("A user", { schema: userSchema, description: "The user" }, 404),
      (c) => respond(c, userSchema, { id: 1, name: "Ada" })
    );

    // The middleware only annotates; the route still answers normally.
    expect(await call(app, "/")).toEqual({
      status: 200,
      body: { id: 1, name: "Ada" },
    });
  });

  it("tags and summarises every operation it describes", async () => {
    const { describe, describeRaw, route } = describer("Users");
    const app = new Hono();
    app.get(
      "/users/:id",
      describe(
        "Get a user. Signed-in callers only.",
        { schema: userSchema },
        404
      ),
      (c) => c.body(null)
    );
    app.get(
      "/users/:id/avatar",
      describeRaw("Stream a user's avatar.", { description: "The image" }),
      (c) => c.body(null)
    );
    app.get(
      "/users/:id/ping",
      route({ description: "Ping a user", responses: {} }),
      (c) => c.body(null)
    );

    const { paths } = await generateSpecs(app);

    expect(paths?.["/users/{id}"]?.get).toMatchObject({
      tags: ["Users"],
      summary: "Get a user",
      description: "Get a user. Signed-in callers only.",
    });
    expect(paths?.["/users/{id}/avatar"]?.get).toMatchObject({
      tags: ["Users"],
      summary: "Stream a user's avatar",
    });
    expect(paths?.["/users/{id}/avatar"]?.get).not.toHaveProperty(
      "description"
    );
    expect(paths?.["/users/{id}/ping"]?.get).toMatchObject({
      tags: ["Users"],
      summary: "Ping a user",
    });
  });
});

suite("jsonErrorHandler", () => {
  it("renders an HTTPException message as the envelope's error", async () => {
    spyOn(console, "warn").mockImplementation(() => {});

    const app = appWithHandler();
    app.get("/", () => {
      throw new HTTPException(404, { message: "Track not found" });
    });

    expect(await call(app, "/")).toEqual({
      status: 404,
      body: { error: "Track not found" },
    });
  });

  it("falls back to the status' description when the exception carries no message", async () => {
    spyOn(console, "warn").mockImplementation(() => {});

    const app = appWithHandler();
    app.get("/", () => {
      throw new HTTPException(401);
    });

    expect(await call(app, "/")).toEqual({
      status: 401,
      body: { error: defaultErrorMessage(401) },
    });
  });

  it("keeps a response the exception supplied itself", async () => {
    spyOn(console, "warn").mockImplementation(() => {});

    const app = appWithHandler();
    app.get("/", () => {
      throw new HTTPException(429, {
        res: new Response("slow down", { status: 429 }),
      });
    });

    const res = await app.request("/");
    expect(res.status).toBe(429);
    expect(await res.text()).toBe("slow down");
  });

  it("hides an unexpected failure behind a 500 in the envelope", async () => {
    spyOn(console, "error").mockImplementation(() => {});

    const app = appWithHandler();
    app.get("/", () => {
      throw new Error("connection terminated unexpectedly");
    });

    const { status, body } = await call(app, "/");
    expect(status).toBe(500);
    expect(body).toEqual({ error: "Internal Server Error" });
    expect(errorSchema.safeParse(body).success).toBe(true);
  });
});
