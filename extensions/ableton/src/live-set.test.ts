import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import {
  compareLiveVersions,
  findNewestLivePrefsFolder,
  parseDitConfig,
  parseLiveVersion,
  parseOpenSetFromLogs,
  parseSetId,
  readRepoMetadata,
  resolveUserLibrary,
} from "./live-set.js";

describe("live-set discovery", () => {
  it("compares Live release and beta versions numerically", () => {
    const v12 = parseLiveVersion("Live 12.4.6")!;
    const v13b2 = parseLiveVersion("Live 13.0b2")!;
    const v13b26 = parseLiveVersion("Live 13.0b26")!;
    const v13 = parseLiveVersion("Live 13.0.0")!;

    assert.ok(compareLiveVersions(v13b26, v12) > 0);
    assert.ok(compareLiveVersions(v13b26, v13b2) > 0);
    assert.ok(compareLiveVersions(v13, v13b26) > 0);
    assert.equal(parseLiveVersion("Crash"), null);
    assert.equal(parseLiveVersion("Live 13.0b"), null);
  });

  it("picks the newest preferences folder including beta versions", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "dit-ext-home-"));
    try {
      const prefs = path.join(home, "Library", "Preferences", "Ableton");
      fs.mkdirSync(path.join(prefs, "Live 12.4.6"), { recursive: true });
      fs.mkdirSync(path.join(prefs, "Live 13.0b26"), { recursive: true });
      fs.mkdirSync(path.join(prefs, "Crash"), { recursive: true });

      assert.equal(
        findNewestLivePrefsFolder(home),
        path.join(prefs, "Live 13.0b26")
      );

      fs.writeFileSync(
        path.join(prefs, "Live 13.0b26", "Library.cfg"),
        '<UserLibrary><LibraryProject><ProjectPath Value="/Volumes/Audio &amp; Samples/Ableton" /></LibraryProject></UserLibrary>'
      );
      assert.equal(
        resolveUserLibrary(path.join(prefs, "Live 13.0b26"), home),
        "/Volumes/Audio & Samples/Ableton/User Library"
      );
      assert.equal(
        resolveUserLibrary(path.join(prefs, "Live 12.4.6"), home),
        path.join(home, "Music", "Ableton", "User Library")
      );
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("reads the open set from Log.txt and cross-checks Indexer.txt", () => {
    const logRun = [
      '2026-11-27T09:40:00: info: Started: Live 13.0b26 Build: x',
      '2026-11-27T09:41:00: info: Loading document "/Users/me/Music/Song Project/Song.als"',
      '2026-11-27T09:41:02: info: Loading document "/Users/me/Music/Ableton/User Library/Defaults/Default MIDI Track.als"',
    ].join("\n");
    const indexer =
      "2026-11-27T09:41:03: info: Configure: CurrentProject: '/Users/me/Music/Song Project' [Current Project]\n";

    assert.equal(
      parseOpenSetFromLogs(
        logRun,
        indexer,
        "/Users/me/Music/Ableton/User Library"
      ),
      "/Users/me/Music/Song Project/Song.als"
    );

    const movedIndexer =
      "2026-11-27T09:45:00: info: Configure: CurrentProject: '/Users/me/Music/Temp Project' [Current Project]\n";
    assert.equal(
      parseOpenSetFromLogs(
        logRun,
        movedIndexer,
        "/Users/me/Music/Ableton/User Library"
      ),
      null
    );
  });

  it("parses .dit config, sets.toml, and remote pushed sessionId", () => {
    assert.deepEqual(
      parseDitConfig(
        'daw = "ableton"\n\n[remote]\ninstance = "https://projammr.example"\nrepo = 42\n'
      ),
      { instance: "https://projammr.example", hubRepoId: 42 }
    );

    const setsToml = '[sets]\nabc123 = "Song.als"\n\n[branches.abc123]\nalt = "Song @alt.als"\n';
    assert.equal(parseSetId(setsToml, "Song.als"), "abc123");
    assert.equal(parseSetId(setsToml, "Song @alt.als"), "abc123");

    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dit-ext-repo-"));
    try {
      fs.mkdirSync(path.join(projectRoot, ".dit", "refs", "remote"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(projectRoot, ".dit", "config.toml"),
        'daw = "ableton"\n[remote]\ninstance = "https://projammr.example"\nrepo = 7\n'
      );
      fs.writeFileSync(
        path.join(projectRoot, ".dit", "sets.toml"),
        '[sets]\nabc123 = "Song.als"\n'
      );
      fs.writeFileSync(
        path.join(projectRoot, ".dit", "refs", "remote", "abc123.json"),
        JSON.stringify({ sessionId: 99 })
      );

      const meta = readRepoMetadata(
        projectRoot,
        path.join(projectRoot, "Song.als"),
        projectRoot
      );
      assert.equal(meta.hasDit, true);
      assert.equal(meta.instance, "https://projammr.example");
      assert.equal(meta.hubRepoId, 7);
      assert.equal(meta.ditSetId, "abc123");
      assert.equal(meta.sessionId, 99);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
