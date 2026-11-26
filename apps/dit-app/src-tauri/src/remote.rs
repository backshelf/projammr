//! The app's side of the cli's [`RemoteSource`]: its config file and a token store that reads the Keychain once.
//!
//! The Keychain's access prompt guards the token, so the app asks for it once per launch and runs every remote call
//! of its own and of the cli's, which arrive over the socket, from that one read.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use dit_cli::RemoteSource;
use dit_core::remote::{self, Instance, RemoteError, Token, TokenStore};

pub struct AppRemote {
    config: PathBuf,
    /// The Keychain, opened on first use.
    keychain: Mutex<Option<Arc<dyn TokenStore>>>,
    /// The secret of each instance read or written, by the instance's address; `None` where there is none.
    secrets: Arc<Mutex<HashMap<String, Option<String>>>>,
}

impl AppRemote {
    pub fn new(config: PathBuf) -> Self {
        AppRemote {
            config,
            keychain: Mutex::default(),
            secrets: Arc::default(),
        }
    }

    fn keychain(&self) -> Result<Arc<dyn TokenStore>, RemoteError> {
        let mut held = self.keychain.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(keychain) = &*held {
            return Ok(keychain.clone());
        }
        let keychain: Arc<dyn TokenStore> = Arc::from(remote::system_tokens()?);
        *held = Some(keychain.clone());
        Ok(keychain)
    }
}

impl RemoteSource for AppRemote {
    fn config_path(&self) -> Result<PathBuf, RemoteError> {
        Ok(self.config.clone())
    }

    fn tokens(&self) -> Result<Box<dyn TokenStore>, RemoteError> {
        Ok(Box::new(Remembered {
            keychain: self.keychain()?,
            secrets: self.secrets.clone(),
        }))
    }
}

/// The Keychain with what it has said remembered.
struct Remembered {
    keychain: Arc<dyn TokenStore>,
    secrets: Arc<Mutex<HashMap<String, Option<String>>>>,
}

impl Remembered {
    fn remember(&self, instance: &Instance, secret: Option<String>) {
        self.secrets
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(instance.url().to_string(), secret);
    }
}

impl TokenStore for Remembered {
    fn get(&self, instance: &Instance) -> Result<Option<Token>, RemoteError> {
        let held = self
            .secrets
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(instance.url())
            .cloned();
        if let Some(secret) = held {
            return Ok(secret.map(Token::new));
        }
        let token = self.keychain.get(instance)?;
        self.remember(
            instance,
            token.as_ref().map(|token| token.secret().to_string()),
        );
        Ok(token)
    }

    fn set(&self, instance: &Instance, token: &Token) -> Result<(), RemoteError> {
        self.keychain.set(instance, token)?;
        self.remember(instance, Some(token.secret().to_string()));
        Ok(())
    }

    fn delete(&self, instance: &Instance) -> Result<(), RemoteError> {
        self.keychain.delete(instance)?;
        self.remember(instance, None);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    /// A keychain that counts how often it is asked.
    #[derive(Default)]
    struct Counting {
        reads: AtomicUsize,
        held: Mutex<Option<String>>,
    }

    impl TokenStore for Counting {
        fn get(&self, _: &Instance) -> Result<Option<Token>, RemoteError> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            Ok(self.held.lock().unwrap().clone().map(Token::new))
        }

        fn set(&self, _: &Instance, token: &Token) -> Result<(), RemoteError> {
            *self.held.lock().unwrap() = Some(token.secret().to_string());
            Ok(())
        }

        fn delete(&self, _: &Instance) -> Result<(), RemoteError> {
            *self.held.lock().unwrap() = None;
            Ok(())
        }
    }

    fn remembered(keychain: &Arc<Counting>) -> Remembered {
        Remembered {
            keychain: keychain.clone(),
            secrets: Arc::default(),
        }
    }

    #[test]
    fn the_keychain_is_read_once_per_instance_however_often_the_token_is_asked_for() {
        let keychain = Arc::new(Counting::default());
        *keychain.held.lock().unwrap() = Some("secret".to_string());
        let store = remembered(&keychain);
        let instance = Instance::parse("https://projammr.example").unwrap();

        for _ in 0..3 {
            assert_eq!(store.get(&instance).unwrap().unwrap().secret(), "secret");
        }

        assert_eq!(keychain.reads.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn an_absent_token_is_remembered_too_and_a_write_replaces_it() {
        let keychain = Arc::new(Counting::default());
        let store = remembered(&keychain);
        let instance = Instance::parse("https://projammr.example").unwrap();

        assert!(store.get(&instance).unwrap().is_none());
        assert!(store.get(&instance).unwrap().is_none());
        assert_eq!(keychain.reads.load(Ordering::SeqCst), 1);

        store
            .set(&instance, &Token::new("fresh".to_string()))
            .unwrap();
        assert_eq!(store.get(&instance).unwrap().unwrap().secret(), "fresh");
        assert_eq!(keychain.reads.load(Ordering::SeqCst), 1);

        store.delete(&instance).unwrap();
        assert!(store.get(&instance).unwrap().is_none());
        assert!(keychain.held.lock().unwrap().is_none());
    }
}
