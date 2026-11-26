-- Custom SQL migration file, put your code below! --

-- PROJ-1228: the `priority` enum becomes a per-project scale
-- (`priority_levels`). Every project gets the five levels the enum named, in
-- the enum's order, with None its default, and every track, collection and
-- session points at its own project's level for the value it held. The names
-- and colours repeat `DEFAULT_PRIORITY_LEVELS` (`db/queries/priority-levels.ts`),
-- which seeds each project created from here on; a migration cannot import it.
-- The colours are the light-theme greys the priority badge painted each value
-- in (`--ink-soft` for None and Medium, `--ink-faint` for Low, `--ink` for High
-- and Urgent), so nothing looks different until someone edits a scale.
CREATE TEMPORARY TABLE priority_scale (
  value priority PRIMARY KEY,
  name text NOT NULL,
  colour text NOT NULL,
  rank integer NOT NULL,
  is_default boolean NOT NULL
);
--> statement-breakpoint
INSERT INTO priority_scale (value, name, colour, rank, is_default) VALUES
  ('none', 'None', '#525252', 0, true),
  ('low', 'Low', '#898989', 1, false),
  ('medium', 'Medium', '#525252', 2, false),
  ('high', 'High', '#020202', 3, false),
  ('urgent', 'Urgent', '#020202', 4, false);
--> statement-breakpoint
INSERT INTO priority_levels (project_id, name, colour, rank, is_default)
SELECT projects.id, priority_scale.name, priority_scale.colour, priority_scale.rank, priority_scale.is_default
FROM projects
CROSS JOIN priority_scale;
--> statement-breakpoint
UPDATE tracks SET priority_id = priority_levels.id
FROM priority_scale
JOIN priority_levels ON priority_levels.name = priority_scale.name
WHERE priority_scale.value = tracks.priority
  AND priority_levels.project_id = tracks.project_id;
--> statement-breakpoint
UPDATE collections SET priority_id = priority_levels.id
FROM priority_scale
JOIN priority_levels ON priority_levels.name = priority_scale.name
WHERE priority_scale.value = collections.priority
  AND priority_levels.project_id = collections.project_id;
--> statement-breakpoint
UPDATE sessions SET priority_id = priority_levels.id
FROM priority_scale
JOIN priority_levels ON priority_levels.name = priority_scale.name
WHERE priority_scale.value = sessions.priority
  AND priority_levels.project_id = sessions.project_id;
--> statement-breakpoint
-- Every enum value has a seeded level, so nothing should be left; the next
-- migration makes `priority_id` NOT NULL and drops the enum, and a row missed
-- here would lose its priority for good, so this stops the run instead.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tracks WHERE priority_id IS NULL)
     OR EXISTS (SELECT 1 FROM collections WHERE priority_id IS NULL)
     OR EXISTS (SELECT 1 FROM sessions WHERE priority_id IS NULL)
  THEN
    RAISE EXCEPTION 'priority backfill left a track, collection or session without a level';
  END IF;
END $$;
--> statement-breakpoint
DROP TABLE priority_scale;
