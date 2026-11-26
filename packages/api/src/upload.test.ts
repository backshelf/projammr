import { IMAGE_TYPES } from "@workspace/settings/groups/instance-limits";
import { describe, expect, it } from "bun:test";
import { IMAGE_ACCEPT } from "./upload";

describe("IMAGE_ACCEPT", () => {
  it("equals IMAGE_TYPES.join(',')", () => {
    expect(IMAGE_ACCEPT).toBe(IMAGE_TYPES.join(","));
  });
});
