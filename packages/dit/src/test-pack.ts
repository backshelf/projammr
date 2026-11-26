// Builds the objects of a save the way dit lays them out, for tests of the
// wasm host and of the server's rebuild: a tree of Text leaves around any XML.

export const BLOB = 1;
export const TREE = 3;

const enc = new TextEncoder();

/** One object as dit stores it: its id, kind and uncompressed body. */
export interface PackObject {
  id: Uint8Array;
  kind: number;
  body: Uint8Array;
}

export function idOf(kind: number, body: Uint8Array): Uint8Array {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(new Uint8Array([kind]));
  hasher.update(body);
  return new Uint8Array(hasher.digest());
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

function u32(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, true);
  return out;
}

/** One pack record: `[id 32][kind u8][body length u32 LE][body]`. */
export function packRecord(kind: number, body: Uint8Array): Uint8Array {
  return concat([
    idOf(kind, body),
    new Uint8Array([kind]),
    u32(body.byteLength),
    body,
  ]);
}

/** A tree body of one Gap part holding a Text leaf per id (no tags, no part id). */
export function treeBody(leafIds: Uint8Array[]): Uint8Array {
  return concat([
    new Uint8Array([1]),
    u32(1),
    new Uint8Array([0, 0, 0]),
    u32(leafIds.length),
    ...leafIds.map((id) => concat([new Uint8Array([0, 0]), id])),
  ]);
}

/**
 * The objects of a save whose XML is `chunks` as Text leaves: one Blob per
 * leaf, the side list Blob and the tree, with the ids of the tree and side.
 */
export function buildObjects(chunks: Uint8Array[] | string[]) {
  const leaves = chunks.map((chunk) =>
    typeof chunk === "string" ? enc.encode(chunk) : chunk
  );
  const side = enc.encode("[]");
  const tree = treeBody(leaves.map((leaf) => idOf(BLOB, leaf)));
  const objects: PackObject[] = [
    ...leaves.map((body) => ({ id: idOf(BLOB, body), kind: BLOB, body })),
    { id: idOf(BLOB, side), kind: BLOB, body: side },
    { id: idOf(TREE, tree), kind: TREE, body: tree },
  ];
  return { objects, treeId: idOf(TREE, tree), sideId: idOf(BLOB, side) };
}

/** A pack whose save is `chunks` as Text leaves; returns the pack and both ids. */
export function buildPack(chunks: string[]) {
  const { objects, treeId, sideId } = buildObjects(chunks);
  return {
    pack: concat(objects.map(({ kind, body }) => packRecord(kind, body))),
    treeId,
    sideId,
  };
}
