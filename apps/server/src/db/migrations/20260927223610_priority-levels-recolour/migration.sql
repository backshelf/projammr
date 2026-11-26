-- Custom SQL migration file, put your code below! --

-- PROJ-1273: the seed ramp painted every level in the light-theme greys the
-- old badge used (`#525252`, `#898989`, `#525252`, `#020202`, `#020202`);
-- None and Medium shared a colour, High and Urgent shared one, and `#020202`
-- all but vanished as a chip tint on the dark theme. This recolours a level
-- only if it still carries BOTH its seeded name and its seeded (old) colour
-- at its seeded rank — a level whose editor renamed or recoloured it is left
-- alone, since matching on name or colour alone would misfire on the two
-- repeated old colours. The new values repeat `DEFAULT_PRIORITY_LEVELS`
-- (`db/queries/priority-levels.ts`), which seeds each project created from
-- here on; a migration cannot import it.
CREATE TEMPORARY TABLE priority_recolour (
  name text PRIMARY KEY,
  old_colour text NOT NULL,
  rank integer NOT NULL,
  new_colour text NOT NULL
);
--> statement-breakpoint
INSERT INTO priority_recolour (name, old_colour, rank, new_colour) VALUES
  ('None', '#525252', 0, '#6C7278'),
  ('Low', '#898989', 1, '#0891C9'),
  ('Medium', '#525252', 2, '#D6B529'),
  ('High', '#020202', 3, '#F06B00'),
  ('Urgent', '#020202', 4, '#D0183A');
--> statement-breakpoint
UPDATE priority_levels SET colour = priority_recolour.new_colour
FROM priority_recolour
WHERE priority_levels.name = priority_recolour.name
  AND priority_levels.colour = priority_recolour.old_colour
  AND priority_levels.rank = priority_recolour.rank;
--> statement-breakpoint
DROP TABLE priority_recolour;