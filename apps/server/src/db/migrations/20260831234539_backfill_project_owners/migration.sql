-- Every project needs exactly one owner. Promote the earliest-added member of
-- each project (lowest members.id) to owner; the rest keep their role.
UPDATE "members"
SET "role" = 'owner'
WHERE "id" IN (SELECT MIN("id")
               FROM "members"
               WHERE "project_id" IS NOT NULL
               GROUP BY "project_id");
