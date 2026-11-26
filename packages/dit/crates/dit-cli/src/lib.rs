//! `dit`: a git-shaped command line over a Live project folder's saves and commits.
//!
//! The command line is a library so the dit app can run it in its own process: [`run`] takes the environment, the
//! stderr stream and the source of signed-in connections as a [`Context`], and nothing in a command reaches for
//! the process's own. The terminal's `dit` is [`main_process`]: it hands the command line to a running app over
//! the socket and runs it itself only when none answers.

mod backfill;
mod commands;
mod config;
mod context;
mod interrupt;
mod login;
mod output;
mod push;
mod remote;
mod renders;
mod restore;
mod script;

use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::{Parser, Subcommand, ValueEnum};
use dit_daemon::backfill::BackfillControl;
use dit_daemon::renders::RenderControl;
use serde::Serialize;

use commands::CliError;
pub use context::{Context, Env, RemoteSource, SystemRemote};

#[derive(Parser)]
#[command(
    name = "dit",
    version,
    about = "Saves and commits for a DAW project folder"
)]
pub struct Cli {
    /// Print the result as JSON.
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
pub enum Command {
    /// Make the current project folder a repo and record a save of every set.
    Init,
    /// Record a save of each set that changed and report what is waiting to be committed.
    Status {
        /// A set file name, with or without its extension.
        set: Option<String>,
    },
    /// List a set's commits, newest first, with the saves folded under each.
    Log {
        /// A set file name, with or without its extension.
        set: Option<String>,
    },
    /// Commit a set's latest save.
    Commit {
        /// The commit message; the summary of what changed when left out.
        #[arg(short, long)]
        message: Option<String>,
        /// Keep the commit here: do not push it to the instance afterwards.
        #[arg(long)]
        no_push: bool,
        /// A set file name, with or without its extension.
        set: Option<String>,
    },
    /// Send a set's saves and commits to the instance; every set when none is named.
    Push {
        /// A set file name, with or without its extension.
        set: Option<String>,
        /// The project to create this repo in on its first push.
        #[arg(long)]
        project: Option<String>,
    },
    /// The instance this repo pushes to.
    Remote {
        #[command(subcommand)]
        command: RemoteCommand,
    },
    /// This repo's settings on its instance.
    Config {
        #[command(subcommand)]
        command: ConfigCommand,
    },
    /// Show what changed between two saves or commits.
    Diff {
        /// A commit or save id prefix (at least 4 hex characters): the older side. With no ids, the
        /// branch head is compared to the latest save.
        a: Option<String>,
        /// A commit or save id prefix: the newer side. With only `a`, the latest save of the file
        /// `a` was recorded from.
        b: Option<String>,
        /// A set file name, with or without its extension. Ignored when ids are given.
        #[arg(long)]
        set: Option<String>,
    },
    /// Record a save of a set now.
    Save {
        /// A set file name, with or without its extension.
        set: Option<String>,
    },
    /// Write a commit out as the working file of a new branch.
    Checkout {
        /// A commit id prefix (at least 4 hex characters).
        commit: String,
        /// The new branch's name.
        #[arg(short = 'b', value_name = "NAME", required = true)]
        branch: String,
    },
    /// Bring a commit the instance holds, such as one made on another computer, in as a new branch of the repo
    /// that tracks it.
    Restore {
        /// The commit's id on the instance.
        commit: i64,
        /// The new branch's name; `restore-` and the commit's first hex digits when left out.
        #[arg(long, value_name = "BRANCH")]
        name: Option<String>,
    },
    /// Show how long each set was open: in all, since its last commit, and in each commit.
    Time {
        /// A set file name, with or without its extension.
        set: Option<String>,
    },
    /// The control-surface script that tells the dit app which set the DAW has open.
    Script {
        #[command(subcommand)]
        command: ScriptCommand,
    },
    /// Sign this machine in to an instance: approve it once in the browser, and the session token goes to the
    /// system keyring.
    Login {
        /// The instance's address, such as https://projammr.example.com. The last instance signed in to when left
        /// out.
        url: Option<String>,
    },
    /// End this machine's session on its instance and remove the token.
    Logout,
    /// Show who this machine is signed in as.
    Whoami,
    /// The audio renders the dit app found beside your projects: with no subcommand, the list.
    Renders {
        #[command(subcommand)]
        command: Option<RendersCommand>,
    },
    /// Bring the Live projects you already have into dit, oldest saves and all. With no folder, list the project
    /// folders found; with folders, bring them in.
    Backfill {
        /// The project folders to bring in.
        folders: Vec<PathBuf>,
        /// The folders to search for projects when listing, instead of Live's own and Music. Repeat it to search
        /// several.
        #[arg(long = "in", value_name = "ROOT", conflicts_with = "folders")]
        roots: Vec<PathBuf>,
        /// The project on the instance to bring them into: the last one used, or your only one, when left out.
        #[arg(long, value_name = "ID")]
        project: Option<i64>,
    },
}

#[derive(Subcommand)]
pub enum RendersCommand {
    /// Add a render to the instance as a version of its session's track.
    Accept {
        /// The render's id, as `dit renders` lists it.
        id: u64,
        /// The instance's session to add it to, when not the one it was proposed for.
        #[arg(long, value_name = "SESSION")]
        set: Option<i64>,
    },
    /// Say a render is not a bounce: it is never proposed again, whatever it is renamed or moved to.
    Reject {
        /// The render's id, as `dit renders` lists it.
        id: u64,
        /// Also propose nothing from the folder it is in.
        #[arg(long)]
        never_here: bool,
    },
}

#[derive(Subcommand)]
pub enum ScriptCommand {
    /// Put the script where the DAW looks for it (the User Library's Remote Scripts), or bring it up to date.
    Install,
    /// Say whether it is installed, current and switched on in the DAW.
    Status,
}

#[derive(Subcommand)]
pub enum RemoteCommand {
    /// Point this repo at the address its instance moved to, keeping the hub repo it pushes to. Run dit login with
    /// that address first.
    Set {
        /// The instance's new address, such as https://projammr.example.com.
        url: String,
    },
}

#[derive(Subcommand)]
pub enum ConfigCommand {
    /// Whether this repo's sample objects are pushed with its commits. Alone, prints the setting as last heard from
    /// the instance.
    PushSamples {
        /// Set it on the instance: on or off.
        value: Option<Toggle>,
    },
}

#[derive(Clone, Copy, ValueEnum)]
pub enum Toggle {
    On,
    Off,
}

/// What a command printed, and the line for stderr that fails it after that output: the part of a push that went
/// through is shown, then the hub's refusal ends it with a non-zero exit.
pub struct Done {
    pub text: String,
    pub refusal: Option<String>,
}

/// Runs `cli` in the folder `cwd`.
pub fn run(cli: Cli, cwd: &Path, cx: &mut Context) -> Result<Done, CliError> {
    let mut refusal = None;
    let text = match cli.command {
        Command::Init => render(cli.json, &commands::init(cx, cwd)?, output::init),
        Command::Status { set } => render(
            cli.json,
            &commands::status(cx, cwd, set.as_deref())?,
            output::status,
        ),
        Command::Log { set } => render(
            cli.json,
            &commands::log(cx, cwd, set.as_deref())?,
            output::log,
        ),
        Command::Commit {
            message,
            no_push,
            set,
        } => render(
            cli.json,
            &commands::commit(cx, cwd, message.as_deref(), set.as_deref(), no_push)?,
            output::commit,
        ),
        Command::Push { set, project } => {
            let result = push::push(cx, cwd, set.as_deref(), project.as_deref())?;
            refusal = result.refused.as_deref().map(output::push_refusal);
            render(cli.json, &result, output::push)
        }
        Command::Remote {
            command: RemoteCommand::Set { url },
        } => render(cli.json, &remote::set(cx, cwd, &url)?, output::remote_set),
        Command::Config {
            command: ConfigCommand::PushSamples { value },
        } => render(
            cli.json,
            &config::push_samples(cx, cwd, value.map(|toggle| matches!(toggle, Toggle::On)))?,
            output::push_samples,
        ),
        Command::Diff { a, b, set } => render(
            cli.json,
            &commands::diff(cx, cwd, a.as_deref(), b.as_deref(), set.as_deref())?,
            output::diff,
        ),
        Command::Save { set } => render(
            cli.json,
            &commands::save(cx, cwd, set.as_deref())?,
            output::save,
        ),
        Command::Checkout { commit, branch } => render(
            cli.json,
            &commands::checkout(cx, cwd, &commit, &branch)?,
            output::checkout,
        ),
        Command::Restore { commit, name } => render(
            cli.json,
            &restore::restore(cx, cwd, commit, name.as_deref())?,
            output::restore,
        ),
        Command::Script { command } => render(
            cli.json,
            &script::script(matches!(command, ScriptCommand::Install))?,
            output::script,
        ),
        Command::Time { set } => render(
            cli.json,
            &commands::time(cx, cwd, set.as_deref())?,
            output::time,
        ),
        Command::Login { url } => render(
            cli.json,
            &login::login(cx, url.as_deref())?,
            output::signed_in,
        ),
        Command::Logout => render(cli.json, &login::logout(cx)?, output::logout),
        Command::Whoami => render(cli.json, &login::whoami(cx)?, output::signed_in),
        Command::Renders { command } => match command {
            None => {
                let listed = renders::list(cx)?;
                if cli.json && listed.stale {
                    cx.say(renders::STALE_LINE);
                }
                render(cli.json, &listed, output::renders)
            }
            Some(RendersCommand::Accept { id, set }) => {
                let accepted = renders::accept(cx, id, set)?;
                refusal = output::render_refusal(&accepted);
                render(cli.json, &accepted, output::render_accepted)
            }
            Some(RendersCommand::Reject { id, never_here }) => render(
                cli.json,
                &renders::reject(cx, id, never_here)?,
                output::render_rejected,
            ),
        },
        Command::Backfill { folders, roots, .. } if folders.is_empty() => render(
            cli.json,
            &backfill::list(cx, cwd, &roots)?,
            output::backfill_list,
        ),
        Command::Backfill {
            folders, project, ..
        } => {
            let result = backfill::run(cx, cwd, &folders, project)?;
            refusal = result.refusal.clone();
            render(cli.json, &result, output::backfill_result)
        }
    };
    Ok(Done { text, refusal })
}

fn render<T: Serialize>(json: bool, result: &T, human: fn(&T) -> String) -> String {
    if json {
        output::json(result)
    } else {
        human(result)
    }
}

/// How a command ended, as the terminal shows it and as the socket carries it: its text and a newline on stdout,
/// then its refusal or error on stderr, with a failing exit code for either. A refused push with nothing sent
/// before it has nothing to show above the refusal.
fn finish(result: Result<Done, CliError>) -> dit_ipc::Done {
    match result {
        Ok(Done {
            text,
            refusal: None,
        }) => dit_ipc::Done {
            stdout: format!("{text}\n"),
            code: 0,
            refusal: None,
        },
        Ok(Done {
            text,
            refusal: Some(refusal),
        }) => dit_ipc::Done {
            stdout: if text.is_empty() {
                text
            } else {
                format!("{text}\n")
            },
            code: 1,
            refusal: Some(refusal),
        },
        Err(error) => dit_ipc::Done {
            stdout: String::new(),
            code: 1,
            refusal: Some(error.to_string()),
        },
    }
}

/// Runs the command line a client sent, as the app does for the cli: the same text, JSON and exit code a local run
/// gives, with `run`'s environment and the app's own `remote`. What the command writes to stderr goes to `err`.
/// `renders` is the app's render engine, which `dit renders` asks instead of reading the ledger.
/// `backfill` is the app's backfill run, which `dit backfill` brings folders in through instead of running one here.
pub fn handle(
    run: dit_ipc::Run,
    err: &mut dyn Write,
    remote: &dyn RemoteSource,
    renders: Option<&dyn RenderControl>,
    backfill: Option<&dyn BackfillControl>,
) -> dit_ipc::Done {
    let argv = std::iter::once("dit".to_string()).chain(run.argv);
    let cli = match Cli::try_parse_from(argv) {
        Ok(cli) => cli,
        // Help and version are answers, not failures.
        Err(error) if !error.use_stderr() => {
            return dit_ipc::Done {
                stdout: error.to_string(),
                code: 0,
                refusal: None,
            };
        }
        Err(error) => {
            return dit_ipc::Done {
                stdout: String::new(),
                code: error.exit_code(),
                refusal: Some(error.to_string().trim_end().to_string()),
            };
        }
    };
    let mut cx = Context::new(run.env, err, remote);
    cx.renders = renders;
    cx.backfill = backfill;
    finish(self::run(cli, &run.cwd, &mut cx))
}

/// The terminal's `dit`: parses the process's arguments, then has the running app run the command or, with none
/// listening, runs it here. A running app that cannot take the command (another protocol version) is an error,
/// never a reason to run it here: the app holds the Keychain and the repos.
pub fn main_process() -> ExitCode {
    let cli = Cli::parse();
    let done = match std::env::current_dir() {
        Ok(cwd) => match served(&cwd) {
            Ok(Some(done)) => done,
            Ok(None) => locally(cli, &cwd),
            Err(error) => finish(Err(error)),
        },
        Err(error) => finish(Err(CliError(format!("current folder: {error}")))),
    };
    // A stdout that is closed (`dit log | head`) is the reader's choice, not a failure of the command.
    let _ = io::stdout().write_all(done.stdout.as_bytes());
    if let Some(refusal) = done.refusal {
        eprintln!("{refusal}");
    }
    ExitCode::from(u8::try_from(done.code).unwrap_or(1))
}

fn locally(cli: Cli, cwd: &Path) -> dit_ipc::Done {
    let mut stderr = io::stderr();
    let mut cx = Context::new(Env::from_process(), &mut stderr, &SystemRemote);
    finish(run(cli, cwd, &mut cx))
}

/// The app's answer to this process's command line; `None` when no app is running.
#[cfg(unix)]
fn served(cwd: &Path) -> Result<Option<dit_ipc::Done>, CliError> {
    let Some(path) = dit_ipc::default_path() else {
        return Ok(None);
    };
    let Some(mut client) = dit_ipc::Client::connect(&path).map_err(|e| CliError(e.to_string()))?
    else {
        return Ok(None);
    };
    let argv = std::env::args_os()
        .skip(1)
        .map(|arg| arg.into_string())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| {
            CliError("Arguments must be valid UTF-8 while the dit app runs.".to_string())
        })?;
    let run = dit_ipc::Run {
        cwd: cwd.to_path_buf(),
        env: Env::from_process(),
        argv,
    };
    client
        .run(run, &mut io::stderr())
        .map(Some)
        .map_err(|e| CliError(e.to_string()))
}

#[cfg(not(unix))]
fn served(_cwd: &Path) -> Result<Option<dit_ipc::Done>, CliError> {
    Ok(None)
}
