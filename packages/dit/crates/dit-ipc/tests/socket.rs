#![cfg(unix)]
//! The socket over a temp path: what a client and a server say to each other, and who may own the socket.

use std::io::{self, BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use dit_ipc::{Client, Done, Env, Handler, IpcError, Run, Server, Serving, VERSION};
use tempfile::TempDir;

/// A folder with a path short enough for a socket: macOS allows 103 bytes, and `$TMPDIR` there is half of that.
fn short_dir() -> TempDir {
    tempfile::Builder::new()
        .prefix("dit")
        .tempdir_in("/tmp")
        .unwrap()
}

fn socket_in(dir: &TempDir) -> PathBuf {
    dir.path().join("dit").join("dit.sock")
}

fn run(argv: &[&str]) -> Run {
    Run {
        cwd: "/some/project".into(),
        env: Env {
            author: Some("ada".into()),
            user: None,
            machine: Some("studio".into()),
        },
        argv: argv.iter().map(|arg| arg.to_string()).collect(),
    }
}

/// Answers a command with what it was given, after writing two stderr lines. The second waits for the client to
/// have read the first, which only a server that streams stderr can get past.
struct Echo {
    seen_first: Mutex<Receiver<()>>,
    panels: AtomicUsize,
}

impl Handler for Echo {
    fn run(&self, run: Run, stderr: &mut dyn Write) -> Done {
        writeln!(stderr, "first").unwrap();
        let streamed = self
            .seen_first
            .lock()
            .unwrap()
            .recv_timeout(Duration::from_secs(5))
            .is_ok();
        writeln!(stderr, "second").unwrap();
        Done {
            stdout: format!(
                "{} {:?} {:?} {}\n",
                run.cwd.display(),
                run.env.author,
                run.env.machine,
                run.argv.join(" ")
            ),
            code: if streamed { 3 } else { 99 },
            refusal: Some("nope".into()),
        }
    }

    fn show_panel(&self) {
        self.panels.fetch_add(1, Ordering::SeqCst);
    }
}

/// A stderr that tells the handler when its first line has arrived.
struct Tell {
    collected: Vec<u8>,
    first: Option<Sender<()>>,
}

impl Write for Tell {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.collected.extend_from_slice(buf);
        if let Some(first) = self.first.take() {
            let _ = first.send(());
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn serve(path: &Path) -> (Serving, Arc<Echo>, Sender<()>) {
    let (release, seen_first) = mpsc::channel();
    let echo = Arc::new(Echo {
        seen_first: Mutex::new(seen_first),
        panels: AtomicUsize::new(0),
    });
    let serving = Server::claim(path)
        .unwrap()
        .expect("nothing else holds the lock")
        .serve(echo.clone());
    (serving, echo, release)
}

#[test]
fn a_command_round_trips_with_its_stderr_streamed_before_it_ends() {
    let dir = short_dir();
    let path = socket_in(&dir);
    let (_serving, _echo, release) = serve(&path);

    let mut client = Client::connect(&path).unwrap().expect("a server listens");
    let mut stderr = Tell {
        collected: Vec::new(),
        first: Some(release),
    };
    let done = client
        .run(run(&["commit", "-m", "x y", "--json"]), &mut stderr)
        .unwrap();

    assert_eq!(
        String::from_utf8(stderr.collected).unwrap(),
        "first\nsecond\n"
    );
    assert_eq!(
        done.code, 3,
        "the first stderr line reached the client before the command ended"
    );
    assert_eq!(done.refusal.as_deref(), Some("nope"));
    assert_eq!(
        done.stdout,
        "/some/project Some(\"ada\") Some(\"studio\") commit -m x y --json\n"
    );
}

#[test]
fn one_connection_runs_command_after_command() {
    let dir = short_dir();
    let path = socket_in(&dir);
    let (_serving, _echo, release) = serve(&path);
    drop(release);

    let mut client = Client::connect(&path).unwrap().unwrap();
    for argv in [&["status"][..], &["log"]] {
        let done = client.run(run(argv), &mut io::sink()).unwrap();
        assert!(done.stdout.ends_with(&format!("{}\n", argv[0])));
    }
    client.ping().unwrap();
}

#[test]
fn a_request_of_another_version_is_refused_and_never_run() {
    let dir = short_dir();
    let path = socket_in(&dir);
    let (_serving, _echo, release) = serve(&path);
    drop(release);

    let mut stream = UnixStream::connect(&path).unwrap();
    writeln!(
        stream,
        r#"{{"v":{},"id":4,"cwd":"/","env":{{}},"argv":["status"]}}"#,
        VERSION + 1
    )
    .unwrap();
    let mut answer = String::new();
    BufReader::new(&stream).read_line(&mut answer).unwrap();
    let answer: serde_json::Value = serde_json::from_str(&answer).unwrap();

    assert_eq!(answer["id"], 4);
    let message = answer["error"].as_str().unwrap();
    assert!(message.contains("protocol"), "{message}");
    assert!(answer.get("done").is_none());
}

#[test]
fn a_client_told_the_version_is_wrong_fails_instead_of_running_locally() {
    let dir = short_dir();
    let path = dir.path().join("old.sock");
    let listener = UnixListener::bind(&path).unwrap();
    let old_app = std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut line = String::new();
        BufReader::new(&stream).read_line(&mut line).unwrap();
        let mut stream = stream;
        writeln!(
            stream,
            r#"{{"id":1,"error":"The dit app speaks protocol 0."}}"#
        )
        .unwrap();
    });

    let mut client = Client::connect(&path).unwrap().unwrap();
    let error = client.run(run(&["status"]), &mut io::sink()).unwrap_err();
    old_app.join().unwrap();

    assert!(
        matches!(&error, IpcError::Refused(message) if message == "The dit app speaks protocol 0."),
        "{error:?}"
    );
}

#[test]
fn a_second_instance_asks_the_first_to_show_its_panel() {
    let dir = short_dir();
    let path = socket_in(&dir);
    let (_serving, echo, release) = serve(&path);
    drop(release);

    assert!(
        Server::claim(&path).unwrap().is_none(),
        "the lock is held, so the second instance does not get the socket"
    );
    Client::connect(&path)
        .unwrap()
        .unwrap()
        .show_panel()
        .unwrap();

    assert_eq!(echo.panels.load(Ordering::SeqCst), 1);
}

#[test]
fn a_stale_socket_is_replaced_by_the_instance_that_wins_the_lock() {
    let dir = short_dir();
    let path = socket_in(&dir);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    // A crashed app leaves its socket file and no listener.
    drop(UnixListener::bind(&path).unwrap());
    assert!(path.exists());
    assert!(
        Client::connect(&path).unwrap().is_none(),
        "a socket nobody listens on is nothing listening"
    );

    let (_serving, _echo, release) = serve(&path);
    drop(release);

    Client::connect(&path)
        .unwrap()
        .expect("the new instance answers")
        .ping()
        .unwrap();
}

#[test]
fn the_socket_is_private_and_goes_when_the_server_stops() {
    let dir = short_dir();
    let path = socket_in(&dir);
    let (serving, _echo, release) = serve(&path);
    drop(release);
    let mode = std::fs::metadata(&path).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o600);
    assert_eq!(
        std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect::<std::collections::BTreeSet<_>>(),
        ["dit.sock", "dit.sock.lock"].map(String::from).into(),
        "no staging folder is left beside the socket"
    );

    drop(serving);

    assert!(!path.exists());
    assert!(Client::connect(&path).unwrap().is_none());
    assert!(
        Server::claim(&path).unwrap().is_some(),
        "the lock is free again"
    );
}

