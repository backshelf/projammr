use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tempfile::TempDir;

use super::client::JsonBody;
use super::test_support::*;
use super::*;

fn code(expires_in: u64, interval: u64) -> (u16, String) {
    let body = json!({
        "device_code": "the-device-code",
        "user_code": "WDJBMJHT",
        "verification_uri": "http://localhost:3000/device",
        "verification_uri_complete": "http://localhost:3000/device?user_code=WDJBMJHT",
        "expires_in": expires_in,
        "interval": interval,
    });
    (200, body.to_string())
}

fn refused(error: &str) -> (u16, String) {
    (400, json!({ "error": error }).to_string())
}

fn token() -> (u16, String) {
    let body = json!({ "access_token": TOKEN, "token_type": "Bearer", "expires_in": 604800 });
    (200, body.to_string())
}

fn session() -> (u16, String) {
    let body = json!({
        "session": { "token": TOKEN, "deviceName": "Studio iMac" },
        "user": { "id": "user-1", "name": "Ada Lovelace", "email": "ada@example.com" },
    });
    (200, body.to_string())
}

/// The in-memory token store the tests use in place of the Keychain.
#[derive(Default)]
struct MemoryTokens(Mutex<HashMap<String, String>>);

impl MemoryTokens {
    fn holding(instance: &str) -> Self {
        let tokens = MemoryTokens::default();
        tokens
            .0
            .lock()
            .unwrap()
            .insert(instance.to_string(), TOKEN.to_string());
        tokens
    }

    fn stored(&self) -> HashMap<String, String> {
        self.0.lock().unwrap().clone()
    }
}

impl TokenStore for MemoryTokens {
    fn get(&self, instance: &Instance) -> Result<Option<Token>, RemoteError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .get(instance.url())
            .cloned()
            .map(Token::new))
    }

    fn set(&self, instance: &Instance, token: &Token) -> Result<(), RemoteError> {
        self.0
            .lock()
            .unwrap()
            .insert(instance.url().to_string(), token.secret().to_string());
        Ok(())
    }

    fn delete(&self, instance: &Instance) -> Result<(), RemoteError> {
        self.0.lock().unwrap().remove(instance.url());
        Ok(())
    }
}

/// A token store that fails the read, or the write, of the instance's token.
struct FlakyTokens(MemoryTokens, FlakyOp);

#[derive(PartialEq)]
enum FlakyOp {
    Get,
    Set,
}

impl FlakyTokens {
    fn unreadable() -> Self {
        FlakyTokens(MemoryTokens::default(), FlakyOp::Get)
    }

    fn unwritable() -> Self {
        FlakyTokens(MemoryTokens::default(), FlakyOp::Set)
    }
}

impl TokenStore for FlakyTokens {
    fn get(&self, instance: &Instance) -> Result<Option<Token>, RemoteError> {
        if self.1 == FlakyOp::Get {
            return Err(RemoteError::Keyring(
                "the stored token is unreadable".to_string(),
            ));
        }
        self.0.get(instance)
    }

    fn set(&self, instance: &Instance, token: &Token) -> Result<(), RemoteError> {
        if self.1 == FlakyOp::Set {
            return Err(RemoteError::Keyring("the keychain is locked".to_string()));
        }
        self.0.set(instance, token)
    }

    fn delete(&self, instance: &Instance) -> Result<(), RemoteError> {
        self.0.delete(instance)
    }
}

/// A clock whose `sleep` moves time on at once and remembers how long it was asked to wait.
struct FakeClock {
    start: Instant,
    elapsed: Cell<Duration>,
    sleeps: RefCell<Vec<u64>>,
}

impl FakeClock {
    fn new() -> Self {
        FakeClock {
            start: Instant::now(),
            elapsed: Cell::new(Duration::ZERO),
            sleeps: RefCell::new(Vec::new()),
        }
    }

    fn sleeps(&self) -> Vec<u64> {
        self.sleeps.borrow().clone()
    }
}

impl Clock for FakeClock {
    fn now(&self) -> Instant {
        self.start + self.elapsed.get()
    }

    fn sleep(&self, duration: Duration) {
        self.elapsed.set(self.elapsed.get() + duration);
        self.sleeps.borrow_mut().push(duration.as_secs());
    }
}

/// A user config path in a temp folder, optionally written first.
struct ConfigFile {
    _dir: TempDir,
    path: PathBuf,
}

impl ConfigFile {
    fn empty() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dit").join("config.toml");
        ConfigFile { _dir: dir, path }
    }

    fn with(config: &UserConfig) -> Self {
        let file = ConfigFile::empty();
        config.save(&file.path).unwrap();
        file
    }

    fn signed_in_to(server: &MockServer) -> Self {
        ConfigFile::with(&UserConfig {
            instance: Some(Instance::parse(&server.url).unwrap()),
            machine: Some("Studio iMac".to_string()),
            ..Default::default()
        })
    }

    fn load(&self) -> UserConfig {
        UserConfig::load(&self.path).unwrap()
    }
}

