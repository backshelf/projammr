//! The object store: every leaf, chunk, tree, save and commit kept once,
//! named by hash. The ids and codecs are always available; the filesystem
//! `Store` and its zstd compression sit behind the default-on `store` feature.

pub mod cdc;
mod codec;

pub use codec::{
    LeafEntry, ObjectId, ObjectKind, ObjectRead, PartEntry, StoreError, TreeObject, decode_chunked,
    decode_tree, encode_chunked, encode_part, encode_tree, read_leaf, read_tree, read_tree_object,
};

#[cfg(feature = "store")]
pub use fs::{Batch, LEAF_INLINE_MAX, Store};

#[cfg(feature = "store")]
mod fs {
    use std::collections::{BTreeSet, HashSet};
    use std::fs::{self, File};
    use std::io::{self, Read, Write};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::cdc::{self, chunk_ranges};
    use super::{ObjectId, ObjectKind, ObjectRead, StoreError, encode_chunked, read_leaf};

    /// A leaf up to this many bytes is one Blob; a larger one is chunked.
    pub const LEAF_INLINE_MAX: usize = 256 * 1024;
    const ZSTD_LEVEL: i32 = 3;

    /// Distinguishes the temp files of writers in one process.
    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn io_error(error: io::Error) -> StoreError {
        StoreError::Io(error.to_string())
    }

    /// Objects as files under one directory, at `<first two hex chars>/<hex id>`,
    /// each holding zstd level 3 of `kind byte ‖ body`.
    #[derive(Debug, Clone)]
    pub struct Store {
        root: PathBuf,
    }

    impl Store {
        /// Opens the store rooted at `dir`, creating the directory if needed.
        pub fn open(dir: impl Into<PathBuf>) -> Result<Self, StoreError> {
            let root = dir.into();
            fs::create_dir_all(&root).map_err(io_error)?;
            Ok(Self { root })
        }

        fn path_of(&self, id: &ObjectId) -> PathBuf {
            let hex = id.to_string();
            self.root.join(&hex[..2]).join(hex)
        }

        /// Stores an object and returns its id. An object already stored is
        /// left alone, which is sound because a file at an object's name is
        /// always durable: the file is written and synced beside its final
        /// name and only then renamed into place, so a reader never sees half
        /// of one either.
        pub fn put(&self, kind: ObjectKind, body: &[u8]) -> Result<ObjectId, StoreError> {
            let id = ObjectId::of(kind, body);
            let path = self.path_of(&id);
            if path.exists() {
                return Ok(id);
            }
            let written =
                write_temp(&path, kind, body, File::sync_all).and_then(|temp| place(&temp, &path));
            match written {
                // A concurrent writer of the same object got there first.
                Err(error) if !path.exists() => Err(io_error(error)),
                _ => Ok(id),
            }
        }

        /// Stores a leaf: one Blob when it is at most `LEAF_INLINE_MAX` bytes,
        /// otherwise its content-defined chunks as Blobs plus a Chunked object
        /// naming them, whose id is returned.
        pub fn put_leaf(&self, bytes: &[u8]) -> Result<ObjectId, StoreError> {
            put_leaf_with(bytes, |kind, body| self.put(kind, body))
        }

        /// Starts a `Batch`: puts made durable together by one flush.
        pub fn batch(&self) -> Batch<'_> {
            Batch {
                store: self,
                pending: Vec::new(),
                ids: HashSet::new(),
            }
        }

        pub fn read_leaf(&self, id: &ObjectId) -> Result<Vec<u8>, StoreError> {
            read_leaf(self, id)
        }

        /// An object's file as stored, unchanged: the zstd frame of `kind byte ‖ body`. It is not checked against
        /// `id`; `get` does that.
        pub fn raw(&self, id: &ObjectId) -> Result<Vec<u8>, StoreError> {
            fs::read(self.path_of(id)).map_err(|error| match error.kind() {
                io::ErrorKind::NotFound => StoreError::Missing(*id),
                _ => io_error(error),
            })
        }

