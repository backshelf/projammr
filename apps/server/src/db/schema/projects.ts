import { isNull } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-orm/zod";
import { z } from "zod";
import { users } from "./auth.js";
import {
  baseSchema,
  baseSchemaIgnores,
  blockDocumentSchema,
  type BlockDocument,
} from "./base.js";
import { memberRoleEnum } from "./enums.js";

export const projects = pgTable("projects", {
  ...baseSchema,
  name: text("name").notNull(),
  description: jsonb("description").$type<BlockDocument>(),
  links: jsonb("links").$type<
    {
      name: string;
      url: string;
    }[]
  >(),
  image: text("image"),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

const projectLinkSchema = z.object({ name: z.string(), url: z.url() });

export const projectSchema = createSelectSchema(projects).extend({
  description: blockDocumentSchema.nullable(),
});
export const newProjectSchema = createInsertSchema(projects)
  .omit({ ...baseSchemaIgnores, description: true, links: true })
  .extend({
    name: z.string().trim().min(1),
    description: blockDocumentSchema.nullable().optional(),
    links: z.array(projectLinkSchema),
  });
export const editProjectSchema = createUpdateSchema(projects)
  .omit({ ...baseSchemaIgnores, description: true, links: true })
  .extend({
    name: z.string().trim().min(1).optional(),
    description: blockDocumentSchema.nullable().optional(),
    links: z.array(projectLinkSchema).optional(),
  });

export const members = pgTable(
  "members",
  {
    ...baseSchema,
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    projectId: integer("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    role: memberRoleEnum("role").notNull().default("viewer"),
  },
  (t) => [
    unique("member_user_project").on(t.userId, t.projectId),
    // The unique constraint leads with `user_id`, so it cannot serve the
    // project's member list or the owner count.
    index("members_project").on(t.projectId),
  ]
);

export const memberSchema = createSelectSchema(members);

export const invites = pgTable(
  "invites",
  {
    ...baseSchema,
    projectId: integer("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    email: text("email").notNull(),
    role: memberRoleEnum("role").notNull().default("viewer"),
    token: text("token").notNull().unique(),
    invitedBy: text("invited_by").references(() => users.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
  },
  (t) => [
    // One pending invite per email per project; a fresh invite may be sent
    // once a prior one is accepted.
    uniqueIndex("invite_project_email")
      .on(t.projectId, t.email)
      .where(isNull(t.acceptedAt)),
  ]
);

export const inviteSchema = createSelectSchema(invites);
