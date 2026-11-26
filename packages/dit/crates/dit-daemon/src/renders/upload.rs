//! The hub side of a render: the instance's upload limits, the lookup of a file already uploaded, the upload of one,
//! and the acceptance of an uploaded file as a version of a session's track.
//!
//! The steps are separate so the caller can persist between them and resume after a crash: [`lookup`] by the file's
//! fingerprint, then [`upload`] when the hub does not hold it, then write the asset id down, then [`accept`]. Every
//! step is safe to repeat: a lookup hit skips the upload, and the hub converges a repeated accept on the same rows.

use std::fs::File;
use std::io::{self, Cursor, Read};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use dit_core::remote::{Remote, RemoteError};
use serde::{Deserialize, Serialize};

/// The status of the hub's answer to an accept of a session that has no track.
const CONFLICT: u16 = 409;

/// The `code` the hub gives a 409 when the session has no track to render into.
const NO_TRACK_CODE: &str = "session_has_no_track";

/// What the instance accepts as an upload.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    /// The largest file one upload may carry, in bytes.
    pub max_bytes: u64,
    /// The audio extensions the instance takes, lowercase and without the dot.
    pub audio_types: Vec<String>,
    /// The instance pushes samples for every repo, so a repo made now does too. An instance that does not say
    /// does not.
    #[serde(default)]
    pub push_samples_everywhere: bool,
}

/// Reads the instance's upload limits.
pub fn limits(remote: &Remote) -> Result<Limits, RemoteError> {
    remote.get("/uploads/limits")
}

/// An asset the hub holds for a fingerprint, as `POST /assets/lookup` answers it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Match {
    fingerprint: String,
    asset_id: i64,
}

/// The id of the asset of `project_id` the hub already holds for `fingerprint`, or `None` when it holds none: the
/// file then needs [`upload`].
pub fn lookup(
    remote: &Remote,
    project_id: i64,
    fingerprint: &str,
) -> Result<Option<i64>, RemoteError> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Body<'a> {
        project_id: i64,
        fingerprints: [&'a str; 1],
    }
    let matches: Vec<Match> = remote.post(
        "/assets/lookup",
        &Body {
            project_id,
            fingerprints: [fingerprint],
        },
    )?;
    Ok(matches
        .into_iter()
        .find(|found| found.fingerprint == fingerprint)
        .map(|found| found.asset_id))
}

/// What `POST /assets/upload` answers: the asset it made.
#[derive(Deserialize)]
struct Uploaded {
    id: i64,
}

/// Uploads the file at `path` to `project_id` as an asset carrying `fingerprint`, and returns the asset's id. The
/// caller persists the id before [`accept`].
///
/// The request is a `multipart/form-data` body of known length, streamed from the disk in chunks so a large file is
/// never held in memory. `progress(sent, total)` is called as the body is read, with the bytes of the whole body read
/// so far (nondecreasing) and its length; the last call has `sent == total`. A file that changes length while it is
/// read fails the upload. The instance refusing the file (over its size limit, not audio) is
/// [`RemoteError::Refused`] with the instance's message.
pub fn upload(
    remote: &Remote,
    project_id: i64,
    fingerprint: &str,
    path: &Path,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<i64, RemoteError> {
    let io_failure = |error: io::Error| RemoteError::Unexpected {
        host: remote.client().instance().host().to_string(),
        detail: format!("could not read {}: {error}", path.display()),
    };
    let file = File::open(path).map_err(io_failure)?;
    let size = file.metadata().map_err(io_failure)?.len();
    let name = path.file_name().map_or_else(
        || "render".to_string(),
        |name| name.to_string_lossy().into(),
    );
    let envelope = Envelope::new(
        &boundary(),
        &[
            ("projectId", project_id.to_string()),
            ("fingerprint", fingerprint.to_string()),
        ],
        &name,
        content_type(path),
        size,
    );
    let length = envelope.length();
    let content_type = envelope.content_type();
    let mut body = Counting {
        inner: envelope.reader(file, size),
        sent: 0,
        total: length,
        progress,
    };
    let uploaded: Uploaded =
        remote.post_stream("/assets/upload", &content_type, length, &mut body)?;
    Ok(uploaded.id)
}

/// What the hub did with an accept.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcceptOutcome {
    /// The file is a version of the session's track. A repeated accept answers the same.
    Accepted {
        /// The track the version belongs to.
        track_id: Option<i64>,
    },
    /// The session has no track to render into: nothing was attached.
    NoTrack,
}

