//! What is read off an audio file's bytes: its length and container ([`probe`]) and the fingerprint that names its
//! content ([`fingerprint`]).
//!
//! The fingerprint is the size and a hash of the first and last 64 KiB, so a multi-gigabyte render is named without
//! being read whole: SHA-256 with a `dit:` prefix.

use std::fmt::Write as _;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;

use lofty::config::ParseOptions;
use lofty::file::{AudioFile, FileType, TaggedFileExt};
use lofty::probe::Probe as FileProbe;
use sha2::{Digest, Sha256};

/// What reading an audio file's header found; a field is `None` when it could not be told.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Probe {
    /// The length of the audio in milliseconds; `None` for unreadable audio or a length of zero.
    pub duration_ms: Option<u64>,
    /// The container or codec, lowercase and told from the bytes, not the extension: `wav`, `mp3`, `flac`, `aiff`,
    /// `m4a`, `aac`, `ogg`.
    pub format: Option<String>,
}

/// The container name of a file type, or `None` for one with no name here.
fn format_of(file_type: FileType) -> Option<&'static str> {
    Some(match file_type {
        FileType::Wav => "wav",
        FileType::Aiff => "aiff",
        FileType::Flac => "flac",
        FileType::Mpeg => "mp3",
        FileType::Mp4 => "m4a",
        FileType::Aac => "aac",
        FileType::Vorbis => "ogg",
        FileType::Opus => "opus",
        FileType::Speex => "spx",
        FileType::Ape => "ape",
        FileType::Mpc => "mpc",
        FileType::WavPack => "wv",
        _ => return None,
    })
}

fn read_header(path: &Path) -> Option<Probe> {
    let options = ParseOptions::new().read_tags(false);
    let file = FileProbe::open(path)
        .ok()?
        .options(options)
        .guess_file_type()
        .ok()?
        .read()
        .ok()?;
    let duration_ms = u64::try_from(file.properties().duration().as_millis())
        .ok()
        .filter(|ms| *ms > 0);
    Some(Probe {
        duration_ms,
        format: format_of(file.file_type()).map(str::to_owned),
    })
}

/// Reads the length and container of the audio file at `path`. Never fails: a missing, unreadable or unrecognised
/// file gives [`Probe::default`]. The bytes are untrusted, so a panic of the parser is caught and counts as
/// unreadable.
pub fn probe(path: &Path) -> Probe {
    catch_unwind(AssertUnwindSafe(|| read_header(path)))
        .ok()
        .flatten()
        .unwrap_or_default()
}

/// How much of each end of a file the fingerprint reads.
const WINDOW: u64 = 64 * 1024;

/// Feeds `len` bytes from the reader's position to `hasher`, a buffer at a time.
fn feed(
    reader: &mut impl Read,
    mut len: u64,
    buffer: &mut [u8],
    hasher: &mut Sha256,
) -> io::Result<()> {
    while len > 0 {
        let take = len.min(buffer.len() as u64) as usize;
        let chunk = &mut buffer[..take];
        reader.read_exact(chunk)?;
        hasher.update(&*chunk);
        len -= chunk.len() as u64;
    }
    Ok(())
}

