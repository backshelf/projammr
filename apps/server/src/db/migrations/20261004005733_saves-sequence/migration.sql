-- The table rename keeps its identity sequence's old name; the snapshot names it after the table.
ALTER SEQUENCE "session_revisions_id_seq" RENAME TO "saves_id_seq";