#[test]
fn login_polls_until_approved_then_stores_the_token_and_the_instance() {
    let server = MockServer::start(vec![
        code(1800, 5),
        refused("authorization_pending"),
        refused("authorization_pending"),
        token(),
        session(),
    ]);
    let config = ConfigFile::with(&UserConfig {
        instance: None,
        machine: Some("Studio iMac".to_string()),
        ..Default::default()
    });
    let tokens = MemoryTokens::default();
    let clock = FakeClock::new();
    let mut shown = None;

    let signed_in = login(
        &config.path,
        &tokens,
        &clock,
        Some(&server.url),
        |code| {
            shown = Some(code.verification_uri_complete.clone());
        },
        |_| {},
    )
    .unwrap();

    assert_eq!(
        shown.as_deref(),
        Some("http://localhost:3000/device?user_code=WDJBMJHT")
    );
    assert_eq!(signed_in.user.name, "Ada Lovelace");
    assert_eq!(signed_in.machine, "Studio iMac");
    assert_eq!(clock.sleeps(), [5, 5, 5]);
    assert_eq!(
        tokens.stored(),
        HashMap::from([(server.url.clone(), TOKEN.to_string())])
    );
    assert_eq!(config.load().instance.unwrap().url(), server.url);
    assert!(
        !std::fs::read_to_string(&config.path)
            .unwrap()
            .contains(TOKEN)
    );

    let requests = server.requests();
    assert_eq!(requests[0].path, "/api/auth/device/code");
    assert_eq!(requests[0].json(), json!({ "client_id": "dit" }));
    for poll in &requests[1..4] {
        assert_eq!(
            (poll.method.as_str(), poll.path.as_str()),
            ("POST", "/api/auth/device/token")
        );
        assert_eq!(
            poll.json(),
            json!({
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "device_code": "the-device-code",
                "client_id": "dit",
            })
        );
        assert_eq!(poll.header("X-Device-Name"), Some("Studio iMac"));
        assert_eq!(poll.header("Authorization"), None);
    }
    assert_eq!(requests[4].path, "/api/auth/get-session");
    assert_eq!(
        requests[4].header("Authorization"),
        Some(format!("Bearer {TOKEN}").as_str())
    );
}

#[test]
fn login_signs_in_as_the_resolved_machine_and_leaves_the_config_naming_none() {
    let server = MockServer::start(vec![code(1800, 5), token(), session()]);
    let config = ConfigFile::empty();

    let signed_in = login(
        &config.path,
        &MemoryTokens::default(),
        &FakeClock::new(),
        Some(&server.url),
        |_| {},
        |_| {},
    )
    .unwrap();

    let name = crate::machine::name(None);
    assert_eq!(signed_in.machine, name);
    assert_eq!(config.load().machine, None);
    assert_eq!(
        server.requests()[1].header("X-Device-Name"),
        Some(client::sanitize_device_name_header(&name).as_str())
    );
}

#[test]
fn curly_apostrophe_machine_name_sanitizes_device_name_header_and_succeeds() {
    let server = MockServer::start(vec![code(1800, 5), token(), session()]);
    let config = ConfigFile::with(&UserConfig {
        instance: Some(Instance::parse(&server.url).unwrap()),
        machine: Some("Alex\u{2019}s MacBook Pro".to_string()),
        ..UserConfig::default()
    });

    let signed_in = login(
        &config.path,
        &MemoryTokens::default(),
        &FakeClock::new(),
        None,
        |_| {},
        |_| {},
    )
    .unwrap();

    assert_eq!(signed_in.machine, "Alex\u{2019}s MacBook Pro");
    assert_eq!(
        server.requests()[1].header("X-Device-Name"),
        Some("Alex's MacBook Pro")
    );
}

#[test]
fn login_with_no_address_signs_in_to_the_configured_instance() {
    let server = MockServer::start(vec![code(1800, 5), token(), session()]);
    let config = ConfigFile::signed_in_to(&server);

    let signed_in = login(
        &config.path,
        &MemoryTokens::default(),
        &FakeClock::new(),
        None,
        |_| {},
        |_| {},
    )
    .unwrap();

    assert_eq!(signed_in.instance.url(), server.url);
}

#[test]
fn login_with_no_address_and_no_configured_instance_asks_for_one() {
    let error = login(
        &ConfigFile::empty().path,
        &MemoryTokens::default(),
        &FakeClock::new(),
        None,
        |_| {},
        |_| {},
    )
    .unwrap_err();

    assert_eq!(
        error.to_string(),
        "No instance to sign in to. Run dit login <url>."
    );
}

#[test]
fn slow_down_adds_five_seconds_to_the_interval_from_then_on() {
    let server = MockServer::start(vec![
        code(1800, 5),
        refused("authorization_pending"),
        refused("slow_down"),
        refused("authorization_pending"),
        token(),
        session(),
    ]);
    let clock = FakeClock::new();

    login(
        &ConfigFile::empty().path,
        &MemoryTokens::default(),
        &clock,
        Some(&server.url),
        |_| {},
        |_| {},
    )
    .unwrap();

    assert_eq!(clock.sleeps(), [5, 5, 10, 10]);
}

#[test]
fn a_denied_code_ends_the_login_with_nothing_stored() {
    let server = MockServer::start(vec![
        code(1800, 5),
        refused("authorization_pending"),
        refused("access_denied"),
    ]);
    let config = ConfigFile::empty();
    let tokens = MemoryTokens::default();

    let error = login(
        &config.path,
        &tokens,
        &FakeClock::new(),
        Some(&server.url),
        |_| {},
        |_| {},
    )
    .unwrap_err();

    assert_eq!(error.to_string(), "Sign-in was denied. Not signed in.");
    assert!(tokens.stored().is_empty());
    assert!(!config.path.exists());
}

