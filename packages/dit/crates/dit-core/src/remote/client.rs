//! The HTTP side of talking to an instance: its address, the client every request goes through, and the signed-in
//! connection that adds the machine's token to each request.

use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use ureq::http::{Response, StatusCode, Uri};
use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
use ureq::typestate::WithBody;
use ureq::{Agent, Body, RequestBuilder};

use super::{
    Machine, NOT_REGISTERED_CODE, RemoteError, TokenStore, UserConfig, is_machine_id, platform,
    register,
};

/// The site's page on serving an instance over HTTPS, which says how to install a self-hosted instance's CA. Its
/// origin follows `SITE.url` in `packages/ui/src/lib/site.ts`.
pub const HTTPS_DOCS_URL: &str = "https://backshelf.github.io/projammr/docs/self-hosting/https/";

/// Names the machine on every request; the instance labels the session a device code is redeemed for with it.
const DEVICE_NAME_HEADER: &str = "X-Device-Name";

/// Names the machine by its id on every request once it has one, so the instance attributes what a push carries to
/// the machine rather than to a name.
const MACHINE_ID_HEADER: &str = "X-Machine-Id";

/// How long a request without a body may take, from connecting to the end of the answer.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// How long finding an instance's address and connecting to it may each take. Set apart from the request's own
/// timeout so a host that never answers the connection is told apart from one that stops answering a request.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// What every request that carries a body may take whatever its size: the connection, the instance's checks and its
/// answer.
const UPLOAD_TIMEOUT_BASE: Duration = Duration::from_secs(2 * 60);

/// What an upload may take for each 64 KiB it carries, about a 0.5 Mbit/s floor for the link.
const UPLOAD_TIMEOUT_PER_CHUNK: Duration = Duration::from_secs(1);

const UPLOAD_TIMEOUT_CHUNK_BYTES: usize = 64 * 1024;

/// How long an upload of `bytes` may take: two minutes and a second for each 64 KiB. A pack or a run of commits goes
/// over whatever link the machine has and is as large as the instance's limits let it be, so the time grows with its
/// size.
pub fn upload_timeout(bytes: usize) -> Duration {
    let chunks = bytes.div_ceil(UPLOAD_TIMEOUT_CHUNK_BYTES);
    UPLOAD_TIMEOUT_BASE
        .saturating_add(
            UPLOAD_TIMEOUT_PER_CHUNK.saturating_mul(u32::try_from(chunks).unwrap_or(u32::MAX)),
        )
        .max(REQUEST_TIMEOUT)
}

/// What a download may take for each MiB it carries, a 1 MiB/s floor for the link.
const DOWNLOAD_TIMEOUT_PER_MIB: Duration = Duration::from_secs(1);

/// The most a download may take whatever its size, so a body that stalls part way is given up on in half an hour
/// at the latest.
const DOWNLOAD_TIMEOUT_CAP: Duration = Duration::from_secs(30 * 60);

/// How long reading an answer of at most `max_bytes` may take: two minutes (the connection, the instance's checks,
/// and the request's own small body) and a second for each MiB, no more than half an hour. The limit is a bound on
/// what the instance may send, not a size it will reach, so it sets the time the way a body's size sets an upload's.
pub fn download_timeout(max_bytes: usize) -> Duration {
    let mibs = max_bytes.div_ceil(1024 * 1024);
    UPLOAD_TIMEOUT_BASE
        .saturating_add(
            DOWNLOAD_TIMEOUT_PER_MIB.saturating_mul(u32::try_from(mibs).unwrap_or(u32::MAX)),
        )
        .min(DOWNLOAD_TIMEOUT_CAP)
}

/// A JSON request body: its bytes, and how long sending them may take.
pub(super) struct JsonBody {
    pub(super) bytes: Vec<u8>,
    pub(super) timeout: Duration,
}

impl JsonBody {
    pub(super) fn new(body: &impl Serialize) -> Result<Self, serde_json::Error> {
        let bytes = serde_json::to_vec(body)?;
        let timeout = upload_timeout(bytes.len());
        Ok(JsonBody { bytes, timeout })
    }
}

/// The instance's error body: `{ "error": string, "code"?: string, "details"?: object }`.
#[derive(Deserialize)]
struct RefusalBody {
    error: String,
    code: Option<String>,
    details: Option<serde_json::Value>,
}

/// An instance's address: the web client's origin, which serves the API under `/api`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Instance {
    url: String,
}

