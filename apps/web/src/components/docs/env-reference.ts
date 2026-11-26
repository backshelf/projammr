/**
 * Reads the root `.env.example` into the entries the self-hosting
 * configuration reference renders, and `docker-compose.yml` for what compose
 * does with each variable. The page is built from both files, so it can say
 * nothing about a variable that they do not.
 */

/** One assignment line in `.env.example`, set or commented out. */
export type EnvVariable = {
  name: string;
  /** The value the example gives, empty when it leaves the variable blank. */
  value: string;
  /** Written as `# NAME=value`: the variable stays off until `.env` sets it. */
  commented: boolean;
};

/** Variables documented together by the comment block written above them. */
export type EnvEntry = {
  variables: EnvVariable[];
  /** The comment block, one string per paragraph; a bare `#` line splits them. */
  paragraphs: string[];
};

/** An assignment, optionally commented out: `NAME=value` or `# NAME=value`. */
const ASSIGNMENT = /^(#\s*)?([A-Z][A-Z0-9_]*)=(.*)$/;

/**
 * Splits `.env.example` into entries. A comment block documents every
 * assignment that follows it until the next blank line or comment line, so a
 * run of related variables shares one description; a comment block that ends
 * at a blank line (the file's own header) documents nothing and is dropped.
 * Throws on a line that is neither a comment nor an assignment, so a file the
 * parser cannot read fails the build rather than rendering half a reference.
 */
export function parseEnvExample(source: string): EnvEntry[] {
  const entries: EnvEntry[] = [];
  let paragraphs: string[][] = [];
  let open: EnvEntry | null = null;

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();

    if (line === "") {
      paragraphs = [];
      open = null;
      continue;
    }

    const assignment = ASSIGNMENT.exec(line);
    if (assignment) {
      const variable: EnvVariable = {
        name: assignment[2]!,
        value: assignment[3]!.trim(),
        commented: assignment[1] !== undefined,
      };
      if (open) {
        open.variables.push(variable);
      } else {
        open = {
          variables: [variable],
          paragraphs: paragraphs
            .filter((lines) => lines.length > 0)
            .map((lines) => lines.join(" ")),
        };
        entries.push(open);
        paragraphs = [];
      }
      continue;
    }

    if (line.startsWith("#")) {
      open = null;
      const text = line.replace(/^#+/, "").trim();
      if (text === "") paragraphs.push([]);
      else if (paragraphs.length === 0) paragraphs.push([text]);
      else paragraphs[paragraphs.length - 1]!.push(text);
      continue;
    }

    throw new Error(
      `.env.example: "${line}" is neither a comment nor an assignment`
    );
  }

  return entries;
}

/** What `docker-compose.yml` does with a variable `.env` sets. */
export type ComposeUse =
  /** `${NAME:?…}`: compose refuses to start until `.env` sets it. */
  | { kind: "required" }
  /** `${NAME:-value}`: compose uses `value` when `.env` leaves it unset. */
  | { kind: "default"; value: string }
  /** A bare `NAME:` key, or an interpolation with no default: passed on only when set. */
  | { kind: "passed" }
  /** Compose never reads it, so it matters only outside Docker. */
  | { kind: "unread" };

const RANK: Record<ComposeUse["kind"], number> = {
  unread: 0,
  passed: 1,
  default: 2,
  required: 3,
};

const VARIABLE_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * How `docker-compose.yml` uses `name`: the strongest of its interpolations
 * (`${NAME}`, `${NAME:-default}`, `${NAME:?error}`, with or without the colon)
 * and bare `NAME:` environment keys, which compose fills from `.env`. Comments
 * are stripped first, and `$${…}` is compose's escape for a literal `$`, not
 * an interpolation. An empty default is the same as none.
 */
export function composeUse(compose: string, name: string): ComposeUse {
  if (!VARIABLE_NAME.test(name)) {
    throw new Error(`"${name}" is not an environment variable name`);
  }
  const text = compose
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, ""))
    .join("\n");

  let use: ComposeUse = { kind: "unread" };
  const consider = (next: ComposeUse) => {
    if (RANK[next.kind] > RANK[use.kind]) use = next;
  };

  const interpolation = new RegExp(
    `(?<!\\$)\\$\\{${name}(?::?([-?])([^}]*))?\\}`,
    "g"
  );
  for (const [, operator, argument = ""] of text.matchAll(interpolation)) {
    if (operator === "?") consider({ kind: "required" });
    else if (operator === "-" && argument !== "")
      consider({ kind: "default", value: argument });
    else consider({ kind: "passed" });
  }

  if (new RegExp(`^\\s+${name}:\\s*$`, "m").test(text)) {
    consider({ kind: "passed" });
  }

  return use;
}

/** A run of comment text, either plain or quoted in backticks. */
export type Segment = { text: string; code: boolean };

/**
 * Splits comment text on backticks, the one piece of markup `.env.example`'s
 * comments use. A backtick with no partner is kept as plain text.
 */
export function inlineCode(text: string): Segment[] {
  const parts = text.split("`");
  const closed = parts.length % 2 === 1;
  const segments: Segment[] = [];

  parts.forEach((part, index) => {
    const lastUnpaired = !closed && index === parts.length - 1;
    const code = index % 2 === 1 && !lastUnpaired;
    const piece = lastUnpaired ? `\`${part}` : part;
    if (piece === "") return;
    const previous = segments.at(-1);
    if (previous && !previous.code && !code) previous.text += piece;
    else segments.push({ text: piece, code });
  });

  return segments;
}