#[test]
fn a_code_the_instance_calls_expired_ends_the_login() {
    let server = MockServer::start(vec![code(1800, 5), refused("expired_token")]);
    let tokens = MemoryTokens::default();

    let error = login(
        &ConfigFile::empty().path,
        &tokens,
        &FakeClock::new(),
        Some(&server.url),
        |_| {},
        |_| {},
    )
    .unwrap_err();

    assert_eq!(
        error.to_string(),
        "The sign-in code expired. Not signed in."
    );
    assert!(tokens.stored().is_empty());
}

#[test]
fn polling_stops_once_expires_in_has_passed() {
    let server = MockServer::start(vec![
        code(12, 5),
        refused("authorization_pending"),
        refused("authorization_pending"),
    ]);
    let clock = FakeClock::new();

    let error = login(
        &ConfigFile::empty().path,
        &MemoryTokens::default(),
        &clock,
        Some(&server.url),
        |_| {},
        |_| {},
    )
    .unwrap_err();

    assert!(matches!(error, RemoteError::Expired));
    assert_eq!(clock.sleeps(), [5, 5, 5]);
    assert_eq!(server.requests().len(), 3);
}

#[test]
fn an_unknown_poll_error_names_the_instance_and_the_error() {
    let server = MockServer::start(vec![code(1800, 5), refused("invalid_grant")]);

    let error = login(
        &ConfigFile::empty().path,
        &MemoryTokens::default(),
        &FakeClock::new(),
        Some(&server.url),
        |_| {},
        |_| {},
    )
    .unwrap_err();

    assert_eq!(
        error.to_string(),
        format!("Unexpected answer from {}: invalid_grant", server.host())
    );
}

#[test]
fn whoami_asks_the_instance_with_the_stored_token() {
    let server = MockServer::start(vec![session()]);
    let config = ConfigFile::signed_in_to(&server);

    let signed_in = whoami(&config.path, &MemoryTokens::holding(&server.url)).unwrap();

    assert_eq!(
        signed_in.user,
        SessionUser {
            id: "user-1".to_string(),
            name: "Ada Lovelace".to_string(),
            email: "ada@example.com".to_string(),
        }
    );
    assert_eq!(signed_in.machine, "Studio iMac");
    let requests = server.requests();
    assert_eq!(
        requests[0].header("Authorization"),
        Some(format!("Bearer {TOKEN}").as_str())
    );
    assert_eq!(requests[0].header("X-Device-Name"), Some("Studio iMac"));
}

#[test]
fn a_401_on_a_later_call_says_the_machine_is_signed_out() {
    let server = MockServer::start(vec![(401, "{}".to_string())]);
    let config = ConfigFile::signed_in_to(&server);

    let error = whoami(&config.path, &MemoryTokens::holding(&server.url)).unwrap_err();

    assert_eq!(
        error.to_string(),
        format!("Signed out of {}. Run dit login.", server.host())
    );
}

#[test]
fn a_session_the_instance_answers_with_null_is_signed_out_too() {
    let server = MockServer::start(vec![(200, "null".to_string())]);
    let config = ConfigFile::signed_in_to(&server);

    let error = whoami(&config.path, &MemoryTokens::holding(&server.url)).unwrap_err();

    assert!(matches!(error, RemoteError::SignedOut { .. }));
}

#[test]
fn whoami_with_no_token_for_the_instance_is_not_signed_in() {
    let server = MockServer::start(vec![]);
    let config = ConfigFile::signed_in_to(&server);

    let error = whoami(&config.path, &MemoryTokens::default()).unwrap_err();

    assert_eq!(
        error.to_string(),
        format!("Not signed in to {}. Run dit login.", server.host())
    );
}

#[test]
fn an_unreachable_instance_is_neither_signed_out_nor_a_certificate_problem() {
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let url = format!("http://127.0.0.1:{port}");
    let config = ConfigFile::with(&UserConfig {
        instance: Some(Instance::parse(&url).unwrap()),
        machine: None,
        ..Default::default()
    });

    let error = whoami(&config.path, &MemoryTokens::holding(&url)).unwrap_err();

    assert!(matches!(error, RemoteError::Unreachable { .. }), "{error}");
    assert!(
        error
            .to_string()
            .starts_with(&format!("Can't reach 127.0.0.1:{port}: "))
    );
    assert!(!error.to_string().contains(TOKEN));
}

#[test]
fn an_untrusted_certificate_names_the_host_and_the_docs() {
    let rcgen::CertifiedKey { cert, signing_key } =
        rcgen::generate_simple_self_signed(vec!["127.0.0.1".to_string()]).unwrap();
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let server_config = rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![cert.der().clone()],
            rustls::pki_types::PrivatePkcs8KeyDer::from(signing_key.serialize_der()).into(),
        )
        .unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut connection = rustls::ServerConnection::new(Arc::new(server_config)).unwrap();
        // The client walks away once it has seen the certificate, which ends the handshake with an error.
        let _ = connection.complete_io(&mut stream);
    });
    let host = format!("127.0.0.1:{port}");
    let client = Client::new(
        Instance::parse(&format!("https://{host}")).unwrap(),
        "Studio iMac".to_string(),
    );

    let error = client.get("/auth/get-session", None).unwrap_err();

    assert_eq!(
        error.to_string(),
        format!(
            "Can't verify {host}'s certificate. Install its CA: https://backshelf.github.io/projammr/docs/self-hosting/https/"
        )
    );
}

