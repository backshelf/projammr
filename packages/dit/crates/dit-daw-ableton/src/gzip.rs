//! The gzip wrapper around a set's XML. Without the `gzip` feature (the wasm build) the host gunzips and gzips,
//! so both directions refuse.
//!
//! `encode` rebuilds the file Live writes: a fixed header, raw deflate from zlib at level 6 with memLevel 9, then
//! the CRC32 and length. `flate2` cannot set memLevel, so this calls zlib directly.

use dit_core::DawError;

#[cfg(feature = "gzip")]
use libz_sys::{
    Bytef, Z_BUF_ERROR, Z_DATA_ERROR, Z_DEFAULT_STRATEGY, Z_DEFLATED, Z_FINISH, Z_NO_FLUSH, Z_OK,
    Z_STREAM_END, crc32, deflate, deflateEnd, deflateInit2_, inflate, inflateEnd, inflateInit2_,
    uInt, z_stream, zlibVersion,
};
#[cfg(feature = "gzip")]
use std::ffi::c_int;
#[cfg(feature = "gzip")]
use std::mem::MaybeUninit;

#[cfg(feature = "gzip")]
const MAGIC: [u8; 2] = [0x1f, 0x8b];

/// zlib's window-bits value that reads the gzip wrapper, checking its CRC32 and length.
#[cfg(feature = "gzip")]
const GZIP_WINDOW_BITS: c_int = 15 + 16;

/// zlib's window-bits value for raw deflate with a 32 KiB window: no zlib or gzip wrapper.
#[cfg(feature = "gzip")]
const RAW_WINDOW_BITS: c_int = -15;

#[cfg(feature = "gzip")]
const LEVEL: c_int = 6;

/// The memLevel Live's zlib runs at; zlib's default of 8 compresses to different bytes.
#[cfg(feature = "gzip")]
const MEM_LEVEL: c_int = 9;

/// The gzip header's OS byte for the platform the set is written on.
#[cfg(feature = "gzip")]
const OS: u8 = if cfg!(target_os = "macos") {
    19
} else if cfg!(target_os = "windows") {
    11
} else {
    3
};

/// Bytes of output zlib writes per call.
#[cfg(feature = "gzip")]
const CHUNK: usize = 1 << 16;

/// The most input one call can take: zlib counts it in a `uInt`.
#[cfg(feature = "gzip")]
const MAX_FEED: usize = uInt::MAX as usize;

/// Gunzips a set file, or passes it through when it does not start with the gzip magic (a plain XML set).
/// An empty file is never a set, and anything short of one complete gzip member with a matching CRC32 and length
/// is `Corrupt`.
#[cfg(feature = "gzip")]
pub(crate) fn decode(file: &[u8]) -> Result<Vec<u8>, DawError> {
    if file.is_empty() {
        return Err(corrupt("empty file".to_string()));
    }
    if !file.starts_with(&MAGIC) {
        return Ok(file.to_vec());
    }
    inflate_gzip(file)
}

/// Gzips a document the way Live does: header `1f 8b 08 00 00000000 00 <os>` (no flags, no mtime, no extra
/// flags), raw deflate, then the CRC32 and the length mod 2³², little-endian.
#[cfg(feature = "gzip")]
pub(crate) fn encode(doc: &[u8]) -> Result<Vec<u8>, DawError> {
    let mut file = Vec::with_capacity(doc.len() / 4 + 18);
    file.extend_from_slice(&MAGIC);
    file.extend_from_slice(&[8, 0, 0, 0, 0, 0, 0, OS]);
    let crc = deflate_raw(doc, &mut file)?;
    file.extend_from_slice(&crc.to_le_bytes());
    file.extend_from_slice(&(doc.len() as u32).to_le_bytes());
    Ok(file)
}

