//! Builds `dit`, the command line the bundle carries, where `bundle.externalBin` looks for it, then runs Tauri's own
//! build step. The cli is built here rather than by a script so `tauri dev`, `tauri build`, clippy and the tests
//! all find it without anyone remembering a step.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::{env, fs};

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let dit = manifest.join("../../../packages/dit");
    let target = env::var("TARGET").unwrap();
    let release = env::var("PROFILE").is_ok_and(|profile| profile == "release");

    let built = build_cli(&dit, &manifest.join("target/dit-cli"), &target, release);
    let binaries = manifest.join("binaries");
    fs::create_dir_all(&binaries).unwrap();
    install(&built, &binaries.join(format!("dit-{target}")));

    // Watch only the crates `dit-cli` depends on so edits to unrelated workspace crates (`dit-wasm`) or test fixtures
    // never retrigger the nested cli build.
    for watched in [
        "Cargo.toml",
        "Cargo.lock",
        "crates/dit-cli/Cargo.toml",
        "crates/dit-cli/src",
        "crates/dit-core/Cargo.toml",
        "crates/dit-core/src",
        "crates/dit-daemon/Cargo.toml",
        "crates/dit-daemon/src",
        "crates/dit-daw-ableton/Cargo.toml",
        "crates/dit-daw-ableton/src",
        "crates/dit-daw-ableton/script",
        "crates/dit-daws/Cargo.toml",
        "crates/dit-daws/src",
        "crates/dit-ipc/Cargo.toml",
        "crates/dit-ipc/src",
    ] {
        println!("cargo:rerun-if-changed={}", dit.join(watched).display());
    }
    tauri_build::build();
}

/// Builds `dit-cli` for `target` in `target_dir`, a build directory of its own so this script never waits on the
/// lock of the build that runs it. Returns the binary.
fn build_cli(dit: &Path, target_dir: &Path, target: &str, release: bool) -> PathBuf {
    let mut cargo = Command::new(env::var("CARGO").unwrap());
    cargo
        .args(["build", "--locked", "-p", "dit-cli", "--target", target])
        .arg("--manifest-path")
        .arg(dit.join("Cargo.toml"))
        .arg("--target-dir")
        .arg(target_dir);
    if release {
        cargo.arg("--release");
    }
    // What the outer cargo set for this crate is not for another one.
    for (name, _) in env::vars() {
        if name.starts_with("CARGO_") && name != "CARGO_HOME" {
            cargo.env_remove(name);
        }
    }
    let status = cargo.status().expect("run cargo to build dit-cli");
    assert!(status.success(), "building dit-cli failed: {status}");
    let profile = if release { "release" } else { "debug" };
    target_dir.join(target).join(profile).join("dit")
}

/// Copies `from` to `to` unless `to` already is that file, so an unchanged cli leaves the bundle input alone.
fn install(from: &Path, to: &Path) {
    let same = matches!((fs::read(from), fs::read(to)), (Ok(a), Ok(b)) if a == b);
    if !same {
        fs::copy(from, to).unwrap_or_else(|error| panic!("copy {}: {error}", from.display()));
    }
}