#[test]
fn logout_ends_the_session_and_removes_the_token() {
    let server = MockServer::start(vec![(200, json!({ "success": true }).to_string())]);
    let config = ConfigFile::signed_in_to(&server);
    let tokens = MemoryTokens::holding(&server.url);

    let logout = logout(&config.path, &tokens).unwrap();

    assert_eq!(logout.instance.unwrap().url(), server.url);
    assert!(logout.server_error.is_none());
    assert!(tokens.stored().is_empty());
    let requests = server.requests();
    assert_eq!(
        (requests[0].method.as_str(), requests[0].path.as_str()),
        ("POST", "/api/auth/sign-out")
    );
    assert_eq!(
        requests[0].header("Authorization"),
        Some(format!("Bearer {TOKEN}").as_str())
    );
    assert_eq!(config.load().instance.unwrap().url(), server.url);
}

#[test]
fn logout_removes_the_token_even_when_the_instance_cannot_be_reached() {
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let url = format!("http://127.0.0.1:{port}");
    let config = ConfigFile::with(&UserConfig {
        instance: Some(Instance::parse(&url).unwrap()),
        machine: None,
        ..Default::default()
    });
    let tokens = MemoryTokens::holding(&url);

    let logout = logout(&config.path, &tokens).unwrap();

    assert!(matches!(
        logout.server_error,
        Some(RemoteError::Unreachable { .. })
    ));
    assert!(tokens.stored().is_empty());
}

#[test]
fn logout_with_a_token_the_instance_already_dropped_is_a_clean_sign_out() {
    let server = MockServer::start(vec![(401, "{}".to_string())]);
    let config = ConfigFile::signed_in_to(&server);
    let tokens = MemoryTokens::holding(&server.url);

    let logout = logout(&config.path, &tokens).unwrap();

    assert!(logout.server_error.is_none());
    assert!(tokens.stored().is_empty());
}

#[test]
fn logout_when_not_signed_in_has_nothing_to_end() {
    let logout = logout(&ConfigFile::empty().path, &MemoryTokens::default()).unwrap();

    assert!(logout.instance.is_none());
}

#[test]
fn an_instance_address_is_read_down_to_its_origin() {
    let parse = |text: &str| Instance::parse(text).map(|instance| instance.url().to_string());

    assert_eq!(
        parse("http://localhost:3000").unwrap(),
        "http://localhost:3000"
    );
    assert_eq!(
        parse(" HTTPS://Projammr.Example.com/ ").unwrap(),
        "https://projammr.example.com"
    );
    assert_eq!(
        parse("https://projammr.example.com/project/abc?tab=1").unwrap(),
        "https://projammr.example.com"
    );
    assert_eq!(
        Instance::parse("https://host:8443").unwrap().host(),
        "host:8443"
    );
    for bad in [
        "localhost:3000",
        "ftp://host",
        "https://user:secret@host",
        "",
        "not a url",
    ] {
        assert!(
            matches!(Instance::parse(bad), Err(RemoteError::BadInstance(_))),
            "{bad}"
        );
    }
}

#[test]
fn a_config_round_trips_through_its_file_and_a_missing_one_is_empty() {
    let file = ConfigFile::empty();
    assert_eq!(file.load(), UserConfig::default());

    let config = UserConfig {
        instance: Some(Instance::parse("https://projammr.example.com").unwrap()),
        machine: Some("Studio iMac".to_string()),
        ..Default::default()
    };
    config.save(&file.path).unwrap();

    assert_eq!(file.load(), config);
    assert_eq!(
        std::fs::read_to_string(&file.path).unwrap(),
        "instance = \"https://projammr.example.com\"\nmachine = \"Studio iMac\"\n"
    );
}

#[test]
fn a_token_debug_prints_nothing_of_the_secret() {
    assert_eq!(format!("{:?}", Token::new(TOKEN.to_string())), "Token(..)");
}

#[test]
fn an_error_body_from_the_instance_reaches_the_person_verbatim() {
    let body = json!({
        "error": "This project is at its storage limit",
        "code": "storage_limit",
        "details": { "limit": 1 },
    });
    let server = MockServer::start(vec![(413, body.to_string())]);

    let error = remote_to(&server)
        .post_bytes::<Value>("/repos/p/objects", b"pack", upload_timeout(4))
        .unwrap_err();

    assert_eq!(error.to_string(), "This project is at its storage limit");
    assert!(matches!(
        error,
        RemoteError::Refused { status: 413, code: Some(ref code), .. } if code == "storage_limit"
    ));
}

#[test]
fn an_error_body_without_a_code_is_refused_with_no_code() {
    let server = MockServer::start(vec![refused("Pack is truncated")]);

    let error = remote_to(&server).get::<Value>("/anything").unwrap_err();

    assert!(matches!(
        error,
        RemoteError::Refused { status: 400, code: None, ref message, .. } if message == "Pack is truncated"
    ));
}

