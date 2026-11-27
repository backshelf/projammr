/**
 * Resolves the active Ableton Live set and its `.dit` repo metadata (instance URL, hub repo ID,
 * and bound Projammr session ID).
 *
 * The `1.0.0-beta.1` Extensions SDK does not expose `Song.filePath`, so we locate the project
 * folder via Live's newest `Log.txt` / `Indexer.txt` (with beta version awareness) and fall back
 * to walking up from any audio clip sample path in the set.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const STARTED_MARKER = "info: Started: Live ";
const LOADING_MARKER = 'info: Loading document "';
const CURRENT_PROJECT_MARKER = "Configure: CurrentProject: '";
const INITIAL_TAIL_BYTES = 256 * 1024;

export interface ParsedVersion {
  numbers: number[];
  beta: number | null;
}

export interface RepoContext {
  projectRoot: string;
  setPath: string | null;
  setFile: string | null;
  hasDit: boolean;
  instance: string | null;
  hubRepoId: number | null;
  ditSetId: string | null;
  sessionId: number | null;
}

/** Parses `Live 12.4.6` or `Live 13.0b26`, returning `null` for non-version folders. */
export function parseLiveVersion(name: string): ParsedVersion | null {
  if (!name.startsWith("Live ")) return null;
  const rest = name.slice("Live ".length);
  const bIndex = rest.indexOf("b");
  let core = rest;
  let beta: number | null = null;
  if (bIndex !== -1) {
    core = rest.slice(0, bIndex);
    const betaStr = rest.slice(bIndex + 1);
    if (!/^\d+$/.test(betaStr)) return null;
    beta = Number.parseInt(betaStr, 10);
  }
  const parts = core.split(".");
  if (parts.length === 0 || parts.some((p) => !/^\d+$/.test(p))) {
    return null;
  }
  const numbers = parts.map((p) => Number.parseInt(p, 10));
  while (numbers.length > 1 && numbers[numbers.length - 1] === 0) {
    numbers.pop();
  }
  return { numbers, beta };
}