impl Instance {
    /// Reads an `http://` or `https://` address down to its origin, lowercased, so a page's URL names its instance
    /// too. Plain `http` is for an instance without TLS, such as one on this machine.
    pub fn parse(text: &str) -> Result<Self, RemoteError> {
        let bad = || RemoteError::BadInstance(text.to_string());
        let uri: Uri = text.trim().parse().map_err(|_| bad())?;
        let scheme = uri
            .scheme_str()
            .filter(|scheme| matches!(*scheme, "http" | "https"))
            .ok_or_else(bad)?;
        let authority = uri
            .authority()
            .map(|authority| authority.as_str())
            .filter(|authority| !authority.contains('@'))
            .ok_or_else(bad)?;
        Ok(Instance {
            url: format!("{scheme}://{authority}").to_ascii_lowercase(),
        })
    }

    /// The origin, with no trailing slash.
    pub fn url(&self) -> &str {
        &self.url
    }

    /// The host and port, which messages name the instance by.
    pub fn host(&self) -> &str {
        self.url
            .split_once("://")
            .map_or(self.url.as_str(), |(_, host)| host)
    }
}

impl TryFrom<String> for Instance {
    type Error = RemoteError;

    fn try_from(text: String) -> Result<Self, Self::Error> {
        Self::parse(&text)
    }
}

impl From<Instance> for String {
    fn from(instance: Instance) -> Self {
        instance.url
    }
}

/// A session token. It goes only to the instance it came from and to the token store: it has no `Display`, and its
/// `Debug` hides it.
pub struct Token(String);

impl Token {
    pub fn new(secret: String) -> Self {
        Token(secret)
    }

    pub fn secret(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Token {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Token(..)")
    }
}

/// Sends requests to one instance as one machine. `https` certificates verify against the system trust store only.
pub struct Client {
    agent: Agent,
    instance: Instance,
    machine: String,
    machine_id: Option<String>,
}

impl Client {
    pub fn new(instance: Instance, machine: String) -> Self {
        let tls = TlsConfig::builder()
            .provider(TlsProvider::Rustls)
            .root_certs(RootCerts::PlatformVerifier)
            .unversioned_rustls_crypto_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .build();
        let agent = Agent::config_builder()
            .tls_config(tls)
            .http_status_as_error(false)
            // A redirect would replay the request without the token, which reads as a sign-out; it is reported
            // instead, naming where the instance lives.
            .max_redirects(0)
            .timeout_global(Some(REQUEST_TIMEOUT))
            .timeout_resolve(Some(CONNECT_TIMEOUT))
            .timeout_connect(Some(CONNECT_TIMEOUT))
            .build()
            .new_agent();
        Client {
            agent,
            instance,
            machine,
            machine_id: None,
        }
    }

    /// The same client sending `machine_id` with every request; `None` sends none.
    pub fn with_machine_id(mut self, machine_id: Option<String>) -> Self {
        self.machine_id = machine_id;
        self
    }

    pub fn instance(&self) -> &Instance {
        &self.instance
    }

    pub fn machine(&self) -> &str {
        &self.machine
    }

    /// The id the requests name the machine by, when it has one.
    pub fn machine_id(&self) -> Option<&str> {
        self.machine_id.as_deref()
    }

    /// GETs `/api<path>`, whatever the answer's status.
    pub(crate) fn get(
        &self,
        path: &str,
        token: Option<&Token>,
    ) -> Result<Response<Body>, RemoteError> {
        self.prepare(self.agent.get(self.url(path)), token)
            .call()
            .map_err(|error| self.failure(error))
    }

    /// DELETEs `/api<path>`, whatever the answer's status.
    pub(crate) fn delete(
        &self,
        path: &str,
        token: Option<&Token>,
    ) -> Result<Response<Body>, RemoteError> {
        self.prepare(self.agent.delete(self.url(path)), token)
            .call()
            .map_err(|error| self.failure(error))
    }

    /// Like [`Client::get`], with `timeout` in place of the agent's default for this request alone.
    pub(crate) fn get_with(
        &self,
        path: &str,
        token: Option<&Token>,
        timeout: Duration,
    ) -> Result<Response<Body>, RemoteError> {
        self.prepare(self.agent.get(self.url(path)), token)
            .config()
            .timeout_global(Some(timeout))
            .build()
            .call()
            .map_err(|error| self.failure(error))
    }

