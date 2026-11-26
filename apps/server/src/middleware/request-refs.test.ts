import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { jsonErrorHandler } from "../lib/http.js";
import { numberOf, positiveInt, requireProjectInBody } from "./request-refs.js";

describe("positiveInt", () => {
  it("accepts positive safe integer strings", () => {
    expect(positiveInt("1")).toBe(1);
    expect(positiveInt("42")).toBe(42);
    expect(positiveInt(String(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER
    );
  });

  it("rejects empty, non-positive, fractional, non-finite, and unsafe values", () => {
    for (const bad of [
      undefined,
      "",
      "   ",
      "0",
      "-1",
      "1.5",
      "Infinity",
      "NaN",
      "1e2",
      " 42 ",
      "abc",
      "9007199254740993",
    ]) {
      expect(positiveInt(bad)).toBeNull();
    }
  });
});

describe("numberOf", () => {
  it("accepts positive safe integers and positive integer strings", () => {
    expect(numberOf(1)).toBe(1);
    expect(numberOf(42)).toBe(42);
    expect(numberOf("42")).toBe(42);
    expect(numberOf(" 7 ")).toBe(7);
  });

  it("rejects empty strings, floats, non-positive, non-finite, booleans, and unsafe integers", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "   ",
      0,
      "0",
      -1,
      "-1",
      1.5,
      "1.5",
      Infinity,
      -Infinity,
      "Infinity",
      NaN,
      "NaN",
      Number.MAX_SAFE_INTEGER + 1,
      "9007199254740993",
      true,
      false,
      [],
      {},
    ]) {
      expect(numberOf(bad)).toBeNull();
    }
  });
});

describe("requireProjectInBody", () => {
  const app = new Hono();
  app.post("/items", async (c) => {
    const scope = await requireProjectInBody(c);
    return c.json(scope);
  });
  app.onError(jsonErrorHandler);

  it("returns project scope for a valid positive integer projectId", async () => {
    const res = await app.request("/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: 7 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: "project", id: 7 });
  });

  it.each(["", 0, -1, 1.5, "1.5", "Infinity", null, true])(
    "returns 400 for invalid projectId %p",
    async (projectId) => {
      const res = await app.request("/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      expect(res.status).toBe(400);
    }
  );
});