#[cfg(feature = "gzip")]
fn inflate_gzip(file: &[u8]) -> Result<Vec<u8>, DawError> {
    let mut stream = MaybeUninit::<z_stream>::zeroed();
    // SAFETY: zlib reads a zeroed `zalloc`, `zfree` and `opaque` as "use the default allocator", and the version
    // and size passed are libz-sys's own, so the struct layout matches the linked library.
    let ret = unsafe {
        inflateInit2_(
            stream.as_mut_ptr(),
            GZIP_WINDOW_BITS,
            zlibVersion(),
            size_of::<z_stream>() as c_int,
        )
    };
    if ret != Z_OK {
        return Err(corrupt(format!("zlib refused to start inflating ({ret})")));
    }
    // SAFETY: a successful init set `zalloc` and `zfree` to zlib's allocators, so every field now holds a valid
    // value; the stream stays in this frame, where zlib's back-pointer to it expects it.
    let stream = unsafe { stream.assume_init_mut() };
    let mut doc = Vec::with_capacity(file.len().saturating_mul(8));
    let mut buf = vec![0u8; CHUNK];
    let mut input = file;
    let result = loop {
        if stream.avail_in == 0 {
            let (next, rest) = input.split_at(input.len().min(MAX_FEED));
            stream.next_in = next.as_ptr() as *mut Bytef;
            stream.avail_in = next.len() as uInt;
            input = rest;
        }
        stream.next_out = buf.as_mut_ptr();
        stream.avail_out = CHUNK as uInt;
        // SAFETY: `next_in` and `next_out` point into `file` and `buf` for `avail_in` and `avail_out` bytes, both
        // alive across the call, and zlib only reads through `next_in`.
        let ret = unsafe { inflate(stream, Z_NO_FLUSH) };
        doc.extend_from_slice(&buf[..CHUNK - stream.avail_out as usize]);
        match ret {
            Z_OK => {}
            Z_STREAM_END if stream.avail_in == 0 && input.is_empty() => break Ok(doc),
            Z_STREAM_END => break Err(corrupt("bytes follow the gzip member".into())),
            Z_BUF_ERROR => break Err(corrupt("the gzip ends early".into())),
            Z_DATA_ERROR => break Err(corrupt("the gzip's data or checksum is invalid".into())),
            _ => break Err(corrupt(format!("zlib failed to inflate ({ret})"))),
        }
    };
    // SAFETY: the stream was initialised above and is ended exactly once.
    unsafe { inflateEnd(stream) };
    result
}

/// Appends `doc` to `out` as one raw deflate stream, and returns `doc`'s CRC32.
#[cfg(feature = "gzip")]
fn deflate_raw(doc: &[u8], out: &mut Vec<u8>) -> Result<u32, DawError> {
    let mut stream = MaybeUninit::<z_stream>::zeroed();
    // SAFETY: as in `inflate_gzip`, a zeroed allocator means zlib's default and the version and size are
    // libz-sys's own.
    let ret = unsafe {
        deflateInit2_(
            stream.as_mut_ptr(),
            LEVEL,
            Z_DEFLATED,
            RAW_WINDOW_BITS,
            MEM_LEVEL,
            Z_DEFAULT_STRATEGY,
            zlibVersion(),
            size_of::<z_stream>() as c_int,
        )
    };
    if ret != Z_OK {
        return Err(corrupt(format!("zlib refused to start deflating ({ret})")));
    }
    // SAFETY: as in `inflate_gzip`, a successful init leaves every field valid and the stream stays in this frame.
    let stream = unsafe { stream.assume_init_mut() };
    let mut buf = vec![0u8; CHUNK];
    let mut input = doc;
    let mut crc = 0;
    let result = loop {
        if stream.avail_in == 0 {
            let (next, rest) = input.split_at(input.len().min(MAX_FEED));
            // SAFETY: `next` is valid for `next.len()` bytes, which fits in a `uInt`.
            crc = unsafe { crc32(crc, next.as_ptr(), next.len() as uInt) };
            stream.next_in = next.as_ptr() as *mut Bytef;
            stream.avail_in = next.len() as uInt;
            input = rest;
        }
        stream.next_out = buf.as_mut_ptr();
        stream.avail_out = CHUNK as uInt;
        let flush = if input.is_empty() {
            Z_FINISH
        } else {
            Z_NO_FLUSH
        };
        // SAFETY: as in `inflate_gzip`, both pointers are valid for their lengths across the call.
        let ret = unsafe { deflate(stream, flush) };
        out.extend_from_slice(&buf[..CHUNK - stream.avail_out as usize]);
        match ret {
            Z_OK => {}
            Z_STREAM_END => break Ok(crc as u32),
            _ => break Err(corrupt(format!("zlib failed to deflate ({ret})"))),
        }
    };
    // SAFETY: the stream was initialised above and is ended exactly once.
    unsafe { deflateEnd(stream) };
    result
}

#[cfg(feature = "gzip")]
fn corrupt(message: String) -> DawError {
    DawError::Corrupt(message)
}

#[cfg(not(feature = "gzip"))]
pub(crate) fn decode(_file: &[u8]) -> Result<Vec<u8>, DawError> {
    Err(DawError::Unsupported)
}

#[cfg(not(feature = "gzip"))]
pub(crate) fn encode(_doc: &[u8]) -> Result<Vec<u8>, DawError> {
    Err(DawError::Unsupported)
}