#[test]
fn a_non_2xx_answer_that_is_not_the_error_json_stays_unexpected() {
    let server = MockServer::start(vec![(502, "<html>Bad gateway</html>".to_string())]);

    let error = remote_to(&server).get::<Value>("/anything").unwrap_err();

    assert_eq!(
        error.to_string(),
        format!("Unexpected answer from {}: HTTP 502", server.host())
    );
}

#[test]
fn a_401_with_the_error_json_is_still_signed_out() {
    let server = MockServer::start(vec![(401, json!({ "error": "Unauthorized" }).to_string())]);

    let error = remote_to(&server).get::<Value>("/anything").unwrap_err();

    assert!(matches!(error, RemoteError::SignedOut { .. }));
}

#[test]
fn post_bytes_sends_the_slice_with_a_content_length_and_the_token() {
    let server = MockServer::start(vec![(200, json!({ "stored": 2 }).to_string())]);
    let bytes: Vec<u8> = (0..=255).chain(0..=255).collect();

    let answer: Value = remote_to(&server)
        .post_bytes("/repos/p/objects", &bytes, upload_timeout(bytes.len()))
        .unwrap();

    assert_eq!(answer, json!({ "stored": 2 }));
    let requests = server.requests();
    let request = &requests[0];
    assert_eq!(request.method, "POST");
    assert_eq!(request.path, "/api/repos/p/objects");
    assert_eq!(
        request.header("content-type"),
        Some("application/octet-stream")
    );
    assert_eq!(
        request.header("content-length"),
        Some(bytes.len().to_string().as_str())
    );
    assert_eq!(request.header("transfer-encoding"), None);
    assert_eq!(
        request.header("authorization"),
        Some(format!("Bearer {TOKEN}").as_str())
    );
    assert_eq!(request.body, bytes);
}

#[test]
fn post_bytes_gives_up_after_the_timeout_it_was_given() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let instance = Instance::parse(&url).unwrap();
    let remote = Remote::new(
        Client::new(instance, "Studio iMac".to_string()),
        Token::new(TOKEN.to_string()),
    );
    let started = Instant::now();

    let error = remote
        .post_bytes::<Value>("/slow", b"pack", Duration::from_millis(200))
        .unwrap_err();

    assert!(matches!(error, RemoteError::TimedOut { .. }), "{error}");
    assert_eq!(
        error.to_string(),
        format!(
            "{} took too long to answer.",
            remote.client().instance().host()
        )
    );
    assert!(started.elapsed() < Duration::from_secs(10));
    drop(listener);
}

#[test]
fn a_timeout_before_the_connection_is_up_is_unreachable_and_after_it_is_timed_out() {
    let client = Client::new(
        Instance::parse("http://hub.example").unwrap(),
        "Studio iMac".to_string(),
    );

    for stage in [ureq::Timeout::Resolve, ureq::Timeout::Connect] {
        let error = client.failure(ureq::Error::Timeout(stage));
        assert!(matches!(error, RemoteError::Unreachable { .. }), "{error}");
        assert!(error.to_string().starts_with("Can't reach hub.example"));
    }
    for stage in [
        ureq::Timeout::Global,
        ureq::Timeout::SendBody,
        ureq::Timeout::RecvResponse,
        ureq::Timeout::RecvBody,
    ] {
        let error = client.failure(ureq::Error::Timeout(stage));
        assert!(matches!(error, RemoteError::TimedOut { .. }), "{error}");
    }
}

#[test]
fn a_json_body_is_given_the_upload_timeout_for_its_size() {
    let small = JsonBody::new(&json!({ "name": "a" })).unwrap();
    assert_eq!(small.timeout, upload_timeout(small.bytes.len()));

    let ids: Vec<String> = (0..100_000).map(|i| format!("{i:064x}")).collect();
    let run = JsonBody::new(&json!({ "objects": ids })).unwrap();
    assert!(run.bytes.len() > 6_000_000, "{}", run.bytes.len());
    assert_eq!(run.timeout, upload_timeout(run.bytes.len()));
    assert!(run.timeout > Duration::from_secs(120 + 90));
}

#[test]
fn the_upload_timeout_is_two_minutes_and_a_second_for_each_64_kib() {
    let kib = 1024;
    assert_eq!(upload_timeout(0), Duration::from_secs(120));
    assert_eq!(upload_timeout(1), Duration::from_secs(121));
    assert_eq!(upload_timeout(64 * kib), Duration::from_secs(121));
    assert_eq!(upload_timeout(64 * kib + 1), Duration::from_secs(122));
    assert_eq!(
        upload_timeout(32 * 1024 * kib),
        Duration::from_secs(120 + 512)
    );
}