        /// The size in bytes of an object's file as stored: the zstd frame a pack carries for it. The file is not
        /// read.
        pub fn frame_len(&self, id: &ObjectId) -> Result<u64, StoreError> {
            fs::metadata(self.path_of(id))
                .map(|metadata| metadata.len())
                .map_err(|error| match error.kind() {
                    io::ErrorKind::NotFound => StoreError::Missing(*id),
                    _ => io_error(error),
                })
        }

        /// Whether the object's file is in the store. Files appear only whole, so this says the object can be read.
        pub fn contains(&self, id: &ObjectId) -> bool {
            self.path_of(id).exists()
        }
    }

    /// Puts whose objects become durable together, for a caller about to make
    /// them reachable: a save's objects before a log names the save.
    ///
    /// Each object is written to a temp file beside its final name and pushed
    /// to the drive. `finish` then flushes the drive's cache once, renames
    /// every temp file into place and syncs the shard directories renamed
    /// into, so a file at an object's name is durable before anything can
    /// name it, as `Store::put` relies on. Nothing may name an object of the
    /// batch, and the store does not read one, until `finish` returns.
    ///
    /// A batch dropped unfinished, as an early `?` return drops it, removes its
    /// temp files and stores nothing. A crash before `finish` renames anything
    /// leaves only `.tmp-*` files; a crash after leaves durable objects that
    /// nothing names yet, which is harmless.
    #[must_use = "a batch stores nothing until it is finished"]
    #[derive(Debug)]
    pub struct Batch<'a> {
        store: &'a Store,
        /// Each object written: its temp file and its final name.
        pending: Vec<(PathBuf, PathBuf)>,
        ids: HashSet<ObjectId>,
    }

    impl Batch<'_> {
        /// Writes an object for `finish` to store and returns its id. An object
        /// already stored, or already in the batch, is left alone.
        pub fn put(&mut self, kind: ObjectKind, body: &[u8]) -> Result<ObjectId, StoreError> {
            let id = ObjectId::of(kind, body);
            let path = self.store.path_of(&id);
            if self.ids.contains(&id) || path.exists() {
                return Ok(id);
            }
            let temp = write_temp(&path, kind, body, durable::push).map_err(io_error)?;
            self.pending.push((temp, path));
            self.ids.insert(id);
            Ok(id)
        }

        /// `Store::put_leaf` within the batch.
        pub fn put_leaf(&mut self, bytes: &[u8]) -> Result<ObjectId, StoreError> {
            put_leaf_with(bytes, |kind, body| self.put(kind, body))
        }

        /// `put_leaf` for the bytes of `reader`, held one chunk window at a time instead of whole: the leaf ids are
        /// the ones `put_leaf` gives the same bytes. Returns the leaf's id and how many bytes were read.
        pub fn put_reader(&mut self, mut reader: impl Read) -> Result<(ObjectId, u64), StoreError> {
            // One byte past a chunk's longest reach, so a full buffer is told from a leaf that ends on it.
            let mut buf = vec![0u8; cdc::MAX + 1];
            let mut filled = fill(&mut reader, &mut buf, 0)?;
            let mut total = filled as u64;
            if filled <= LEAF_INLINE_MAX {
                return Ok((self.put(ObjectKind::Blob, &buf[..filled])?, total));
            }
            let mut chunks = Vec::new();
            while filled > 0 {
                let cut = cdc::next_cut(&buf[..filled.min(cdc::MAX)], 0);
                chunks.push(self.put(ObjectKind::Blob, &buf[..cut])?);
                buf.copy_within(cut..filled, 0);
                filled -= cut;
                if filled < buf.len() {
                    let more = fill(&mut reader, &mut buf, filled)?;
                    total += (more - filled) as u64;
                    filled = more;
                }
            }
            Ok((
                self.put(ObjectKind::Chunked, &encode_chunked(&chunks))?,
                total,
            ))
        }

        /// Stores every object of the batch: one flush of the drive's cache,
        /// then the renames into place, then a sync of each shard directory
        /// renamed into. On Apple platforms those directory syncs only reach
        /// the drive; the full flush that `sync_all` issues when the caller
        /// writes the log naming the objects makes them stable first. On an
        /// error the objects not yet renamed are removed, and the caller must
        /// name none of the batch.
        pub fn finish(mut self) -> Result<(), StoreError> {
            if self.pending.is_empty() {
                return Ok(());
            }
            durable::barrier(&self.store.root).map_err(io_error)?;
            let mut shards = BTreeSet::new();
            let mut placed = Ok(());
            while let Some((temp, path)) = self.pending.pop() {
                let renamed = place(&temp, &path);
                // A concurrent writer of the same object got there first.
                if renamed.is_err() && !path.exists() {
                    placed = renamed;
                    break;
                }
                if let Some(shard) = path.parent() {
                    shards.insert(shard.to_path_buf());
                }
            }
            let synced = shards.iter().try_for_each(|shard| sync_dir(shard));
            placed.and(synced).map_err(io_error)
        }
    }

    impl Drop for Batch<'_> {
        fn drop(&mut self) {
            // An unfinished batch stores nothing.
            for (temp, _) in self.pending.drain(..) {
                let _ = fs::remove_file(temp);
            }
        }
    }

    /// Reads into `buf` from `at` until it is full or `reader` ends, and returns how much of `buf` is filled.
    fn fill(reader: &mut impl Read, buf: &mut [u8], mut at: usize) -> Result<usize, StoreError> {
        while at < buf.len() {
            match reader.read(&mut buf[at..]) {
                Ok(0) => break,
                Ok(read) => at += read,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(error) => return Err(io_error(error)),
            }
        }
        Ok(at)
    }

    /// Stores a leaf through `put`, as `Store::put_leaf` describes.
    fn put_leaf_with(
        bytes: &[u8],
        mut put: impl FnMut(ObjectKind, &[u8]) -> Result<ObjectId, StoreError>,
    ) -> Result<ObjectId, StoreError> {
        if bytes.len() <= LEAF_INLINE_MAX {
            return put(ObjectKind::Blob, bytes);
        }
        let chunks = chunk_ranges(bytes)
            .into_iter()
            .map(|range| put(ObjectKind::Blob, &bytes[range]))
            .collect::<Result<Vec<_>, _>>()?;
        put(ObjectKind::Chunked, &encode_chunked(&chunks))
    }

    /// Writes `kind ‖ body`, compressed, to a new temp file in the shard
    /// directory of the object path `path`, syncs it with `sync` and returns
    /// the temp file's path. A failure leaves no temp file.
    fn write_temp(
        path: &Path,
        kind: ObjectKind,
        body: &[u8],
        sync: fn(&File) -> io::Result<()>,
    ) -> io::Result<PathBuf> {
        let dir = path.parent().expect("an object path has a shard directory");
        fs::create_dir_all(dir)?;

        let mut raw = Vec::with_capacity(body.len() + 1);
        raw.push(kind.as_byte());
        raw.extend_from_slice(body);
        // The bulk call writes the content size into the frame, which a push reads instead of decoding the object.
        let packed = zstd::bulk::compress(raw.as_slice(), ZSTD_LEVEL)?;

        let temp = dir.join(format!(
            ".tmp-{}-{}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let written = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .and_then(|mut file| {
                file.write_all(&packed)?;
                sync(&file)
            });
        match written {
            Ok(()) => Ok(temp),
            Err(error) => {
                let _ = fs::remove_file(&temp);
                Err(error)
            }
        }
    }

    /// Renames a written temp file to its object's name, removing the temp
    /// file when that fails.
    fn place(temp: &Path, path: &Path) -> io::Result<()> {
        fs::rename(temp, path).inspect_err(|_| {
            let _ = fs::remove_file(temp);
        })
    }

    /// Syncs a directory's entries, so the renames into it survive a crash.
    /// Windows cannot open a directory as a file to sync it.
    fn sync_dir(dir: &Path) -> io::Result<()> {
        #[cfg(unix)]
        return durable::push(&File::open(dir)?);
        #[cfg(not(unix))]
        {
            let _ = dir;
            Ok(())
        }
    }

    /// How a batch syncs. On Apple platforms `File::sync_all` is
    /// `fcntl(F_FULLFSYNC)`, a flush of the whole drive's cache, so a batch
    /// pushes each file to the drive with a plain `fsync` and flushes the
    /// cache once. Elsewhere each file keeps `sync_all` and the flush is a
    /// no-op.
    #[cfg(target_vendor = "apple")]
    mod durable {
        use std::fs::File;
        use std::io;
        use std::os::fd::AsRawFd;
        use std::path::Path;

        /// Hands a file's data and metadata to the drive, which may still hold
        /// them in its cache.
        pub(super) fn push(file: &File) -> io::Result<()> {
            // SAFETY: `fsync` only reads the descriptor, which `file` keeps open
            // for the call.
            retry(|| unsafe { libc::fsync(file.as_raw_fd()) })
        }

        /// Flushes the cache of the drive holding `dir`, so everything handed
        /// to it before is on stable storage.
        pub(super) fn barrier(dir: &Path) -> io::Result<()> {
            let dir = File::open(dir)?;
            // SAFETY: as in `push`; `F_FULLFSYNC` takes no argument.
            retry(|| unsafe { libc::fcntl(dir.as_raw_fd(), libc::F_FULLFSYNC) })
        }

        fn retry(call: impl Fn() -> libc::c_int) -> io::Result<()> {
            loop {
                if call() != -1 {
                    return Ok(());
                }
                let error = io::Error::last_os_error();
                if error.kind() != io::ErrorKind::Interrupted {
                    return Err(error);
                }
            }
        }
    }

    #[cfg(not(target_vendor = "apple"))]
    mod durable {
        use std::fs::File;
        use std::io;
        use std::path::Path;

        pub(super) fn push(file: &File) -> io::Result<()> {
            file.sync_all()
        }

        pub(super) fn barrier(_dir: &Path) -> io::Result<()> {
            Ok(())
        }
    }

    impl ObjectRead for Store {
        /// Reads an object and checks it hashes to its name. It never repairs.
        fn get(&self, id: &ObjectId) -> Result<(ObjectKind, Vec<u8>), StoreError> {
            let packed = match fs::read(self.path_of(id)) {
                Ok(packed) => packed,
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    return Err(StoreError::Missing(*id));
                }
                Err(error) => return Err(io_error(error)),
            };
            let mut raw =
                zstd::decode_all(packed.as_slice()).map_err(|_| StoreError::Corrupt(*id))?;
            let kind = raw
                .first()
                .and_then(|&byte| ObjectKind::from_byte(byte))
                .ok_or(StoreError::Corrupt(*id))?;
            let body = raw.split_off(1);
            if ObjectId::of(kind, &body) != *id {
                return Err(StoreError::Corrupt(*id));
            }
            Ok((kind, body))
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::store::{
            LeafEntry, PartEntry, TreeObject, decode_chunked, decode_tree, encode_tree,
        };
        use crate::tree::{LeafKind, PartKind};

        fn store() -> (tempfile::TempDir, Store) {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(dir.path().join("objects")).unwrap();
            (dir, store)
        }

        fn noise(len: usize) -> Vec<u8> {
            let mut x = 0x1234_5678u32;
            (0..len)
                .map(|_| {
                    x ^= x << 13;
                    x ^= x >> 17;
                    x ^= x << 5;
                    (x >> 24) as u8
                })
                .collect()
        }

        /// Hands out at most `step` bytes a call, as a pipe or a slow disk would.
        struct Trickle<'a>(&'a [u8], usize);

        impl Read for Trickle<'_> {
            fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
                let n = self.0.len().min(self.1).min(out.len());
                out[..n].copy_from_slice(&self.0[..n]);
                self.0 = &self.0[n..];
                Ok(n)
            }
        }

        #[test]
        fn a_streamed_leaf_has_the_id_of_the_slice_leaf_at_every_size_around_the_cuts() {
            let (_dir, store) = store();
            let data = noise(3 * 1024 * 1024);
            let sizes = [
                0,
                1,
                LEAF_INLINE_MAX - 1,
                LEAF_INLINE_MAX,
                LEAF_INLINE_MAX + 1,
                cdc::MAX * 2,
                cdc::MAX * 2 + 1,
                data.len(),
            ];
            for size in sizes {
                let bytes = &data[..size];
                let by_slice = store.put_leaf(bytes).unwrap();
                for step in [7, 4096, 1 << 20] {
                    let mut batch = store.batch();
                    let (by_stream, read) = batch.put_reader(Trickle(bytes, step)).unwrap();
                    batch.finish().unwrap();
                    assert_eq!(by_stream, by_slice, "size {size}, step {step}");
                    assert_eq!(read, size as u64);
                }
                assert_eq!(store.read_leaf(&by_slice).unwrap(), bytes);
            }
        }

        #[test]
        fn put_and_get_round_trip_every_kind() {
            let (_dir, store) = store();
            let tree = encode_tree(&TreeObject {
                parts: vec![PartEntry {
                    kind: PartKind::Track,
                    tag: Some("t".into()),
                    id: None,
                    leaves: vec![LeafEntry {
                        kind: LeafKind::Blob,
                        tag: None,
                        object: ObjectId::of(ObjectKind::Blob, b"x"),
                    }],
                }],
            });
            let bodies: [(ObjectKind, &[u8]); 5] = [
                (ObjectKind::Blob, b"leaf bytes"),
                (ObjectKind::Chunked, &[9; 64]),
                (ObjectKind::Tree, &tree),
                (ObjectKind::Save, br#"{"note":"a"}"#),
                (ObjectKind::Commit, br#"{"message":"b"}"#),
            ];
            for (kind, body) in bodies {
                let id = store.put(kind, body).unwrap();
                assert_eq!(id, ObjectId::of(kind, body));
                assert_eq!(store.get(&id).unwrap(), (kind, body.to_vec()));
            }
            let (_, tree_body) = store.get(&ObjectId::of(ObjectKind::Tree, &tree)).unwrap();
            assert_eq!(decode_tree(&tree_body).unwrap().parts.len(), 1);
        }

        #[test]
        fn an_empty_body_round_trips() {
            let (_dir, store) = store();
            let id = store.put(ObjectKind::Blob, b"").unwrap();
            assert_eq!(store.get(&id).unwrap(), (ObjectKind::Blob, vec![]));
        }

        #[test]
        fn objects_live_under_their_two_char_shard() {
            let (dir, store) = store();
            let id = store.put(ObjectKind::Blob, b"where").unwrap();
            let hex = id.to_string();
            let path = dir.path().join("objects").join(&hex[..2]).join(&hex);
            let packed = std::fs::read(path).unwrap();
            let raw = zstd::decode_all(packed.as_slice()).unwrap();
            assert_eq!(raw, [&[1u8][..], b"where"].concat());
        }

        #[test]
        fn putting_an_existing_object_does_not_rewrite_it() {
            let (dir, store) = store();
            let id = store.put(ObjectKind::Blob, b"once").unwrap();
            let hex = id.to_string();
            let path = dir.path().join("objects").join(&hex[..2]).join(&hex);
            let before = std::fs::metadata(&path).unwrap().modified().unwrap();
            assert_eq!(store.put(ObjectKind::Blob, b"once").unwrap(), id);
            assert_eq!(
                std::fs::metadata(&path).unwrap().modified().unwrap(),
                before
            );
            let shard = std::fs::read_dir(path.parent().unwrap()).unwrap().count();
            assert_eq!(shard, 1, "no temp file is left behind");
        }

        #[test]
        fn raw_is_the_stored_file_unchanged() {
            let (dir, store) = store();
            let id = store.put(ObjectKind::Blob, b"as stored").unwrap();
            let hex = id.to_string();
            let path = dir.path().join("objects").join(&hex[..2]).join(&hex);
            assert_eq!(store.raw(&id).unwrap(), std::fs::read(path).unwrap());
        }

        #[test]
        fn raw_of_an_absent_object_is_missing() {
            let (_dir, store) = store();
            let id = ObjectId::of(ObjectKind::Blob, b"never stored");
            assert_eq!(store.raw(&id), Err(StoreError::Missing(id)));
        }

        #[test]
        fn getting_an_absent_object_is_missing() {
            let (_dir, store) = store();
            let id = ObjectId::of(ObjectKind::Blob, b"never stored");
            assert_eq!(store.get(&id), Err(StoreError::Missing(id)));
        }

        #[test]
        fn a_leaf_of_exactly_256_kib_is_one_blob() {
            let (_dir, store) = store();
            let bytes = noise(LEAF_INLINE_MAX);
            let id = store.put_leaf(&bytes).unwrap();
            assert_eq!(id, ObjectId::of(ObjectKind::Blob, &bytes));
            assert_eq!(store.get(&id).unwrap().0, ObjectKind::Blob);
            assert_eq!(store.read_leaf(&id).unwrap(), bytes);
        }

        #[test]
        fn a_leaf_over_256_kib_is_chunked_and_reads_back_identical() {
            let (_dir, store) = store();
            let bytes = noise(1024 * 1024);
            let id = store.put_leaf(&bytes).unwrap();
            let (kind, body) = store.get(&id).unwrap();
            assert_eq!(kind, ObjectKind::Chunked);
            let chunks = decode_chunked(&body).unwrap();
            assert!(chunks.len() > 1);
            for chunk in &chunks {
                assert_eq!(store.get(chunk).unwrap().0, ObjectKind::Blob);
            }
            assert_eq!(store.read_leaf(&id).unwrap(), bytes);
        }

        #[test]
        fn a_small_edit_to_a_chunked_leaf_stores_only_the_chunks_around_it() {
            let (_dir, store) = store();
            let mut bytes = noise(2 * 1024 * 1024);
            let first = store.put_leaf(&bytes).unwrap();
            bytes[1_500_000] ^= 0xff;
            let second = store.put_leaf(&bytes).unwrap();
            let old = decode_chunked(&store.get(&first).unwrap().1).unwrap();
            let new = decode_chunked(&store.get(&second).unwrap().1).unwrap();
            let changed = new.iter().filter(|id| !old.contains(id)).count();
            assert_eq!(old.len(), new.len());
            assert!(changed <= 2, "{changed} chunks changed");
        }

        #[test]
        fn a_file_whose_content_does_not_hash_to_its_name_is_corrupt() {
            let (dir, store) = store();
            let id = store.put(ObjectKind::Blob, b"honest").unwrap();
            let hex = id.to_string();
            let path = dir.path().join("objects").join(&hex[..2]).join(&hex);

            let forged = zstd::encode_all(&[&[1u8][..], b"forged"].concat()[..], 3).unwrap();
            std::fs::write(&path, forged).unwrap();
            assert_eq!(store.get(&id), Err(StoreError::Corrupt(id)));
            assert_eq!(store.read_leaf(&id), Err(StoreError::Corrupt(id)));

            std::fs::write(&path, b"not zstd").unwrap();
            assert_eq!(store.get(&id), Err(StoreError::Corrupt(id)));

            std::fs::write(&path, zstd::encode_all(&[][..], 3).unwrap()).unwrap();
            assert_eq!(store.get(&id), Err(StoreError::Corrupt(id)));

            std::fs::write(&path, zstd::encode_all(&[99u8, 1][..], 3).unwrap()).unwrap();
            assert_eq!(store.get(&id), Err(StoreError::Corrupt(id)));
        }

        #[test]
        fn concurrent_writers_of_one_object_both_succeed() {
            let (_dir, store) = store();
            let bytes = noise(100_000);
            let ids: Vec<ObjectId> = std::thread::scope(|scope| {
                let handles: Vec<_> = (0..8)
                    .map(|_| scope.spawn(|| store.put(ObjectKind::Blob, &bytes).unwrap()))
                    .collect();
                handles.into_iter().map(|h| h.join().unwrap()).collect()
            });
            assert!(ids.windows(2).all(|w| w[0] == w[1]));
            assert_eq!(store.get(&ids[0]).unwrap().1, bytes);
        }

        #[test]
        fn open_creates_the_directory_and_reopens_the_same_objects() {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path().join("a").join("objects");
            let id = Store::open(&root)
                .unwrap()
                .put(ObjectKind::Blob, b"kept")
                .unwrap();
            assert_eq!(Store::open(&root).unwrap().get(&id).unwrap().1, b"kept");
        }

        /// The name of every file in the store's shard directories.
        fn stored_files(dir: &tempfile::TempDir) -> Vec<String> {
            let mut names = Vec::new();
            for shard in std::fs::read_dir(dir.path().join("objects")).unwrap() {
                for file in std::fs::read_dir(shard.unwrap().path()).unwrap() {
                    names.push(file.unwrap().file_name().to_string_lossy().into_owned());
                }
            }
            names
        }

        #[test]
        fn a_batch_stores_nothing_until_it_is_finished_then_every_object_once() {
            let (dir, store) = store();
            let leaf = noise(1024 * 1024);
            let mut batch = store.batch();
            let small = batch.put(ObjectKind::Blob, b"small").unwrap();
            let chunked = batch.put_leaf(&leaf).unwrap();
            assert_eq!(batch.put(ObjectKind::Blob, b"small").unwrap(), small);
            assert_eq!(store.get(&small), Err(StoreError::Missing(small)));
            assert_eq!(store.get(&chunked), Err(StoreError::Missing(chunked)));

            batch.finish().unwrap();
            assert_eq!(
                store.get(&small).unwrap(),
                (ObjectKind::Blob, b"small".to_vec())
            );
            assert_eq!(store.read_leaf(&chunked).unwrap(), leaf);
            let chunks = decode_chunked(&store.get(&chunked).unwrap().1).unwrap();
            let files = stored_files(&dir);
            assert_eq!(
                files.len(),
                chunks.len() + 2,
                "one file per object: {files:?}"
            );
            assert!(files.iter().all(|name| !name.starts_with(".tmp-")));
        }

        #[test]
        fn a_batch_leaves_an_object_already_stored_alone() {
            let (dir, store) = store();
            let id = store.put(ObjectKind::Blob, b"once").unwrap();
            let hex = id.to_string();
            let path = dir.path().join("objects").join(&hex[..2]).join(&hex);
            let before = std::fs::metadata(&path).unwrap().modified().unwrap();

            let mut batch = store.batch();
            assert_eq!(batch.put(ObjectKind::Blob, b"once").unwrap(), id);
            batch.finish().unwrap();
            assert_eq!(
                std::fs::metadata(&path).unwrap().modified().unwrap(),
                before
            );
            assert_eq!(stored_files(&dir), [hex]);
        }

        #[test]
        fn a_batch_dropped_unfinished_stores_nothing_and_removes_its_temp_files() {
            let (dir, store) = store();
            let ids = {
                let mut batch = store.batch();
                [
                    batch.put(ObjectKind::Blob, b"dropped").unwrap(),
                    batch.put_leaf(&noise(1024 * 1024)).unwrap(),
                ]
            };
            for id in ids {
                assert_eq!(store.get(&id), Err(StoreError::Missing(id)));
            }
            assert_eq!(stored_files(&dir), Vec::<String>::new());
        }

        #[test]
        fn a_crash_before_finish_leaves_no_object_a_log_could_name_and_a_retry_stores_them_all() {
            let (dir, store) = store();
            let leaf = noise(1024 * 1024);
            let mut batch = store.batch();
            let chunked = batch.put_leaf(&leaf).unwrap();
            let save_body = chunked.to_string();
            let save = batch.put(ObjectKind::Save, save_body.as_bytes()).unwrap();
            // The process stops before `finish`: nothing is renamed or removed.
            std::mem::forget(batch);

            let files = stored_files(&dir);
            assert!(!files.is_empty());
            assert!(
                files.iter().all(|name| name.starts_with(".tmp-")),
                "{files:?}"
            );
            assert_eq!(store.get(&save), Err(StoreError::Missing(save)));
            assert_eq!(store.get(&chunked), Err(StoreError::Missing(chunked)));

            // The next save writes the same objects again, past the leftovers.
            let mut retry = store.batch();
            assert_eq!(retry.put_leaf(&leaf).unwrap(), chunked);
            assert_eq!(
                retry.put(ObjectKind::Save, save_body.as_bytes()).unwrap(),
                save
            );
            retry.finish().unwrap();
            let chunks = decode_chunked(&store.get(&chunked).unwrap().1).unwrap();
            for id in chunks.iter().chain([&chunked, &save]) {
                assert!(
                    store.get(id).is_ok(),
                    "{id} reads back and hashes to its name"
                );
            }
            assert_eq!(store.read_leaf(&chunked).unwrap(), leaf);
        }
    }
}
