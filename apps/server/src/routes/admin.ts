import { Hono } from "hono";
import { z } from "zod";
import type { AuthedEnv } from "../auth.js";
import {
  changeInstanceUser,
  getInstanceUser,
  instanceUserPatchSchema,
  instanceUserSchema,
  instanceUsersSchema,
  listInstanceUsers,
} from "../db/queries/instance-users.js";
import { paginationQuerySchema } from "../db/queries/pagination.js";
import { listAdminMachines } from "../db/queries/machines.js";
import { adminMachinesSchema } from "../db/schema/machines.js";
import { recordAdminAction } from "../db/queries/admin-audit.js";
import { mintResetLink } from "../db/queries/reset-link.js";
import { clearLockout } from "../db/queries/signin-attempts.js";
import { lastSaveContentSweep } from "../db/queries/save-retention.js";
import { lastStorageAudit } from "../db/queries/storage-audit.js";
import {
  allUsageReports,
  instanceUsedBytes,
  repositoryBytesByProject,
  sharedRepoStorage,
} from "../db/queries/storage-usage.js";
import {
  projectStorageReportSchema,
  storageReportSchema,
} from "../db/schema/storage-usage.js";
import { describer, params, respond, validator } from "../lib/http.js";
import { log } from "../lib/log.js";

const { describe } = describer("Instance admin");

const app = new Hono<AuthedEnv>({ strict: false });

/** What the last audit did, as the readout shows it. Null before one has run. */
const auditSummarySchema = z
  .object({
    jobId: z.number(),
    status: z.string(),
    finishedAt: z.string().nullable(),
    deleted: z.number().nullable(),
    deletedBytes: z.number().nullable(),
    driftedScopes: z.number().nullable(),
  })
  .nullable();

/** The last retention sweep to finish, as the retention setting shows it. Null before one has. */
const sweepSummarySchema = z
  .object({
    finishedAt: z.string().nullable(),
    status: z.enum(["done", "failed"]),
    bytesFreed: z.number(),
  })
  .nullable();

const instanceStorageSchema = z.object({
  /** Every project's files plus the avatars, which belong to no project. */
  usedBytes: z.number(),
  /** Each project with what it pays of the repo objects in `repositoryBytes`. */
  projects: z.array(projectStorageReportSchema),
  users: z.array(storageReportSchema),
  /** What holding repo objects once saves: projects sharing and bytes not charged twice. */
  sharing: z.object({ projects: z.number(), savedBytes: z.number() }),
  lastAudit: auditSummarySchema,
  /** The last prune of uncommitted save content: when, whether it finished, bytes freed. */
  lastSweep: sweepSummarySchema,
});

const countOf = (result: Record<string, unknown> | null, key: string) =>
  typeof result?.[key] === "number" ? (result[key] as number) : null;

app.get(
  "/storage",
  describe(
    "Storage across the instance: the total, every project's and every " +
      "account's usage, and what the last orphan audit found.",
    { schema: instanceStorageSchema, description: "Instance storage" },
    404
  ),
  async (c) => {
    const [usedBytes, reports, audit, repositoryBytes, sharing, sweep] =
      await Promise.all([
        instanceUsedBytes(),
        allUsageReports(),
        lastStorageAudit(),
        repositoryBytesByProject(),
        sharedRepoStorage(),
        lastSaveContentSweep(),
      ]);

    return respond(c, instanceStorageSchema, {
      usedBytes,
      projects: reports
        .filter((report) => report.scopeKind === "project")
        .map((report) => ({
          ...report,
          repositoryBytes: repositoryBytes.get(Number(report.scopeId)) ?? 0,
        })),
      users: reports.filter((report) => report.scopeKind === "user"),
      sharing,
      lastSweep: sweep
        ? {
            finishedAt: sweep.finishedAt?.toISOString() ?? null,
            status: sweep.status,
            bytesFreed: sweep.bytesFreed,
          }
        : null,
      lastAudit: audit
        ? {
            jobId: audit.id,
            status: audit.status,
            finishedAt: audit.finishedAt?.toISOString() ?? null,
            deleted: countOf(audit.result, "deleted"),
            deletedBytes: countOf(audit.result, "deletedBytes"),
            driftedScopes: countOf(audit.result, "driftedScopes"),
          }
        : null,
    });
  }
);

/** The two pagination params; the account list has no sort, filter or grouping. */
const usersQuerySchema = paginationQuerySchema.pick({
  page: true,
  pageSize: true,
});

app.get(
  "/users",
  describe(
    "The instance's accounts, oldest first: who they are, what they are using and whether they are disabled.",
    { schema: instanceUsersSchema, description: "Accounts" },
    400,
    404
  ),
  validator("query", usersQuerySchema),
  async (c) => {
    const { page, pageSize } = c.req.valid("query");
    return respond(
      c,
      instanceUsersSchema,
      await listInstanceUsers(page, pageSize)
    );
  }
);

app.get(
  "/machines",
  describe(
    "Every account's dit machines, most recently seen first: whose each is, its platform, dit version and last beat. Removed machines are not listed.",
    { schema: adminMachinesSchema, description: "Machines" },
    400,
    404
  ),
  validator("query", usersQuerySchema),
  async (c) => {
    const { page, pageSize } = c.req.valid("query");
    return respond(
      c,
      adminMachinesSchema,
      await listAdminMachines(page, pageSize)
    );
  }
);

app.patch(
  "/users/:id",
  describe(
    "Change an account's instance role or disable it. Refused with 409 when it would leave the instance without an admin who can sign in.",
    { schema: instanceUserSchema, description: "Account" },
    400,
    404,
    409
  ),
  // A Better Auth user id is an opaque string, not one of the numeric row ids
  // `idParam` validates.
  params({ id: z.string().min(1) }),
  validator("json", instanceUserPatchSchema),
  async (c) =>
    respond(
      c,
      instanceUserSchema,
      await changeInstanceUser(
        c.req.valid("param").id,
        c.req.valid("json"),
        c.get("user").id
      )
    )
);

const resetLinkSchema = z.object({ url: z.string() });

app.post(
  "/users/:id/reset-link",
  describe(
    "Mint a password reset link for an account. One-time and valid for one hour, the way a mailed reset would be. Returned once — hand it to the account holder directly — and clears the address's sign-in lockout.",
    { schema: resetLinkSchema, description: "Reset link" },
    404
  ),
  params({ id: z.string().min(1) }),
  async (c) => {
    const target = await getInstanceUser(c.req.valid("param").id);
    const url = await mintResetLink(target.id);
    await clearLockout(target.email);
    const byUserId = c.get("user").id;
    await recordAdminAction({
      action: "reset_link_issued",
      actorId: byUserId,
      targetUserId: target.id,
    });
    log("admin").info("issued a password reset link", {
      targetUserId: target.id,
      byUserId,
    });
    return respond(c, resetLinkSchema, { url });
  }
);

export default app;
