-- Attributes the rows dit pushed before machines were recorded on them. A row
-- takes a machine only where one machine can be told from the data alone;
-- every other row stays null, and so does every row the scanner recorded.

-- A commit: the machine of its author that carries the commit's name. A user's
-- machine names are unique, so there is at most one.
UPDATE "commits" c
   SET "machine_id" = m."id"
  FROM "machines" m
 WHERE c."machine_id" IS NULL
   AND c."author_id" = m."user_id"
   AND c."machine_name" = m."name";--> statement-breakpoint

-- A save dit recorded: through the commit that covers it, the first on its
-- branch whose own save is at or after it, when that commit names the same
-- machine. The source is compared as text: a database migrated from scratch
-- runs this in the transaction that added the value 'dit' to the enum, which
-- forbids using the value as an enum.
UPDATE "saves" s
   SET "machine_id" = cover."machine_id"
  FROM (
    SELECT DISTINCT ON (s2."id") s2."id" AS "save_id", c."machine_id", c."machine_name"
      FROM "saves" s2
      JOIN "commits" c ON c."branch_id" = s2."branch_id"
      JOIN "saves" own ON own."id" = c."save_id" AND own."file_updated_at" >= s2."file_updated_at"
     WHERE s2."source"::text = 'dit'
       AND s2."machine_name" IS NOT NULL
     ORDER BY s2."id", own."file_updated_at" ASC
  ) cover
 WHERE s."id" = cover."save_id"
   AND cover."machine_id" IS NOT NULL
   AND s."machine_name" = cover."machine_name";--> statement-breakpoint

-- A segment: through the commits of its session that name the same machine,
-- when they are all one author's and all attributed to one machine.
UPDATE "time_segments" t
   SET "machine_id" = named."machine_id"
  FROM (
    SELECT "session_id", "machine_name", min("machine_id") AS "machine_id"
      FROM "commits"
     WHERE "machine_name" IS NOT NULL
     GROUP BY "session_id", "machine_name"
    HAVING count(DISTINCT "author_id") = 1
       AND count(DISTINCT "machine_id") = 1
       AND bool_and("machine_id" IS NOT NULL)
  ) named
 WHERE t."machine_id" IS NULL
   AND t."session_id" = named."session_id"
   AND t."machine_name" = named."machine_name";--> statement-breakpoint

-- A repo's last push: the machine of its newest commit, when that is known.
UPDATE "repos" r
   SET "last_push_machine_id" = newest."machine_id"
  FROM (
    SELECT DISTINCT ON ("repo_id") "repo_id", "machine_id"
      FROM "commits"
     ORDER BY "repo_id", "committed_at" DESC, "id" DESC
  ) newest
 WHERE r."id" = newest."repo_id"
   AND r."last_push_at" IS NOT NULL
   AND newest."machine_id" IS NOT NULL;
