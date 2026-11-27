//! The app's end of the Live script (contract C5): a loopback TCP listener the script connects out to, speaking
//! newline-delimited JSON.
//!
//! The app writes `<port>\n<nonce>` to `port` beside the script's files (mode 0600); the script's first line is
//! `{"type":"hello","nonce","live","script"}`, which must arrive whole within [`HELLO_WITHIN`] of the connection
//! being accepted, and a connection whose nonce is not the one in the file is dropped, so another process on the
//! machine cannot pose as Live. At most [`MAX_OPEN`] connections are open at once; the rest are closed as they
//! arrive. The app answers with `{"type":"greeting","app"}` and says nothing else. One reader thread serves each
//! connection (the script is recreated per set, so connections come and go); a line over [`MAX_LINE`] ends its
//! connection. Lines that do not parse as a message are skipped, so a newer script can say more than this app knows.

use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::Sender;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::Deserialize;

/// The longest line read from the script.
pub const MAX_LINE: u64 = 1 << 20;

const PORT_FILE: &str = "port";
/// How long a new connection has, from the moment it is accepted, to send its whole hello line.
const HELLO_WITHIN: Duration = Duration::from_secs(10);
/// The most connections open at once, counting those still to say hello and those that have.
const MAX_OPEN: usize = 8;

/// What the listener holds its connections to.
#[derive(Clone, Copy)]
struct Limits {
    hello_within: Duration,
    max_open: usize,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptDevice {
    pub name: String,
    /// `live`, `vst3`, `au`, `vst` or `m4l`.
    pub kind: String,
    /// Live's internal class name (e.g. `Eq8`, `InstrumentGroupDevice`, `PluginDevice`), when sent by the script.
    #[serde(default)]
    pub class_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptTrack {
    pub id: i64,
    pub name: String,
    pub color: Option<i64>,
    /// `audio`, `midi`, `return`, `group` or `master`.
    pub kind: String,
    pub group_id: Option<i64>,
    pub devices: Vec<ScriptDevice>,
}

/// What the script says after its hello.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ScriptMessage {
    /// The document open: its path, `None` for a set not saved yet; `at` is when, in milliseconds since the epoch.
    Document {
        path: Option<String>,
        at: i64,
    },
    Tracks {
        tracks: Vec<ScriptTrack>,
    },
    #[serde(rename_all = "camelCase")]
    Song {
        tempo: f64,
        root_note: Option<u8>,
        scale_name: Option<String>,
        signature: [u32; 2],
    },
    Transport {
        playing: bool,
        recording: bool,
    },
    Closed,
}

/// What the listener tells the app.
#[derive(Debug, Clone, PartialEq)]
pub enum ScriptEvent {
    /// A script said hello with the right nonce.
    Connected {
        live: String,
        script: String,
    },
    Message(ScriptMessage),
    /// A connection that had said hello ended.
    Disconnected,
}

#[derive(Deserialize)]
struct Hello {
    #[serde(rename = "type")]
    kind: String,
    nonce: String,
    #[serde(default)]
    live: String,
    #[serde(default)]
    script: String,
}

/// A running listener. Dropping it stops accepting and removes the port file; connections already open end when
/// their script hangs up.
pub struct ScriptServer {
    port: u16,
    folder: PathBuf,
    stop: Arc<AtomicBool>,
    accepting: Option<JoinHandle<()>>,
}

fn random_nonce() -> io::Result<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|error| io::Error::other(error.to_string()))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn write_port_file(folder: &Path, port: u16, nonce: &str) -> io::Result<()> {
    fs::create_dir_all(folder)?;
    let temp = folder.join(".port.tmp");
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(&temp)?;
    file.write_all(format!("{port}\n{nonce}").as_bytes())?;
    file.sync_all()?;
    fs::rename(&temp, folder.join(PORT_FILE))
}