    /// POSTs `body` as JSON to `/api<path>`, whatever the answer's status. The request may take as long as an upload
    /// of the serialised body does.
    pub(crate) fn post(
        &self,
        path: &str,
        token: Option<&Token>,
        body: &impl Serialize,
    ) -> Result<Response<Body>, RemoteError> {
        self.json_request(self.agent.post(self.url(path)), token, body)
    }

    /// PATCHes `/api<path>` with `body` as JSON, whatever the answer's status.
    pub(crate) fn patch(
        &self,
        path: &str,
        token: Option<&Token>,
        body: &impl Serialize,
    ) -> Result<Response<Body>, RemoteError> {
        self.json_request(self.agent.patch(self.url(path)), token, body)
    }

    /// PUTs `body` as JSON to `/api<path>`, whatever the answer's status.
    pub(crate) fn put(
        &self,
        path: &str,
        token: Option<&Token>,
        body: &impl Serialize,
    ) -> Result<Response<Body>, RemoteError> {
        self.json_request(self.agent.put(self.url(path)), token, body)
    }

    /// POSTs `bytes` as `application/octet-stream` to `/api<path>`, whatever the answer's status. `timeout`
    /// replaces the agent's default for this request alone.
    pub(crate) fn post_bytes(
        &self,
        path: &str,
        token: Option<&Token>,
        bytes: &[u8],
        timeout: Duration,
    ) -> Result<Response<Body>, RemoteError> {
        self.send(
            self.agent.post(self.url(path)),
            token,
            "application/octet-stream",
            bytes,
            timeout,
        )
    }

    /// POSTs `length` bytes read from `body` as `content_type` to `/api<path>`, whatever the answer's status. The
    /// request declares its `Content-Length`, so it is never chunked, and the body is read as it is sent rather than
    /// held in memory. `timeout` replaces the agent's default for this request alone.
    pub(crate) fn post_stream(
        &self,
        path: &str,
        token: Option<&Token>,
        content_type: &str,
        length: u64,
        body: &mut dyn std::io::Read,
        timeout: Duration,
    ) -> Result<Response<Body>, RemoteError> {
        self.prepare(self.agent.post(self.url(path)), token)
            .config()
            .timeout_global(Some(timeout))
            .build()
            .header("Content-Type", content_type)
            .header("Content-Length", length.to_string())
            .send(ureq::SendBody::from_reader(body))
            .map_err(|error| self.failure(error))
    }

    /// POSTs `body` as JSON to `/api<path>`, whatever the answer's status, allowing the request exactly `timeout`
    /// from connecting to the end of the answer: for an answer that is itself large.
    pub(crate) fn post_timed(
        &self,
        path: &str,
        token: Option<&Token>,
        body: &impl Serialize,
        timeout: Duration,
    ) -> Result<Response<Body>, RemoteError> {
        let body =
            JsonBody::new(body).map_err(|_| self.unexpected("a request body that is not JSON"))?;
        self.send(
            self.agent.post(self.url(path)),
            token,
            "application/json",
            &body.bytes,
            timeout,
        )
    }

    /// Sends `body` as JSON through `request`, with the time an upload of the serialised body may take.
    fn json_request(
        &self,
        request: RequestBuilder<WithBody>,
        token: Option<&Token>,
        body: &impl Serialize,
    ) -> Result<Response<Body>, RemoteError> {
        let body =
            JsonBody::new(body).map_err(|_| self.unexpected("a request body that is not JSON"))?;
        self.send(
            request,
            token,
            "application/json",
            &body.bytes,
            body.timeout,
        )
    }

    /// Sends `bytes` of `content_type` through `request`. The body is sent from the slice, so the request carries a
    /// `Content-Length` and is never chunked.
    fn send(
        &self,
        request: RequestBuilder<WithBody>,
        token: Option<&Token>,
        content_type: &str,
        bytes: &[u8],
        timeout: Duration,
    ) -> Result<Response<Body>, RemoteError> {
        self.prepare(request, token)
            .config()
            .timeout_global(Some(timeout))
            .build()
            .header("Content-Type", content_type)
            .send(bytes)
            .map_err(|error| self.failure(error))
    }

    /// The JSON body of a 2xx answer; any other status is the error [`Client::refusal`] makes of it.
    pub(crate) fn read<T: DeserializeOwned>(
        &self,
        response: Response<Body>,
    ) -> Result<T, RemoteError> {
        let status = response.status();
        if status.is_success() {
            return self.json(response);
        }
        Err(self.refusal(response))
    }

