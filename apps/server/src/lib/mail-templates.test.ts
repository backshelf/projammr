import { describe, expect, it } from "bun:test";
import { inviteEmail } from "./mail-templates.js";

describe("inviteEmail", () => {
  it("names the instance passed in, not a literal product name", () => {
    const content = inviteEmail(
      "The Album",
      "Alex",
      "editor",
      "https://app.test/invite/abc",
      "Alex's Studio"
    );
    expect(content.text).toContain("on Alex's Studio as editor");
    expect(content.html).toContain("on Alex&#39;s Studio as editor");
  });

  it("falls back to 'Someone' when no inviter name is known", () => {
    const content = inviteEmail(
      "The Album",
      null,
      "viewer",
      "https://app.test/invite/abc",
      "Alex's Studio"
    );
    expect(content.subject).toBe("Someone invited you to The Album");
  });

  it("escapes markup in interpolated values in html, but leaves text raw", () => {
    const content = inviteEmail(
      `<b>Loud</b> "Album"`,
      "Alex",
      "editor",
      "https://app.test/invite/abc",
      "Alex's Studio"
    );

    expect(content.html).not.toContain("<b>Loud</b>");
    expect(content.html).toContain("&lt;b&gt;Loud&lt;/b&gt;");
    expect(content.html).toContain("&quot;Album&quot;");

    expect(content.text).toContain(`<b>Loud</b> "Album"`);
  });
});