impl ScriptServer {
    /// Listens on a loopback port of the system's choosing, writes the port file in `folder` (the script's own
    /// folder) and sends what the script says to `events`. `app` is the version the greeting names.
    pub fn start(
        folder: &Path,
        app: &str,
        events: Sender<ScriptEvent>,
    ) -> io::Result<ScriptServer> {
        Self::start_limited(
            folder,
            app,
            events,
            Limits {
                hello_within: HELLO_WITHIN,
                max_open: MAX_OPEN,
            },
        )
    }

    fn start_limited(
        folder: &Path,
        app: &str,
        events: Sender<ScriptEvent>,
        limits: Limits,
    ) -> io::Result<ScriptServer> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let port = listener.local_addr()?.port();
        let nonce = random_nonce()?;
        write_port_file(folder, port, &nonce)?;
        let stop = Arc::new(AtomicBool::new(false));
        let accepting = {
            let stop = stop.clone();
            let app = app.to_string();
            let open = Arc::new(AtomicUsize::new(0));
            thread::spawn(move || {
                for stream in listener.incoming() {
                    if stop.load(Ordering::SeqCst) {
                        return;
                    }
                    let Ok(stream) = stream else {
                        continue;
                    };
                    let accepted = Instant::now();
                    // Past the cap the stream is dropped, which closes it.
                    let Some(counted) = Open::take(&open, limits.max_open) else {
                        continue;
                    };
                    let (events, nonce, app) = (events.clone(), nonce.clone(), app.clone());
                    thread::spawn(move || {
                        serve(stream, accepted, limits.hello_within, &nonce, &app, &events);
                        drop(counted);
                    });
                }
            })
        };
        Ok(ScriptServer {
            port,
            folder: folder.to_path_buf(),
            stop,
            accepting: Some(accepting),
        })
    }

    pub fn port(&self) -> u16 {
        self.port
    }
}

impl Drop for ScriptServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // A blocked accept returns for a connection; this one is only there to be that.
        let _ = TcpStream::connect(SocketAddr::from((Ipv4Addr::LOCALHOST, self.port)));
        if let Some(accepting) = self.accepting.take() {
            let _ = accepting.join();
        }
        let _ = fs::remove_file(self.folder.join(PORT_FILE));
    }
}

/// The next line, without its newline; `None` at the end of the stream or past the cap.
fn read_line(reader: &mut impl BufRead) -> io::Result<Option<String>> {
    let mut line = Vec::new();
    let read = reader
        .by_ref()
        .take(MAX_LINE + 1)
        .read_until(b'\n', &mut line)?;
    if read == 0 || line.last() != Some(&b'\n') {
        return Ok(None);
    }
    line.pop();
    Ok(Some(String::from_utf8_lossy(&line).into_owned()))
}

/// A connection's read half. While it has a `deadline` every read waits at most until then, so a client that trickles
/// bytes cannot hold the connection past it by keeping each read short.
struct Reading {
    stream: TcpStream,
    deadline: Option<Instant>,
}

impl Read for Reading {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if let Some(deadline) = self.deadline {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(io::ErrorKind::TimedOut.into());
            }
            self.stream.set_read_timeout(Some(left))?;
        }
        self.stream.read(buf)
    }
}

/// Whether `given` is `expected`, taking as long for a wrong guess as for a right one. The lengths are not secret
/// (the nonce is always 32 hex digits), so a different length answers at once.
fn nonce_matches(given: &str, expected: &str) -> bool {
    let (given, expected) = (given.as_bytes(), expected.as_bytes());
    if given.len() != expected.len() {
        return false;
    }
    given
        .iter()
        .zip(expected)
        .fold(0u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

/// Counts a connection while it is open, from accept to the end of its thread.
struct Open(Arc<AtomicUsize>);

impl Open {
    /// Counts a connection, unless `max` are already open.
    fn take(open: &Arc<AtomicUsize>, max: usize) -> Option<Open> {
        open.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
            (count < max).then_some(count + 1)
        })
        .ok()
        .map(|_| Open(open.clone()))
    }
}

