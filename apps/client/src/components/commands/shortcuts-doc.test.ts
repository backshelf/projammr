import { describe, expect, it, mock } from "bun:test";
import { join } from "node:path";

import type { Command } from "@/components/commands/types";
import { parseCombo } from "@workspace/ui/lib/keymap";

// `TRACK_COMMANDS` imports server actions that load `server-only`; `mock.module`
// is not hoisted, so it runs before the dynamic import below.
mock.module("server-only", () => ({}));

const { COMMANDS } = await import("@/components/commands/index");

// The web docs cannot import the client's registry, so the guide's shortcut
// tables are kept by hand and this suite is what fails when they drift.
const root = join(import.meta.dir, "..", "..", "..", "..", "..");
const GUIDE = "apps/web/src/content/docs/docs/guide/search-and-shortcuts.mdx";
const SECTION = "Keyboard shortcuts";

const MODIFIERS: Record<string, string> = {
  Ctrl: "mod",
  "⌘": "mod",
  Shift: "shift",
  "⇧": "shift",
  Alt: "alt",
  "⌥": "alt",
};

const NAMED_KEYS: Record<string, string> = {
  Space: "space",
  "↵": "Enter",
  Esc: "Escape",
  "←": "ArrowLeft",
  "→": "ArrowRight",
  "↑": "ArrowUp",
  "↓": "ArrowDown",
};

const RANGE = "–";

// The characters MDX would read as markup or an expression, spelled as
// entities in the guide.
const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&lbrace;": "{",
  "&rbrace;": "}",
  "&amp;": "&",
};

function decodeEntities(text: string): string {
  return text.replace(/&[a-z]+;/g, (entity) => ENTITIES[entity] ?? entity);
}

/** The `<kbd>` keys of one alternative, split on the cell's ` / `; text
 *  inside `( )` (the Mac spelling) is dropped. */
function cellAlternatives(cell: string): string[][] {
  const alternatives: string[][] = [[]];
  let depth = 0;
  for (const [, key, text] of cell.matchAll(/<kbd>(.*?)<\/kbd>|([^<]+)/g)) {
    if (key !== undefined) {
      if (depth === 0) alternatives.at(-1)?.push(decodeEntities(key));
      continue;
    }
    const parts = (text ?? "").split("/");
    parts.forEach((part, index) => {
      if (index > 0 && depth === 0) alternatives.push([]);
      for (const char of part) {
        if (char === "(") depth += 1;
        else if (char === ")") depth -= 1;
        else if (depth === 0 && char === RANGE)
          alternatives.at(-1)?.push(RANGE);
      }
      const prose = part
        .replace(/[()]/g, "")
        .replace(RANGE, "")
        .replace(/\bwith\b/, "")
        .trim();
      if (prose !== "" && depth === 0) {
        throw new Error(`Unreadable text "${prose}" in key cell: ${cell}`);
      }
    });
  }
  return alternatives;
}

/** One cell's keys as grammar combos: `Ctrl K (⌘ K)` is `mod+k`, `G P` the
 *  chord `g p`, `Shift with ← / →` both shifted arrows, `0–9` ten digits. */
function combosOfCell(cell: string): string[] {
  const combos: string[] = [];
  let carried: string[] = [];
  for (const written of cellAlternatives(cell)) {
    // A modifier leading an alternative also holds for the ones after it in
    // the cell: `Shift with ← / →` is both shifted arrows.
    const lead = written.findIndex((key) => !(key in MODIFIERS));
    const leading = lead === -1 ? written : written.slice(0, lead);
    if (leading.length > 0) {
      carried = leading.map((key) => MODIFIERS[key] as string);
    }
    const alternative = written.slice(leading.length);
    if (alternative.length === 0) continue;
    const rangeAt = alternative.indexOf(RANGE);
    if (rangeAt > 0) {
      const from = Number(alternative[rangeAt - 1]);
      const to = Number(alternative[rangeAt + 1]);
      for (let digit = from; digit <= to; digit += 1) {
        combos.push(String(digit));
      }
      continue;
    }
    const presses: string[] = [];
    let held: string[] = [...carried];
    for (const key of alternative) {
      const modifier = MODIFIERS[key];
      if (modifier !== undefined) {
        held.push(modifier);
        continue;
      }
      const named =
        NAMED_KEYS[key] ?? (key.length === 1 ? key.toLowerCase() : key);
      const press = parseCombo([...held, named].join("+"));
      if (press === null)
        throw new Error(`Unreadable key "${key}" in: ${cell}`);
      presses.push(press);
      held = [...carried];
    }
    combos.push(presses.join(" "));
  }
  return combos;
}

/** The keys each `###` section of the guide's shortcuts lists, by heading. */
function guideKeys(guide: string): Map<string, Set<string>> {
  const lines = guide.split("\n");
  const start = lines.indexOf(`## ${SECTION}`);
  if (start === -1) throw new Error(`The guide has no "${SECTION}" section`);
  const sections = new Map<string, Set<string>>();
  let keys: Set<string> | null = null;
  let table: string[] = [];
  const endTable = () => {
    // A table's first two lines are its header and delimiter row.
    for (const row of table.slice(2)) {
      const cell = row.split("|")[1] ?? "";
      for (const combo of combosOfCell(cell)) keys?.add(combo);
    }
    table = [];
  };
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("|")) {
      table.push(line);
      continue;
    }
    endTable();
    if (line.startsWith("## ")) break;
    if (line.startsWith("### ")) {
      keys = new Set();
      sections.set(line.slice(4).trim(), keys);
    }
  }
  endTable();
  return sections;
}