    /// A non-2xx answer as the error it is: a redirect, the instance's own refusal when its body is the instance's
    /// error JSON, and an unexpected answer when it is anything else.
    pub(crate) fn refusal(&self, mut response: Response<Body>) -> RemoteError {
        if let Some(redirect) = self.redirect(&response) {
            return redirect;
        }
        let status = response.status();
        match response.body_mut().read_json::<RefusalBody>() {
            Ok(body) => RemoteError::Refused {
                host: self.instance.host().to_string(),
                status: status.as_u16(),
                code: body.code,
                details: body.details,
                message: body.error,
            },
            Err(_) => self.unexpected(format!("HTTP {}", status.as_u16())),
        }
    }

    /// The JSON body of an answer of any status.
    pub(crate) fn json<T: DeserializeOwned>(
        &self,
        mut response: Response<Body>,
    ) -> Result<T, RemoteError> {
        response
            .body_mut()
            .read_json()
            .map_err(|error| self.failure(error))
    }

    /// A 3xx answer as the error it is: the instance lives at another address, which is where to sign in.
    pub(crate) fn redirect(&self, response: &Response<Body>) -> Option<RemoteError> {
        if !response.status().is_redirection() {
            return None;
        }
        let location = response
            .headers()
            .get("location")
            .and_then(|location| location.to_str().ok())
            .unwrap_or("another address");
        Some(RemoteError::Redirected {
            host: self.instance.host().to_string(),
            location: location.to_string(),
        })
    }

    pub(crate) fn unexpected(&self, detail: impl Into<String>) -> RemoteError {
        RemoteError::Unexpected {
            host: self.instance.host().to_string(),
            detail: detail.into(),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}/api{path}", self.instance.url())
    }

    fn prepare<B>(&self, request: RequestBuilder<B>, token: Option<&Token>) -> RequestBuilder<B> {
        let device_name = sanitize_device_name_header(&self.machine);
        let request = if device_name.is_empty() {
            request
        } else {
            request.header(DEVICE_NAME_HEADER, &device_name)
        };
        let request = match &self.machine_id {
            Some(id) => request.header(MACHINE_ID_HEADER, id),
            None => request,
        };
        match token {
            Some(token) => request.header("Authorization", format!("Bearer {}", token.secret())),
            None => request,
        }
    }

    /// What a request that got no usable answer means to the person: a certificate the system does not trust, a
    /// body that is not JSON, an instance that cannot be reached, or one that stopped answering once connected.
    pub(crate) fn failure(&self, error: ureq::Error) -> RemoteError {
        let host = self.instance.host().to_string();
        if is_untrusted_certificate(&error) {
            RemoteError::Certificate { host }
        } else if let ureq::Error::Json(_) = error {
            self.unexpected("a body that is not the expected JSON")
        } else if matches!(
            error,
            ureq::Error::Timeout(ureq::Timeout::Resolve | ureq::Timeout::Connect)
        ) {
            RemoteError::Unreachable {
                host,
                reason: "no answer to the connection".to_string(),
            }
        } else if let ureq::Error::Timeout(_) = error {
            RemoteError::TimedOut { host }
        } else {
            RemoteError::Unreachable {
                host,
                reason: error.to_string(),
            }
        }
    }
}

/// Normalizes a machine name to visible ASCII bytes safe for an HTTP header value.
/// macOS host names commonly include typographic punctuation (such as U+2019 in "Alex’s MacBook Pro"),
/// which `http::HeaderValue` rejects.
pub(crate) fn sanitize_device_name_header(machine: &str) -> String {
    let mut out = String::with_capacity(machine.len());
    for ch in machine.chars() {
        match ch {
            '\u{2018}' | '\u{2019}' | '\u{02BC}' => out.push('\''),
            '\u{201C}' | '\u{201D}' => out.push('"'),
            '\u{2010}'..='\u{2015}' | '\u{2212}' => out.push('-'),
            '\u{00A0}' | '\u{2000}'..='\u{200A}' | '\u{202F}' | '\u{205F}' | '\u{3000}' => {
                out.push(' ')
            }
            c if c.is_ascii_graphic() || c == ' ' => out.push(c),
            _ => {}
        }
    }
    out.trim().to_string()
}

/// A certificate rustls refused, whether `ureq` hands the rustls error over directly or inside the I/O error of the
/// handshake.
fn is_untrusted_certificate(error: &ureq::Error) -> bool {
    let rustls_error = match error {
        ureq::Error::Rustls(error) => Some(error),
        ureq::Error::Io(error) => error
            .get_ref()
            .and_then(|inner| inner.downcast_ref::<rustls::Error>()),
        _ => None,
    };
    matches!(rustls_error, Some(rustls::Error::InvalidCertificate(_)))
}

/// A signed-in connection: the instance and machine the user config names, and the token stored for that instance,
/// sent with every request. A 401 on any request is a token the instance no longer accepts.
pub struct Remote {
    client: Client,
    token: Token,
}

impl Remote {
    /// Opens the connection the config describes. The machine's id goes with every request when the config has
    /// one; `dit login` and the app's first beat are what put it there.
    pub fn open(config: &UserConfig, tokens: &dyn TokenStore) -> Result<Self, RemoteError> {
        let instance = config.instance.clone().ok_or(RemoteError::NoInstance)?;
        let token = tokens
            .get(&instance)?
            .ok_or_else(|| RemoteError::NotSignedIn {
                host: instance.host().to_string(),
            })?;
        let machine_id = config.machine_id.clone().filter(|id| is_machine_id(id));
        let client = Client::new(instance, config.machine()).with_machine_id(machine_id);
        Ok(Remote::new(client, token))
    }

