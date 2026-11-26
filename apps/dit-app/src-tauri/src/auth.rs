//! What the panel's sign-in state is, given how opening the stored sign-in went, and what the app's sign-out does.

use std::path::Path;

use dit_core::remote::{
    Remote, RemoteError, TokenStore, UserConfig, forget_machine_id, machine_id_at, remove_machine,
};

use crate::snapshot::{Auth, AuthState};

/// The line the panel shows for a sign-in that failed. A certificate the computer does not trust is worded for the
/// person who has to fix it; every other error is dit-core's own line, which is the cli's too.
pub fn failure_line(error: &RemoteError) -> String {
    match error {
        RemoteError::Certificate { host } => format!(
            "{host} uses a certificate this computer doesn't trust. Install the instance's certificate and try again."
        ),
        other => other.to_string(),
    }
}

/// The auth state a failed open of the stored sign-in means, and a line for the panel when the failure is not one
/// of the sign-in's own states. `host` is the instance the config names, when it names one.
pub fn auth_after(error: &RemoteError, host: Option<String>) -> (Auth, Option<String>) {
    let (state, notice) = match error {
        RemoteError::NoInstance | RemoteError::NotSignedIn { .. } => (AuthState::SignedOut, None),
        RemoteError::SignedOut { .. } => (AuthState::Revoked, None),
        RemoteError::Keyring(_) | RemoteError::NoKeyring => (AuthState::KeychainLocked, None),
        other => (AuthState::SignedOut, Some(failure_line(other))),
    };
    (
        Auth {
            state,
            host,
            pending: None,
        },
        notice,
    )
}

