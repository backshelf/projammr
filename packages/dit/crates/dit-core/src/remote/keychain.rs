//! The macOS token store: the login Keychain, through `keyring-core`.

use std::sync::Arc;

use apple_native_keyring_store::keychain::Store;
use keyring_core::api::CredentialStoreApi;
use keyring_core::{Entry, Error};

use super::{Instance, RemoteError, Token, TokenStore};

/// One generic password per instance in the login Keychain under a chosen service name.
pub(super) struct Keychain {
    store: Arc<Store>,
    service: String,
}

impl Keychain {
    pub(super) fn open(service: &str) -> Result<Self, RemoteError> {
        Store::new()
            .map(|store| Keychain {
                store,
                service: service.to_string(),
            })
            .map_err(keyring_error)
    }

    fn entry(&self, instance: &Instance) -> Result<Entry, RemoteError> {
        self.store
            .build(&self.service, instance.url(), None)
            .map_err(keyring_error)
    }
}

impl TokenStore for Keychain {
    fn get(&self, instance: &Instance) -> Result<Option<Token>, RemoteError> {
        match self.entry(instance)?.get_password() {
            Ok(secret) => Ok(Some(Token::new(secret))),
            Err(Error::NoEntry) => Ok(None),
            Err(error) => Err(keyring_error(error)),
        }
    }

    fn set(&self, instance: &Instance, token: &Token) -> Result<(), RemoteError> {
        self.entry(instance)?
            .set_password(token.secret())
            .map_err(keyring_error)
    }

    fn delete(&self, instance: &Instance) -> Result<(), RemoteError> {
        match self.entry(instance)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(error) => Err(keyring_error(error)),
        }
    }
}

fn keyring_error(error: Error) -> RemoteError {
    RemoteError::Keyring(match error {
        // Both carry the stored secret's bytes, which no message may show.
        Error::BadEncoding(_) | Error::BadDataFormat(..) => {
            "the stored token is unreadable".to_string()
        }
        other => other.to_string(),
    })
}
