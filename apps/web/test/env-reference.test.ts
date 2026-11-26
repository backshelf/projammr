import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import {
  composeUse,
  inlineCode,
  parseEnvExample,
} from "../src/components/docs/env-reference";

const root = join(import.meta.dir, "..", "..", "..");
const read = (file: string) => Bun.file(join(root, file)).text();

describe("parseEnvExample", () => {
  it("documents a variable with the comment block above it", () => {
    const entries = parseEnvExample(
      ["# Signs sessions.", "# Generate one.", "SECRET="].join("\n")
    );
    expect(entries).toEqual([
      {
        variables: [{ name: "SECRET", value: "", commented: false }],
        paragraphs: ["Signs sessions. Generate one."],
      },
    ]);
  });

  it("reads a commented-out assignment as an optional variable", () => {
    const [entry] = parseEnvExample(
      "# Where mail goes.\n# SMTP_URL=smtps://host:465"
    );
    expect(entry?.variables).toEqual([
      { name: "SMTP_URL", value: "smtps://host:465", commented: true },
    ]);
  });

  it("gives a run of assignments the one comment above them", () => {
    const entries = parseEnvExample(
      "# The database.\nDB_USER=a\nDB_PASSWORD=b\nDB_NAME=c"
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.variables.map((variable) => variable.name)).toEqual([
      "DB_USER",
      "DB_PASSWORD",
      "DB_NAME",
    ]);
    expect(entries[0]?.paragraphs).toEqual(["The database."]);
  });

  it("starts a new entry at a comment between two assignments", () => {
    const entries = parseEnvExample(
      "# First.\n# FIRST=\n# Second.\n# SECOND=x"
    );
    expect(entries.map((entry) => entry.paragraphs)).toEqual([
      ["First."],
      ["Second."],
    ]);
  });

  it("drops a comment block that a blank line separates from any assignment", () => {
    const entries = parseEnvExample("# The file's header.\n\n# Used.\nUSED=1");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.paragraphs).toEqual(["Used."]);
  });

  it("splits paragraphs at a bare comment line", () => {
    const [entry] = parseEnvExample("# One.\n#\n# Two.\nNAME=");
    expect(entry?.paragraphs).toEqual(["One.", "Two."]);
  });

  it("leaves an uncommented variable with no description when nothing documents it", () => {
    const [entry] = parseEnvExample("BARE=1");
    expect(entry?.paragraphs).toEqual([]);
  });

  it("refuses a line that is neither a comment nor an assignment", () => {
    expect(() => parseEnvExample("# Fine.\nnot an assignment")).toThrow(
      "neither a comment nor an assignment"
    );
  });
});

describe("composeUse", () => {
  const compose = [
    "services:",
    "  api:",
    "    environment:",
    "      SECRET: ${SECRET:?set SECRET in .env}",
    "      HOST: https://${HOST:-localhost}",
    "      ORIGINS: ${ORIGINS:-}",
    "      TUNING:",
    "      FIXED: http://api:8080",
    "      # MENTIONED: ${MENTIONED:?only in a comment}",
    "    command: echo $${ESCAPED}",
  ].join("\n");

  it("reads a `:?` interpolation as required", () => {
    expect(composeUse(compose, "SECRET")).toEqual({ kind: "required" });
  });

  it("reads a `:-` interpolation as a default", () => {
    expect(composeUse(compose, "HOST")).toEqual({
      kind: "default",
      value: "localhost",
    });
  });

  it("reads an empty default as passed through", () => {
    expect(composeUse(compose, "ORIGINS")).toEqual({ kind: "passed" });
  });

  it("reads a bare environment key as passed through", () => {
    expect(composeUse(compose, "TUNING")).toEqual({ kind: "passed" });
  });

  it("does not count a key compose sets itself, a comment or an escaped `$`", () => {
    expect(composeUse(compose, "FIXED")).toEqual({ kind: "unread" });
    expect(composeUse(compose, "MENTIONED")).toEqual({ kind: "unread" });
    expect(composeUse(compose, "ESCAPED")).toEqual({ kind: "unread" });
  });

  it("does not match a variable whose name only starts the same way", () => {
    expect(composeUse(compose, "SECRE")).toEqual({ kind: "unread" });
  });

  it("refuses a name that is not an environment variable name", () => {
    expect(() => composeUse(compose, "A.*")).toThrow();
  });
});

describe("inlineCode", () => {
  it("marks backticked runs as code", () => {
    expect(inlineCode("set `acme` for ACME")).toEqual([
      { text: "set ", code: false },
      { text: "acme", code: true },
      { text: " for ACME", code: false },
    ]);
  });

  it("keeps an unpaired backtick as plain text", () => {
    expect(inlineCode("a `b` c `d")).toEqual([
      { text: "a ", code: false },
      { text: "b", code: true },
      { text: " c `d", code: false },
    ]);
  });
});

describe("the repository's own .env.example", () => {
  it("parses, and documents every variable it names", async () => {
    const entries = parseEnvExample(await read(".env.example"));
    const undocumented = entries
      .filter((entry) => entry.paragraphs.length === 0)
      .flatMap((entry) => entry.variables.map((variable) => variable.name));
    expect(undocumented).toEqual([]);
  });

  it("names each variable once", async () => {
    const names = parseEnvExample(await read(".env.example")).flatMap((entry) =>
      entry.variables.map((variable) => variable.name)
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it("passes the Tailscale override's auth key on, rather than leaving it outside Docker", async () => {
    const compose = [
      await read("docker-compose.yml"),
      await read("docker-compose.tailscale.yml"),
    ].join("\n");
    expect(composeUse(compose, "TS_AUTHKEY")).toEqual({ kind: "passed" });
    expect(composeUse(compose, "PUBLIC_HOST")).toEqual({
      kind: "default",
      value: "localhost",
    });
  });

  it("agrees with docker-compose.yml on the two required secrets", async () => {
    const compose = await read("docker-compose.yml");
    expect(composeUse(compose, "BETTER_AUTH_SECRET")).toEqual({
      kind: "required",
    });
    expect(composeUse(compose, "NOTES_MASTER_KEY")).toEqual({
      kind: "required",
    });
  });
});
