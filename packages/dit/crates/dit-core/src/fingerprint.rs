//! The match fingerprint of a set file: how the hub's sessions recorded by the retired scanner are recognised.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

use sha1::{Digest, Sha1};

/// How much of each end of a file the fingerprint reads.
const END: u64 = 64 * 1024;

/// `<size>:<sha1 of the first and last 64 KiB>` of the file at `path`, in lowercase hex: the whole file when it is
/// no longer than 128 KiB. A file that changes while it is read gives the fingerprint of the bytes read, with the
/// size the file had when it was opened.
///
/// The hub stores the string and never reads it; a session matches a file by comparing the strings.
pub fn file_fingerprint(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    let mut hash = Sha1::new();
    let mut buf = Vec::new();
    if size <= END * 2 {
        file.read_to_end(&mut buf)?;
        hash.update(&buf);
    } else {
        (&mut file).take(END).read_to_end(&mut buf)?;
        hash.update(&buf);
        buf.clear();
        file.seek(SeekFrom::Start(size - END))?;
        (&mut file).take(END).read_to_end(&mut buf)?;
        hash.update(&buf);
    }
    Ok(format!("{size}:{}", hex::encode(hash.finalize())))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn sha1_hex(bytes: &[u8]) -> String {
        hex::encode(Sha1::digest(bytes))
    }

    #[test]
    fn a_small_file_hashes_whole() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Song.als");
        fs::write(&path, b"abc").unwrap();

        assert_eq!(
            file_fingerprint(&path).unwrap(),
            "3:a9993e364706816aba3e25717850c26c9cd0d89d"
        );
    }

    #[test]
    fn a_file_of_exactly_two_ends_hashes_whole() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Song.als");
        let bytes: Vec<u8> = (0..(END * 2) as usize).map(|i| (i % 251) as u8).collect();
        fs::write(&path, &bytes).unwrap();

        assert_eq!(
            file_fingerprint(&path).unwrap(),
            format!("{}:{}", bytes.len(), sha1_hex(&bytes))
        );
    }

    #[test]
    fn a_larger_file_hashes_its_first_and_last_64_kib_and_ignores_the_middle() {
        let dir = tempfile::tempdir().unwrap();
        let mut bytes: Vec<u8> = (0..300_000usize).map(|i| (i % 253) as u8).collect();
        let path = dir.path().join("Song.als");
        fs::write(&path, &bytes).unwrap();
        let expected = format!(
            "300000:{}",
            sha1_hex(&[&bytes[..END as usize], &bytes[300_000 - END as usize..]].concat())
        );
        assert_eq!(file_fingerprint(&path).unwrap(), expected);

        bytes[150_000] ^= 0xff;
        fs::write(&path, &bytes).unwrap();
        assert_eq!(file_fingerprint(&path).unwrap(), expected);

        bytes[10] ^= 0xff;
        fs::write(&path, &bytes).unwrap();
        assert_ne!(file_fingerprint(&path).unwrap(), expected);
    }

    #[test]
    fn a_missing_file_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert!(file_fingerprint(&dir.path().join("gone.als")).is_err());
    }
}
