//! Direct render upload (`dit renders add`) and one-shot directory scanning (`dit renders scan`).
//!
//! Both reuse the render engine's own pairing, batch exclusion, fingerprinting, scoring, and streaming upload
//! machinery so one-shot imports behave the same as the background watcher.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use dit_core::remote::Remote;
use serde::{Deserialize, Serialize};

use super::driver::{SessionFacts, bounced_from, session_facts};
use super::engine::{SetRef, judge_render};
use super::ledger::Ledger;
use super::probe::fingerprint;
use super::rules::{
    Candidate, Choice, Exclusions, batches, group_pairs, is_audio_path, upload_choice,
};
use super::upload::{
    AcceptDetailed, TrackAudioSummary, UploadMeta, accept_detailed, link_track_audio, lookup,
    set_primary_audio, upload_with_meta,
};

/// Options for adding one audio file to a track (and optionally a session).
#[derive(Debug, Clone)]
pub struct AddOptions {
    pub track_id: i64,
    pub session_id: Option<i64>,
    pub primary: bool,
    pub machine_name: Option<String>,
}

/// The result of uploading (or deduplicating) and attaching one audio render.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddedRender {
    pub file: PathBuf,
    pub track_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<i64>,
    pub asset_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_audio_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
    pub is_primary: bool,
    pub deduplicated: bool,
    pub fingerprint: String,
    pub size: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackProject {
    project_id: i64,
}

fn file_timestamps_ms(meta: &fs::Metadata) -> (Option<i64>, i64) {
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as i64);
    let ctime_ms = meta
        .created()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .or(if mtime_ms > 0 { Some(mtime_ms) } else { None });
    (ctime_ms, mtime_ms)
}

fn find_audio(audios: &[TrackAudioSummary], asset_id: i64) -> Option<&TrackAudioSummary> {
    audios.iter().find(|audio| audio.asset_id == asset_id)
}

/// Fingerprints `file`, checks `POST /api/assets/lookup` for deduplication, streams to `POST /api/assets/upload`
/// when absent, and attaches the asset to `options.track_id` (or `options.session_id` via
/// `POST /api/sessions/:id/renders` when a session is supplied).
pub fn add_render(
    remote: &Remote,
    file: &Path,
    options: AddOptions,
    on_upload: &mut dyn FnMut(&Path, u64),
) -> Result<AddedRender, String> {
    if !file.is_file() {
        return Err(format!(
            "Cannot read {}: file does not exist.",
            file.display()
        ));
    }
    if !is_audio_path(file) {
        return Err(format!("{} is not a supported audio file.", file.display()));
    }
    let meta = fs::metadata(file).map_err(|e| format!("{}: {e}", file.display()))?;
    let size = meta.len();
    let (created_at_ms, mtime_ms) = file_timestamps_ms(&meta);
    let fp = fingerprint(file).map_err(|e| format!("{}: {e}", file.display()))?;

    let project_id = if let Some(session_id) = options.session_id {
        let facts = session_facts(remote, session_id).map_err(|e| e.to_string())?;
        if let Some(session_track_id) = facts.track_id
            && session_track_id != options.track_id
        {
            return Err(format!(
                "Session {session_id} belongs to track {session_track_id}, not track {}.",
                options.track_id
            ));
        }
        facts.project_id
    } else {
        let track: TrackProject = remote
            .get(&format!("/tracks/{}", options.track_id))
            .map_err(|e| e.to_string())?;
        track.project_id
    };

    let (asset_id, deduplicated) =
        match lookup(remote, project_id, &fp).map_err(|e| e.to_string())? {
            Some(existing) => (existing, true),
            None => {
                on_upload(file, size);
                let local_filepath = file.to_string_lossy().into_owned();
                let upload_meta = UploadMeta {
                    local_filepath: Some(&local_filepath),
                    local_file_created_at: created_at_ms,
                    local_file_updated_at: if mtime_ms > 0 { Some(mtime_ms) } else { None },
                    local_file_machine_name: options.machine_name.as_deref(),
                };
                let uploaded = upload_with_meta(
                    remote,
                    project_id,
                    &fp,
                    file,
                    Some(&upload_meta),
                    &mut |_, _| {},
                )
                .map_err(|e| e.to_string())?;
                (uploaded, false)
            }
        };

    let (track_audio_id, version, mut is_primary) = if let Some(session_id) = options.session_id {
        let bounced_save = bounced_from(remote, session_id, mtime_ms);
        match accept_detailed(remote, session_id, asset_id, bounced_save)
            .map_err(|e| e.to_string())?
        {
            AcceptDetailed::NoTrack => {
                return Err(format!(
                    "Session {session_id} has no track yet; link it to track {} first.",
                    options.track_id
                ));
            }
            AcceptDetailed::Accepted { audios, .. } => {
                let matched = find_audio(&audios, asset_id);
                let audio_id = matched.map(|a| a.id);
                let version = matched.map(|a| a.version);
                let already_primary = matched.is_some_and(|a| a.is_primary);
                if options.primary
                    && !already_primary
                    && let Some(id) = audio_id
                {
                    set_primary_audio(remote, id).map_err(|e| e.to_string())?;
                    (audio_id, version, true)
                } else {
                    (audio_id, version, already_primary)
                }
            }
        }
    } else {
        let audios = link_track_audio(remote, options.track_id, asset_id, options.primary)
            .map_err(|e| e.to_string())?;
        let matched = find_audio(&audios, asset_id);
        (
            matched.map(|a| a.id),
            matched.map(|a| a.version),
            matched.is_some_and(|a| a.is_primary) || options.primary,
        )
    };

    if options.primary && track_audio_id.is_some() {
        is_primary = true;
    }

    Ok(AddedRender {
        file: file.to_path_buf(),
        track_id: options.track_id,
        session_id: options.session_id,
        asset_id,
        track_audio_id,
        version,
        is_primary,
        deduplicated,
        fingerprint: fp,
        size,
    })
}

