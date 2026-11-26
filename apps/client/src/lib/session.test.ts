import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const readCachedSessionCookie = mock();
const getSession = mock();

mock.module("@/lib/auth-server", () => ({
  readCachedSessionCookie,
  authServerClient: { getSession },
}));

const { getCachedSession } = await import("./session");

beforeEach(() => {
  readCachedSessionCookie.mockReset();
  getSession.mockReset();
});

describe("getCachedSession", () => {
  it("answers from the cookie without asking the API", async () => {
    readCachedSessionCookie.mockResolvedValue({
      user: { id: "user_1", isAnonymous: false },
      session: { id: "session_1" },
    });

    expect((await getCachedSession()).kind).toBe("member");
    expect(getSession).not.toHaveBeenCalled();
  });

  it("asks the API when there is no cookie", async () => {
    readCachedSessionCookie.mockResolvedValue(null);
    getSession.mockResolvedValue({ data: null, error: { status: 401 } });

    expect((await getCachedSession()).kind).toBe("signed-out");
  });

  // An unreachable API rejects rather than answering, which used to escape the
  // session read and take the whole page to the error boundary.
  it("reports a rejected read as unavailable rather than throwing", async () => {
    readCachedSessionCookie.mockResolvedValue(null);
    getSession.mockRejectedValue(new TypeError("fetch failed"));

    await expect(getCachedSession()).resolves.toEqual({ kind: "unavailable" });
  });
});
