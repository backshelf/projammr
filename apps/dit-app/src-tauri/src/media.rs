//! Playing a file from disk in the panel: the webview may load a file through the asset protocol only once the app
//! has put that one file in the protocol's scope, and `allow_media` does so only for an audio file the person's own
//! projects or home folder hold.

use std::path::{Path, PathBuf};

/// The extensions of the audio files a render preview plays.
const AUDIO: &[&str] = &[
    "wav", "aif", "aiff", "aifc", "flac", "mp3", "m4a", "aac", "ogg", "opus", "caf",
];

/// The file at `path`, canonical, when it is an audio file inside `home` or inside one of `repos` (the project
/// folders dit tracks, which may be on another drive). A path that climbs out of those with `..` or through a
/// symlink is judged by where it lands, so it is refused.
pub fn playable(path: &Path, repos: &[PathBuf], home: &Path) -> Result<PathBuf, String> {
    let file = path
        .canonicalize()
        .map_err(|_| format!("{} isn't there to play.", path.display()))?;
    if !file.is_file() {
        return Err(format!("{} isn't a file.", path.display()));
    }
    let audio = file
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| AUDIO.contains(&extension.to_ascii_lowercase().as_str()));
    if !audio {
        return Err(format!("{} isn't an audio file.", path.display()));
    }
    let inside = |folder: &Path| {
        folder
            .canonicalize()
            .is_ok_and(|folder| file.starts_with(folder))
    };
    if inside(home) || repos.iter().any(|repo| inside(repo)) {
        Ok(file)
    } else {
        Err(format!(
            "{} is outside your projects and your home folder.",
            path.display()
        ))
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::os::unix::fs::symlink;

    use super::*;

    struct Folders {
        _dir: tempfile::TempDir,
        home: PathBuf,
        drive: PathBuf,
        elsewhere: PathBuf,
    }

    fn folders() -> Folders {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let (home, drive, elsewhere) = (root.join("home"), root.join("drive"), root.join("else"));
        for folder in [&home, &drive, &elsewhere] {
            fs::create_dir_all(folder).unwrap();
        }
        Folders {
            home,
            drive,
            elsewhere,
            _dir: dir,
        }
    }

    fn touch(path: &Path) -> PathBuf {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, "x").unwrap();
        path.to_path_buf()
    }

    #[test]
    fn an_audio_file_in_home_or_a_tracked_repo_is_playable() {
        let f = folders();
        let in_home = touch(&f.home.join("Music/bounce.WAV"));
        let in_repo = touch(&f.drive.join("Song Project/Renders/take.flac"));
        let repos = [f.drive.join("Song Project")];

        assert_eq!(playable(&in_home, &repos, &f.home).unwrap(), in_home);
        assert_eq!(playable(&in_repo, &repos, &f.home).unwrap(), in_repo);
    }

    #[test]
    fn every_listed_audio_extension_is_playable() {
        let f = folders();
        for extension in AUDIO {
            let file = touch(&f.home.join(format!("a.{extension}")));
            assert!(playable(&file, &[], &f.home).is_ok(), "{extension}");
        }
    }

    #[test]
    fn a_file_outside_home_and_the_repos_is_refused() {
        let f = folders();
        let outside = touch(&f.elsewhere.join("take.wav"));
        let beside = touch(&f.drive.join("Other Project/take.wav"));
        let repos = [f.drive.join("Song Project")];
        fs::create_dir_all(&repos[0]).unwrap();

        for file in [outside, beside] {
            let error = playable(&file, &repos, &f.home).unwrap_err();
            assert!(error.contains("outside your projects"), "{error}");
        }
    }

    #[test]
    fn a_dotdot_or_a_symlink_cannot_climb_out() {
        let f = folders();
        let outside = touch(&f.elsewhere.join("secret.wav"));
        let climbing = f.home.join("../else/secret.wav");
        assert!(playable(&climbing, &[], &f.home).is_err());

        let link = f.home.join("link.wav");
        symlink(&outside, &link).unwrap();
        assert!(playable(&link, &[], &f.home).is_err());
    }

    #[test]
    fn a_file_that_is_not_audio_is_missing_or_a_folder_is_refused() {
        let f = folders();
        let text = touch(&f.home.join("notes.txt"));
        let no_extension = touch(&f.home.join("take"));
        assert!(playable(&text, &[], &f.home).unwrap_err().contains("audio"));
        assert!(
            playable(&no_extension, &[], &f.home)
                .unwrap_err()
                .contains("audio")
        );
        assert!(
            playable(&f.home.join("gone.wav"), &[], &f.home)
                .unwrap_err()
                .contains("isn't there")
        );
        let folder = f.home.join("folder.wav");
        fs::create_dir(&folder).unwrap();
        assert!(
            playable(&folder, &[], &f.home)
                .unwrap_err()
                .contains("isn't a file")
        );
    }
}
