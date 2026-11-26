import { describe, expect, test } from "bun:test";
import { linkKeys, normaliseUrl, removeLinkAt, replaceLinkAt } from "./links";

const a = { name: "A", url: "https://a.test" };
const b = { name: "B", url: "https://same.test" };
const c = { name: "C", url: "https://same.test" };
const links = [a, b, c];

describe("replaceLinkAt", () => {
  test("swaps only the link at the index, even when another shares its URL", () => {
    const edited = { name: "C2", url: "https://c.test" };
    expect(replaceLinkAt(links, 2, edited)).toEqual([a, b, edited]);
  });

  test("does not mutate the list it was given", () => {
    replaceLinkAt(links, 0, { name: "X", url: "https://x.test" });
    expect(links).toEqual([a, b, c]);
  });
});

describe("removeLinkAt", () => {
  test("drops only the link at the index, even when another shares its URL", () => {
    expect(removeLinkAt(links, 1)).toEqual([a, c]);
  });

  test("leaves the list alone for an index past the end", () => {
    expect(removeLinkAt(links, 7)).toEqual(links);
  });
});

describe("linkKeys", () => {
  test("gives links that share a URL different keys, and every key is stable across a re-render", () => {
    const keys = linkKeys(links);
    expect(new Set(keys).size).toBe(links.length);
    expect(linkKeys(links)).toEqual(keys);
  });
});

describe("normaliseUrl", () => {
  test("prefixes https:// when there is no scheme", () => {
    expect(normaliseUrl(" example.com/x ")).toBe("https://example.com/x");
  });

  test("keeps an http or https address as typed", () => {
    expect(normaliseUrl("http://a.test")).toBe("http://a.test");
    expect(normaliseUrl("https://a.test")).toBe("https://a.test");
  });
});