/// Options for one-shot directory render scanning.
#[derive(Debug, Clone)]
pub struct ScanOptions {
    pub dir: PathBuf,
    pub apply: bool,
    pub min_confidence: f64,
    pub max_upload_mb: u64,
    pub export_dirs: Vec<PathBuf>,
    pub excluded: Vec<PathBuf>,
    pub managed_subfolders: Vec<String>,
    pub ledger_path: Option<PathBuf>,
    pub machine_name: Option<String>,
}

/// Outcome for a matched render found during a scan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScanMatchStatus {
    Proposed,
    Uploaded,
    Deduplicated,
    OverLimit,
    SkippedNoTrack,
    Failed,
}

/// A render matched to a pushed session during `dit renders scan`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedMatch {
    pub name: String,
    pub chosen_file: PathBuf,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skipped_files: Vec<PathBuf>,
    pub size: u64,
    pub mtime_ms: i64,
    pub fingerprint: String,
    pub session_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_title: Option<String>,
    pub confidence: f64,
    pub reasons: Vec<String>,
    pub status: ScanMatchStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_audio_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Summary of a one-shot render directory scan.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub dir: PathBuf,
    pub applied: bool,
    pub min_confidence: f64,
    pub total_audio_files: usize,
    pub skipped_batch_renders: usize,
    pub unmatched_renders: usize,
    pub matches: Vec<ScannedMatch>,
}

fn collect_audio_candidates(
    root: &Path,
    exclusions: &Exclusions,
    out: &mut Vec<Candidate>,
) -> Result<(), String> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(error) if dir == root => {
                return Err(format!("Cannot read {}: {error}", root.display()));
            }
            Err(_) => continue,
        };
        let mut children: Vec<PathBuf> = entries
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .collect();
        children.sort();
        for path in children {
            if exclusions.excludes_below(root, &path) {
                continue;
            }
            let Ok(meta) = fs::symlink_metadata(&path) else {
                continue;
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                stack.push(path);
            } else if meta.is_file() && is_audio_path(&path) {
                let (_, mtime_ms) = file_timestamps_ms(&meta);
                out.push(Candidate {
                    path,
                    size: meta.len(),
                    mtime_ms,
                });
            }
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(())
}

