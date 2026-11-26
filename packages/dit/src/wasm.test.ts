import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { buildPack } from "./test-pack";
import {
  ABI_VERSION,
  DitError,
  DitErrorCode,
  compileDit,
  loadDit,
} from "./wasm";

const enc = new TextEncoder();

const XML =
  '<?xml version="1.0" encoding="UTF-8"?><Ableton><LiveSet/></Ableton>';

describe("compileDit", () => {
  test("returns the same module on every call", () => {
    expect(compileDit()).toBeInstanceOf(WebAssembly.Module);
    expect(compileDit()).toBe(compileDit());
  });
});

describe("loadDit", () => {
  test("gives each call its own instance", () => {
    expect(loadDit().exports).not.toBe(loadDit().exports);
  });

  test("gives each instance its own memory", () => {
    expect(loadDit().exports.memory).not.toBe(loadDit().exports.memory);
  });

  test("the ABI version matches the crate's constant", () => {
    const source = readFileSync(
      new URL("../crates/dit-wasm/src/lib.rs", import.meta.url),
      "utf8"
    );
    const match = /pub const ABI_VERSION: u32 = (\d+);/.exec(source);
    expect(Number(match?.[1])).toBe(ABI_VERSION);
    expect(loadDit().exports.dit_abi_version()).toBe(ABI_VERSION);
  });
});

describe("Dit.parse", () => {
  test("reads the metadata of the arranged fixture", () => {
    const als = readFileSync(
      new URL(
        "../crates/dit-daw-ableton/fixtures/Contract Fixtures Project/Arranged Set.als",
        import.meta.url
      )
    );
    const meta = loadDit().parse("ableton", Bun.gunzipSync(als));
    expect(meta.tempo).not.toBeNull();
    expect(meta.tracksCount).toBeGreaterThan(0);
    expect(meta.structure?.tracks.length).toBeGreaterThan(0);
  });

  test("throws a DitError for a document that is not a set", () => {
    const error = catchError(() =>
      loadDit().parse("ableton", enc.encode("not xml at all"))
    );
    expect(error).toBeInstanceOf(DitError);
    expect((error as DitError).code).toBe(DitErrorCode.Malformed);
  });
});

describe("Dit.materialise", () => {
  test("rebuilds a document from one leaf", () => {
    const { pack, treeId, sideId } = buildPack([XML]);
    const out = loadDit().materialise("ableton", pack, treeId, sideId);
    expect(new TextDecoder().decode(out)).toBe(XML);
  });

  test("joins leaves in order", () => {
    const { pack, treeId, sideId } = buildPack([
      XML.slice(0, 40),
      XML.slice(40),
    ]);
    const out = loadDit().materialise("ableton", pack, treeId, sideId);
    expect(new TextDecoder().decode(out)).toBe(XML);
  });

  test("throws a corrupt DitError when a body byte is flipped", () => {
    const { pack, treeId, sideId } = buildPack([XML]);
    // The first record is the XML Blob: 32 id + 1 kind + 4 length, then the body.
    pack.set([(pack[40] ?? 0) ^ 0xff], 40);
    const error = catchError(() =>
      loadDit().materialise("ableton", pack, treeId, sideId)
    );
    expect(error).toBeInstanceOf(DitError);
    expect((error as DitError).code).toBe(DitErrorCode.Corrupt);
  });
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}
