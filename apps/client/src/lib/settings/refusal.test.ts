import { beforeEach, describe, expect, it, mock } from "bun:test";

const error = mock();
mock.module("sonner", () => ({ toast: { error } }));

const { toastRefusedWrite } = await import("./refusal");

const idOf = (call: number): unknown => error.mock.calls[call]?.[1]?.id;

describe("toastRefusedWrite", () => {
  beforeEach(() => error.mockClear());

  it("uses one toast id for every caller of the same refusal", () => {
    const failure = new Error("nope");
    toastRefusedWrite(failure);
    toastRefusedWrite(failure);
    toastRefusedWrite(failure);
    expect(error).toHaveBeenCalledTimes(3);
    expect(idOf(0)).toBeString();
    expect(idOf(1)).toBe(idOf(0));
    expect(idOf(2)).toBe(idOf(0));
  });

  it("gives different refusals different ids", () => {
    toastRefusedWrite(new Error("a"));
    toastRefusedWrite(new Error("a"));
    expect(idOf(1)).not.toBe(idOf(0));
  });

  it("does not throw on a string failure and falls back to the generic message", () => {
    expect(() => toastRefusedWrite("boom")).not.toThrow();
    expect(error.mock.calls[0]?.[0]).toBe("Couldn't save the setting");
    toastRefusedWrite("boom");
    expect(idOf(1)).not.toBe(idOf(0));
  });
});
