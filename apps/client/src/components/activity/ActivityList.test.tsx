import type { Activity } from "@workspace/api/api";
import { defaultFormatters } from "@workspace/ui/lib/formatters";
import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LOW, NONE, SEEDED_SCALE, URGENT } from "@/fields/priority-fixture";
import { customField } from "@/fields/custom-field-fixture";

import { ActivityList, type ActivityVocabularies } from "./ActivityList";

const row = (overrides: Partial<Activity>): Activity => ({
  id: 1,
  createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  projectId: 1,
  entityType: "track",
  entityId: 7,
  userId: "u1",
  action: "created",
  changes: null,
  commentId: null,
  user: null,
  entityName: "Intro",
  comment: null,
  ...overrides,
});

const format = defaultFormatters("UTC");

const render = (rows: Activity[], vocabularies?: ActivityVocabularies) =>
  renderToStaticMarkup(
    <ActivityList rows={rows} format={format} vocabularies={vocabularies} />
  );

const VOCABULARIES: ActivityVocabularies = {
  statuses: [
    { id: 3, name: "Writing" },
    { id: 4, name: "Mixing" },
  ],
  priorityLevels: SEEDED_SCALE,
};

const change = (field: string, from: unknown, to: unknown) =>
  row({
    action: "updated",
    changes: {
      [field]: { from, to },
      // A second field, so the row prints each change with its field name.
      bpm: { from: 120, to: 124 },
    },
  });

describe("ActivityList", () => {
  it("shows an update row's before → after", () => {
    const html = render([
      row({
        action: "updated",
        changes: { bpm: { from: 120, to: 124 } },
      }),
    ]);
    expect(html).toContain("Someone updated track Intro");
    expect(html).toMatch(/bpm: <span[^>]*>120<\/span> → <span[^>]*>124/);
  });

  it("prints a lone status change as a bare, named transition", () => {
    const html = render(
      [
        row({
          action: "updated",
          changes: { statusId: { from: 3, to: 4 } },
        }),
      ],
      VOCABULARIES
    );
    expect(html).toMatch(/<span[^>]*>Writing<\/span> →[^<]*<span[^>]*>Mixing/);
    expect(html).not.toContain("Status:");
    expect(html).not.toContain("statusId");
  });

  it("shows a comment row's excerpt and its position", () => {
    const html = render([
      row({
        action: "commented",
        comment: { excerpt: "Too quiet here", positionMs: 112_000 },
      }),
    ]);
    expect(html).toContain("Too quiet here");
    expect(html).toContain("commented on track Intro at 1:52");
  });

  it("names the priority levels a priority change moved between", () => {
    const html = render(
      [change("priorityId", LOW.id, URGENT.id)],
      VOCABULARIES
    );
    expect(html).toMatch(
      /Priority: <span[^>]*>Low<\/span> → <span[^>]*>Urgent/
    );
    expect(html).not.toContain("priorityId");
    expect(html).not.toContain(`>${LOW.id}<`);
  });

  it("names the statuses a status change moved between", () => {
    const html = render([change("statusId", 3, 4)], VOCABULARIES);
    expect(html).toMatch(
      /Status: <span[^>]*>Writing<\/span> → <span[^>]*>Mixing/
    );
  });

  it("prints the id of a level the scale no longer has", () => {
    const html = render([change("priorityId", 99, NONE.id)], VOCABULARIES);
    expect(html).toMatch(/Priority: <span[^>]*>99<\/span> → <span[^>]*>None/);
  });

  it("prints ids as they are when no vocabulary is at hand", () => {
    const html = render([change("priorityId", LOW.id, URGENT.id)]);
    expect(html).toMatch(
      new RegExp(
        `Priority: <span[^>]*>${LOW.id}</span> → <span[^>]*>${URGENT.id}`
      )
    );
  });

  it("names nothing but the vocabulary's own field", () => {
    const html = render(
      [change("trackNumber", LOW.id, URGENT.id)],
      VOCABULARIES
    );
    expect(html).not.toContain("Low");
    expect(html).toContain(`>${URGENT.id}<`);
  });

  describe("a custom field's change", () => {
    const fields: ActivityVocabularies = {
      customFields: [
        customField(1, "Mood", "select", [
          { id: "a1", label: "Dark" },
          { id: "b2", label: "Mellow" },
        ]),
        customField(4, "Cleared", "checkbox"),
        customField(2, "Energy", "number"),
      ],
    };

    it("reads under the field's name, a select's values by their labels", () => {
      const html = render([change("cf_1", "a1", "b2")], fields);
      expect(html).toMatch(/Mood: <span[^>]*>Dark<\/span> → <span[^>]*>Mellow/);
      expect(html).not.toContain("cf_1");
    });

    it("reads a box as Yes or No, and a cleared value as a dash", () => {
      const html = render(
        [change("cf_4", false, true), change("cf_2", 7, null)],
        fields
      );
      expect(html).toMatch(/Cleared: <span[^>]*>No<\/span> → <span[^>]*>Yes/);
      expect(html).toMatch(/Energy: <span[^>]*>7<\/span> → <span[^>]*>—/);
    });

    it("keeps the key and raw values of a field deleted since", () => {
      const html = render([change("cf_9", "x", "y")], fields);
      expect(html).toMatch(/cf_9: <span[^>]*>x<\/span> → <span[^>]*>y/);
    });
  });

  it("shows every row's relative time", () => {
    const rows = [
      row({ id: 1 }),
      row({
        id: 2,
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      }),
    ];
    const html = render(rows);
    for (const r of rows) {
      expect(html).toContain(format.relative(r.createdAt));
    }
    expect(html.match(/<li/g)).toHaveLength(2);
  });
});
