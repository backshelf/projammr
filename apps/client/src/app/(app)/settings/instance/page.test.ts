import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const getMe = mock();

mock.module("@/actions/me", () => ({
  getMe,
  getMyProjects: mock(),
}));

class NotFoundError extends Error {}

// The page imports the hub's whole tree, and with it every export of
// `next/navigation` some part of it names; only the 404 is replaced.
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  notFound: () => {
    throw new NotFoundError("NOT_FOUND");
  },
}));

const Page = (await import("./[[...group]]/page")).default;

const request = (group?: string[]) => ({
  params: Promise.resolve(group === undefined ? {} : { group }),
  searchParams: Promise.resolve({}),
});

beforeEach(() => {
  getMe.mockReset();
});

describe("the Instance settings page", () => {
  it("is not reachable for a caller who does not administer the instance", async () => {
    getMe.mockResolvedValue({ instanceRole: "user" });

    await expect(Page(request())).rejects.toBeInstanceOf(NotFoundError);
    await expect(Page(request(["member-defaults"]))).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it("renders for a caller who does administer the instance", async () => {
    getMe.mockResolvedValue({ instanceRole: "admin" });

    await expect(Page(request())).resolves.toBeTruthy();
  });

  it("is not reachable when /me could not be read", async () => {
    getMe.mockResolvedValue({ error: "Unauthorized" });

    await expect(Page(request())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is a 404 for a path deeper than a group", async () => {
    getMe.mockResolvedValue({ instanceRole: "admin" });

    await expect(Page(request(["access", "extra"]))).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});
