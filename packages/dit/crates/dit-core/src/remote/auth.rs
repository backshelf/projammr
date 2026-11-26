//! Signing in with the OAuth device grant (RFC 8628), keeping the token, and signing out.

use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

use serde::de::IgnoredAny;
use serde::{Deserialize, Serialize};

use super::{
    Client, Instance, Machine, Remote, RemoteError, Token, UserConfig, forget_machine_id,
    machine_id_at, platform, register,
};

/// The client id the instance knows dit by.
const CLIENT_ID: &str = "dit";

const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";

/// What a `slow_down` answer adds to the polling interval, for that poll and every later one (RFC 8628 §3.5).
const SLOW_DOWN: Duration = Duration::from_secs(5);

/// Keeps one session token per instance. A store is shared across threads: the app holds one for every command it
/// runs for the cli.
pub trait TokenStore: Send + Sync {
    fn get(&self, instance: &Instance) -> Result<Option<Token>, RemoteError>;
    fn set(&self, instance: &Instance, token: &Token) -> Result<(), RemoteError>;
    /// Removes the instance's token; there being none is not an error.
    fn delete(&self, instance: &Instance) -> Result<(), RemoteError>;
}

/// The platform's token store: the login Keychain on macOS. Other platforms have none yet.
pub fn system_tokens() -> Result<Box<dyn TokenStore>, RemoteError> {
    #[cfg(target_vendor = "apple")]
    return Ok(Box::new(super::keychain::Keychain::open()?));
    #[cfg(not(target_vendor = "apple"))]
    Err(RemoteError::NoKeyring)
}

/// Time for the polling loop, so a test can run it without waiting.
pub trait Clock {
    fn now(&self) -> Instant;
    fn sleep(&self, duration: Duration);
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Instant {
        Instant::now()
    }

    fn sleep(&self, duration: Duration) {
        thread::sleep(duration);
    }
}

/// A code the instance issued for this machine: what the person confirms in the browser, and where.
#[derive(Deserialize)]
pub struct DeviceCode {
    device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    /// `verification_uri` with the code filled in.
    pub verification_uri_complete: String,
    /// Seconds until the code expires.
    pub expires_in: u64,
    /// Seconds to wait between polls.
    #[serde(default = "default_interval")]
    pub interval: u64,
}

/// RFC 8628's interval when the instance names none.
fn default_interval() -> u64 {
    5
}

/// The person a session belongs to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionUser {
    pub id: String,
    pub name: String,
    pub email: String,
}

/// A machine signed in to an instance, and who it is signed in as.
#[derive(Debug, Serialize)]
pub struct SignedIn {
    pub instance: Instance,
    pub machine: String,
    pub user: SessionUser,
}

/// What logging out did.
#[derive(Debug, Serialize)]
pub struct Logout {
    /// The instance signed out of; `None` when there was no sign-in to end.
    pub instance: Option<Instance>,
    /// Why the instance did not end the session, when it did not. The token is gone from this machine either way.
    #[serde(skip)]
    pub server_error: Option<RemoteError>,
}

/// Signs this machine in to `instance`, else to the one the config at `config_path` names. `on_code` shows the
/// person the code and where to confirm it; the instance is then polled until they approve or deny it or it
/// expires. The token goes to `tokens`, the instance to the config; the config's machine name stays as it was, so
/// only a name someone configured is ever in it. The machine's id is made at the first sign-in and saved with the
/// instance, sent with every request, and registered with the instance once the session is known: a
/// machine that only ever runs the cli is a machine too. A session this sign-in
/// replaces is ended on the instance; when that cannot be done `on_previous_session_error` is told why as soon as it is
/// known, whatever the rest of the login comes to.
///
/// The sign-in stands when the instance refuses the registration, as with a name another machine of the account
/// has; the refusal is the error returned. A registration the instance could not be asked for is left to the
/// first request, which registers the machine. A machine the instance removed answers its id with a 401 even to a new
/// session: the sign-in then makes the machine a new id.
pub fn login(
    config_path: &Path,
    tokens: &dyn TokenStore,
    clock: &dyn Clock,
    instance: Option<&str>,
    on_code: impl FnOnce(&DeviceCode),
    on_previous_session_error: impl FnOnce(&RemoteError),
) -> Result<SignedIn, RemoteError> {
    let mut config = UserConfig::load(config_path)?;
    let machine_id = config.ensure_machine_id(config_path)?;
    let instance = match instance {
        Some(text) => Instance::parse(text)?,
        None => config.instance.clone().ok_or(RemoteError::NoInstance)?,
    };
    let machine = config.machine();
    let client =
        Client::new(instance.clone(), machine.clone()).with_machine_id(Some(machine_id.clone()));
    let code = request_code(&client)?;
    on_code(&code);
    let token = poll_token(&client, &code, clock)?;
    let previous = tokens.get(&instance);
    if let Err(error) = tokens.set(&instance, &token) {
        // The new session has no token to be found by; ending it leaves the instance as it was.
        sign_out(&Remote::new(client, token));
        return Err(error);
    }
    if let Some(error) = end_previous_session(previous, &instance, &machine) {
        on_previous_session_error(&error);
    }
    // The user is asked for before the config is saved: a token the instance does not know is removed again and
    // leaves the config as it was, while a network failure keeps the sign-in.
    let remote = Remote::new(client, token);
    let user = session(&remote);
    if let Err(error @ RemoteError::SignedOut { .. }) = user {
        tokens.delete(&instance)?;
        return Err(error);
    }
    config.instance = Some(instance.clone());
    config.save(config_path)?;
    let user = user?;
    let machine_with = |id: String| Machine {
        id,
        name: machine.clone(),
        platform: platform().to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    };
    let mut registration = register(&remote, &machine_with(machine_id));
    if let Err(RemoteError::SignedOut { .. }) = registration {
        // The session is the one just checked, so the instance refuses the id itself: the machine was removed. It
        // registers again under a new id.
        forget_machine_id(config_path)?;
        let machine_id = machine_id_at(config_path)?;
        let remote = remote.with_machine_id(Some(machine_id.clone()));
        registration = register(&remote, &machine_with(machine_id));
    }
    if let Err(error @ RemoteError::Refused { .. }) = registration {
        return Err(error);
    }
    Ok(SignedIn {
        instance,
        machine,
        user,
    })
}