impl Drop for Open {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

fn serve(
    stream: TcpStream,
    accepted: Instant,
    hello_within: Duration,
    nonce: &str,
    app: &str,
    events: &Sender<ScriptEvent>,
) {
    let Ok(read_half) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(Reading {
        stream: read_half,
        deadline: Some(accepted + hello_within),
    });
    let hello = match read_line(&mut reader) {
        Ok(Some(line)) => serde_json::from_str::<Hello>(&line).ok(),
        _ => None,
    };
    let Some(hello) =
        hello.filter(|hello| hello.kind == "hello" && nonce_matches(&hello.nonce, nonce))
    else {
        return;
    };
    let mut stream = stream;
    let app = serde_json::Value::from(app);
    let greeting = format!("{{\"type\":\"greeting\",\"app\":{app}}}");
    if writeln!(stream, "{greeting}").is_err() {
        return;
    }
    reader.get_mut().deadline = None;
    let _ = reader.get_ref().stream.set_read_timeout(None);
    let connected = ScriptEvent::Connected {
        live: hello.live,
        script: hello.script,
    };
    if events.send(connected).is_err() {
        return;
    }
    while let Ok(Some(line)) = read_line(&mut reader) {
        if let Ok(message) = serde_json::from_str::<ScriptMessage>(&line)
            && events.send(ScriptEvent::Message(message)).is_err()
        {
            return;
        }
    }
    let _ = events.send(ScriptEvent::Disconnected);
}

#[cfg(test)]
mod tests {
    use std::io::BufRead;
    use std::sync::mpsc::{self, Receiver};

    use super::*;

    fn start() -> (tempfile::TempDir, ScriptServer, Receiver<ScriptEvent>) {
        let folder = tempfile::tempdir().unwrap();
        let (sender, events) = mpsc::channel();
        let server = ScriptServer::start(folder.path(), "9.9.9", sender).unwrap();
        (folder, server, events)
    }

    fn port_and_nonce(folder: &Path) -> (u16, String) {
        let text = fs::read_to_string(folder.join("port")).unwrap();
        let (port, nonce) = text.split_once('\n').unwrap();
        (port.parse().unwrap(), nonce.to_string())
    }

    fn connect(folder: &Path) -> (TcpStream, String) {
        let (port, nonce) = port_and_nonce(folder);
        (
            TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap(),
            nonce,
        )
    }

    fn next(events: &Receiver<ScriptEvent>) -> ScriptEvent {
        events
            .recv_timeout(Duration::from_secs(5))
            .expect("an event")
    }

    fn hello(nonce: &str) -> String {
        format!(
            "{{\"type\":\"hello\",\"nonce\":\"{nonce}\",\"live\":\"12.4.6\",\"script\":\"1\"}}\n"
        )
    }

