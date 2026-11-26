import { describe, expect, it } from "bun:test";
import { defaultFormatters } from "@workspace/ui/lib/formatters";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsStorage } from "./SettingsStorage";

const format = defaultFormatters("UTC");

const report = (
  usedBytes: number,
  limitBytes: number | null,
  repositoryBytes = 0
) => ({
  scopeKind: "project" as const,
  scopeId: "7",
  usedBytes,
  limitBytes,
  repositoryBytes,
});

describe("SettingsStorage", () => {
  it("reads used of cap over a meter when the instance caps a project", () => {
    const html = renderToStaticMarkup(
      <SettingsStorage
        storage={report(25 * 1024 ** 3, 50 * 1024 ** 3)}
        format={format}
      />
    );

    // The readout itself, not the meter's hover title.
    expect(html).toContain(">25 GB of 50 GB<");
    expect(html).toContain('aria-valuenow="50"');
  });

  it("reads the figure alone, with no meter, when nothing caps the project", () => {
    const html = renderToStaticMarkup(
      <SettingsStorage storage={report(1_500_000_000, null)} format={format} />
    );

    expect(html).toContain(">1.4 GB used<");
    expect(html).not.toContain("progressbar");
  });

  it("adds the repositories figure only where repo objects are charged", () => {
    const withRepos = renderToStaticMarkup(
      <SettingsStorage
        storage={report(2 * 1024 ** 3, null, 1_500_000_000)}
        format={format}
      />
    );
    expect(withRepos).toContain("Repositories 1.4 GB");

    const without = renderToStaticMarkup(
      <SettingsStorage storage={report(1024, null)} format={format} />
    );
    expect(without).not.toContain("Repositories");
  });
});
