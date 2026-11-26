-- Custom SQL migration file, put your code below! --

-- A merge node, no DDL: it joins the three open snapshot leaves (custom fields, device settings, relation
-- types) so drizzle-kit's commutativity check stops comparing branches that each carry the settings tables.
SELECT 1;
