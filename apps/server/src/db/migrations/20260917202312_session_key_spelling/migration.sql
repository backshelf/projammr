-- A session's root note and scale were free text, so the rows written before
-- they were normalised on the wire carry whatever spelling their writer used.
-- `session_revisions.meta` snapshots the same two fields and is rewritten with
-- them: a revision left in the old spelling reads back as an edit the file
-- never had.
--
-- `spelling` is the SQL form of `ROOT_NOTES` and `ENHARMONIC_ROOT_NOTES` in
-- `src/db/schema/sessions.ts` — the twelve pitches as they are stored, then
-- every other spelling of those same pitches, keyed by the uppercased input
-- with `♯`/`♭` folded to ASCII. A root note that matches neither names no
-- pitch and becomes null.
with spelling (input, canonical) as (
	values ('C', 'C'), ('C#', 'C#'), ('D', 'D'), ('D#', 'D#'), ('E', 'E'),
	       ('F', 'F'), ('F#', 'F#'), ('G', 'G'), ('G#', 'G#'), ('A', 'A'),
	       ('A#', 'A#'), ('B', 'B'),
	       ('CB', 'B'), ('B#', 'C'), ('DB', 'C#'), ('EB', 'D#'), ('E#', 'F'),
	       ('FB', 'E'), ('GB', 'F#'), ('AB', 'G#'), ('BB', 'A#')
),
written (source, id, root_note, scale) as (
	select 'session', id, root_note, scale
	from sessions
	where root_note is not null or scale is not null
	union all
	select 'revision', id, meta ->> 'rootNote', meta ->> 'scale'
	from session_revisions
	where meta ->> 'rootNote' is not null or meta ->> 'scale' is not null
),
normalised as (
	select
		w.source,
		w.id,
		(
			select canonical from spelling
			where input = upper(replace(replace(btrim(w.root_note), '♯', '#'), '♭', 'b'))
		) as root_note,
		case
			when btrim(w.scale) = '' then null
			when lower(btrim(w.scale)) = 'major' then 'Major'
			when lower(btrim(w.scale)) = 'minor' then 'Minor'
			else btrim(w.scale)
		end as scale
	from written w
),
updated_sessions as (
	update sessions s
	set root_note = n.root_note, scale = n.scale
	from normalised n
	where n.source = 'session' and n.id = s.id
),
updated_revisions as (
	update session_revisions r
	set meta = jsonb_set(
		jsonb_set(r.meta, '{rootNote}', coalesce(to_jsonb(n.root_note), 'null'::jsonb), false),
		'{scale}',
		coalesce(to_jsonb(n.scale), 'null'::jsonb),
		false
	)
	from normalised n
	where n.source = 'revision' and n.id = r.id
)
select 1;
