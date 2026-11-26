import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { stubEnv, unstubAllEnvs } from "@workspace/test/env";

// Each case reloads `env.ts` against a stubbed environment; letting the real
// `.env` load would put the developer's own values back on every reload.
mock.module("dotenv/config", () => ({}));

/**
 * `env.ts` reads `process.env` once at import time, so every case has to load
 * a fresh copy of the module against a fresh environment.
 */
async function loadEnv(vars: Record<string, string | undefined>) {
  delete require.cache[require.resolve("./env.js")];
  for (const [key, value] of Object.entries(vars)) {
    stubEnv(key, value);
  }
  return import("./env.js");
}

describe("env", () => {
  beforeEach(() => {
    stubEnv("TRUSTED_ORIGINS", undefined);
    stubEnv("CLIENT_URL", undefined);
    stubEnv("BETTER_AUTH_SECRET", "test-secret");
    stubEnv("BETTER_AUTH_URL", undefined);
    stubEnv("NOTES_MASTER_KEY", Buffer.alloc(32, "t").toString("base64"));
    stubEnv("NOTES_MASTER_KEY_PREVIOUS", undefined);
    stubEnv("NOTES_KEY_VERSION", undefined);
    stubEnv("SMTP_URL", undefined);
    stubEnv("MAIL_FROM", undefined);
  });

  afterEach(() => {
    unstubAllEnvs();
  });

  describe("trustedOrigins", () => {
    it("splits TRUSTED_ORIGINS on commas, trimming and dropping empties", async () => {
      const { trustedOrigins } = await loadEnv({
        TRUSTED_ORIGINS: "https://a.test, https://b.test ,",
      });
      expect(trustedOrigins).toEqual(["https://a.test", "https://b.test"]);
    });

    it("falls back to CLIENT_URL when TRUSTED_ORIGINS is unset", async () => {
      const { trustedOrigins } = await loadEnv({
        CLIENT_URL: "https://client.test",
      });
      expect(trustedOrigins).toEqual(["https://client.test"]);
    });

    it("falls back to localhost:3000 when neither is set", async () => {
      const { trustedOrigins } = await loadEnv({});
      expect(trustedOrigins).toEqual(["http://localhost:3000"]);
    });
  });

  describe("betterAuthSecret", () => {
    it("throws on import when BETTER_AUTH_SECRET is unset", async () => {
      await expect(loadEnv({ BETTER_AUTH_SECRET: undefined })).rejects.toThrow(
        /BETTER_AUTH_SECRET/
      );
    });

    it("returns the configured secret", async () => {
      const { betterAuthSecret } = await loadEnv({
        BETTER_AUTH_SECRET: "hunter2",
      });
      expect(betterAuthSecret).toBe("hunter2");
    });
  });

  describe("betterAuthUrl", () => {
    it("exposes BETTER_AUTH_URL when set", async () => {
      const { betterAuthUrl } = await loadEnv({
        BETTER_AUTH_URL: "https://api.test",
      });
      expect(betterAuthUrl).toBe("https://api.test");
    });

    it("defaults to the client's development origin when unset", async () => {
      const { betterAuthUrl } = await loadEnv({ BETTER_AUTH_URL: undefined });
      expect(betterAuthUrl).toBe("http://localhost:3000");
    });
  });

  it("derives the MCP resource from the Better Auth URL", async () => {
    const { mcpResource } = await loadEnv({
      BETTER_AUTH_URL: "https://music.test",
    });
    expect(mcpResource).toBe("https://music.test/api/mcp");
  });

  describe("mcpEnabled", () => {
    it.each([
      "https://music.test",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
    ])("is on for %s", async (url) => {
      const { mcpEnabled } = await loadEnv({ BETTER_AUTH_URL: url });
      expect(mcpEnabled).toBe(true);
    });

    it("is off when MCP_DISABLED is set, whatever the URL", async () => {
      const { mcpEnabled } = await loadEnv({
        BETTER_AUTH_URL: "https://music.test",
        MCP_DISABLED: "1",
      });
      expect(mcpEnabled).toBe(false);
    });

    // The MCP plugin throws for these, so the server boots without it.
    it.each(["http://192.168.1.20:8080", "http://music.local:3000"])(
      "is off for %s",
      async (url) => {
        const { mcpEnabled } = await loadEnv({ BETTER_AUTH_URL: url });
        expect(mcpEnabled).toBe(false);
      }
    );
  });

  describe("notesMasterKeys", () => {
    it("throws on import when NOTES_MASTER_KEY is unset", async () => {
      await expect(loadEnv({ NOTES_MASTER_KEY: undefined })).rejects.toThrow(
        /NOTES_MASTER_KEY/
      );
    });

    it("throws on import when NOTES_MASTER_KEY decodes to the wrong length", async () => {
      await expect(
        loadEnv({
          NOTES_MASTER_KEY: Buffer.alloc(31, "t").toString("base64"),
        })
      ).rejects.toThrow(/NOTES_MASTER_KEY/);
    });

    it("leaves previous null when NOTES_MASTER_KEY_PREVIOUS is unset", async () => {
      const { notesMasterKeys } = await loadEnv({
        NOTES_MASTER_KEY_PREVIOUS: undefined,
      });
      expect(notesMasterKeys.previous).toBeNull();
    });

    it("decodes NOTES_MASTER_KEY_PREVIOUS when set", async () => {
      const previous = Buffer.alloc(32, "p");
      const { notesMasterKeys } = await loadEnv({
        NOTES_MASTER_KEY_PREVIOUS: previous.toString("base64"),
      });
      expect(notesMasterKeys.previous).toEqual(previous);
    });

    it("throws on import when NOTES_MASTER_KEY_PREVIOUS decodes to the wrong length", async () => {
      await expect(
        loadEnv({
          NOTES_MASTER_KEY_PREVIOUS: Buffer.alloc(10, "p").toString("base64"),
        })
      ).rejects.toThrow(/NOTES_MASTER_KEY_PREVIOUS/);
    });

    it("defaults the version to 1 when NOTES_KEY_VERSION is unset", async () => {
      const { notesMasterKeys } = await loadEnv({
        NOTES_KEY_VERSION: undefined,
      });
      expect(notesMasterKeys.version).toBe(1);
    });

    it("reads the version from NOTES_KEY_VERSION", async () => {
      const { notesMasterKeys } = await loadEnv({ NOTES_KEY_VERSION: "3" });
      expect(notesMasterKeys.version).toBe(3);
    });

    it.each(["0", "-1", "1.5", "two", "32768"])(
      "throws on import when NOTES_KEY_VERSION is %s",
      async (value) => {
        await expect(loadEnv({ NOTES_KEY_VERSION: value })).rejects.toThrow(
          /NOTES_KEY_VERSION/
        );
      }
    );
  });

  describe("trustedProxyHops", () => {
    it("defaults to 0 when TRUSTED_PROXY_HOPS is unset", async () => {
      const { trustedProxyHops } = await loadEnv({
        TRUSTED_PROXY_HOPS: undefined,
      });
      expect(trustedProxyHops).toBe(0);
    });

    it("reads the configured hop count", async () => {
      const { trustedProxyHops } = await loadEnv({
        TRUSTED_PROXY_HOPS: "2",
      });
      expect(trustedProxyHops).toBe(2);
    });

    it("throws on import for a negative or non-integer value", async () => {
      await expect(loadEnv({ TRUSTED_PROXY_HOPS: "-1" })).rejects.toThrow(
        /TRUSTED_PROXY_HOPS/
      );
      await expect(loadEnv({ TRUSTED_PROXY_HOPS: "1.5" })).rejects.toThrow(
        /TRUSTED_PROXY_HOPS/
      );
    });
  });

  describe("publicTlsMode", () => {
    it("is false when TLS_MODE is unset", async () => {
      const { publicTlsMode } = await loadEnv({ TLS_MODE: undefined });
      expect(publicTlsMode).toBe(false);
    });

    it("is false for the self-signed internal CA mode", async () => {
      const { publicTlsMode } = await loadEnv({ TLS_MODE: "internal" });
      expect(publicTlsMode).toBe(false);
    });

    it("is true only for TLS_MODE=acme", async () => {
      const { publicTlsMode } = await loadEnv({ TLS_MODE: "acme" });
      expect(publicTlsMode).toBe(true);
    });
  });

  describe("emailEnabled", () => {
    it("is false when SMTP_URL is unset", async () => {
      const { emailEnabled, smtpUrl, mailFromAddress } = await loadEnv({});
      expect(emailEnabled).toBe(false);
      expect(smtpUrl).toBeNull();
      expect(mailFromAddress).toBeNull();
    });

    it("is true once SMTP_URL is set", async () => {
      const { emailEnabled, smtpUrl } = await loadEnv({
        SMTP_URL: "smtps://user:pass@smtp.test:465",
        MAIL_FROM: "Projammr <noreply@test>",
      });
      expect(emailEnabled).toBe(true);
      expect(smtpUrl).toBe("smtps://user:pass@smtp.test:465");
    });

    it("throws on import when SMTP_URL is set but MAIL_FROM is not", async () => {
      await expect(
        loadEnv({
          SMTP_URL: "smtps://user:pass@smtp.test:465",
          MAIL_FROM: undefined,
        })
      ).rejects.toThrow(/MAIL_FROM/);
    });

    it("throws on import when MAIL_FROM has no address", async () => {
      await expect(
        loadEnv({
          SMTP_URL: "smtps://user:pass@smtp.test:465",
          MAIL_FROM: "not an address",
        })
      ).rejects.toThrow(/MAIL_FROM/);
    });

    it("parses a bare address out of MAIL_FROM", async () => {
      const { mailFromAddress } = await loadEnv({
        SMTP_URL: "smtps://user:pass@smtp.test:465",
        MAIL_FROM: "noreply@test",
      });
      expect(mailFromAddress).toBe("noreply@test");
    });

    it("parses the address out of a Name <address> MAIL_FROM, discarding the name", async () => {
      const { mailFromAddress } = await loadEnv({
        SMTP_URL: "smtps://user:pass@smtp.test:465",
        MAIL_FROM: "Projammr <noreply@test>",
      });
      expect(mailFromAddress).toBe("noreply@test");
    });
  });

  describe("parseMailFromAddress", () => {
    it("parses a bare address", async () => {
      const { parseMailFromAddress } = await loadEnv({});
      expect(parseMailFromAddress("noreply@test")).toBe("noreply@test");
    });

    it("parses a Name <address> form, discarding the name", async () => {
      const { parseMailFromAddress } = await loadEnv({});
      expect(parseMailFromAddress("Projammr <noreply@test>")).toBe(
        "noreply@test"
      );
    });

    it("returns null when nothing parses", async () => {
      const { parseMailFromAddress } = await loadEnv({});
      expect(parseMailFromAddress("")).toBeNull();
    });
  });
});
