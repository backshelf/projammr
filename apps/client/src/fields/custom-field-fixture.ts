import type { CustomField } from "@workspace/api/api";

/** A project's custom field for a test, a track's unless `kind` says otherwise. */
export function customField(
  id: number,
  name: string,
  type: CustomField["type"],
  options: CustomField["options"] = [],
  kind: CustomField["kind"] = "track"
): CustomField {
  return {
    id,
    projectId: 1,
    kind,
    name,
    type,
    options,
    rank: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    valueCount: 0,
  };
}