#[test]
fn the_download_timeout_is_two_minutes_and_a_second_for_each_mib_up_to_half_an_hour() {
    let mib = 1024 * 1024;
    let half_hour = Duration::from_secs(30 * 60);
    assert_eq!(download_timeout(0), Duration::from_secs(120));
    assert_eq!(download_timeout(1), Duration::from_secs(121));
    assert_eq!(download_timeout(mib), Duration::from_secs(121));
    assert_eq!(download_timeout(mib + 1), Duration::from_secs(122));
    // The 1 GiB a restore allows a fetch answer is about 18 minutes, not the 4.6 hours an upload's rate would give.
    assert_eq!(download_timeout(1 << 30), Duration::from_secs(120 + 1024));
    assert_eq!(download_timeout(4 << 30), half_hour);
    assert_eq!(download_timeout(usize::MAX), half_hour);
    let sizes = [0, 1, mib, 64 * mib, 1 << 30, 3 << 30, usize::MAX];
    for pair in sizes.windows(2) {
        assert!(download_timeout(pair[0]) <= download_timeout(pair[1]));
    }
}

#[test]
fn post_for_bytes_gives_up_on_a_body_that_stalls_part_way() {
    use std::io::{Read, Write};

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let instance = Instance::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
    let remote = Remote::new(
        Client::new(instance, "Studio iMac".to_string()),
        Token::new(TOKEN.to_string()),
    );
    let hub = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut seen = Vec::new();
        let mut chunk = [0; 1024];
        while !seen.windows(4).any(|window| window == b"\r\n\r\n") {
            let read = stream.read(&mut chunk).unwrap();
            assert_ne!(read, 0, "the client hung up before it finished its request");
            seen.extend_from_slice(&chunk[..read]);
        }
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\nabc")
            .unwrap();
        thread::sleep(Duration::from_secs(3));
    });
    let started = Instant::now();

    let error = remote
        .post_for_bytes_within("/blob", &json!({}), 1000, Duration::from_millis(300))
        .unwrap_err();

    assert!(matches!(error, RemoteError::TimedOut { .. }), "{error}");
    assert!(started.elapsed() < Duration::from_secs(2));
    hub.join().unwrap();
}

#[test]
fn a_redirect_is_reported_with_its_address_and_not_followed() {
    let target = MockServer::start(vec![]);
    let server = MockServer::start_with([(
        301,
        Some(format!("{}/api/auth/get-session", target.url)),
        String::new(),
    )]);

    let error = remote_to(&server)
        .get::<Value>("/auth/get-session")
        .unwrap_err();

    assert_eq!(
        error.to_string(),
        format!(
            "Unexpected answer from {}: redirected to {}/api/auth/get-session; sign in with that address",
            server.host(),
            target.url
        )
    );
    assert_eq!(server.requests().len(), 1);
    assert!(target.requests().is_empty(), "the redirect is not followed");
}

#[test]
fn a_redirect_of_a_pack_upload_is_reported_not_read_as_a_sign_out() {
    let server = MockServer::start_with([(
        308,
        Some("https://hub.example/api/repos/p/objects".to_string()),
        String::new(),
    )]);

    let error = remote_to(&server)
        .post_bytes::<Value>("/repos/p/objects", b"pack", upload_timeout(4))
        .unwrap_err();

    assert!(
        matches!(&error, RemoteError::Redirected { location, .. } if location.contains("https://hub.example")),
        "{error}"
    );
}

#[test]
fn login_removes_a_token_the_instance_does_not_know_and_leaves_the_config_alone() {
    let server = MockServer::start(vec![code(1800, 5), token(), (200, "null".to_string())]);
    let config = ConfigFile::empty();
    let tokens = MemoryTokens::default();

    let error = login(
        &config.path,
        &tokens,
        &FakeClock::new(),
        Some(&server.url),
        |_| {},
        |_| {},
    )
    .unwrap_err();

    assert!(matches!(error, RemoteError::SignedOut { .. }), "{error}");
    assert!(tokens.stored().is_empty());
    assert_eq!(config.load(), UserConfig::default());
    assert!(!config.path.exists());
}

#[test]
fn login_keeps_the_sign_in_when_the_instance_cannot_be_asked_who_it_is() {
    let server = MockServer::start(vec![code(1800, 5), token(), (200, "not json".to_string())]);
    let config = ConfigFile::empty();
    let tokens = MemoryTokens::default();

    let error = login(
        &config.path,
        &tokens,
        &FakeClock::new(),
        Some(&server.url),
        |_| {},
        |_| {},
    )
    .unwrap_err();

    assert!(matches!(error, RemoteError::Unexpected { .. }), "{error}");
    assert_eq!(
        tokens.stored(),
        HashMap::from([(server.url.clone(), TOKEN.to_string())])
    );
    assert_eq!(config.load().instance.unwrap().url(), server.url);
}

#[test]
fn login_signs_the_old_session_out_before_storing_the_new_token() {
    let server = MockServer::start(vec![
        code(1800, 5),
        token(),
        (200, json!({ "success": true }).to_string()),
        session(),
    ]);
    let config = ConfigFile::empty();
    let tokens = MemoryTokens::default();
    let instance = Instance::parse(&server.url).unwrap();
    tokens
        .set(&instance, &Token::new("old-token".into()))
        .unwrap();

    let signed_in = login(
        &config.path,
        &tokens,
        &FakeClock::new(),
        Some(&server.url),
        |_| {},
        |_| {},
    )
    .unwrap();

    assert_eq!(signed_in.user.name, "Ada Lovelace");
    assert_eq!(
        tokens.stored(),
        HashMap::from([(server.url.clone(), TOKEN.to_string())])
    );
    let requests = server.requests();
    assert_eq!(requests[2].path, "/api/auth/sign-out");
    assert_eq!(
        requests[2].header("Authorization"),
        Some("Bearer old-token")
    );
    assert_eq!(requests[3].path, "/api/auth/get-session");
    assert_eq!(
        requests[3].header("Authorization"),
        Some(format!("Bearer {TOKEN}").as_str())
    );
}

