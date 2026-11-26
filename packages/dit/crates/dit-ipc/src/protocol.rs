//! The wire: newline-delimited JSON, one object per line, over the socket.
//!
//! A client sends a [`Request`]; the server answers with [`Frame`]s carrying the request's `id`: any number of
//! stderr frames as the command runs, then one `done` (a command), `ok` (an op) or `error` (a request refused).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// The protocol version both sides must speak. A request of another version is refused, never run.
pub const VERSION: u32 = 1;

/// The environment variables a command reads, as the requesting process had them: the app answers for the cli,
/// so the app's own environment is not the one a command's author and machine name come from.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Env {
    #[serde(
        rename = "DIT_AUTHOR",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub author: Option<String>,
    #[serde(rename = "USER", default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(
        rename = "DIT_MACHINE",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub machine: Option<String>,
}

impl Env {
    /// This process's own variables.
    pub fn from_process() -> Self {
        let var = |name| std::env::var(name).ok();
        Env {
            author: var("DIT_AUTHOR"),
            user: var("USER"),
            machine: var("DIT_MACHINE"),
        }
    }
}

/// A command line to run: what `dit <argv>` would do in `cwd`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Run {
    pub cwd: PathBuf,
    pub env: Env,
    /// The arguments after the program name.
    pub argv: Vec<String>,
}

/// A request that is not a command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Op {
    /// Answers `ok` when the server is there and speaks this version.
    Ping,
    /// Asks the running app to show its panel: what a second instance does before it exits.
    ShowPanel,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Body {
    Op { op: Op },
    Run(Run),
}

/// One line from a client.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Request {
    pub v: u32,
    pub id: u64,
    #[serde(flatten)]
    pub body: Body,
}

/// How a command ended: what it printed on stdout, its exit code and the line that fails it on stderr after that
/// output. A refused push prints what went through, then the refusal; an error is a refusal with nothing before it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Done {
    pub stdout: String,
    pub code: i32,
    pub refusal: Option<String>,
}

/// Which stream a text frame belongs to; stderr is the only one that streams.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Stream {
    Stderr,
}

/// One line from the server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Frame {
    /// Text the command wrote to stderr while it ran.
    Stderr {
        id: u64,
        stream: Stream,
        text: String,
    },
    /// The command ended.
    Done { id: u64, done: Done },
    /// The op was carried out.
    Ok { id: u64, ok: bool },
    /// The request was not run: the wrong version, or not a request at all.
    Error { id: u64, error: String },
}

impl Frame {
    pub fn id(&self) -> u64 {
        match self {
            Frame::Stderr { id, .. }
            | Frame::Done { id, .. }
            | Frame::Ok { id, .. }
            | Frame::Error { id, .. } => *id,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_run_request_is_the_documented_line() {
        let request = Request {
            v: VERSION,
            id: 7,
            body: Body::Run(Run {
                cwd: "/p".into(),
                env: Env {
                    author: Some("ada".into()),
                    user: None,
                    machine: Some("studio".into()),
                },
                argv: vec!["commit".into(), "-m".into(), "x".into()],
            }),
        };
        let value = serde_json::to_value(&request).unwrap();
        assert_eq!(
            value,
            json!({
                "v": 1, "id": 7, "cwd": "/p",
                "env": { "DIT_AUTHOR": "ada", "DIT_MACHINE": "studio" },
                "argv": ["commit", "-m", "x"],
            })
        );
        assert_eq!(serde_json::from_value::<Request>(value).unwrap(), request);
    }

    #[test]
    fn an_op_request_parses_without_a_command() {
        let request: Request = serde_json::from_str(r#"{"v":1,"id":2,"op":"show-panel"}"#).unwrap();
        assert_eq!(
            request,
            Request {
                v: 1,
                id: 2,
                body: Body::Op { op: Op::ShowPanel }
            }
        );
    }

    #[test]
    fn frames_round_trip_by_their_shape() {
        let done = Done {
            stdout: "out\n".into(),
            code: 1,
            refusal: Some("no".into()),
        };
        for frame in [
            Frame::Stderr {
                id: 1,
                stream: Stream::Stderr,
                text: "hi".into(),
            },
            Frame::Done { id: 1, done },
            Frame::Ok { id: 2, ok: true },
            Frame::Error {
                id: 3,
                error: "skew".into(),
            },
        ] {
            let line = serde_json::to_string(&frame).unwrap();
            assert_eq!(
                serde_json::from_str::<Frame>(&line).unwrap(),
                frame,
                "{line}"
            );
        }
    }
}