    pub(crate) fn new(client: Client, token: Token) -> Self {
        Remote { client, token }
    }

    /// This connection sending `machine_id` with every request from now on.
    pub(crate) fn with_machine_id(mut self, machine_id: Option<String>) -> Self {
        self.client = self.client.with_machine_id(machine_id);
        self
    }

    pub fn client(&self) -> &Client {
        &self.client
    }

    /// GETs `/api<path>` and reads its JSON.
    pub fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, RemoteError> {
        self.registered(|| {
            let response = self.client.get(path, Some(&self.token))?;
            self.read(response)
        })
    }

    /// DELETEs `/api<path>`; the instance answers with no body.
    pub fn delete(&self, path: &str) -> Result<(), RemoteError> {
        self.registered(|| {
            let response = self.client.delete(path, Some(&self.token))?;
            self.bytes_of(response, 0).map(|_| ())
        })
    }

    /// POSTs `body` as JSON to `/api<path>` and reads the answer's JSON.
    pub fn post<T: DeserializeOwned>(
        &self,
        path: &str,
        body: &impl Serialize,
    ) -> Result<T, RemoteError> {
        self.registered(|| {
            let response = self.client.post(path, Some(&self.token), body)?;
            self.read(response)
        })
    }

    /// PATCHes `body` as JSON to `/api<path>` and reads the answer's JSON.
    pub fn patch<T: DeserializeOwned>(
        &self,
        path: &str,
        body: &impl Serialize,
    ) -> Result<T, RemoteError> {
        self.registered(|| {
            let response = self.client.patch(path, Some(&self.token), body)?;
            self.read(response)
        })
    }

    /// PUTs `body` as JSON to `/api<path>` and reads the answer's JSON.
    pub fn put<T: DeserializeOwned>(
        &self,
        path: &str,
        body: &impl Serialize,
    ) -> Result<T, RemoteError> {
        self.registered(|| self.put_once(path, body))
    }

    /// [`Remote::put`] without registering the machine on a refusal: the beat that does the registering goes
    /// through it, so a refusal of the beat itself is never answered with another.
    pub(super) fn put_once<T: DeserializeOwned>(
        &self,
        path: &str,
        body: &impl Serialize,
    ) -> Result<T, RemoteError> {
        let response = self.client.put(path, Some(&self.token), body)?;
        self.read(response)
    }

    /// POSTs `bytes` as `application/octet-stream` to `/api<path>`, allowing the request `timeout`, and reads the
    /// answer's JSON.
    pub fn post_bytes<T: DeserializeOwned>(
        &self,
        path: &str,
        bytes: &[u8],
        timeout: Duration,
    ) -> Result<T, RemoteError> {
        self.registered(|| {
            let response = self
                .client
                .post_bytes(path, Some(&self.token), bytes, timeout)?;
            self.read(response)
        })
    }