/** Compares two Live versions numerically; betas sort before their corresponding final release. */
export function compareLiveVersions(
  a: ParsedVersion,
  b: ParsedVersion
): number {
  const len = Math.max(a.numbers.length, b.numbers.length);
  for (let i = 0; i < len; i++) {
    const diff = (a.numbers[i] ?? 0) - (b.numbers[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (a.beta === b.beta) return 0;
  if (a.beta === null) return 1;
  if (b.beta === null) return -1;
  return a.beta - b.beta;
}

export function findNewestLivePrefsFolder(home = os.homedir()): string | null {
  const prefsDir = path.join(home, "Library", "Preferences", "Ableton");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(prefsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  let best: { version: ParsedVersion; folder: string } | null = null;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const version = parseLiveVersion(entry.name);
    if (!version) continue;
    if (!best || compareLiveVersions(version, best.version) > 0) {
      best = { version, folder: path.join(prefsDir, entry.name) };
    }
  }
  return best?.folder ?? null;
}

function readTail(filePath: string, bytes: number): string {
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - bytes);
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function readLastRun(logPath: string): string | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(logPath);
  } catch {
    return null;
  }
  let chunk = INITIAL_TAIL_BYTES;
  while (true) {
    const text = readTail(logPath, chunk);
    const at = text.lastIndexOf(STARTED_MARKER);
    if (at !== -1) {
      const lineStart = text.lastIndexOf("\n", at);
      return text.slice(lineStart === -1 ? 0 : lineStart + 1);
    }
    if (chunk >= stat.size) {
      return text;
    }
    chunk *= 2;
  }
}

export function parseOpenSetFromLogs(
  logRun: string,
  indexerTail: string,
  userLibrary: string
): string | null {
  const templatesDir = path.join(userLibrary, "Templates");
  let openSet: string | null = null;
  let loadedAt = "";

  for (const line of logRun.split("\n")) {
    const idx = line.indexOf(LOADING_MARKER);
    if (idx === -1) continue;
    const rest = line.slice(idx + LOADING_MARKER.length);
    const end = rest.lastIndexOf('"');
    if (end === -1) continue;
    const docPath = rest.slice(0, end);
    if (docPath.startsWith(templatesDir)) {
      openSet = null;
    } else if (docPath.startsWith(userLibrary) || docPath.includes(".app/")) {
      continue;
    } else {
      openSet = docPath;
      loadedAt = line.split(" ")[0] ?? "";
    }
  }

  if (!openSet) return null;

  const indexerLines = indexerTail.split("\n");
  for (let i = indexerLines.length - 1; i >= 0; i--) {
    const line = indexerLines[i];
    if (!line) continue;
    const at = line.indexOf(CURRENT_PROJECT_MARKER);
    if (at === -1) continue;
    const rest = line.slice(at + CURRENT_PROJECT_MARKER.length);
    const end = rest.indexOf("'");
    if (end === -1) continue;
    const stamp = line.split(" ")[0] ?? "";
    const currentProject = rest.slice(0, end);
    if (stamp > loadedAt && path.dirname(openSet) !== currentProject) {
      return null;
    }
    break;
  }

  return openSet;
}

/** Walks up from an audio clip file path to find a containing `.dit` or Live Project folder. */
export function findProjectRootFromSample(samplePath: string): string | null {
  let dir = path.dirname(samplePath);
  for (let depth = 0; depth < 8; depth++) {
    if (
      fs.existsSync(path.join(dir, ".dit")) ||
      fs.existsSync(path.join(dir, "Ableton Project Info"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Parses `[remote]` `instance` and `repo` from `.dit/config.toml`. */
export function parseDitConfig(toml: string): {
  instance: string | null;
  hubRepoId: number | null;
} {
  let inRemote = false;
  let instance: string | null = null;
  let hubRepoId: number | null = null;

  for (const rawLine of toml.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      inRemote = line === "[remote]";
      continue;
    }
    if (!inRemote) continue;
    const instanceMatch = /^instance\s*=\s*"([^"]+)"/.exec(line);
    if (instanceMatch?.[1]) {
      instance = instanceMatch[1];
    }
    const repoMatch = /^repo\s*=\s*(\d+)/.exec(line);
    if (repoMatch?.[1]) {
      hubRepoId = Number.parseInt(repoMatch[1], 10);
    }
  }

  return { instance, hubRepoId };
}

/** Parses `instance = "..."` from the user's global `dit/config.toml`. */
export function readUserInstance(
  home = os.homedir(),
  platform = process.platform,
  env = process.env
): string | null {
  const configDir =
    platform === "darwin"
      ? path.join(home, "Library", "Application Support", "dit")
      : platform === "win32" && env.APPDATA
        ? path.join(env.APPDATA, "dit")
        : path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "dit");
  const configPath = path.join(configDir, "config.toml");
  try {
    const toml = fs.readFileSync(configPath, "utf8");
    const match = /^\s*instance\s*=\s*"([^"]+)"/m.exec(toml);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function decodeXmlEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_m, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10))
    );
}

/** Reads `<ProjectPath>` inside `<UserLibrary>` from Live's `Library.cfg`, falling back to `~/Music/Ableton/User Library`. */
export function resolveUserLibrary(
  prefsFolder: string | null,
  home = os.homedir()
): string {
  if (prefsFolder) {
    try {
      const cfg = fs.readFileSync(path.join(prefsFolder, "Library.cfg"), "utf8");
      const block = /<UserLibrary>[\s\S]*?<\/UserLibrary>/.exec(cfg)?.[0];
      const value = block
        ? /<ProjectPath\s+Value="([^"]+)"/.exec(block)?.[1]
        : null;
      if (value) {
        return path.join(decodeXmlEntities(value), "User Library");
      }
    } catch {
      // Missing or unreadable Library.cfg falls back to Live's default location
    }
  }
  return path.join(home, "Music", "Ableton", "User Library");
}