/// Walks `options.dir`, pairs multi-format bounces, skips stem-export batches and rejected fingerprints, scores
/// each render against `sets`, and (when `options.apply` is true) uploads and attaches each matched render.
pub fn scan_dir(
    remote: &Remote,
    sets: &[SetRef],
    options: &ScanOptions,
    on_progress: &mut dyn FnMut(&str),
) -> Result<ScanResult, String> {
    if !options.dir.is_dir() {
        return Err(format!(
            "Cannot scan {}: not a directory.",
            options.dir.display()
        ));
    }
    let ledger = options
        .ledger_path
        .as_deref()
        .and_then(|path| Ledger::load(path).ok())
        .unwrap_or_default();
    let managed: Vec<&str> = options
        .managed_subfolders
        .iter()
        .map(String::as_str)
        .collect();
    let mut exclusions = Exclusions::new(&managed, &ledger.never_here);
    exclusions.set_excluded(&options.excluded);

    let mut candidates = Vec::new();
    collect_audio_candidates(&options.dir, &exclusions, &mut candidates)?;
    let total_audio_files = candidates.len();

    let renders = group_pairs(&candidates);
    let batch_indices: HashSet<usize> = batches(&renders).into_iter().flatten().collect();
    let skipped_batch_renders = batch_indices.len();

    let mut facts_cache: HashMap<i64, Option<SessionFacts>> = HashMap::new();
    let mut fetch_facts = |session_id: i64| -> Option<SessionFacts> {
        if let Some(cached) = facts_cache.get(&session_id) {
            return cached.clone();
        }
        let fetched = session_facts(remote, session_id).ok();
        facts_cache.insert(session_id, fetched.clone());
        fetched
    };

    let mut matches = Vec::new();
    let mut unmatched_renders = 0usize;

    for (index, render) in renders.iter().enumerate() {
        if batch_indices.contains(&index) {
            continue;
        }
        let largest_index = render
            .files
            .iter()
            .enumerate()
            .max_by_key(|(_, file)| file.size)
            .map(|(i, _)| i)
            .unwrap_or(0);
        let (chosen_index, over_limit) = match upload_choice(render, options.max_upload_mb) {
            Choice::Upload(i) => (i, false),
            Choice::OverLimit => (largest_index, true),
        };
        let chosen = &render.files[chosen_index];
        let Ok(fp) = fingerprint(&chosen.path) else {
            unmatched_renders += 1;
            continue;
        };
        if ledger.is_rejected(&fp) {
            unmatched_renders += 1;
            continue;
        }

        let verdict = judge_render(
            render,
            sets,
            &options.export_dirs,
            options.max_upload_mb,
            options.min_confidence,
            &mut |session_id| fetch_facts(session_id).and_then(|f| f.track_title),
        );
        let Some(best) = verdict else {
            unmatched_renders += 1;
            continue;
        };

        let facts = fetch_facts(best.session_id);
        let track_id = facts.as_ref().and_then(|f| f.track_id);
        let track_title = facts.as_ref().and_then(|f| f.track_title.clone());
        let skipped_files: Vec<PathBuf> = render
            .files
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != chosen_index)
            .map(|(_, f)| f.path.clone())
            .collect();

        let mut item = ScannedMatch {
            name: render.name.clone(),
            chosen_file: chosen.path.clone(),
            skipped_files,
            size: chosen.size,
            mtime_ms: chosen.mtime_ms,
            fingerprint: fp,
            session_id: best.session_id,
            track_id,
            track_title,
            confidence: best.score.value,
            reasons: best.score.reasons,
            status: if over_limit {
                ScanMatchStatus::OverLimit
            } else {
                ScanMatchStatus::Proposed
            },
            asset_id: None,
            track_audio_id: None,
            version: None,
            error: None,
        };

        if options.apply && !over_limit {
            match track_id {
                None => {
                    item.status = ScanMatchStatus::SkippedNoTrack;
                }
                Some(tid) => {
                    let result = add_render(
                        remote,
                        &chosen.path,
                        AddOptions {
                            track_id: tid,
                            session_id: Some(best.session_id),
                            primary: false,
                            machine_name: options.machine_name.clone(),
                        },
                        &mut |path, _| {
                            let label = path
                                .file_name()
                                .map(|n| n.to_string_lossy().into_owned())
                                .unwrap_or_else(|| path.display().to_string());
                            on_progress(&format!("Uploading {label}…"));
                        },
                    );
                    match result {
                        Ok(added) => {
                            item.status = if added.deduplicated {
                                ScanMatchStatus::Deduplicated
                            } else {
                                ScanMatchStatus::Uploaded
                            };
                            item.asset_id = Some(added.asset_id);
                            item.track_audio_id = added.track_audio_id;
                            item.version = added.version;
                        }
                        Err(err) => {
                            item.status = ScanMatchStatus::Failed;
                            item.error = Some(err);
                        }
                    }
                }
            }
        }

        matches.push(item);
    }

    Ok(ScanResult {
        dir: options.dir.clone(),
        applied: options.apply,
        min_confidence: options.min_confidence,
        total_audio_files,
        skipped_batch_renders,
        unmatched_renders,
        matches,
    })
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, SystemTime};

    use dit_core::remote::test_support::{MockServer, Reply, remote_to};
    use serde_json::json;

    use super::*;

    fn write_wav(path: &Path, seconds: u32, mtime_secs: u64) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        // Minimal valid PCM WAV header declaring `seconds` of mono 8 kHz 8-bit audio so probe() reads duration.
        let sample_rate: u32 = 8_000;
        let data_size: u32 = sample_rate * seconds;
        let mut bytes = Vec::with_capacity(44 + 64);
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_size).to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&8u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_size.to_le_bytes());
        bytes.extend_from_slice(&[0x80u8; 64]);
        fs::write(path, bytes).unwrap();
        let mtime = SystemTime::UNIX_EPOCH + Duration::from_secs(mtime_secs);
        fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(mtime)
            .unwrap();
    }

    #[test]
    fn add_render_direct_to_track_uploads_links_and_deduplicates() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("Midnight Mix.wav");
        write_wav(&file, 90, 1_700_000_000);

        let uploaded_once = std::sync::atomic::AtomicBool::new(false);
        let server = MockServer::route(move |req| match (req.method.as_str(), req.path_only()) {
            ("GET", "/api/tracks/9") => Reply::json(200, r#"{"id":9,"projectId":3}"#),
            ("POST", "/api/assets/lookup") => {
                if uploaded_once.load(std::sync::atomic::Ordering::SeqCst) {
                    let body = req.json();
                    let fp = body["fingerprints"][0].as_str().unwrap();
                    Reply::json(
                        200,
                        json!([{ "fingerprint": fp, "assetId": 77 }]).to_string(),
                    )
                } else {
                    Reply::json(200, "[]")
                }
            }
            ("POST", "/api/assets/upload") => {
                uploaded_once.store(true, std::sync::atomic::Ordering::SeqCst);
                Reply::json(201, r#"{"id":77}"#)
            }
            ("POST", "/api/tracks/9/audios") => {
                let body = req.json();
                assert_eq!(body["assetIds"], json!([77]));
                assert_eq!(body["primaryAssetId"], json!(77));
                Reply::json(
                    201,
                    r#"{"audios":[{"id":501,"assetId":77,"version":1,"isPrimary":true}]}"#,
                )
            }
            other => panic!("unexpected request {other:?}"),
        });
        let remote = remote_to(&server);

        let mut uploads = 0usize;
        let first = add_render(
            &remote,
            &file,
            AddOptions {
                track_id: 9,
                session_id: None,
                primary: true,
                machine_name: Some("Studio".to_string()),
            },
            &mut |_, _| uploads += 1,
        )
        .unwrap();
        assert_eq!(uploads, 1);
        assert!(!first.deduplicated);
        assert_eq!(first.asset_id, 77);
        assert_eq!(first.track_audio_id, Some(501));
        assert_eq!(first.version, Some(1));
        assert!(first.is_primary);

        let second = add_render(
            &remote,
            &file,
            AddOptions {
                track_id: 9,
                session_id: None,
                primary: true,
                machine_name: Some("Studio".to_string()),
            },
            &mut |_, _| uploads += 1,
        )
        .unwrap();
        assert_eq!(uploads, 1, "second add deduplicates by fingerprint");
        assert!(second.deduplicated);
        assert_eq!(second.asset_id, 77);
    }

    #[test]
    fn scan_dir_collapses_format_pairs_skips_batches_and_applies_matches() {
        let dir = tempfile::tempdir().unwrap();
        let bounces = dir.path().join("Bounces");
        let project = dir.path().join("Canopy Project");
        fs::create_dir_all(&project).unwrap();

        // A multi-format bounce pair (.wav + .mp3) matching "Canopy"
        write_wav(&bounces.join("Canopy v2.wav"), 120, 1_700_000_100);
        let mp3 = bounces.join("Canopy v2.mp3");
        fs::write(&mp3, vec![0xFFu8; 40]).unwrap();
        fs::File::options()
            .write(true)
            .open(&mp3)
            .unwrap()
            .set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_105))
            .unwrap();

        // A 3-file stem batch written within 10s of each other (must be skipped)
        write_wav(&bounces.join("Drums.wav"), 120, 1_700_050_000);
        write_wav(&bounces.join("Bass.wav"), 120, 1_700_050_005);
        write_wav(&bounces.join("Synth.wav"), 120, 1_700_050_010);

        let sets = vec![SetRef {
            session_id: 5,
            set_path: project.join("Canopy.als"),
            project_folder: Some(project.clone()),
            save_times_ms: vec![1_700_000_000_000],
        }];

        let server = MockServer::route(|req| match (req.method.as_str(), req.path_only()) {
            ("GET", "/api/sessions/5") => Reply::json(
                200,
                r#"{"id":5,"projectId":3,"track":{"id":9,"title":"Canopy"}}"#,
            ),
            ("GET", "/api/sessions/5/commits") => Reply::json(200, "[]"),
            ("POST", "/api/assets/lookup") => Reply::json(200, "[]"),
            ("POST", "/api/assets/upload") => Reply::json(201, r#"{"id":88}"#),
            ("POST", "/api/sessions/5/renders") => Reply::json(
                201,
                r#"{"trackId":9,"attached":true,"audios":[{"id":601,"assetId":88,"version":1,"isPrimary":true}]}"#,
            ),
            other => panic!("unexpected request {other:?}"),
        });
        let remote = remote_to(&server);

        let dry = scan_dir(
            &remote,
            &sets,
            &ScanOptions {
                dir: bounces.clone(),
                apply: false,
                min_confidence: super::super::score::ASK_CONFIDENCE,
                max_upload_mb: 0,
                export_dirs: vec![bounces.clone()],
                excluded: Vec::new(),
                managed_subfolders: Vec::new(),
                ledger_path: None,
                machine_name: None,
            },
            &mut |_| {},
        )
        .unwrap();

        assert!(!dry.applied);
        assert_eq!(dry.total_audio_files, 5);
        assert_eq!(dry.skipped_batch_renders, 3);
        assert_eq!(dry.matches.len(), 1);
        assert_eq!(dry.matches[0].name, "Canopy v2");
        assert!(dry.matches[0].chosen_file.ends_with("Canopy v2.wav"));
        assert_eq!(dry.matches[0].skipped_files.len(), 1);
        assert_eq!(dry.matches[0].status, ScanMatchStatus::Proposed);
        assert_eq!(dry.matches[0].session_id, 5);
        assert_eq!(dry.matches[0].track_id, Some(9));

        let applied = scan_dir(
            &remote,
            &sets,
            &ScanOptions {
                dir: bounces.clone(),
                apply: true,
                min_confidence: super::super::score::ASK_CONFIDENCE,
                max_upload_mb: 0,
                export_dirs: vec![bounces],
                excluded: Vec::new(),
                managed_subfolders: Vec::new(),
                ledger_path: None,
                machine_name: Some("Studio".to_string()),
            },
            &mut |_| {},
        )
        .unwrap();

        assert!(applied.applied);
        assert_eq!(applied.matches.len(), 1);
        assert_eq!(applied.matches[0].status, ScanMatchStatus::Uploaded);
        assert_eq!(applied.matches[0].asset_id, Some(88));
        assert_eq!(applied.matches[0].track_audio_id, Some(601));
    }
}
