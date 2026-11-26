//! The name this computer goes by in dit: what its saves and its sign-in are recorded under.

/// The environment variable that overrides the host name.
pub const ENV: &str = "DIT_MACHINE";

/// The machine's name: `configured` if it is non-empty, else `DIT_MACHINE` if set and non-empty, else the
/// computer's host name.
pub fn name(configured: Option<&str>) -> String {
    resolve(configured, std::env::var(ENV).ok().as_deref())
}

/// [`name`] with the value of `DIT_MACHINE` given, not read from this process: what a command run for another
/// process, with that process's environment, records saves under.
pub fn resolve(configured: Option<&str>, env: Option<&str>) -> String {
    [configured, env]
        .into_iter()
        .flatten()
        .find(|name| !name.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| gethostname::gethostname().to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_configured_name_wins_over_the_environment() {
        assert_eq!(resolve(Some("studio"), Some("laptop")), "studio");
    }

    #[test]
    fn an_empty_or_absent_configured_name_falls_to_the_environment() {
        assert_eq!(resolve(Some(""), Some("laptop")), "laptop");
        assert_eq!(resolve(None, Some("laptop")), "laptop");
    }

    #[test]
    fn with_neither_the_host_name_is_used() {
        let host = gethostname::gethostname().to_string_lossy().into_owned();
        assert_eq!(resolve(None, None), host);
        assert_eq!(resolve(Some(""), Some("")), host);
    }
}