/** Resolves a set's `setId` from `.dit/sets.toml` given a project-relative `.als` file name. */
export function parseSetId(
  setsToml: string,
  setFile: string | null
): string | null {
  const entries: Array<{ id: string; file: string }> = [];
  let section = "";

  for (const rawLine of setsToml.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      section = line;
      continue;
    }
    const match = /^([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/.exec(line);
    if (!match?.[1] || !match[2]) continue;
    if (section === "[sets]") {
      entries.push({ id: match[1], file: match[2] });
    } else if (section.startsWith("[branches.")) {
      const id = section.slice("[branches.".length, -1);
      if (setFile && match[2] === setFile) {
        return id;
      }
    }
  }

  if (setFile) {
    const exact = entries.find((entry) => entry.file === setFile);
    if (exact) return exact.id;
  }
  return entries.length === 1 ? (entries[0]?.id ?? null) : null;
}

export function readRepoMetadata(
  projectRoot: string,
  setPath: string | null,
  home = os.homedir()
): RepoContext {
  const ditDir = path.join(projectRoot, ".dit");
  const setFile = setPath ? path.relative(projectRoot, setPath) : null;
  const hasDit = fs.existsSync(ditDir);

  if (!hasDit) {
    return {
      projectRoot,
      setPath,
      setFile,
      hasDit: false,
      instance: readUserInstance(home),
      hubRepoId: null,
      ditSetId: null,
      sessionId: null,
    };
  }

  let instance: string | null = null;
  let hubRepoId: number | null = null;
  try {
    const configToml = fs.readFileSync(path.join(ditDir, "config.toml"), "utf8");
    const parsed = parseDitConfig(configToml);
    instance = parsed.instance;
    hubRepoId = parsed.hubRepoId;
  } catch {
    // Missing or unreadable config leaves instance null
  }
  instance ??= readUserInstance(home);

  let ditSetId: string | null = null;
  try {
    const setsToml = fs.readFileSync(path.join(ditDir, "sets.toml"), "utf8");
    ditSetId = parseSetId(setsToml, setFile);
  } catch {
    // No sets recorded yet
  }

  let sessionId: number | null = null;
  if (ditSetId) {
    try {
      const pushed = JSON.parse(
        fs.readFileSync(
          path.join(ditDir, "refs", "remote", `${ditSetId}.json`),
          "utf8"
        )
      ) as { sessionId?: number; session_id?: number };
      const resolved = pushed.sessionId ?? pushed.session_id;
      if (typeof resolved === "number" && Number.isInteger(resolved)) {
        sessionId = resolved;
      }
    } catch {
      // Set not pushed to hub yet
    }
  }

  return {
    projectRoot,
    setPath,
    setFile,
    hasDit: true,
    instance,
    hubRepoId,
    ditSetId,
    sessionId,
  };
}

export function discoverActiveRepo(
  samplePaths: readonly string[],
  home = os.homedir()
): RepoContext | null {
  const prefs = findNewestLivePrefsFolder(home);
  if (prefs) {
    const run = readLastRun(path.join(prefs, "Log.txt"));
    if (run) {
      let indexer = "";
      try {
        indexer = readTail(path.join(prefs, "Indexer.txt"), INITIAL_TAIL_BYTES);
      } catch {
        // Indexer.txt is optional
      }
      const userLibrary = resolveUserLibrary(prefs, home);
      const openSet = parseOpenSetFromLogs(run, indexer, userLibrary);
      if (openSet && fs.existsSync(openSet)) {
        return readRepoMetadata(path.dirname(openSet), openSet, home);
      }
    }
  }

  for (const samplePath of samplePaths) {
    const root = findProjectRootFromSample(samplePath);
    if (root) {
      return readRepoMetadata(root, null, home);
    }
  }

  return null;
}