/// The app's sign-out. It forgets the sign-in on this computer: the instance revokes the session with the machine's
/// removal, so the cli on this computer is signed out too, and the next sign-in is a new machine.
///
/// In order: `stop_pushing` (nothing may beat after the machine is removed, or the instance would list it again),
/// this computer is removed from the account's machines on the instance, the machine id is forgotten, then the token
/// goes from `tokens`. The instance stays in the config. A removal the instance did not take is returned, not
/// raised: the sign-out has happened either way. Nothing is done, and `stop_pushing` is not called, when there is no
/// token to forget.
pub fn forget_sign_in(
    config_path: &Path,
    tokens: &dyn TokenStore,
    stop_pushing: impl FnOnce(),
) -> Result<Option<RemoteError>, RemoteError> {
    let config = UserConfig::load(config_path)?;
    let remote = match Remote::open(&config, tokens) {
        Ok(remote) => remote,
        Err(RemoteError::NoInstance | RemoteError::NotSignedIn { .. }) => return Ok(None),
        Err(error) => return Err(error),
    };
    stop_pushing();
    let removal = machine_id_at(config_path)
        .and_then(|id| remove_machine(&remote, &id))
        .err();
    forget_machine_id(config_path)?;
    tokens.delete(remote.client().instance())?;
    Ok(removal)
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use dit_core::remote::test_support::{MockServer, Reply, TOKEN};
    use dit_core::remote::{Instance, Token};
    use serde_json::json;

    use super::*;

    const HOST: &str = "https://projammr.example";

    fn after(error: RemoteError) -> (AuthState, Option<String>) {
        let (auth, notice) = auth_after(&error, Some(HOST.to_string()));
        assert_eq!(auth.host.as_deref(), Some(HOST));
        assert_eq!(auth.pending, None);
        (auth.state, notice)
    }

    #[test]
    fn the_sign_ins_own_failures_are_states_not_notices() {
        assert_eq!(after(RemoteError::NoInstance), (AuthState::SignedOut, None));
        assert_eq!(
            after(RemoteError::NotSignedIn { host: "x".into() }),
            (AuthState::SignedOut, None)
        );
        assert_eq!(
            after(RemoteError::SignedOut { host: "x".into() }),
            (AuthState::Revoked, None)
        );
        assert_eq!(
            after(RemoteError::Keyring("locked".into())),
            (AuthState::KeychainLocked, None)
        );
    }

    #[test]
    fn anything_else_leaves_the_machine_signed_out_with_the_reason_in_a_notice() {
        let (state, notice) = after(RemoteError::Config {
            path: "/c".into(),
            reason: "bad toml".into(),
        });
        assert_eq!(state, AuthState::SignedOut);
        assert_eq!(notice.as_deref(), Some("/c: bad toml"));
    }

    #[test]
    fn an_untrusted_certificate_names_the_host_and_what_to_do() {
        let error = RemoteError::Certificate {
            host: "hub.example:8443".into(),
        };
        assert_eq!(
            failure_line(&error),
            "hub.example:8443 uses a certificate this computer doesn't trust. Install the instance's certificate and try again."
        );
        let (state, notice) = after(error);
        assert_eq!(state, AuthState::SignedOut);
        assert_eq!(
            notice.as_deref(),
            Some(
                "hub.example:8443 uses a certificate this computer doesn't trust. Install the instance's certificate and try again."
            )
        );
    }

    #[test]
    fn every_other_error_keeps_dit_cores_words() {
        assert_eq!(
            failure_line(&RemoteError::Denied),
            "Sign-in was denied. Not signed in."
        );
        assert_eq!(
            failure_line(&RemoteError::Unreachable {
                host: "hub.example".into(),
                reason: "refused".into()
            }),
            "Can't reach hub.example: refused"
        );
    }

    /// A token store in memory.
    struct Held(Mutex<Option<String>>);

    impl Held {
        fn signed_in() -> Self {
            Held(Mutex::new(Some(TOKEN.to_string())))
        }

        fn has_token(&self) -> bool {
            self.0.lock().unwrap().is_some()
        }
    }

    impl TokenStore for Held {
        fn get(&self, _: &Instance) -> Result<Option<Token>, RemoteError> {
            Ok(self.0.lock().unwrap().clone().map(Token::new))
        }

        fn set(&self, _: &Instance, token: &Token) -> Result<(), RemoteError> {
            *self.0.lock().unwrap() = Some(token.secret().to_string());
            Ok(())
        }

        fn delete(&self, _: &Instance) -> Result<(), RemoteError> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }

    /// A config naming `server` as the instance, in a folder of its own.
    fn config_for(server: &MockServer) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dit").join("config.toml");
        UserConfig {
            instance: Some(Instance::parse(&server.url).unwrap()),
            ..UserConfig::default()
        }
        .save(&path)
        .unwrap();
        (dir, path)
    }

    #[test]
    fn signing_out_removes_the_machine_then_forgets_the_token_and_never_ends_the_session() {
        let server = MockServer::start_replies(vec![Reply::bytes(204, Vec::new())]);
        let (_dir, path) = config_for(&server);
        let tokens = Held::signed_in();
        let requests_when_pushing_stopped = Mutex::new(None);
        let id = machine_id_at(&path).unwrap();

        let removal = forget_sign_in(&path, &tokens, || {
            *requests_when_pushing_stopped.lock().unwrap() = Some(server.requests().len());
        })
        .unwrap();

        assert!(removal.is_none());
        assert_eq!(*requests_when_pushing_stopped.lock().unwrap(), Some(0));
        assert_eq!(
            UserConfig::load(&path).unwrap().machine_id,
            None,
            "the next sign-in is a new machine"
        );
        let requests = server.requests();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].method, "DELETE");
        assert_eq!(requests[0].path, format!("/api/machines/{id}"));
        assert_eq!(
            requests[0].header("authorization"),
            Some(format!("Bearer {TOKEN}").as_str())
        );
        assert!(!tokens.has_token());
        assert_eq!(
            UserConfig::load(&path).unwrap().instance,
            Some(Instance::parse(&server.url).unwrap())
        );
    }

    #[test]
    fn a_removal_the_instance_refuses_is_reported_and_the_token_still_goes() {
        let server = MockServer::start(vec![(
            500,
            json!({ "error": "The instance is unwell" }).to_string(),
        )]);
        let (_dir, path) = config_for(&server);
        let tokens = Held::signed_in();

        let removal = forget_sign_in(&path, &tokens, || {}).unwrap();

        assert!(matches!(
            removal,
            Some(RemoteError::Refused { status: 500, .. })
        ));
        assert!(!tokens.has_token());
    }

    #[test]
    fn an_instance_that_cannot_be_reached_does_not_keep_the_token() {
        let server = MockServer::start(Vec::new());
        let (_dir, path) = config_for(&server);
        let tokens = Held::signed_in();

        let removal = forget_sign_in(&path, &tokens, || {}).unwrap();

        assert!(removal.is_some());
        assert!(!tokens.has_token());
    }

    #[test]
    fn with_no_token_there_is_nothing_to_stop_or_remove() {
        let server = MockServer::start(Vec::new());
        let (_dir, path) = config_for(&server);
        let tokens = Held(Mutex::new(None));

        let removal = forget_sign_in(&path, &tokens, || panic!("nothing is pushing")).unwrap();

        assert!(removal.is_none());
        assert!(server.requests().is_empty());
    }
}
