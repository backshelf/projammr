-- Custom SQL migration file, put your code below! --

INSERT INTO track_audios (track_id, asset_id, version, is_primary, audio_peaks)
SELECT ta.track_id, ta.asset_id, 1, true, a.audio_peaks
FROM track_attachments ta
         JOIN assets a ON a.id = ta.asset_id
WHERE ta.primary_attachment = true;
