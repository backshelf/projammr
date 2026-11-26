import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  jest,
} from "bun:test";
import { stubGlobal, unstubAllGlobals } from "@workspace/test/globals";

import { longPressHandlers, type LongPressPoint } from "./use-long-press";

const touch = (x: number, y: number): LongPressPoint => ({
  pointerType: "touch",
  clientX: x,
  clientY: y,
});

describe("longPressHandlers", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    unstubAllGlobals();
  });

  it("fires once the press outlasts the delay", () => {
    const onLongPress = mock();
    const handlers = longPressHandlers(onLongPress, { ms: 450 });

    handlers.onPointerDown(touch(0, 0));
    jest.advanceTimersByTime(449);
    expect(onLongPress).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("is cancelled by movement beyond the slop", () => {
    const onLongPress = mock();
    const handlers = longPressHandlers(onLongPress, { ms: 450, slop: 8 });

    handlers.onPointerDown(touch(0, 0));
    handlers.onPointerMove(touch(5, 5));
    jest.advanceTimersByTime(450);
    expect(onLongPress).toHaveBeenCalledTimes(1);

    onLongPress.mockClear();
    handlers.onPointerDown(touch(0, 0));
    handlers.onPointerMove(touch(0, 20));
    jest.advanceTimersByTime(450);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("is cancelled when the finger lifts first", () => {
    const onLongPress = mock();
    const handlers = longPressHandlers(onLongPress);

    handlers.onPointerDown(touch(0, 0));
    jest.advanceTimersByTime(200);
    handlers.onPointerUp();
    jest.advanceTimersByTime(450);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("swallows the click the finger leaves behind, and only that one", () => {
    const handlers = longPressHandlers(mock());
    const click = () => {
      const event = { preventDefault: mock(), stopPropagation: mock() };
      handlers.onClickCapture(event);
      return event.preventDefault.mock.calls.length;
    };

    handlers.onPointerDown(touch(0, 0));
    jest.advanceTimersByTime(450);
    expect(click()).toBe(1);
    expect(click()).toBe(0);

    handlers.onPointerDown(touch(0, 0));
    handlers.onPointerUp();
    expect(click()).toBe(0);
  });

  it("ignores a mouse, which has the right-click menu instead", () => {
    const onLongPress = mock();
    const handlers = longPressHandlers(onLongPress);

    handlers.onPointerDown({ pointerType: "mouse", clientX: 0, clientY: 0 });
    jest.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("is pressing from the moment the finger lands until the press fires", () => {
    const pressing: boolean[] = [];
    const handlers = longPressHandlers(mock(), {
      ms: 450,
      onPressingChange: (next) => pressing.push(next),
    });

    handlers.onPointerDown(touch(0, 0));
    expect(pressing).toEqual([true]);

    jest.advanceTimersByTime(450);
    expect(pressing).toEqual([true, false]);
  });

  it("stops pressing when the finger lifts or drifts off", () => {
    const pressing: boolean[] = [];
    const handlers = longPressHandlers(mock(), {
      ms: 450,
      slop: 8,
      onPressingChange: (next) => pressing.push(next),
    });

    handlers.onPointerDown(touch(0, 0));
    handlers.onPointerUp();
    expect(pressing).toEqual([true, false]);

    handlers.onPointerDown(touch(0, 0));
    handlers.onPointerMove(touch(0, 20));
    expect(pressing).toEqual([true, false, true, false]);
  });

  it("is never pressing under a mouse, which cannot long-press", () => {
    const pressing: boolean[] = [];
    const handlers = longPressHandlers(mock(), {
      onPressingChange: (next) => pressing.push(next),
    });

    handlers.onPointerDown({ pointerType: "mouse", clientX: 0, clientY: 0 });
    jest.advanceTimersByTime(1000);

    expect(pressing).toEqual([]);
  });

  it("clears the text the finger selected before the press fires", () => {
    const order: string[] = [];
    const removeAllRanges = mock(() => order.push("cleared"));
    stubGlobal("window", { getSelection: () => ({ removeAllRanges }) });
    const handlers = longPressHandlers(() => order.push("pressed"));

    handlers.onPointerDown(touch(0, 0));
    jest.advanceTimersByTime(450);

    expect(order).toEqual(["cleared", "pressed"]);
  });
});