    #[test]
    fn the_port_file_holds_the_port_and_a_nonce_only_the_owner_can_read() {
        let (folder, server, _events) = start();
        let (port, nonce) = port_and_nonce(folder.path());
        assert_eq!(port, server.port());
        assert_eq!(nonce.len(), 32);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(folder.path().join("port"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn a_script_with_the_nonce_is_greeted_and_its_messages_arrive_in_order() {
        let (folder, _server, events) = start();
        let (mut stream, nonce) = connect(folder.path());
        stream.write_all(hello(&nonce).as_bytes()).unwrap();
        let mut greeting = String::new();
        BufReader::new(stream.try_clone().unwrap())
            .read_line(&mut greeting)
            .unwrap();
        assert_eq!(greeting.trim(), r#"{"type":"greeting","app":"9.9.9"}"#);
        assert_eq!(
            next(&events),
            ScriptEvent::Connected {
                live: "12.4.6".into(),
                script: "1".into()
            }
        );

        stream
            .write_all(
                concat!(
                    "{\"type\":\"document\",\"path\":\"/p/S Project/S.als\",\"at\":1760000000000}\n",
                    "{\"type\":\"future\",\"x\":1}\n",
                    "not json\n",
                    "{\"type\":\"tracks\",\"tracks\":[{\"id\":0,\"name\":\"Bass\",\"color\":16,\"kind\":\"audio\",\"groupId\":null,",
                    "\"devices\":[{\"name\":\"EQ Eight\",\"kind\":\"live\"}]}]}\n",
                    "{\"type\":\"song\",\"tempo\":124.0,\"rootNote\":null,\"scaleName\":null,\"signature\":[4,4]}\n",
                    "{\"type\":\"transport\",\"playing\":true,\"recording\":false}\n",
                    "{\"type\":\"closed\"}\n"
                )
                .as_bytes(),
            )
            .unwrap();

        assert_eq!(
            next(&events),
            ScriptEvent::Message(ScriptMessage::Document {
                path: Some("/p/S Project/S.als".into()),
                at: 1_760_000_000_000
            })
        );
        match next(&events) {
            ScriptEvent::Message(ScriptMessage::Tracks { tracks }) => {
                assert_eq!(tracks[0].name, "Bass");
                assert_eq!(tracks[0].group_id, None);
                assert_eq!(tracks[0].devices[0].kind, "live");
            }
            other => panic!("{other:?}"),
        }
        assert!(
            matches!(next(&events), ScriptEvent::Message(ScriptMessage::Song { tempo, .. }) if tempo == 124.0)
        );
        assert_eq!(
            next(&events),
            ScriptEvent::Message(ScriptMessage::Transport {
                playing: true,
                recording: false
            })
        );
        assert_eq!(next(&events), ScriptEvent::Message(ScriptMessage::Closed));
        drop(stream);
        assert_eq!(next(&events), ScriptEvent::Disconnected);
    }

    #[test]
    fn a_connection_with_the_wrong_nonce_or_no_hello_is_dropped_and_heard_by_no_one() {
        let (folder, _server, events) = start();
        let (mut wrong, _) = connect(folder.path());
        wrong.write_all(hello("not-the-nonce").as_bytes()).unwrap();
        let mut closed = String::new();
        assert_eq!(
            BufReader::new(wrong).read_line(&mut closed).unwrap(),
            0,
            "hung up, no greeting"
        );

        let (mut first, _) = connect(folder.path());
        first
            .write_all(b"{\"type\":\"document\",\"path\":null,\"at\":1}\n")
            .unwrap();
        let mut none = String::new();
        assert_eq!(BufReader::new(first).read_line(&mut none).unwrap(), 0);
        assert!(events.recv_timeout(Duration::from_millis(200)).is_err());
    }

    #[test]
    fn a_line_past_the_cap_ends_the_connection() {
        let (folder, _server, events) = start();
        let (mut stream, nonce) = connect(folder.path());
        stream.write_all(hello(&nonce).as_bytes()).unwrap();
        assert!(matches!(next(&events), ScriptEvent::Connected { .. }));

        let big = vec![b'x'; MAX_LINE as usize + 10];
        let _ = stream.write_all(&big);

        assert_eq!(next(&events), ScriptEvent::Disconnected);
    }

    #[test]
    fn dropping_the_server_removes_the_port_file() {
        let (folder, server, _events) = start();
        assert!(folder.path().join("port").exists());
        drop(server);
        assert!(!folder.path().join("port").exists());
    }

    fn start_limited(limits: Limits) -> (tempfile::TempDir, ScriptServer, Receiver<ScriptEvent>) {
        let folder = tempfile::tempdir().unwrap();
        let (sender, events) = mpsc::channel();
        let server = ScriptServer::start_limited(folder.path(), "9.9.9", sender, limits).unwrap();
        (folder, server, events)
    }

    /// Whether the server closes `stream` within `within`, without having sent it anything.
    fn closed_within(mut stream: &TcpStream, within: Duration) -> bool {
        stream.set_read_timeout(Some(within)).unwrap();
        let mut byte = [0u8];
        match stream.read(&mut byte) {
            Ok(read) => read == 0,
            Err(error) => !matches!(
                error.kind(),
                io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
            ),
        }
    }

    #[test]
    fn a_client_that_trickles_its_hello_is_dropped_when_the_budget_runs_out() {
        let (folder, _server, events) = start_limited(Limits {
            hello_within: Duration::from_millis(300),
            max_open: MAX_OPEN,
        });
        let (mut stream, _) = connect(folder.path());
        let started = Instant::now();

        // One byte every 100 ms never completes the line, and each wait for the next byte is short.
        let mut dropped = false;
        while started.elapsed() < Duration::from_secs(3) {
            if stream.write_all(b"x").is_err() {
                dropped = true;
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }

        assert!(dropped, "the connection was kept past the hello budget");
        assert!(started.elapsed() < Duration::from_millis(1500));
        assert!(events.recv_timeout(Duration::from_millis(100)).is_err());
    }

    #[test]
    fn a_connection_that_said_hello_in_time_is_not_held_to_the_budget_after() {
        let (folder, _server, events) = start_limited(Limits {
            hello_within: Duration::from_millis(600),
            max_open: MAX_OPEN,
        });
        let (mut stream, nonce) = connect(folder.path());
        stream.write_all(hello(&nonce).as_bytes()).unwrap();

        assert!(matches!(next(&events), ScriptEvent::Connected { .. }));
        // Said hello, the connection has no budget: it outlives it.
        thread::sleep(Duration::from_millis(900));
        stream
            .write_all(b"{\"type\":\"transport\",\"playing\":true,\"recording\":false}\n")
            .unwrap();
        assert!(matches!(next(&events), ScriptEvent::Message(_)));
    }

    #[test]
    fn a_connection_past_the_cap_is_closed_and_a_closed_one_frees_its_place() {
        let (folder, _server, _events) = start();
        let mut open: Vec<TcpStream> = (0..MAX_OPEN).map(|_| connect(folder.path()).0).collect();

        let (ninth, nonce) = connect(folder.path());
        assert!(closed_within(&ninth, Duration::from_secs(2)));
        assert!(!closed_within(&open[0], Duration::from_millis(200)));

        drop(open.pop());
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let (mut stream, _) = connect(folder.path());
            stream.write_all(hello(&nonce).as_bytes()).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_millis(300)))
                .unwrap();
            let mut greeting = String::new();
            if BufReader::new(&stream)
                .read_line(&mut greeting)
                .is_ok_and(|read| read > 0)
            {
                assert!(greeting.contains("greeting"));
                break;
            }
            assert!(
                Instant::now() < deadline,
                "the freed place was never given out"
            );
        }
    }

    #[test]
    fn a_nonce_of_the_right_length_that_is_wrong_is_refused_and_the_right_one_accepted() {
        let (folder, _server, events) = start();
        let (mut wrong, nonce) = connect(folder.path());
        let mut guess = nonce.clone();
        let last = guess.pop().unwrap();
        guess.push(if last == '0' { '1' } else { '0' });
        wrong.write_all(hello(&guess).as_bytes()).unwrap();
        assert!(closed_within(&wrong, Duration::from_secs(2)));
        assert!(events.recv_timeout(Duration::from_millis(200)).is_err());

        let (mut right, _) = connect(folder.path());
        right.write_all(hello(&nonce).as_bytes()).unwrap();
        assert!(matches!(next(&events), ScriptEvent::Connected { .. }));
    }

    #[test]
    fn nonces_match_only_when_equal() {
        assert!(nonce_matches("0123abcd", "0123abcd"));
        assert!(!nonce_matches("0123abcd", "0123abce"));
        assert!(!nonce_matches("1123abcd", "0123abcd"));
        assert!(!nonce_matches("0123abc", "0123abcd"));
        assert!(!nonce_matches("", "0123abcd"));
        assert!(nonce_matches("", ""));
    }
}