/// The fingerprint of the file at `path`: `dit:<size>:<hash>`, where `size` is its length in bytes and `hash` is
/// the lowercase hex SHA-256 of its first 64 KiB followed by its last 64 KiB. A file of 128 KiB or less is hashed
/// whole, each byte once: where the two windows would overlap or touch, the bytes are not counted twice. Two files
/// with the same bytes have the same fingerprint wherever they are and whatever they are called; a change to the
/// size, the first or the last 64 KiB changes it, a change to the middle of a larger file does not.
///
/// A file that ends before the length it reported (it was truncated while being read) is an error.
pub fn fingerprint(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; WINDOW as usize];
    if size <= 2 * WINDOW {
        feed(&mut file, size, &mut buffer, &mut hasher)?;
    } else {
        feed(&mut file, WINDOW, &mut buffer, &mut hasher)?;
        file.seek(SeekFrom::Start(size - WINDOW))?;
        feed(&mut file, WINDOW, &mut buffer, &mut hasher)?;
    }
    let digest = hasher.finalize();
    let mut text = String::with_capacity(4 + 20 + 1 + 2 * digest.len());
    let _ = write!(text, "dit:{size}:");
    for byte in digest {
        let _ = write!(text, "{byte:02x}");
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    /// A mono 16-bit PCM WAV of `frames` silent frames.
    fn wav_bytes(sample_rate: u32, frames: u32) -> Vec<u8> {
        let data_len = frames * 2;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&(sample_rate * 2).to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        bytes.resize(bytes.len() + data_len as usize, 0);
        bytes
    }

    /// A mono 16-bit AIFF of `frames` silent frames at 8000 Hz (the rate is written as the 80-bit float AIFF uses).
    fn aiff_bytes(frames: u32) -> Vec<u8> {
        let data_len = frames * 2;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"FORM");
        bytes.extend_from_slice(&(4 + 26 + 16 + data_len).to_be_bytes());
        bytes.extend_from_slice(b"AIFFCOMM");
        bytes.extend_from_slice(&18u32.to_be_bytes());
        bytes.extend_from_slice(&1u16.to_be_bytes());
        bytes.extend_from_slice(&frames.to_be_bytes());
        bytes.extend_from_slice(&16u16.to_be_bytes());
        bytes.extend_from_slice(&0x400Bu16.to_be_bytes());
        bytes.extend_from_slice(&0xFA00_0000_0000_0000u64.to_be_bytes());
        bytes.extend_from_slice(b"SSND");
        bytes.extend_from_slice(&(8 + data_len).to_be_bytes());
        bytes.extend_from_slice(&[0; 8]);
        bytes.resize(bytes.len() + data_len as usize, 0);
        bytes
    }

    fn write(dir: &TempDir, name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let path = dir.path().join(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn a_wav_has_its_length_and_container() {
        let dir = TempDir::new().unwrap();
        let path = write(&dir, "Mix.wav", &wav_bytes(8_000, 12_000));
        assert_eq!(
            probe(&path),
            Probe {
                duration_ms: Some(1_500),
                format: Some("wav".into()),
            }
        );
    }

    #[test]
    fn an_aiff_has_its_length_and_container() {
        let dir = TempDir::new().unwrap();
        let path = write(&dir, "Mix.aif", &aiff_bytes(8_000));
        assert_eq!(
            probe(&path),
            Probe {
                duration_ms: Some(1_000),
                format: Some("aiff".into()),
            }
        );
    }

    #[test]
    fn the_container_is_told_from_the_bytes_not_the_extension() {
        let dir = TempDir::new().unwrap();
        let path = write(&dir, "Mix.mp3", &wav_bytes(8_000, 8_000));
        let found = probe(&path);
        assert_eq!(found.format.as_deref(), Some("wav"));
        assert_eq!(found.duration_ms, Some(1_000));
    }

    #[test]
    fn a_missing_file_probes_as_nothing() {
        let dir = TempDir::new().unwrap();
        assert_eq!(probe(&dir.path().join("gone.wav")), Probe::default());
    }

    #[test]
    fn bytes_that_are_not_audio_probe_as_nothing() {
        let dir = TempDir::new().unwrap();
        let noise: Vec<u8> = (0..4096u32)
            .map(|n| (n.wrapping_mul(2_654_435_761) >> 13) as u8)
            .collect();
        assert_eq!(probe(&write(&dir, "noise.wav", &noise)), Probe::default());
        assert_eq!(probe(&write(&dir, "empty.flac", &[])), Probe::default());
        assert_eq!(probe(&write(&dir, "notes.txt", b"hello")), Probe::default());
    }

    #[test]
    fn a_directory_probes_as_nothing() {
        let dir = TempDir::new().unwrap();
        assert_eq!(probe(dir.path()), Probe::default());
    }

    /// The SHA-256 of `bytes`, as the fingerprint spells it.
    fn sha256_hex(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    fn patterned(len: usize) -> Vec<u8> {
        (0..len).map(|n| (n * 31 % 251) as u8).collect()
    }

    #[test]
    fn a_fingerprint_is_the_size_and_a_sha256() {
        let dir = TempDir::new().unwrap();
        let path = write(&dir, "a.wav", b"abc");
        assert_eq!(
            fingerprint(&path).unwrap(),
            "dit:3:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn an_empty_file_has_a_fingerprint() {
        let dir = TempDir::new().unwrap();
        let path = write(&dir, "empty.wav", b"");
        assert_eq!(
            fingerprint(&path).unwrap(),
            "dit:0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn a_file_up_to_128_kib_is_hashed_whole_each_byte_once() {
        let dir = TempDir::new().unwrap();
        for len in [1, 65_535, 65_536, 65_537, 100_000, 131_071, 131_072] {
            let bytes = patterned(len);
            let path = write(&dir, "a.wav", &bytes);
            assert_eq!(
                fingerprint(&path).unwrap(),
                format!("dit:{len}:{}", sha256_hex(&bytes)),
                "{len} bytes"
            );
        }
    }

    #[test]
    fn overlapping_windows_are_not_counted_twice() {
        let dir = TempDir::new().unwrap();
        let bytes = patterned(100_000);
        let path = write(&dir, "a.wav", &bytes);
        let mut doubled = bytes[..65_536].to_vec();
        doubled.extend_from_slice(&bytes[100_000 - 65_536..]);
        assert_ne!(
            fingerprint(&path).unwrap(),
            format!("dit:100000:{}", sha256_hex(&doubled))
        );
    }

    #[test]
    fn a_larger_file_is_its_first_and_last_64_kib() {
        let dir = TempDir::new().unwrap();
        for len in [131_073, 200_000, 1_000_000] {
            let bytes = patterned(len);
            let path = write(&dir, "a.wav", &bytes);
            let mut windows = bytes[..65_536].to_vec();
            windows.extend_from_slice(&bytes[len - 65_536..]);
            assert_eq!(
                fingerprint(&path).unwrap(),
                format!("dit:{len}:{}", sha256_hex(&windows)),
                "{len} bytes"
            );
        }
    }

    #[test]
    fn the_middle_of_a_larger_file_is_not_read() {
        let dir = TempDir::new().unwrap();
        let mut bytes = patterned(300_000);
        let before = fingerprint(&write(&dir, "a.wav", &bytes)).unwrap();
        bytes[150_000] ^= 0xFF;
        assert_eq!(fingerprint(&write(&dir, "a.wav", &bytes)).unwrap(), before);
    }

    #[test]
    fn a_change_in_either_window_or_the_size_changes_the_fingerprint() {
        let dir = TempDir::new().unwrap();
        let bytes = patterned(300_000);
        let original = fingerprint(&write(&dir, "a.wav", &bytes)).unwrap();

        let mut head = bytes.clone();
        head[65_535] ^= 1;
        assert_ne!(fingerprint(&write(&dir, "a.wav", &head)).unwrap(), original);

        let mut tail = bytes.clone();
        tail[300_000 - 65_536] ^= 1;
        assert_ne!(fingerprint(&write(&dir, "a.wav", &tail)).unwrap(), original);

        let mut longer = bytes.clone();
        longer.insert(150_000, 7);
        assert_ne!(
            fingerprint(&write(&dir, "a.wav", &longer)).unwrap(),
            original
        );
    }

    #[test]
    fn the_same_bytes_have_the_same_fingerprint_under_another_name_and_folder() {
        let dir = TempDir::new().unwrap();
        let bytes = patterned(250_000);
        let first = write(&dir, "Mix.wav", &bytes);
        fs::create_dir(dir.path().join("Old")).unwrap();
        let moved = dir.path().join("Old").join("Mix v2 (final).wav");
        fs::rename(&first, &moved).unwrap();
        assert_eq!(
            fingerprint(&moved).unwrap(),
            fingerprint(&write(&dir, "copy.mp3", &bytes)).unwrap()
        );
    }

    #[test]
    fn a_file_that_is_not_there_is_an_error() {
        let dir = TempDir::new().unwrap();
        assert_eq!(
            fingerprint(&dir.path().join("gone.wav"))
                .unwrap_err()
                .kind(),
            io::ErrorKind::NotFound
        );
    }
}
