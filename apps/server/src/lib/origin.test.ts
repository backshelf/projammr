import { describe, expect, it } from "bun:test";
import { sameOrigin } from "./origin.js";

function req(headers: Record<string, string>) {
  return new Request("http://localhost:8080/api/auth/sign-in/email", {
    headers,
  });
}

describe("sameOrigin", () => {
  it("returns the origin when it matches the host addressed", () => {
    expect(
      sameOrigin(
        req({ origin: "http://localhost:8080", host: "localhost:8080" })
      )
    ).toBe("http://localhost:8080");
  });

  it("matches on host alone, so the scheme need not agree", () => {
    expect(
      sameOrigin(req({ origin: "https://api.test", host: "api.test" }))
    ).toBe("https://api.test");
  });

  it("rejects an origin pointing at another host", () => {
    expect(
      sameOrigin(req({ origin: "https://evil.test", host: "localhost:8080" }))
    ).toBeNull();
  });

  it("rejects a host that drops the port the origin names", () => {
    expect(
      sameOrigin(req({ origin: "http://localhost:8080", host: "localhost" }))
    ).toBeNull();
  });

  it("returns null when either header is missing or unparseable", () => {
    expect(sameOrigin(req({ host: "localhost:8080" }))).toBeNull();
    expect(sameOrigin(req({ origin: "not a url" }))).toBeNull();
    expect(sameOrigin(undefined)).toBeNull();
  });
});
