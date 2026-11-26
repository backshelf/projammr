import { describe, expect, it } from "bun:test";
import { rampParam } from "./audio-output";

/** An AudioParam that records its automation, with a `value` that lags it. */
function recordingParam(value: number) {
  const events: [string, number, number?][] = [];
  const param = {
    value,
    cancelScheduledValues: (at: number) => events.push(["cancel", at]),
    setValueAtTime: (v: number, at: number) => events.push(["set", v, at]),
    linearRampToValueAtTime: (v: number, at: number) =>
      events.push(["ramp", v, at]),
  } as unknown as AudioParam;
  return { param, events };
}

const ctx = { currentTime: 10 } as BaseAudioContext;

describe("rampParam", () => {
  it("ramps from the param's current value by default", () => {
    const { param, events } = recordingParam(0.5);
    rampParam(ctx, param, 1, 2);
    expect(events).toEqual([
      ["cancel", 10],
      ["set", 0.5, 10],
      ["ramp", 1, 12],
    ]);
  });

  it("ramps from `from` when a value was scheduled at the same instant", () => {
    // The node still reads 1: a silent start set at this instant is not in
    // `value` yet, so the fade-in must start from the 0 the caller knows.
    const { param, events } = recordingParam(1);
    rampParam(ctx, param, 0, 0);
    rampParam(ctx, param, 1, 3, 0);
    expect(events.slice(3)).toEqual([
      ["cancel", 10],
      ["set", 0, 10],
      ["ramp", 1, 13],
    ]);
  });
});
