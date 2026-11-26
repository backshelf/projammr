ALTER TABLE "projects" ALTER COLUMN "description" TYPE jsonb USING (
  CASE
    WHEN description IS NULL OR btrim(description) = '' THEN NULL
    WHEN btrim(description) LIKE '[%' THEN description::jsonb
    ELSE jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text, 'type', 'paragraph', 'props', '{}'::jsonb,
      'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', description, 'styles', '{}'::jsonb)),
      'children', '[]'::jsonb))
  END
);