type Keyed = {
  id: Command["id"];
  group: string;
  keys?: Command["keys"];
};

/** What is out of step between the guide and the commands: a keyed command
 *  whose key its group's section does not list, and a listed key that none
 *  of the group's commands has. */
function drift(guide: string, commands: readonly Keyed[]): string[] {
  const sections = guideKeys(guide);
  const problems: string[] = [];
  const registry = new Map<string, Set<string>>();

  for (const { id, group, keys } of commands) {
    if (!keys || keys.length === 0) continue;
    const registered = registry.get(group) ?? new Set<string>();
    registry.set(group, registered);
    const listed = sections.get(group);
    for (const key of keys) {
      registered.add(key);
      if (listed === undefined) {
        problems.push(
          `${id}: the guide has no "### ${group}" section for its key "${key}"`
        );
      } else if (!listed.has(key)) {
        problems.push(
          `${id}: key "${key}" is not listed under "### ${group}" in the guide`
        );
      }
    }
  }

  for (const [group, listed] of sections) {
    const registered = registry.get(group);
    if (registered === undefined) {
      problems.push(`"### ${group}" in the guide is not a command group`);
      continue;
    }
    for (const key of listed) {
      if (!registered.has(key)) {
        problems.push(
          `"### ${group}" lists key "${key}", which no ${group} command has`
        );
      }
    }
  }
  return problems;
}

describe("combosOfCell", () => {
  it("reads Ctrl and the Mac spelling as one mod combo", () => {
    expect(
      combosOfCell("<kbd>Ctrl</kbd> <kbd>K</kbd> (<kbd>⌘</kbd> <kbd>K</kbd>)")
    ).toEqual(["mod+k"]);
  });

  it("reads consecutive keys as a chord", () => {
    expect(combosOfCell("<kbd>G</kbd> <kbd>,</kbd>")).toEqual(["g ,"]);
  });

  it("reads a modifier before a ' / ' list as applying to each key", () => {
    expect(
      combosOfCell("<kbd>Shift</kbd> with <kbd>←</kbd> / <kbd>→</kbd>")
    ).toEqual(["shift+ArrowLeft", "shift+ArrowRight"]);
  });

  it("reads a shifted letter and a named key", () => {
    expect(combosOfCell("<kbd>Shift</kbd> <kbd>S</kbd>")).toEqual(["shift+s"]);
    expect(combosOfCell("<kbd>Esc</kbd>")).toEqual(["Escape"]);
    expect(combosOfCell("<kbd>Space</kbd>")).toEqual(["space"]);
  });

  it("expands a digit range and decodes escaped characters", () => {
    expect(combosOfCell("<kbd>0</kbd>–<kbd>3</kbd>")).toEqual([
      "0",
      "1",
      "2",
      "3",
    ]);
    expect(combosOfCell("<kbd>&lt;</kbd> / <kbd>&lbrace;</kbd>")).toEqual([
      "<",
      "{",
    ]);
  });

  it("keeps the slash key apart from the ' / ' separator", () => {
    expect(combosOfCell("<kbd>/</kbd>")).toEqual(["/"]);
  });
});

describe("drift", () => {
  const guide = [
    `## ${SECTION}`,
    "",
    "### Go to",
    "",
    "| Key | Goes to |",
    "| --- | --- |",
    "| <kbd>G</kbd> <kbd>P</kbd> | Project |",
    "",
    "### Extra",
    "",
    "| Key | Does |",
    "| --- | --- |",
    "| <kbd>Z</kbd> | Nothing |",
    "",
    "## Next",
  ].join("\n");

  it("is quiet when the guide and the commands agree", () => {
    expect(
      drift(guide.replace(/### Extra[\s\S]*?\n\n## Next/, "## Next"), [
        { id: "go-to-project", group: "Go to", keys: ["g p"] },
      ])
    ).toEqual([]);
  });

  it("names the command and group of a key the guide does not list", () => {
    expect(
      drift(guide, [
        { id: "go-to-project", group: "Go to", keys: ["g p"] },
        { id: "go-to-tracks", group: "Go to", keys: ["g t"] },
        { id: "new-track", group: "New", keys: ["n t"] },
      ])
    ).toEqual([
      `go-to-tracks: key "g t" is not listed under "### Go to" in the guide`,
      `new-track: the guide has no "### New" section for its key "n t"`,
      `"### Extra" in the guide is not a command group`,
    ]);
  });

  it("names a listed key no command in the group has", () => {
    expect(
      drift(guide, [
        { id: "go-to-tracks", group: "Go to", keys: ["g t"] },
        { id: "extra", group: "Extra", keys: ["z"] },
      ])
    ).toContain(`"### Go to" lists key "g p", which no Go to command has`);
  });
});

describe("the guide's keyboard shortcuts", () => {
  it("lists every keyed command's keys under its group, and nothing else", async () => {
    const guide = await Bun.file(join(root, GUIDE)).text();
    expect(drift(guide, COMMANDS)).toEqual([]);
  });
});
