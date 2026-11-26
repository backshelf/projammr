-- Custom SQL migration file, put your code below! --

-- PROJ-847: before this release, `POST /statuses` accepted a body naming no
-- `projectId` and silently created an instance-wide status
-- (`middleware/project-resolvers.ts`'s old `resolveStatusRoute` fell through
-- to `projectFromBody`, which answered "skip" for a body with no project).
-- This cleans up whatever that produced. A null-project row is legitimate
-- only for the three names the seed migration shipped
-- (`20260802043107_seed-statuses`), which nothing can ever rename —
-- `updateStatus` refuses to change any null-project row, and
-- `statuses_global_name` allows only one null-project row per name. Anything
-- else with a null project is either bug debris or a status an admin added
-- directly by hand; either way it is safe to remove once nothing points at
-- it. `tracks.status_id` and `collections.status_id` both fall back to the
-- seeded "To Do" row (`ON DELETE SET DEFAULT`) rather than break, but
-- resetting a project's own status choice out from under it is not this
-- migration's call, so a referenced row is left alone and reported instead.
DELETE FROM statuses
WHERE project_id IS NULL
  AND name NOT IN ('To Do', 'In Progress', 'Complete')
  AND NOT EXISTS (SELECT 1 FROM tracks WHERE tracks.status_id = statuses.id)
  AND NOT EXISTS (SELECT 1 FROM collections WHERE collections.status_id = statuses.id);
--> statement-breakpoint

DO $$
DECLARE
  leftover RECORD;
BEGIN
  FOR leftover IN
    SELECT id, name, percentage
    FROM statuses
    WHERE project_id IS NULL
      AND name NOT IN ('To Do', 'In Progress', 'Complete')
  LOOP
    RAISE NOTICE 'statuses: global status % (id %, percentage %) is still referenced by a track or collection; leaving it in place — reassign those rows and delete it by hand', leftover.name, leftover.id, leftover.percentage;
  END LOOP;
END $$;
