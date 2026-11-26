import { describe, expect, it } from "bun:test";
import { sampleFileName, sampleFolder } from "./sample-path";

describe("sample paths", () => {
  it.each([
    [
      "/Users/demo/Samples/Kicks/Invented Kick 01.wav",
      "Invented Kick 01.wav",
      "/Users/demo/Samples/Kicks",
    ],
    ["D:\\Samples\\Pads\\Glass Pad.aif", "Glass Pad.aif", "D:\\Samples\\Pads"],
    [
      "Samples/Imported/Mixed\\Snare.wav",
      "Snare.wav",
      "Samples/Imported/Mixed",
    ],
    ["Loose Loop.wav", "Loose Loop.wav", ""],
  ])("splits %s", (path, name, folder) => {
    expect(sampleFileName(path)).toBe(name);
    expect(sampleFolder(path)).toBe(folder);
  });

  it("keeps a path with a trailing separator whole as its name", () => {
    expect(sampleFileName("/Users/demo/")).toBe("/Users/demo/");
  });
});
