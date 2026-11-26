import { randomBytes } from "node:crypto";
import { describe, expect, it } from "bun:test";
import {
  type Envelope,
  type MasterKeys,
  newEnvelope,
  open,
  openJson,
  rewrap,
  scopeKey,
  seal,
  sealJson,
  unwrap,
} from "./notes-crypto.js";

const master = randomBytes(32);
const keys: MasterKeys = { current: master, previous: null, version: 1 };

describe("seal/open", () => {
  it("round-trips a plaintext buffer", () => {
    const plaintext = Buffer.from("the lyrics live here", "utf8");
    const key = randomBytes(32);
    const sealed = seal(key, plaintext);
    expect(open(key, sealed)).toEqual(plaintext);
  });

  it("throws when a byte in the sealed buffer is flipped", () => {
    const key = randomBytes(32);
    const sealed = seal(key, Buffer.from("tamper me", "utf8"));
    const lastByte = sealed.length - 1;
    sealed.writeUInt8(sealed.readUInt8(lastByte) ^ 0xff, lastByte);
    expect(() => open(key, sealed)).toThrow();
  });
});

describe("scopeKey", () => {
  it("derives different keys for different scopes at the same version", () => {
    const a = scopeKey(master, "user:author-1", 1);
    const b = scopeKey(master, "project:1", 1);
    expect(a.equals(b)).toBe(false);
  });

  it("derives the same key for the same scope and version", () => {
    const a = scopeKey(master, "user:author-1", 1);
    const b = scopeKey(master, "user:author-1", 1);
    expect(a.equals(b)).toBe(true);
  });
});

describe("newEnvelope/unwrap", () => {
  it("unwrap returns the data key newEnvelope generated", () => {
    const { dataKey, envelope } = newEnvelope(keys, "user:author-1");
    expect(unwrap(keys, envelope)).toEqual(dataKey);
  });

  it("tags the envelope with the keys' version", () => {
    const { envelope } = newEnvelope({ ...keys, version: 7 }, "user:author-1");
    expect(envelope.keyVersion).toBe(7);
  });
});

describe("rewrap", () => {
  it("unwraps to the same data key under the new scope but not the old one", () => {
    const { dataKey, envelope } = newEnvelope(keys, "user:author-1");
    const rewrapped = rewrap(keys, envelope, "project:7");

    expect(unwrap(keys, rewrapped)).toEqual(dataKey);
    expect(() =>
      unwrap(keys, { ...rewrapped, keyScope: "user:author-1" })
    ).toThrow();
  });
});

describe("key rotation", () => {
  const previous = randomBytes(32);
  const current = randomBytes(32);
  const CURRENT_VERSION = 2;
  const rotating: MasterKeys = { current, previous, version: CURRENT_VERSION };
  const OLD_VERSION = CURRENT_VERSION - 1;

  /** A row as it would sit mid-rotation: wrapped under `previous`, at a version older than the current one. */
  function oldVersionRow(
    scope: Envelope["keyScope"],
    dataKey: Buffer
  ): Envelope {
    return {
      wrappedKey: seal(scopeKey(previous, scope, OLD_VERSION), dataKey),
      keyScope: scope,
      keyVersion: OLD_VERSION,
    };
  }

  it("unwraps a row on an older key version with the previous key", () => {
    const dataKey = randomBytes(32);
    const row = oldVersionRow("user:author-1", dataKey);

    expect(unwrap(rotating, row)).toEqual(dataKey);
  });

  it("unwraps a row on the current key version with the current key, ignoring the previous one", () => {
    const { dataKey, envelope } = newEnvelope(rotating, "user:author-1");
    expect(unwrap(rotating, envelope)).toEqual(dataKey);
  });

  it("rewrap moves an older-version row onto the current key and version", () => {
    const dataKey = randomBytes(32);
    const row = oldVersionRow("user:author-1", dataKey);

    const rotated = rewrap(rotating, row, row.keyScope);

    expect(rotated.keyVersion).toBe(CURRENT_VERSION);
    expect(
      unwrap({ current, previous: null, version: CURRENT_VERSION }, rotated)
    ).toEqual(dataKey);
  });

  it("names NOTES_MASTER_KEY_PREVIOUS when an older-version row has no previous key configured", () => {
    const row = oldVersionRow("user:author-1", randomBytes(32));
    const noPrevious: MasterKeys = {
      current,
      previous: null,
      version: CURRENT_VERSION,
    };

    expect(() => unwrap(noPrevious, row)).toThrow(/NOTES_MASTER_KEY_PREVIOUS/);
  });
});

describe("sealJson/openJson", () => {
  it("round-trips a block array", () => {
    const key = randomBytes(32);
    const blocks = [
      { type: "paragraph", text: "verse one" },
      { type: "paragraph", text: "verse two" },
    ];
    const sealed = sealJson(key, blocks);
    expect(openJson<typeof blocks>(key, sealed)).toEqual(blocks);
  });
});
