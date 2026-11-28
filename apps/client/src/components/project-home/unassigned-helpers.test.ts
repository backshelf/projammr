import { describe, expect, it } from "bun:test";
import { cleanSetTitle, suggestTrackMatch } from "./unassigned-helpers";

describe("cleanSetTitle", () => {
  it("strips DAW extensions, Project suffix, and version tags", () => {
    expect(cleanSetTitle("want_you_gone_v3.als")).toBe("want you gone");
    expect(cleanSetTitle("Canopy Project")).toBe("Canopy");
    expect(cleanSetTitle("motions-v12-final.als")).toBe("motions");
    expect(cleanSetTitle("night-drive_mix2.rpp")).toBe("night-drive");
  });

  it("falls back to original name when stripping would leave empty", () => {
    expect(cleanSetTitle(".als")).toBe(".als");
  });
});

describe("suggestTrackMatch", () => {
  const tracks = [
    { id: 1, title: "Want You Gone" },
    { id: 2, title: "Midnight Drive" },
    { id: 3, title: "Canopy Outro" },
  ];

  it("hoists the strongest fuzzy match above threshold", () => {
    expect(suggestTrackMatch("want_you_gone_v4.als", tracks)?.id).toBe(1);
    expect(suggestTrackMatch("canopy-outro-mix.als", tracks)?.id).toBe(3);
  });

  it("returns null when no track is close enough", () => {
    expect(suggestTrackMatch("completely_unrelated_99.als", tracks)).toBeNull();
  });
});
