import { describe, expect, it } from "bun:test";
import type { Status } from "@workspace/api/api";
import type { ResolverOptions } from "react-hook-form";

import type { FieldSpec } from "./EntityForm";
import { fieldKindResolver } from "./field-resolver";

type Draft = { title: string };

const fields: FieldSpec<Draft>[] = [
  { name: "title", type: "title", label: "Title" },
];

const options = {
  fields: {},
  shouldUseNativeValidation: false,
} as unknown as ResolverOptions<Draft>;

describe("fieldKindResolver", () => {
  it("refuses a blank or whitespace title with Required", async () => {
    const result = await fieldKindResolver(fields)(
      { title: "   " },
      undefined,
      options
    );

    expect(result.errors.title?.message).toBe("Required");
  });

  it("passes a title through the text kind, trimmed", async () => {
    const result = await fieldKindResolver<Draft, Draft>(fields)(
      { title: "  Song  " },
      undefined,
      options
    );

    expect(result.errors).toEqual({});
    expect(result.values).toEqual({ title: "Song" });
  });

  it("awaits a status spec's statuses promise and accepts a listed id", async () => {
    type StatusDraft = { statusId: string };
    type StatusParsed = { statusId: number };
    const mixing: Status = {
      id: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      name: "Mixing",
      percentage: 40,
      description: null,
      // eslint-disable-next-line no-restricted-syntax -- a status's own colourHex, not a class name
      colourHex: "#336699",
      projectId: null,
    };
    const statusFields: FieldSpec<StatusDraft>[] = [
      {
        kind: "field-kind",
        name: "statusId",
        field: "status",
        label: "Status",
        statuses: Promise.resolve([mixing]),
      },
    ];
    const statusOptions = options as unknown as ResolverOptions<StatusDraft>;

    const result = await fieldKindResolver<StatusDraft, StatusParsed>(
      statusFields
    )({ statusId: "1" }, undefined, statusOptions);

    expect(result.errors).toEqual({});
    expect(result.values).toEqual({ statusId: 1 });
  });

  it("rejects an id not in the resolved statuses list", async () => {
    type StatusDraft = { statusId: string };
    const statusFields: FieldSpec<StatusDraft>[] = [
      {
        kind: "field-kind",
        name: "statusId",
        field: "status",
        label: "Status",
        statuses: Promise.resolve([]),
      },
    ];
    const statusOptions = options as unknown as ResolverOptions<StatusDraft>;

    const result = await fieldKindResolver<StatusDraft, StatusDraft>(
      statusFields
    )({ statusId: "1" }, undefined, statusOptions);

    expect(result.errors.statusId?.message).toBe("Not a status");
  });

  it("nests a custom spec's validate errors by field path", async () => {
    type LinksDraft = { links: { name: string; url: string }[] };
    const linksFields: FieldSpec<LinksDraft>[] = [
      {
        kind: "custom",
        key: "links",
        render: () => null,
        validate: (value) => {
          const links = value as { name: string; url: string }[];
          const errors: Record<string, string> = {};
          links.forEach((link, index) => {
            if (!link.name) errors[`links.${index}.name`] = "Name this link";
          });
          return errors;
        },
      },
    ];
    const linksOptions = options as unknown as ResolverOptions<LinksDraft>;

    const result = await fieldKindResolver<LinksDraft, LinksDraft>(linksFields)(
      { links: [{ name: "", url: "https://example.com" }] },
      undefined,
      linksOptions
    );

    expect(result.errors.links?.[0]?.name?.message).toBe("Name this link");
  });
});