#[test]
fn login_replaces_the_old_token_even_when_its_sign_out_fails() {
    let server = MockServer::start(vec![
        code(1800, 5),
        token(),
        (500, json!({ "error": "boom" }).to_string()),
        session(),
    ]);
    let config = ConfigFile::empty();
    let tokens = MemoryTokens::default();
    let instance = Instance::parse(&server.url).unwrap();
    tokens
        .set(&instance, &Token::new("old-token".into()))
        .unwrap();

    let warned = RefCell::new(Vec::new());
    login(
        &config.path,
        &tokens,
        &FakeClock::new(),
        Some(&server.url),
        |_| {},
        |error| warned.borrow_mut().push(error.to_string()),
    )
    .unwrap();

    assert_eq!(warned.into_inner(), ["boom"]);
    assert_eq!(
        tokens.stored(),
        HashMap::from([(server.url.clone(), TOKEN.to_string())])
    );
}

#[test]
fn login_tells_of_a_session_it_could_not_end_even_when_it_then_fails_to_ask_who_it_is() {
    let server = MockServer::start(vec![
        code(1800, 5),
        token(),
        (500, json!({ "error": "boom" }).to_string()),
        (200, "not json".to_string()),
    ]);
    let config = ConfigFile::empty();
    let tokens = MemoryTokens::default();
    let instance = Instance::parse(&server.url).unwrap();
    tokens
        .set(&instance, &Token::new("old-token".into()))
        .unwrap();
    let warned = RefCell::new(Vec::new());

    let error = login(
        &config.path,
        &tokens,
        &FakeClock::new(),
        Some(&server.url),
        |_| {},
        |error| warned.borrow_mut().push(error.to_string()),
    )
    .unwrap_err();

    assert!(matches!(error, RemoteError::Unexpected { .. }), "{error}");
    assert_eq!(warned.into_inner(), ["boom"]);
}

#[test]
fn login_carries_a_stored_token_it_cannot_read_and_still_stores_the_new_one() {
    let server = MockServer::start(vec![code(1800, 5), token(), session()]);
    let config = ConfigFile::empty();
    let tokens = FlakyTokens::unreadable();
    let warned = RefCell::new(Vec::new());

    login(
        &config.path,
        &tokens,
        &FakeClock::new(),
        Some(&server.url),
        |_| {},
        |error| warned.borrow_mut().push(error.to_string()),
    )
    .unwrap();

    assert_eq!(
        warned.into_inner(),
        ["Can't use the keyring: the stored token is unreadable"]
    );
    assert_eq!(
        tokens.0.stored(),
        HashMap::from([(server.url.clone(), TOKEN.to_string())])
    );
    assert_eq!(server.requests().len(), 3, "no sign-out was sent");
}

#[test]
fn login_signs_the_new_session_out_and_leaves_the_old_token_when_it_cannot_store_the_new_one() {
    let server = MockServer::start(vec![
        code(1800, 5),
        token(),
        (200, json!({ "success": true }).to_string()),
    ]);
    let config = ConfigFile::empty();
    let tokens = FlakyTokens::unwritable();
    let instance = Instance::parse(&server.url).unwrap();
    tokens
        .0
        .set(&instance, &Token::new("old-token".into()))
        .unwrap();

    let error = login(
        &config.path,
        &tokens,
        &FakeClock::new(),
        Some(&server.url),
        |_| {},
        |_| panic!("the old session was not ended"),
    )
    .unwrap_err();

    assert!(matches!(error, RemoteError::Keyring(_)), "{error}");
    assert_eq!(
        tokens.0.stored(),
        HashMap::from([(server.url.clone(), "old-token".to_string())])
    );
    let requests = server.requests();
    assert_eq!(requests.len(), 3);
    assert_eq!(requests[2].path, "/api/auth/sign-out");
    assert_eq!(
        requests[2].header("Authorization"),
        Some(format!("Bearer {TOKEN}").as_str())
    );
    assert!(!config.path.exists());
}

#[test]
fn the_apps_settings_survive_a_save_beside_the_instance_and_are_left_out_when_unset() {
    let file = ConfigFile::empty();
    let config = UserConfig {
        instance: Some(Instance::parse("https://projammr.example").unwrap()),
        machine: Some("Studio".to_string()),
        shortcut: Some("Alt+Shift+D".to_string()),
        max_upload_mb: Some(0),
        watch_roots: vec!["/Users/me".to_string()],
        excluded: vec!["/Users/me/Library".to_string()],
        ..Default::default()
    };
    config.save(&file.path).unwrap();

    assert_eq!(file.load(), config);

    UserConfig::default().save(&file.path).unwrap();
    assert_eq!(std::fs::read_to_string(&file.path).unwrap(), "");
}

