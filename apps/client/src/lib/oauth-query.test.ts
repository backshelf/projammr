import { describe, expect, it } from "bun:test";

import {
  hasOAuthQuery,
  paramString,
  searchParamsToQueryString,
} from "./oauth-query";

describe("hasOAuthQuery", () => {
  it("is true once the provider's signature param is present", () => {
    expect(hasOAuthQuery({ client_id: "abc", sig: "xyz" })).toBe(true);
  });

  it("is false for an ordinary visit with no signature", () => {
    expect(hasOAuthQuery({})).toBe(false);
    expect(hasOAuthQuery({ client_id: "abc" })).toBe(false);
  });
});

describe("paramString", () => {
  it("passes a single value through", () => {
    expect(paramString("abc")).toBe("abc");
  });

  it("takes the first value of a repeated param", () => {
    expect(paramString(["abc", "def"])).toBe("abc");
  });

  it("is undefined when the param was never set", () => {
    expect(paramString(undefined)).toBeUndefined();
  });
});

describe("searchParamsToQueryString", () => {
  it("round-trips a signed OAuth query", () => {
    const query = searchParamsToQueryString({
      client_id: "abc",
      scope: "read write",
      sig: "xyz",
    });
    expect(new URLSearchParams(query).get("scope")).toBe("read write");
    expect(new URLSearchParams(query).get("sig")).toBe("xyz");
  });

  it("drops params that were never set", () => {
    expect(searchParamsToQueryString({ client_id: undefined })).toBe("");
  });
});