/// Signs the session out that the token `previous`, read from the store for `instance` before a new sign-in replaced
/// it, belongs to, so it does not stay open on the instance. Why it could not be done is returned, not raised: the
/// new sign-in stands either way.
fn end_previous_session(
    previous: Result<Option<Token>, RemoteError>,
    instance: &Instance,
    machine: &str,
) -> Option<RemoteError> {
    match previous {
        Ok(Some(previous)) => sign_out(&Remote::new(
            Client::new(instance.clone(), machine.to_string()),
            previous,
        )),
        Ok(None) => None,
        Err(error) => Some(error),
    }
}

/// Posts the sign-out of `remote`'s session; the instance already not knowing the token is a success.
fn sign_out(remote: &Remote) -> Option<RemoteError> {
    match remote.post::<IgnoredAny>("/auth/sign-out", &serde_json::Map::new()) {
        Ok(_) | Err(RemoteError::SignedOut { .. }) => None,
        Err(error) => Some(error),
    }
}

/// Who this machine is signed in as, asked of the instance.
pub fn whoami(config_path: &Path, tokens: &dyn TokenStore) -> Result<SignedIn, RemoteError> {
    let remote = Remote::open(&UserConfig::load(config_path)?, tokens)?;
    let user = session(&remote)?;
    Ok(SignedIn {
        instance: remote.client().instance().clone(),
        machine: remote.client().machine().to_string(),
        user,
    })
}

/// Ends this machine's session on the instance, then removes its token and its machine id, whether or not the instance
/// could be told. The instance stays in the config, so `login` with no address signs in to it again.
pub fn logout(config_path: &Path, tokens: &dyn TokenStore) -> Result<Logout, RemoteError> {
    let remote = match Remote::open(&UserConfig::load(config_path)?, tokens) {
        Ok(remote) => remote,
        Err(RemoteError::NoInstance | RemoteError::NotSignedIn { .. }) => {
            return Ok(Logout {
                instance: None,
                server_error: None,
            });
        }
        Err(error) => return Err(error),
    };
    let server_error = sign_out(&remote);
    let instance = remote.client().instance().clone();
    tokens.delete(&instance)?;
    forget_machine_id(config_path)?;
    Ok(Logout {
        instance: Some(instance),
        server_error,
    })
}

#[derive(Serialize)]
struct CodeRequest {
    client_id: &'static str,
}

#[derive(Serialize)]
struct TokenRequest<'a> {
    grant_type: &'static str,
    device_code: &'a str,
    client_id: &'static str,
}

#[derive(Deserialize)]
struct TokenReply {
    access_token: String,
}

/// The body of a refused poll.
#[derive(Deserialize)]
struct GrantError {
    error: String,
}

#[derive(Deserialize)]
struct SessionReply {
    user: SessionUser,
}

fn request_code(client: &Client) -> Result<DeviceCode, RemoteError> {
    let response = client.post(
        "/auth/device/code",
        None,
        &CodeRequest {
            client_id: CLIENT_ID,
        },
    )?;
    client.read(response)
}

/// Polls for the token every `interval` seconds, five more after each `slow_down`, until the person approves or
/// denies the code or `expires_in` runs out.
fn poll_token(client: &Client, code: &DeviceCode, clock: &dyn Clock) -> Result<Token, RemoteError> {
    let deadline = clock.now() + Duration::from_secs(code.expires_in);
    let mut interval = Duration::from_secs(code.interval);
    let request = TokenRequest {
        grant_type: DEVICE_GRANT,
        device_code: &code.device_code,
        client_id: CLIENT_ID,
    };
    loop {
        clock.sleep(interval);
        if clock.now() >= deadline {
            return Err(RemoteError::Expired);
        }
        let response = client.post("/auth/device/token", None, &request)?;
        let status = response.status();
        if status.is_success() {
            let reply: TokenReply = client.json(response)?;
            return Ok(Token::new(reply.access_token));
        }
        if let Some(redirect) = client.redirect(&response) {
            return Err(redirect);
        }
        if status.as_u16() != 400 {
            return Err(client.unexpected(format!("HTTP {}", status.as_u16())));
        }
        let GrantError { error } = client.json(response)?;
        match error.as_str() {
            "authorization_pending" => {}
            "slow_down" => interval += SLOW_DOWN,
            "access_denied" => return Err(RemoteError::Denied),
            "expired_token" => return Err(RemoteError::Expired),
            _ => return Err(client.unexpected(error)),
        }
    }
}

/// The session's user. The instance answers a token it does not know with `null` as well as with a 401.
fn session(remote: &Remote) -> Result<SessionUser, RemoteError> {
    match remote.get::<Option<SessionReply>>("/auth/get-session")? {
        Some(reply) => Ok(reply.user),
        None => Err(remote.signed_out()),
    }
}
