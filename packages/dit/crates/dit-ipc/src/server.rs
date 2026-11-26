//! The app's side of the socket: one running instance, one listener, a [`Handler`] that answers.
//!
//! The instance that holds `dit.sock.lock` owns `dit.sock`. A socket file found there is a crashed app's, whatever
//! its age: the lock says nobody else answers for it, so it is replaced, not probed.

use std::fs::{self, DirBuilder, File, OpenOptions, TryLockError};
use std::io::{self, BufReader, Write};
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crate::IpcError;
use crate::protocol::{Body, Done, Frame, Op, Request, Run, Stream, VERSION};
use crate::wire::{MAX_REQUEST_BYTES, read_line, write_line};

/// What the app does for a client.
pub trait Handler: Send + Sync + 'static {
    /// Runs the command line `run` and returns how it ended. Whatever it writes to `stderr` reaches the client at
    /// once, so a command that waits on a person (the sign-in code) can show it while it waits.
    fn run(&self, run: Run, stderr: &mut dyn Write) -> Done;

    /// Shows the panel: a second instance has asked to hand off to this one.
    fn show_panel(&self);
}

/// The right to answer on a socket: the instance lock held, the socket bound.
#[must_use = "the socket answers only once serve is called"]
pub struct Server {
    listener: UnixListener,
    path: PathBuf,
    lock: File,
}

impl Server {
    /// Takes the instance lock beside `path` and binds the socket there with mode 0600. `None` when another
    /// instance holds the lock: the caller is the second instance and should [`Client::show_panel`] on `path`,
    /// then exit. A socket file a crashed instance left is replaced.
    ///
    /// [`Client::show_panel`]: crate::Client::show_panel
    pub fn claim(path: &Path) -> Result<Option<Server>, IpcError> {
        let (parent, name) = path.parent().zip(path.file_name()).ok_or_else(|| {
            IpcError::Protocol(format!("{} is not a socket path", path.display()))
        })?;
        fs::create_dir_all(parent)
            .map_err(|e| IpcError::io(format!("create {}", parent.display()), e))?;
        let mut lock_name = name.to_os_string();
        lock_name.push(".lock");
        let lock_path = parent.join(lock_name);
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)
            .map_err(|e| IpcError::io(format!("open {}", lock_path.display()), e))?;
        match lock.try_lock() {
            Ok(()) => {}
            Err(TryLockError::WouldBlock) => return Ok(None),
            Err(TryLockError::Error(error)) => {
                return Err(IpcError::io(format!("lock {}", lock_path.display()), error));
            }
        }
        let listener =
            bind_private(path).map_err(|e| IpcError::io(format!("bind {}", path.display()), e))?;
        Ok(Some(Server {
            listener,
            path: path.to_path_buf(),
            lock,
        }))
    }

    /// Answers clients through `handler` on a thread of its own, a thread for each connection, until the
    /// returned [`Serving`] is dropped.
    pub fn serve(self, handler: Arc<dyn Handler>) -> Serving {
        let stop = Arc::new(AtomicBool::new(false));
        let accepting = {
            let stop = stop.clone();
            let listener = self.listener;
            thread::spawn(move || accept(&listener, &handler, &stop))
        };
        Serving {
            path: self.path,
            stop,
            accepting: Some(accepting),
            _lock: self.lock,
        }
    }
}

/// A running server. Dropping it stops accepting, removes the socket and releases the instance lock, in that
/// order, so a successor never has its fresh socket removed by its predecessor.
pub struct Serving {
    path: PathBuf,
    stop: Arc<AtomicBool>,
    accepting: Option<JoinHandle<()>>,
    _lock: File,
}

impl Drop for Serving {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // A blocked accept returns for a connection; this one is only there to be that.
        let _ = UnixStream::connect(&self.path);
        if let Some(accepting) = self.accepting.take() {
            let _ = accepting.join();
        }
        let _ = fs::remove_file(&self.path);
    }
}

