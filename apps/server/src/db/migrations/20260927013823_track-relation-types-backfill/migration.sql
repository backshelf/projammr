-- Custom SQL migration file, put your code below! --

-- The `relation_type` enum becomes a per-project list (`track_relation_types`).
-- Every project gets the eight types the enum named, each under the enum
-- value's own name and in the enum's order, and every relation points at the
-- type of its enum value's name in its from-track's project (the derivative,
-- the track a relation is added on). The list repeats `DEFAULT_RELATION_TYPES`
-- (`db/queries/track-relation-types.ts`), which seeds each project created from
-- here on; a migration cannot import it.
INSERT INTO track_relation_types (project_id, name, rank)
SELECT projects.id, seeded.name, seeded.rank
FROM projects
CROSS JOIN (VALUES
  ('remix', 0),
  ('remaster', 1),
  ('rework', 2),
  ('edit', 3),
  ('live version', 4),
  ('cover', 5),
  ('instrumental', 6),
  ('acoustic', 7)
) AS seeded (name, rank);
--> statement-breakpoint
UPDATE track_relations SET relation_type_id = track_relation_types.id
FROM tracks
JOIN track_relation_types ON track_relation_types.project_id = tracks.project_id
WHERE tracks.id = track_relations.from_track_id
  AND track_relation_types.name = track_relations.relation::text;
--> statement-breakpoint
-- Every enum value has a seeded type in every project, so nothing should be
-- left; the next migration makes `relation_type_id` NOT NULL and drops the
-- enum, and a relation missed here would lose its type for good, so this stops
-- the run instead.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM track_relations WHERE relation_type_id IS NULL) THEN
    RAISE EXCEPTION 'relation type backfill left a track relation without a type';
  END IF;
END $$;
