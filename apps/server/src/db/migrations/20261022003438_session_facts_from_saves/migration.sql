-- A session's DAW facts follow its newest save, which is how a dit push keeps
-- them from now on: once, every session whose newest save carries a meta takes
-- that meta's tempo, key, time signature, counts, DAW version and structure.
UPDATE "sessions" s
   SET "tempo" = (newest."meta" ->> 'tempo')::numeric,
       "time_signature" = newest."meta" ->> 'timeSignature',
       "root_note" = newest."meta" ->> 'rootNote',
       "scale" = newest."meta" ->> 'scale',
       "tracks_count" = (newest."meta" ->> 'tracksCount')::integer,
       "scenes_count" = (newest."meta" ->> 'scenesCount')::integer,
       "daw_version" = newest."meta" ->> 'dawVersion',
       "structure" = nullif(newest."meta" -> 'structure', 'null'::jsonb)
  FROM (
    SELECT DISTINCT ON ("session_id") "session_id", "meta"
      FROM "saves"
     ORDER BY "session_id", "file_updated_at" DESC
  ) newest
 WHERE newest."session_id" = s."id"
   AND newest."meta" IS NOT NULL;
