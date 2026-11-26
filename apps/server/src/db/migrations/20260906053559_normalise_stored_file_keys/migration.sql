-- Stored files are addressed by their key relative to the static root
-- (`images/<uuid>.png`), in every column that names one.
--
-- Previously `assets.asset_path` and `images.image_path` held the on-disk path
-- (`./static/...`) while an entity's `image` column held the URL
-- (`/static/...`), so resolving a cover meant stripping both shapes with
-- `regexp_replace` — which made the index on the column unusable. The three
-- column families now hold the same string, and `storedFilePath`/`staticUrl`
-- render it for disk and for the wire.

UPDATE "assets"
  SET "asset_path" = regexp_replace("asset_path", '^[.]?/?(static/)?', '')
  WHERE "asset_path" ~ '^[.]?/?static/';--> statement-breakpoint

UPDATE "images"
  SET "image_path" = regexp_replace("image_path", '^[.]?/?(static/)?', '')
  WHERE "image_path" ~ '^[.]?/?static/';--> statement-breakpoint

UPDATE "projects"
  SET "image" = regexp_replace("image", '^[.]?/?(static/)?', '')
  WHERE "image" ~ '^[.]?/?static/';--> statement-breakpoint

UPDATE "collections"
  SET "image" = regexp_replace("image", '^[.]?/?(static/)?', '')
  WHERE "image" ~ '^[.]?/?static/';--> statement-breakpoint

UPDATE "tracks"
  SET "image" = regexp_replace("image", '^[.]?/?(static/)?', '')
  WHERE "image" ~ '^[.]?/?static/';