/// Accepts the asset `asset_id` as a render of session `session_id`, recording the save it was bounced from. A
/// session without a track is [`AcceptOutcome::NoTrack`]; an asset or save the hub rejects (400, 404) is
/// [`RemoteError::Refused`].
pub fn accept(
    remote: &Remote,
    session_id: i64,
    asset_id: i64,
    bounced_from_save_id: Option<i64>,
) -> Result<AcceptOutcome, RemoteError> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Body {
        asset_id: i64,
        bounced_from_save_id: Option<i64>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Accepted {
        track_id: Option<i64>,
    }
    let answer: Result<Accepted, RemoteError> = remote.post(
        &format!("/sessions/{session_id}/renders"),
        &Body {
            asset_id,
            bounced_from_save_id,
        },
    );
    match answer {
        Ok(accepted) => Ok(AcceptOutcome::Accepted {
            track_id: accepted.track_id,
        }),
        Err(RemoteError::Refused {
            status: CONFLICT,
            code: Some(code),
            ..
        }) if code == NO_TRACK_CODE => Ok(AcceptOutcome::NoTrack),
        Err(error) => Err(error),
    }
}

/// The MIME type an audio file is declared as, by its extension; an extension the hub does not know is plain bytes.
fn content_type(path: &Path) -> &'static str {
    let extension = path
        .extension()
        .map(|extension| extension.to_string_lossy().to_ascii_lowercase());
    match extension.as_deref() {
        Some("wav" | "wave") => "audio/wav",
        Some("mp3") => "audio/mpeg",
        Some("flac") => "audio/flac",
        Some("aif" | "aiff") => "audio/aiff",
        Some("m4a" | "aac") => "audio/mp4",
        Some("ogg" | "oga" | "opus") => "audio/ogg",
        _ => "application/octet-stream",
    }
}

/// A boundary no file is likely to contain: the time to the nanosecond, the process and a counter, hashed together
/// with the address of a stack value.
fn boundary() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    let marker = 0u8;
    let address = std::ptr::addr_of!(marker) as usize;
    format!(
        "----dit-{nanos:x}-{:x}-{count:x}-{address:x}",
        std::process::id()
    )
}

/// A `multipart/form-data` body of text fields and one file, as the bytes before the file's, the length of the file
/// and the bytes after it.
struct Envelope {
    boundary: String,
    head: Vec<u8>,
    tail: Vec<u8>,
    file_size: u64,
}

impl Envelope {
    /// The envelope of `fields` and a file part named `file` holding `file_size` bytes, uploaded as `filename` of
    /// `file_type`.
    fn new(
        boundary: &str,
        fields: &[(&str, String)],
        filename: &str,
        file_type: &str,
        file_size: u64,
    ) -> Self {
        let mut head = Vec::new();
        for (name, value) in fields {
            head.extend_from_slice(
                format!(
                    "--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
                )
                .as_bytes(),
            );
        }
        let filename = filename
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace(['\r', '\n'], " ");
        head.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {file_type}\r\n\r\n"
            )
            .as_bytes(),
        );
        Envelope {
            boundary: boundary.to_string(),
            head,
            tail: format!("\r\n--{boundary}--\r\n").into_bytes(),
            file_size,
        }
    }

    /// The `Content-Type` of the request.
    fn content_type(&self) -> String {
        format!("multipart/form-data; boundary={}", self.boundary)
    }

    /// The length of the whole body.
    fn length(&self) -> u64 {
        self.head.len() as u64 + self.file_size + self.tail.len() as u64
    }

    /// The body, reading `size` bytes of the file from `file`.
    fn reader<R: Read>(self, file: R, size: u64) -> impl Read {
        Cursor::new(self.head)
            .chain(Exact {
                inner: file.take(size),
                remaining: size,
            })
            .chain(Cursor::new(self.tail))
    }
}

