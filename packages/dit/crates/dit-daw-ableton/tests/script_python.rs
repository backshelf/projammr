//! Runs the Live script's Python tests (`script/tests`, no Live needed) with `python3 -m unittest`, so `cargo test`
//! covers the script's wire. A machine without `python3` skips them and says so.

use std::path::Path;
use std::process::Command;

#[test]
fn the_script_protocol_python_tests_pass() {
    let tests = Path::new(env!("CARGO_MANIFEST_DIR")).join("script/tests");
    let output = match Command::new("python3")
        .args(["-m", "unittest", "discover", "-s"])
        .arg(&tests)
        .output()
    {
        Ok(output) => output,
        Err(error) => {
            eprintln!("skipped: python3 is not available ({error})");
            return;
        }
    };
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