#[test]
fn nothing_listening_is_none_whether_the_socket_exists_or_not() {
    let dir = short_dir();
    assert!(
        Client::connect(&dir.path().join("none.sock"))
            .unwrap()
            .is_none()
    );
}

#[test]
fn the_default_socket_sits_beside_the_user_config() {
    let path = dit_ipc::default_path().expect("this platform has a config folder");
    assert!(path.ends_with("dit/dit.sock"), "{}", path.display());
}

/// A listener that accepts connections and never answers them, like an app whose threads are wedged.
fn wedged(path: &Path) -> (UnixListener, Receiver<UnixStream>) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let listener = UnixListener::bind(path).unwrap();
    let accepting = listener.try_clone().unwrap();
    let (held, held_streams) = mpsc::channel();
    std::thread::spawn(move || {
        for stream in accepting.incoming().flatten() {
            if held.send(stream).is_err() {
                return;
            }
        }
    });
    (listener, held_streams)
}

fn timed_out(error: IpcError) -> bool {
    matches!(error, IpcError::Io { ref source, .. } if source.kind() == io::ErrorKind::TimedOut)
}

#[test]
fn a_ping_or_a_show_panel_to_an_app_that_never_answers_times_out() {
    let dir = short_dir();
    let path = socket_in(&dir);
    let (_listener, _held) = wedged(&path);

    for ask in [Client::ping, Client::show_panel] {
        let mut client = Client::connect(&path)
            .unwrap()
            .unwrap()
            .with_op_timeout(Duration::from_millis(300));
        let started = std::time::Instant::now();

        let error = ask(&mut client).unwrap_err();

        assert!(timed_out(error), "an answer that never comes is a timeout");
        assert!(started.elapsed() < Duration::from_secs(3));
    }
}

#[test]
fn an_app_that_answers_is_reached_within_the_timeout_and_a_command_is_not_held_to_it() {
    let dir = short_dir();
    let path = socket_in(&dir);
    let (_serving, echo, release) = serve(&path);
    let mut client = Client::connect(&path)
        .unwrap()
        .unwrap()
        .with_op_timeout(Duration::from_millis(200));

    client.ping().unwrap();
    client.show_panel().unwrap();
    assert_eq!(echo.panels.load(Ordering::SeqCst), 1);

    // The command's second line waits three times as long as an operation may.
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(600));
        let _ = release.send(());
    });
    let done = client
        .run(run(&["status"]), &mut io::sink())
        .expect("a command may take longer than an operation");
    assert_eq!(done.code, 3);
}