/// A reader that must yield exactly the bytes it was promised: a file that ends early is an error rather than a
/// request shorter than its `Content-Length`.
struct Exact<R> {
    inner: R,
    remaining: u64,
}

impl<R: Read> Read for Exact<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let read = self.inner.read(buf)?;
        if read == 0 && self.remaining > 0 && !buf.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "the file got shorter while it was being uploaded",
            ));
        }
        self.remaining -= read as u64;
        Ok(read)
    }
}

/// A reader that reports the bytes read so far to `progress` after each read.
struct Counting<'a, R> {
    inner: R,
    sent: u64,
    total: u64,
    progress: &'a mut dyn FnMut(u64, u64),
}

impl<R: Read> Read for Counting<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let read = self.inner.read(buf)?;
        if read > 0 {
            self.sent += read as u64;
            (self.progress)(self.sent, self.total);
        }
        Ok(read)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use dit_core::remote::test_support::{MockServer, Recorded, Reply, remote_to};

    use super::*;

    /// `len` bytes that no boundary occurs in, different at every offset in a way a shifted copy would show.
    fn noise(len: usize) -> Vec<u8> {
        let mut state = 0x9E37_79B9_7F4A_7C15_u64;
        (0..len)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                (state >> 24) as u8
            })
            .collect()
    }

    /// Where `needle` first occurs in `haystack` at or after `from`.
    fn find(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
        haystack[from..]
            .windows(needle.len())
            .position(|window| window == needle)
            .map(|at| at + from)
    }

    /// A multipart part: name, filename, content type and bytes.
    type Part = (String, Option<String>, Option<String>, Vec<u8>);

    /// The parts of a multipart request.
    fn parts(request: &Recorded) -> Vec<Part> {
        let content_type = request.header("content-type").unwrap();
        let boundary = content_type
            .strip_prefix("multipart/form-data; boundary=")
            .unwrap();
        let delimiter = format!("--{boundary}").into_bytes();
        let body = &request.body;
        let mut found = Vec::new();
        let mut at = 0;
        assert_eq!(find(body, &delimiter, 0), Some(0));
        loop {
            let start = at + delimiter.len();
            if body[start..].starts_with(b"--\r\n") {
                assert_eq!(start + 4, body.len(), "nothing follows the closing line");
                return found;
            }
            assert!(body[start..].starts_with(b"\r\n"));
            let head_end = find(body, b"\r\n\r\n", start).unwrap();
            let head = String::from_utf8(body[start + 2..head_end].to_vec()).unwrap();
            let next = find(
                body,
                &[b"\r\n".as_slice(), &delimiter].concat(),
                head_end + 4,
            )
            .unwrap();
            let mut name = String::new();
            let mut filename = None;
            let mut kind = None;
            for line in head.split("\r\n") {
                if let Some(rest) = line.strip_prefix("Content-Disposition: form-data; ") {
                    for field in rest.split("; ") {
                        if let Some(value) = field.strip_prefix("name=\"") {
                            name = value.trim_end_matches('"').to_string();
                        } else if let Some(value) = field.strip_prefix("filename=\"") {
                            filename = Some(value.trim_end_matches('"').to_string());
                        }
                    }
                } else if let Some(value) = line.strip_prefix("Content-Type: ") {
                    kind = Some(value.to_string());
                }
            }
            found.push((name, filename, kind, body[head_end + 4..next].to_vec()));
            at = next + 2;
        }
    }

    fn server(replies: Vec<Reply>) -> (MockServer, Remote) {
        let server = MockServer::start_replies(replies);
        let remote = remote_to(&server);
        (server, remote)
    }

    #[test]
    fn upload_sends_a_well_formed_envelope_with_the_file_intact() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("My \"Mix\".wav");
        let bytes = noise(3 * 1024 * 1024 + 17);
        fs::write(&path, &bytes).unwrap();
        let (server, remote) = server(vec![Reply::json(201, r#"{"id":77,"name":"x"}"#)]);

        let id = upload(&remote, 5, "dit:1:abc", &path, &mut |_, _| {}).unwrap();

        assert_eq!(id, 77);
        let requests = server.requests();
        let request = &requests[0];
        assert_eq!(request.method, "POST");
        assert_eq!(request.path_only(), "/api/assets/upload");
        assert_eq!(
            request.header("content-length").unwrap(),
            request.body.len().to_string()
        );
        assert!(request.header("transfer-encoding").is_none());
        let parts = parts(request);
        let names: Vec<_> = parts.iter().map(|part| part.0.as_str()).collect();
        assert_eq!(names, ["projectId", "fingerprint", "file"]);
        assert_eq!(parts[0].3, b"5");
        assert_eq!(parts[1].3, b"dit:1:abc");
        let (_, filename, kind, content) = &parts[2];
        assert_eq!(filename.as_deref(), Some("My \\\"Mix\\\".wav"));
        assert_eq!(kind.as_deref(), Some("audio/wav"));
        assert!(content == &bytes, "the file's bytes arrive intact");
    }

    #[test]
    fn upload_progress_is_monotonic_and_ends_at_the_total() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Mix.mp3");
        fs::write(&path, noise(1_000_000)).unwrap();
        let (server, remote) = server(vec![Reply::json(201, r#"{"id":1}"#)]);
        let mut calls: Vec<(u64, u64)> = Vec::new();

        upload(&remote, 1, "dit:f", &path, &mut |sent, total| {
            calls.push((sent, total));
        })
        .unwrap();

        let body_length = server.requests()[0].body.len() as u64;
        assert!(calls.len() > 2, "called as the body is read");
        assert!(calls.windows(2).all(|pair| pair[0].0 < pair[1].0));
        assert!(calls.iter().all(|call| call.1 == body_length));
        assert_eq!(calls.last(), Some(&(body_length, body_length)));
    }

    #[test]
    fn upload_declares_the_type_by_extension() {
        for (name, expected) in [
            ("a.MP3", "audio/mpeg"),
            ("a.flac", "audio/flac"),
            ("a.aiff", "audio/aiff"),
            ("a.m4a", "audio/mp4"),
            ("a.xyz", "application/octet-stream"),
            ("a", "application/octet-stream"),
        ] {
            assert_eq!(content_type(Path::new(name)), expected, "{name}");
        }
    }

    #[test]
    fn upload_over_the_limit_is_the_hubs_refusal() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Big.wav");
        fs::write(&path, noise(1000)).unwrap();
        let (_server, remote) = server(vec![Reply::json(
            413,
            r#"{"error":"File is over the 1 MB upload limit"}"#,
        )]);

        let error = upload(&remote, 1, "dit:f", &path, &mut |_, _| {}).unwrap_err();

        assert!(
            matches!(&error, RemoteError::Refused { status: 413, message, .. }
                if message == "File is over the 1 MB upload limit"),
            "{error:?}"
        );
    }

    #[test]
    fn upload_of_a_missing_file_fails_without_a_request() {
        let dir = tempfile::tempdir().unwrap();
        let (server, remote) = server(vec![]);

        let error = upload(
            &remote,
            1,
            "dit:f",
            &dir.path().join("gone.wav"),
            &mut |_, _| {},
        )
        .unwrap_err();

        assert!(matches!(error, RemoteError::Unexpected { .. }), "{error:?}");
        assert!(server.requests().is_empty());
    }

    #[test]
    fn a_file_that_ends_early_is_an_error_not_a_short_body() {
        let mut reader =
            Envelope::new("b", &[], "a.wav", "audio/wav", 10).reader(&[0u8; 4][..], 10);
        let mut sink = Vec::new();
        let error = reader.read_to_end(&mut sink).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::UnexpectedEof);
    }

    #[test]
    fn boundaries_differ() {
        assert_ne!(boundary(), boundary());
    }

    #[test]
    fn upload_signed_out_on_401() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Mix.wav");
        fs::write(&path, noise(100)).unwrap();
        let (_server, remote) = server(vec![Reply::json(401, r#"{"error":"no"}"#)]);

        let error = upload(&remote, 1, "dit:f", &path, &mut |_, _| {}).unwrap_err();

        assert!(matches!(error, RemoteError::SignedOut { .. }), "{error:?}");
    }

    #[test]
    fn limits_reads_the_instance_limits() {
        let (server, remote) = server(vec![Reply::json(
            200,
            r#"{"maxBytes":52428800,"audioTypes":["wav","mp3"],"imageTypes":["image/png"]}"#,
        )]);

        let found = limits(&remote).unwrap();

        assert_eq!(found.max_bytes, 52_428_800);
        assert_eq!(found.audio_types, ["wav", "mp3"]);
        assert_eq!(server.requests()[0].path_only(), "/api/uploads/limits");
    }

    #[test]
    fn lookup_hit_names_the_asset_of_the_fingerprint() {
        let (server, remote) = server(vec![Reply::json(
            200,
            r#"[{"fingerprint":"dit:2:b","assetId":9,"name":"x.wav","sessionIds":[1]},{"fingerprint":"dit:1:a","assetId":4,"name":"y.wav","sessionIds":[]}]"#,
        )]);

        assert_eq!(lookup(&remote, 3, "dit:1:a").unwrap(), Some(4));

        let requests = server.requests();
        assert_eq!(requests[0].path_only(), "/api/assets/lookup");
        assert_eq!(
            requests[0].json(),
            serde_json::json!({"projectId": 3, "fingerprints": ["dit:1:a"]})
        );
    }

    #[test]
    fn lookup_miss_is_none() {
        let (_server, remote) = server(vec![Reply::json(200, "[]")]);
        assert_eq!(lookup(&remote, 3, "dit:1:a").unwrap(), None);
    }

    #[test]
    fn lookup_signed_out_on_401() {
        let (_server, remote) = server(vec![Reply::json(401, r#"{"error":"no"}"#)]);
        let error = lookup(&remote, 3, "dit:1:a").unwrap_err();
        assert!(matches!(error, RemoteError::SignedOut { .. }), "{error:?}");
    }

    #[test]
    fn accept_201_and_200_replay_are_accepted() {
        let (server, remote) = server(vec![
            Reply::json(201, r#"{"trackId":12,"attached":true}"#),
            Reply::json(200, r#"{"trackId":12,"attached":true}"#),
        ]);

        for _ in 0..2 {
            assert_eq!(
                accept(&remote, 8, 77, Some(31)).unwrap(),
                AcceptOutcome::Accepted { track_id: Some(12) }
            );
        }

        let requests = server.requests();
        assert_eq!(requests[0].path_only(), "/api/sessions/8/renders");
        assert_eq!(
            requests[0].json(),
            serde_json::json!({"assetId": 77, "bouncedFromSaveId": 31})
        );
    }

    #[test]
    fn accept_without_a_save_sends_null() {
        let (server, remote) = server(vec![Reply::json(201, r#"{"trackId":12}"#)]);
        accept(&remote, 8, 77, None).unwrap();
        assert_eq!(
            server.requests()[0].json(),
            serde_json::json!({"assetId": 77, "bouncedFromSaveId": null})
        );
    }

    #[test]
    fn accept_409_no_track_is_an_outcome() {
        let (_server, remote) = server(vec![Reply::json(
            409,
            r#"{"error":"The session has no track to render into","code":"session_has_no_track"}"#,
        )]);
        assert_eq!(
            accept(&remote, 8, 77, None).unwrap(),
            AcceptOutcome::NoTrack
        );
    }

    #[test]
    fn accept_other_409_and_400_404_are_refusals() {
        let (_server, remote) = server(vec![
            Reply::json(409, r#"{"error":"busy","code":"other"}"#),
            Reply::json(
                400,
                r#"{"error":"A render must be an audio file","code":"not_audio"}"#,
            ),
            Reply::json(404, r#"{"error":"Asset not found"}"#),
        ]);
        for status in [409, 400, 404] {
            let error = accept(&remote, 8, 77, None).unwrap_err();
            assert!(
                matches!(&error, RemoteError::Refused { status: found, .. } if *found == status),
                "{error:?}"
            );
        }
    }

    #[test]
    fn accept_signed_out_on_401() {
        let (_server, remote) = server(vec![Reply::json(401, r#"{"error":"no"}"#)]);
        let error = accept(&remote, 8, 77, None).unwrap_err();
        assert!(matches!(error, RemoteError::SignedOut { .. }), "{error:?}");
    }
}