#[test]
fn opening_a_remote_reads_the_configs_machine_id() {
    let id = "0123456789abcdef0123456789abcdef";
    let instance = Instance::parse("http://127.0.0.1:9").unwrap();
    let tokens = MemoryTokens::holding(instance.url());
    let config = |machine_id: Option<&str>| UserConfig {
        instance: Some(instance.clone()),
        machine_id: machine_id.map(str::to_string),
        ..Default::default()
    };

    let with = Remote::open(&config(Some(id)), &tokens).unwrap();
    let without = Remote::open(&config(None), &tokens).unwrap();
    let malformed = Remote::open(&config(Some("short")), &tokens).unwrap();

    assert_eq!(with.client().machine_id(), Some(id));
    assert_eq!(without.client().machine_id(), None);
    assert_eq!(malformed.client().machine_id(), None);
}

fn machine_view() -> (u16, String) {
    let body = json!({
        "id": "any",
        "name": "Studio iMac",
        "platform": "macOS",
        "appVersion": "0.9.0",
        "lastSeenAt": "2026-10-21T09:00:00.000Z",
        "online": true,
        "openSessionId": null,
    });
    (200, body.to_string())
}

#[test]
fn a_cli_only_login_mints_the_machine_id_names_it_on_every_request_and_registers_it() {
    let server = MockServer::start(vec![code(1800, 5), token(), session(), machine_view()]);
    let config = ConfigFile::empty();

    login(
        &config.path,
        &MemoryTokens::default(),
        &FakeClock::new(),
        Some(&server.url),
        |_| {},
        |_| {},
    )
    .unwrap();

    let id = config
        .load()
        .machine_id
        .expect("login keeps the machine id");
    assert_eq!(id.len(), 32);
    let requests = server.requests();
    assert_eq!(requests.len(), 4);
    for request in requests.iter() {
        assert_eq!(
            request.header("X-Machine-Id"),
            Some(id.as_str()),
            "{}",
            request.path
        );
    }
    assert_eq!(requests[3].method, "PUT");
    assert_eq!(requests[3].path, format!("/api/machines/{id}"));
    assert_eq!(
        requests[3].header("Authorization"),
        Some(format!("Bearer {TOKEN}").as_str())
    );
    assert_eq!(
        requests[3].json()["name"],
        json!(crate::machine::name(None))
    );
    assert_eq!(requests[3].json()["platform"], json!(platform()));
}

#[test]
fn a_second_login_keeps_the_machine_id() {
    let config = ConfigFile::empty();
    let mut ids = Vec::new();
    for _ in 0..2 {
        let server = MockServer::start(vec![code(1800, 5), token(), session(), machine_view()]);
        login(
            &config.path,
            &MemoryTokens::default(),
            &FakeClock::new(),
            Some(&server.url),
            |_| {},
            |_| {},
        )
        .unwrap();
        ids.push(config.load().machine_id.unwrap());
    }

    assert_eq!(ids[0], ids[1]);
}

#[test]
fn login_keeps_the_sign_in_and_returns_the_refusal_when_the_name_is_taken() {
    let taken = json!({ "error": "That name is taken", "code": NAME_TAKEN_CODE }).to_string();
    let server = MockServer::start(vec![code(1800, 5), token(), session(), (409, taken)]);
    let config = ConfigFile::empty();
    let tokens = MemoryTokens::default();

    let error = login(
        &config.path,
        &tokens,
        &FakeClock::new(),
        Some(&server.url),
        |_| {},
        |_| {},
    )
    .unwrap_err();

    assert!(matches!(
        &error,
        RemoteError::Refused { status: 409, code: Some(code), .. } if code == NAME_TAKEN_CODE
    ));
    assert_eq!(tokens.stored().len(), 1);
    assert_eq!(config.load().instance.unwrap().url(), server.url);
}

#[test]
fn login_takes_a_new_machine_id_when_the_instance_refuses_the_stored_one_to_a_new_session() {
    let removed = "0123456789abcdef0123456789abcdef".to_string();
    let config = ConfigFile::with(&UserConfig {
        machine_id: Some(removed.clone()),
        ..Default::default()
    });
    let server = MockServer::start(vec![
        code(1800, 5),
        token(),
        session(),
        (401, "{}".to_string()),
        machine_view(),
    ]);

    login(
        &config.path,
        &MemoryTokens::default(),
        &FakeClock::new(),
        Some(&server.url),
        |_| {},
        |_| {},
    )
    .unwrap();

    let renewed = config.load().machine_id.unwrap();
    assert_ne!(renewed, removed);
    let requests = server.requests();
    assert_eq!(requests[3].path, format!("/api/machines/{removed}"));
    assert_eq!(requests[4].path, format!("/api/machines/{renewed}"));
}

#[test]
fn logout_forgets_the_machine_id() {
    let server = MockServer::start(vec![(200, "{}".to_string())]);
    let config = ConfigFile::with(&UserConfig {
        instance: Some(Instance::parse(&server.url).unwrap()),
        machine_id: Some("0123456789abcdef0123456789abcdef".to_string()),
        ..Default::default()
    });
    let tokens = MemoryTokens::default();
    tokens
        .set(
            &Instance::parse(&server.url).unwrap(),
            &Token::new(TOKEN.to_string()),
        )
        .unwrap();

    logout(&config.path, &tokens).unwrap();

    assert_eq!(config.load().machine_id, None);
}
