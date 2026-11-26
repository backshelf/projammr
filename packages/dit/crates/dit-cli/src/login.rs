//! `login`, `logout` and `whoami` over `dit_core::remote`, with the user config and token store the context's
//! remote source gives. What a person reads mid-command (the code, a warning) goes to the context's stderr, so
//! `--json` still prints only the result on stdout.

use std::cell::RefCell;
use std::io::{self, Write};
use std::process::{Command, Stdio};

use dit_core::remote::{self, DeviceCode, Logout, RemoteError, SignedIn, SystemClock};

use crate::commands::CliError;
use crate::context::Context;

impl From<RemoteError> for CliError {
    fn from(error: RemoteError) -> Self {
        CliError(error.to_string())
    }
}

/// Signs this machine in with the device grant: shows the code and where to confirm it, opens that page, and waits
/// for the person to approve it.
pub fn login(cx: &mut Context, url: Option<&str>) -> Result<SignedIn, CliError> {
    let tokens = cx.remote.tokens()?;
    let config = cx.remote.config_path()?;
    // Both callbacks write to stderr; they never run at once.
    let err = RefCell::new(&mut *cx.err);
    Ok(remote::login(
        &config,
        tokens.as_ref(),
        &SystemClock,
        url,
        |code| show_code(&mut **err.borrow_mut(), code),
        |error| {
            let _ = writeln!(
                **err.borrow_mut(),
                "warning: the previous session may still be open on the instance: {error}"
            );
        },
    )?)
}

/// Ends the session and removes the token. An instance that could not be told is a warning: the token is gone from
/// this machine either way.
pub fn logout(cx: &mut Context) -> Result<Logout, CliError> {
    let tokens = cx.remote.tokens()?;
    let logout = remote::logout(&cx.remote.config_path()?, tokens.as_ref())?;
    if let Some(error) = &logout.server_error {
        cx.say(format_args!(
            "warning: the session may still be open on the instance: {error}"
        ));
    }
    Ok(logout)
}

pub fn whoami(cx: &Context) -> Result<SignedIn, CliError> {
    let tokens = cx.remote.tokens()?;
    Ok(remote::whoami(&cx.remote.config_path()?, tokens.as_ref())?)
}

fn show_code(err: &mut dyn Write, code: &DeviceCode) {
    let _ = writeln!(
        err,
        "Confirm the code {} at {}",
        code.user_code, code.verification_uri
    );
    if let Err(error) = open_browser(&code.verification_uri_complete) {
        let _ = writeln!(
            err,
            "warning: couldn't open a browser ({error}); open the address above yourself."
        );
    }
    let _ = writeln!(err, "Waiting for approval\u{2026}");
}

fn open_browser(url: &str) -> io::Result<()> {
    let status = browser_command(url)?
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(io::Error::other(status.to_string()))
    }
}

fn validate_browser_url(url: &str) -> io::Result<()> {
    let allowed_scheme = url.starts_with("https://") || url.starts_with("http://");
    let has_control = url.chars().any(char::is_control);
    if !allowed_scheme || has_control {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "refusing to open a non-HTTP(S) address in a browser",
        ));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn browser_command(url: &str) -> io::Result<Command> {
    validate_browser_url(url)?;
    let mut command = Command::new("open");
    command.arg(url);
    Ok(command)
}

#[cfg(windows)]
fn browser_command(url: &str) -> io::Result<Command> {
    validate_browser_url(url)?;
    let mut command = Command::new("rundll32.exe");
    command.args(["url.dll,FileProtocolHandler", url]);
    Ok(command)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn browser_command(url: &str) -> io::Result<Command> {
    validate_browser_url(url)?;
    let mut command = Command::new("xdg-open");
    command.arg(url);
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_command_passes_ampersand_urls_without_shell_interpolation() {
        let url = "https://hub.example.test/device?user_code=ABCD-1234&extra=calc";
        let command = browser_command(url).unwrap();
        let program = command.get_program().to_string_lossy();
        let args: Vec<String> = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();

        assert_ne!(program.to_ascii_lowercase(), "cmd");
        assert_ne!(program.to_ascii_lowercase(), "cmd.exe");
        #[cfg(windows)]
        {
            assert_eq!(program, "rundll32.exe");
            assert_eq!(args, ["url.dll,FileProtocolHandler", url]);
        }
        #[cfg(not(windows))]
        {
            assert_eq!(args, [url]);
        }
    }

    #[test]
    fn browser_command_rejects_non_http_schemes_and_control_characters() {
        for bad in [
            "file:///C:/Windows/System32/calc.exe",
            "javascript:alert(1)",
            "calc.exe",
            "https://hub.example.test/\r\nevil",
        ] {
            let error = browser_command(bad).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput, "{bad}");
        }
    }
}
