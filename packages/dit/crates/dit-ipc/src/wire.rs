//! Reading and writing one JSON line.

use std::io::{self, BufRead, Read, Write};

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::IpcError;

/// The longest request line a server reads: a command line, not a payload.
pub(crate) const MAX_REQUEST_BYTES: u64 = 1 << 20;

/// The longest answer line a client reads: a command's whole stdout rides in one `done` frame.
pub(crate) const MAX_ANSWER_BYTES: u64 = 256 << 20;

/// The next line parsed as `T`; `None` at a clean end of stream. A line longer than `limit`, or not JSON of that
/// shape, is a [`IpcError::Protocol`].
pub(crate) fn read_line<T: DeserializeOwned>(
    reader: &mut impl BufRead,
    limit: u64,
) -> Result<Option<T>, IpcError> {
    let mut line = Vec::new();
    // One byte past the limit tells "exactly at it" from "over it".
    let read = reader
        .by_ref()
        .take(limit + 1)
        .read_until(b'\n', &mut line)
        .map_err(|e| IpcError::io("read from the dit socket", e))?;
    if read == 0 {
        return Ok(None);
    }
    if line.last() != Some(&b'\n') {
        return Err(if line.len() as u64 > limit {
            IpcError::Protocol(format!("a line longer than {limit} bytes"))
        } else {
            IpcError::Closed
        });
    }
    serde_json::from_slice(&line)
        .map(Some)
        .map_err(|e| IpcError::Protocol(e.to_string()))
}

/// Writes `message` as one line.
pub(crate) fn write_line(writer: &mut impl Write, message: &impl Serialize) -> io::Result<()> {
    let mut line = serde_json::to_vec(message).map_err(io::Error::other)?;
    line.push(b'\n');
    writer.write_all(&line)?;
    writer.flush()
}
