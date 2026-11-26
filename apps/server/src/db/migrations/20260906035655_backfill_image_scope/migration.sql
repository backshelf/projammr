-- Every image that predates the scope column and belongs to no project is an
-- avatar: the images upload route is the only writer, and it only omits a
-- project id for a user's own picture.
UPDATE "images" SET "scope" = 'user' WHERE "project_id" IS NULL;