    /// POSTs `length` bytes read from `body` as `content_type` to `/api<path>` and reads the answer's JSON. The body
    /// is streamed, never held whole, and the request may take as long as an upload of `length` bytes does. A
    /// stream that is read cannot be sent again, so this request alone is not retried after the machine registers.
    pub fn post_stream<T: DeserializeOwned>(
        &self,
        path: &str,
        content_type: &str,
        length: u64,
        body: &mut dyn std::io::Read,
    ) -> Result<T, RemoteError> {
        let timeout = upload_timeout(usize::try_from(length).unwrap_or(usize::MAX));
        let response = self.client.post_stream(
            path,
            Some(&self.token),
            content_type,
            length,
            body,
            timeout,
        )?;
        self.read(response)
    }

    /// GETs `/api<path>` and reads the answer's bytes, which may be as many as `max_bytes`. The request may take as
    /// long as [`download_timeout`] allows for that many bytes. An answer longer than `max_bytes` is an unexpected
    /// one.
    pub fn get_bytes(&self, path: &str, max_bytes: usize) -> Result<Vec<u8>, RemoteError> {
        self.registered(|| {
            let response =
                self.client
                    .get_with(path, Some(&self.token), download_timeout(max_bytes))?;
            Ok(self.bytes_of(response, max_bytes)?.0)
        })
    }

    /// POSTs `body` as JSON to `/api<path>` and reads the answer's bytes, which may be as many as `max_bytes`. The
    /// request may take as long as [`download_timeout`] allows for that many bytes. An answer longer than
    /// `max_bytes` is an unexpected one.
    pub fn post_for_bytes(
        &self,
        path: &str,
        body: &impl Serialize,
        max_bytes: usize,
    ) -> Result<Vec<u8>, RemoteError> {
        self.post_for_bytes_within(path, body, max_bytes, download_timeout(max_bytes))
    }

    /// Like [`Remote::post_for_bytes`], with the whole request given `timeout`.
    pub(super) fn post_for_bytes_within(
        &self,
        path: &str,
        body: &impl Serialize,
        max_bytes: usize,
        timeout: Duration,
    ) -> Result<Vec<u8>, RemoteError> {
        self.registered(|| {
            let response = self
                .client
                .post_timed(path, Some(&self.token), body, timeout)?;
            Ok(self.bytes_of(response, max_bytes)?.0)
        })
    }

    /// Sends a request through `send`; when the instance answers that it does not know this machine
    /// ([`NOT_REGISTERED_CODE`]), registers the machine and sends the request once more. A machine with no id has
    /// nothing to register, and the refusal stands.
    fn registered<T>(&self, send: impl Fn() -> Result<T, RemoteError>) -> Result<T, RemoteError> {
        let result = send();
        let unregistered = matches!(
            &result,
            Err(RemoteError::Refused { status: 409, code: Some(code), .. })
                if code == NOT_REGISTERED_CODE
        );
        let Some(id) = self.client.machine_id().filter(|_| unregistered) else {
            return result;
        };
        register(
            self,
            &Machine {
                id: id.to_string(),
                name: self.client.machine().to_string(),
                platform: platform().to_string(),
                app_version: env!("CARGO_PKG_VERSION").to_string(),
            },
        )?;
        send()
    }

    /// The body of a 2xx answer, at most `max_bytes` long, with the answer's status; a 401 is a sign-out and any
    /// other status the instance's refusal.
    fn bytes_of(
        &self,
        mut response: Response<Body>,
        max_bytes: usize,
    ) -> Result<(Vec<u8>, StatusCode), RemoteError> {
        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(self.signed_out());
        }
        if !response.status().is_success() {
            return Err(self.client.refusal(response));
        }
        let status = response.status();
        let too_long = || {
            self.client
                .unexpected(format!("an answer over the {max_bytes}-byte limit"))
        };
        // One byte past the limit: reading exactly `limit` bytes to the end of the body is itself refused.
        let limit = (max_bytes as u64).saturating_add(1);
        match response.body_mut().with_config().limit(limit).read_to_vec() {
            Ok(bytes) if bytes.len() > max_bytes => Err(too_long()),
            Ok(bytes) => Ok((bytes, status)),
            Err(ureq::Error::BodyExceedsLimit(_)) => Err(too_long()),
            Err(error) => Err(self.client.failure(error)),
        }
    }

    pub fn signed_out(&self) -> RemoteError {
        RemoteError::SignedOut {
            host: self.client.instance.host().to_string(),
        }
    }

    fn read<T: DeserializeOwned>(&self, response: Response<Body>) -> Result<T, RemoteError> {
        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(self.signed_out());
        }
        self.client.read(response)
    }
}
