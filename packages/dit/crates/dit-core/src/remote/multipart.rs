//! Streaming `multipart/form-data` uploads over [`Remote`].
//!
//! Used by audio render uploads and local cover image uploads so large files are
//! streamed straight from disk with a known `Content-Length` and never buffered
//! whole in memory.

use std::fmt;
use std::fs::File;
use std::io::{self, Cursor, Read};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::de::DeserializeOwned;

use super::{Remote, RemoteError};

/// Why a multipart file upload failed: either reading the local file failed
/// (never worth retrying offline) or the hub refused/dropped the request.
#[derive(Debug)]
pub enum MultipartError {
    Local(String),
    Remote(RemoteError),
}

impl fmt::Display for MultipartError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MultipartError::Local(message) => f.write_str(message),
            MultipartError::Remote(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for MultipartError {}

impl From<RemoteError> for MultipartError {
    fn from(error: RemoteError) -> Self {
        MultipartError::Remote(error)
    }
}

/// Streams `path` as the `file` part of a `multipart/form-data` POST to `endpoint`,
/// alongside text `fields`, declaring `file_type` as the part's `Content-Type`.
///
/// `progress(sent, total)` receives the monotonically increasing byte offset of
/// the whole request body; the final call has `sent == total`.
pub fn upload_file<T: DeserializeOwned>(
    remote: &Remote,
    endpoint: &str,
    fields: &[(&str, String)],
    path: &Path,
    default_filename: &str,
    file_type: &str,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<T, MultipartError> {
    let io_failure = |error: io::Error| {
        MultipartError::Local(format!("could not read {}: {error}", path.display()))
    };
    let file = File::open(path).map_err(io_failure)?;
    let size = file.metadata().map_err(io_failure)?.len();
    let name = path.file_name().map_or_else(
        || default_filename.to_string(),
        |name| name.to_string_lossy().into_owned(),
    );
    let envelope = Envelope::new(&boundary(), fields, &name, file_type, size);
    let length = envelope.length();
    let content_type = envelope.content_type();
    let mut body = Counting {
        inner: envelope.reader(file, size),
        sent: 0,
        total: length,
        progress,
    };
    Ok(remote.post_stream(endpoint, &content_type, length, &mut body)?)
}

/// A boundary no file is likely to contain: the time to the nanosecond, the process and a counter,
/// hashed together with the address of a stack value.
pub(crate) fn boundary() -> String {
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

/// A `multipart/form-data` body of text fields and one file, as the bytes before the file's,
/// the length of the file, and the bytes after it.
pub struct Envelope {
    boundary: String,
    head: Vec<u8>,
    tail: Vec<u8>,
    file_size: u64,
}

impl Envelope {
    /// The envelope of `fields` and a file part named `file` holding `file_size` bytes,
    /// uploaded as `filename` of `file_type`.
    pub fn new(
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
    pub fn content_type(&self) -> String {
        format!("multipart/form-data; boundary={}", self.boundary)
    }

    /// The length of the whole body.
    pub fn length(&self) -> u64 {
        self.head.len() as u64 + self.file_size + self.tail.len() as u64
    }

    /// The body, reading `size` bytes of the file from `file`.
    pub fn reader<R: Read>(self, file: R, size: u64) -> impl Read {
        Cursor::new(self.head)
            .chain(Exact {
                inner: file.take(size),
                remaining: size,
            })
            .chain(Cursor::new(self.tail))
    }
}

/// A reader that must yield exactly the bytes it was promised: a file that ends early
/// is an error rather than a request shorter than its `Content-Length`.
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
    use super::*;

    #[test]
    fn boundaries_differ() {
        assert_ne!(boundary(), boundary());
    }

    #[test]
    fn a_file_that_ends_early_is_an_error_not_a_short_body() {
        let mut reader =
            Envelope::new("b", &[], "a.wav", "audio/wav", 10).reader(&[0u8; 4][..], 10);
        let mut sink = Vec::new();
        let error = reader.read_to_end(&mut sink).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::UnexpectedEof);
    }
}
