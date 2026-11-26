import { describe, expect, it } from "bun:test";
import type { AdminStorage } from "@workspace/api/api";
import { defaultFormatters } from "@workspace/ui/lib/formatters";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminStorageSection, sharingLine } from "./AdminStorageSection";

const format = defaultFormatters("UTC");

const storage = (
  sharing: AdminStorage["sharing"],
  repositoryBytes: number
): AdminStorage => ({
  usedBytes: 4 * 1024 ** 3,
  projects: [
    {
      scopeKind: "project",
      scopeId: "1",
      name: "science",
      usedBytes: 3 * 1024 ** 3,
      limitBytes: null,
      repositoryBytes,
    },
  ],
  users: [],
  sharing,
  lastAudit: null,
  lastSweep: null,
});

describe("AdminStorageSection", () => {
  it("writes the sharing line with a singular and a plural project", () => {
    expect(sharingLine({ projects: 1, savedBytes: 1024 ** 3 }, format)).toBe(
      "Samples stored once · shared by 1 project · 1 GB saved"
    );
    expect(
      sharingLine({ projects: 3, savedBytes: 1024 ** 3 }, format)
    ).toContain("shared by 3 projects");
  });

  it("shows a project's repositories figure and the sharing line when there is something to say", () => {
    const html = renderToStaticMarkup(
      <AdminStorageSection
        storage={storage({ projects: 2, savedBytes: 1024 ** 3 }, 2 * 1024 ** 3)}
        format={format}
      />
    );
    expect(html).toContain("Repositories 2 GB");
    expect(html).toContain("Samples stored once · shared by 2 projects");
  });

  it("stays quiet about repositories and sharing when neither exists", () => {
    const html = renderToStaticMarkup(
      <AdminStorageSection
        storage={storage({ projects: 0, savedBytes: 0 }, 0)}
        format={format}
      />
    );
    expect(html).not.toContain("Repositories");
    expect(html).not.toContain("Stored once");
  });
});