/// Binds the socket with no moment at which another user could connect: it is made inside a directory only this
/// user can enter, given its mode there, and renamed into place, which also replaces a stale socket in one step.
fn bind_private(path: &Path) -> io::Result<UnixListener> {
    let parent = path.parent().unwrap_or(Path::new("."));
    let staging = parent.join(format!(".{}", std::process::id()));
    let _ = fs::remove_dir_all(&staging);
    DirBuilder::new().mode(0o700).create(&staging)?;
    let bound = (|| {
        let staged = staging.join("s");
        let listener = UnixListener::bind(&staged)?;
        fs::set_permissions(&staged, fs::Permissions::from_mode(0o600))?;
        fs::rename(&staged, path)?;
        Ok(listener)
    })();
    let _ = fs::remove_dir_all(&staging);
    bound
}

fn accept(listener: &UnixListener, handler: &Arc<dyn Handler>, stop: &AtomicBool) {
    for stream in listener.incoming() {
        if stop.load(Ordering::SeqCst) {
            return;
        }
        match stream {
            Ok(stream) => {
                let handler = handler.clone();
                thread::spawn(move || connection(&*handler, stream));
            }
            // A connection that fell over before it was accepted is not the listener's end.
            Err(_) => thread::sleep(Duration::from_millis(50)),
        }
    }
}

/// Answers a client's requests until it hangs up. A write that fails ends the connection: the client is gone.
fn connection(handler: &dyn Handler, stream: UnixStream) {
    let Ok(read_half) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(read_half);
    let mut writer = stream;
    loop {
        let line: serde_json::Value = match read_line(&mut reader, MAX_REQUEST_BYTES) {
            Ok(Some(line)) => line,
            Ok(None) => return,
            Err(error) => {
                let _ = write_line(&mut writer, &refusal(0, error.to_string()));
                return;
            }
        };
        let id = line.get("id").and_then(|id| id.as_u64()).unwrap_or(0);
        let version = line.get("v").and_then(|v| v.as_u64());
        if version != Some(u64::from(VERSION)) {
            let message = format!(
                "The dit app speaks protocol {VERSION}; this dit speaks {}. Update the older one, or quit the \
                 app to run dit without it.",
                version.map_or_else(|| "none".to_string(), |v| v.to_string())
            );
            if write_line(&mut writer, &refusal(id, message)).is_err() {
                return;
            }
            continue;
        }
        let answered = match serde_json::from_value::<Request>(line) {
            Ok(request) => answer(handler, request, &mut writer),
            Err(error) => write_line(&mut writer, &refusal(id, error.to_string())),
        };
        if answered.is_err() {
            return;
        }
    }
}

fn answer(handler: &dyn Handler, request: Request, writer: &mut UnixStream) -> io::Result<()> {
    let id = request.id;
    match request.body {
        Body::Op { op: Op::Ping } => write_line(writer, &Frame::Ok { id, ok: true }),
        Body::Op { op: Op::ShowPanel } => {
            handler.show_panel();
            write_line(writer, &Frame::Ok { id, ok: true })
        }
        Body::Run(run) => {
            let mut stderr = StderrFrames {
                writer,
                id,
                carry: Vec::new(),
            };
            let done = handler.run(run, &mut stderr);
            stderr.finish()?;
            write_line(writer, &Frame::Done { id, done })
        }
    }
}

fn refusal(id: u64, error: String) -> Frame {
    Frame::Error { id, error }
}

/// A command's stderr as frames: one for each write, holding back the end of a character a write split.
struct StderrFrames<'a> {
    writer: &'a mut UnixStream,
    id: u64,
    carry: Vec<u8>,
}

impl StderrFrames<'_> {
    fn send(&mut self, upto: usize) -> io::Result<()> {
        if upto == 0 {
            return Ok(());
        }
        let text = String::from_utf8_lossy(&self.carry[..upto]).into_owned();
        self.carry.drain(..upto);
        write_line(
            self.writer,
            &Frame::Stderr {
                id: self.id,
                stream: Stream::Stderr,
                text,
            },
        )
    }

    /// Sends what is held back: the command is over, so the rest of a split character never comes.
    fn finish(&mut self) -> io::Result<()> {
        self.send(self.carry.len())
    }
}

impl Write for StderrFrames<'_> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.carry.extend_from_slice(buf);
        let whole = match std::str::from_utf8(&self.carry) {
            Ok(_) => self.carry.len(),
            // A character cut short at the end waits for its rest; bytes that are wrong go out as they are.
            Err(error) if error.error_len().is_none() => error.valid_up_to(),
            Err(_) => self.carry.len(),
        };
        self.send(whole)?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.writer.flush()
    }
}
