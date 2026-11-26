-- Custom SQL migration file, put your code below! --

-- PROJ-1040: the three seeded global statuses (`20260802043107_seed-statuses`)
-- predate `colour_hex`, so `20260802043753_abnormal_nocturne` backfilled all of
-- them with the column default, `#FFFFFF`. The status chip is a filled pie in the
-- status's own colour, and a white pie is invisible on the light theme. Nothing
-- can repaint them afterwards: `updateStatus` refuses to change a null-project
-- row. Each UPDATE is keyed on `project_id IS NULL` as well as the name, so a
-- project's own status with the same name keeps the colour its owner chose.
UPDATE statuses SET colour_hex = '#8A8A8A' WHERE project_id IS NULL AND name = 'To Do';
--> statement-breakpoint
UPDATE statuses SET colour_hex = '#4A7FD4' WHERE project_id IS NULL AND name = 'In Progress';
--> statement-breakpoint
UPDATE statuses SET colour_hex = '#4CAF7A' WHERE project_id IS NULL AND name = 'Complete';
