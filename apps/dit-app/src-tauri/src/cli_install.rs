//! "Install the dit command": a symlink from `/usr/local/bin/dit` to the `dit` the app carries beside its own
//! executable, made with an administrator prompt because that folder is not the person's.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Where the command is linked.
pub const LINK: &str = "/usr/local/bin/dit";

/// The `dit` the app carries: the bundler puts an external binary next to the app's own executable, in a bundle and
/// in a development build alike.
pub fn bundled() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|error| format!("dit can't find itself: {error}"))?;
    let sidecar = exe
        .parent()
        .map(|folder| folder.join("dit"))
        .ok_or("dit can't find the folder it runs from.")?;
    if sidecar.is_file() {
        Ok(sidecar)
    } else {
        Err(format!(
            "This build of dit doesn't carry the dit command ({} is missing).",
            sidecar.display()
        ))
    }
}

/// `link` when it is a symlink that points at `sidecar`: the command is installed from this app. A link to some
/// other `dit`, a file that is not a link, or nothing there is not.
pub fn installed(link: &Path, sidecar: &Path) -> Option<String> {
    let target = std::fs::read_link(link).ok()?;
    let target = if target.is_relative() {
        link.parent()?.join(target)
    } else {
        target
    };
    let same = match (target.canonicalize(), sidecar.canonicalize()) {
        (Ok(target), Ok(sidecar)) => target == sidecar,
        _ => target == sidecar,
    };
    same.then(|| link.display().to_string())
}

/// `text` as one shell word: in single quotes, each quote inside ended, escaped and begun again.
fn shell_word(text: &str) -> String {
    format!("'{}'", text.replace('\'', "'\\''"))
}

/// The shell command that links `link` to `sidecar`, making the folder first.
pub fn link_command(sidecar: &Path, link: &Path) -> String {
    let folder = link.parent().unwrap_or(Path::new("/"));
    format!(
        "/bin/mkdir -p {} && /bin/ln -sf {} {}",
        shell_word(&folder.to_string_lossy()),
        shell_word(&sidecar.to_string_lossy()),
        shell_word(&link.to_string_lossy()),
    )
}

/// The AppleScript that runs `shell` as an administrator: the command is a string literal, in which a backslash and
/// a double quote are escaped.
pub fn admin_script(shell: &str) -> String {
    let escaped = shell.replace('\\', "\\\\").replace('"', "\\\"");
    format!("do shell script \"{escaped}\" with administrator privileges")
}

/// Links `LINK` to the app's `dit`, asking for the administrator password. The prompt is macOS's own.
pub fn install() -> Result<(), String> {
    let sidecar = bundled()?;
    let script = admin_script(&link_command(&sidecar, Path::new(LINK)));
    let output = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("dit couldn't ask for permission: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let reason = String::from_utf8_lossy(&output.stderr);
    // The person closed the password dialog: error -128.
    if reason.contains("-128") {
        return Err(
            "The dit command was not installed: the password prompt was cancelled.".to_string(),
        );
    }
    Err(format!(
        "The dit command was not installed: {}",
        reason.trim()
    ))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::os::unix::fs::symlink;

    use super::*;

    #[test]
    fn the_command_links_the_sidecar_to_the_path_after_making_its_folder() {
        assert_eq!(
            link_command(
                Path::new("/Applications/dit.app/Contents/MacOS/dit"),
                Path::new("/usr/local/bin/dit")
            ),
            "/bin/mkdir -p '/usr/local/bin' && /bin/ln -sf '/Applications/dit.app/Contents/MacOS/dit' '/usr/local/bin/dit'"
        );
    }

    #[test]
    fn a_path_with_spaces_or_quotes_stays_one_shell_word() {
        let command = link_command(
            Path::new("/Users/o'neil/My Apps/dit.app/Contents/MacOS/dit"),
            Path::new("/usr/local/bin/dit"),
        );
        assert!(command.contains("'/Users/o'\\''neil/My Apps/dit.app/Contents/MacOS/dit'"));
        // A path cannot end the word early and add a command of its own.
        let hostile = link_command(
            Path::new("/x'; rm -rf ~; '"),
            Path::new("/usr/local/bin/dit"),
        );
        assert!(hostile.contains("'/x'\\''; rm -rf ~; '\\'''"));
    }

    #[test]
    fn the_script_escapes_what_an_applescript_string_cannot_hold() {
        assert_eq!(
            admin_script("ln -sf 'a' \"b\\c\""),
            "do shell script \"ln -sf 'a' \\\"b\\\\c\\\"\" with administrator privileges"
        );
    }

    #[test]
    fn a_link_to_the_sidecar_is_installed_and_any_other_is_not() {
        let dir = tempfile::tempdir().unwrap();
        let sidecar = dir.path().join("MacOS-dit");
        let other = dir.path().join("other-dit");
        fs::write(&sidecar, "").unwrap();
        fs::write(&other, "").unwrap();
        let link = dir.path().join("dit");

        assert_eq!(installed(&link, &sidecar), None, "nothing there");

        symlink(&other, &link).unwrap();
        assert_eq!(installed(&link, &sidecar), None, "another dit");

        fs::remove_file(&link).unwrap();
        symlink(&sidecar, &link).unwrap();
        assert_eq!(installed(&link, &sidecar), Some(link.display().to_string()));

        fs::remove_file(&link).unwrap();
        fs::write(&link, "").unwrap();
        assert_eq!(installed(&link, &sidecar), None, "a file, not a link");
    }

    #[test]
    fn a_relative_link_is_read_from_the_folder_it_is_in() {
        let dir = tempfile::tempdir().unwrap();
        let sidecar = dir.path().join("dit-real");
        fs::write(&sidecar, "").unwrap();
        let link = dir.path().join("dit");
        symlink("dit-real", &link).unwrap();
        assert!(installed(&link, &sidecar).is_some());
    }
}
