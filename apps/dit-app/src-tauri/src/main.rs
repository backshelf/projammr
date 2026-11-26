//! dit's menu bar app. The bar item, the panel and the daemon behind them are one process; the cli reaches it over
//! a local socket while it runs.

mod arc;
mod art;
mod auth;
mod backfill;
mod backfill_window;
mod cli_install;
mod commands;
mod commit;
mod core;
mod daw_app;
mod deep_link;
mod login_item;
mod media;
mod notify;
mod panel;
mod paths;
mod permissions;
mod readout;
mod reducer;
mod remote;
mod renders;
mod restore;
mod shortcut;
mod snapshot;
mod state;
mod tray;
mod update;
mod wake;

use std::sync::Arc;
use std::thread;

use dit_ipc::{Client, Done, Handler, Run, Server};
use signal_hook::consts::{SIGINT, SIGTERM};
use signal_hook::iterator::Signals;
use tauri::{ActivationPolicy, AppHandle, Manager, RunEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_deep_link::DeepLinkExt;

use crate::core::Core;
use crate::paths::Paths;

/// Answers the cli's socket for the app.
struct Answering {
    core: Arc<Core>,
    app: AppHandle,
}

impl Handler for Answering {
    fn run(&self, run: Run, stderr: &mut dyn std::io::Write) -> Done {
        self.core.run_for_cli(run, stderr)
    }

    fn show_panel(&self) {
        panel::show(&self.app, None);
    }
}

fn main() {
    let context = tauri::generate_context!();
    let paths = match Paths::resolve(&context.config().identifier) {
        Ok(paths) => paths,
        Err(error) => {
            eprintln!("dit: {error}");
            std::process::exit(1);
        }
    };
    // The instance that holds the lock owns the socket; a second launch hands over to it and leaves.
    let server = match Server::claim(&paths.socket) {
        Ok(Some(server)) => Some(server),
        Ok(None) => {
            if let Ok(Some(mut running)) = Client::connect(&paths.socket) {
                let _ = running.show_panel();
            }
            return;
        }
        Err(error) => {
            eprintln!("dit: the cli can't reach this app: {error}");
            None
        }
    };

    let identifier = context.config().identifier.clone();
    let updater = update::plugin(context.config());
    let has_updater = updater.is_some();
    let mut builder = tauri::Builder::default();
    if let Some(updater) = updater {
        builder = builder.plugin(updater);
    }
    let app = builder
        .plugin(tauri_nspanel::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .macos_launcher(MacosLauncher::LaunchAgent)
                // The LaunchAgent is named for the app's identifier, as `launchctl list` then shows it.
                .app_name(identifier)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        // The artwork lives on the hub behind the sign-in; the webview asks this scheme, Rust holds the token.
        .register_asynchronous_uri_scheme_protocol(art::SCHEME, |context, request, responder| {
            let app = context.app_handle().clone();
            thread::spawn(move || {
                let credentials = || app.try_state::<Arc<Core>>()?.hub_credentials();
                responder.respond(art::respond(&request, credentials));
            });
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::sign_in,
            commands::sign_out,
            commands::adopt,
            commands::decline_folder,
            commands::track_folder,
            commands::commit,
            commands::set_draft,
            commands::set_setting,
            commands::open_web,
            commands::hide_panel,
            commands::set_picking_folder,
            commands::resize_panel,
            commands::install_script,
            commands::quit,
            commands::install_cli,
            commands::request_screen_recording,
            commands::allow_media,
            commands::cancel_restore,
            commands::propose_track,
            commands::accept_render,
            commands::reject_render,
            commands::restore,
            commands::validate_branch_name,
            commands::forget_rejection,
            commands::forget_never_here,
            commands::install_update,
            commands::open_backfill,
            commands::get_backfill,
            commands::backfill_roots,
            commands::backfill_choose,
            commands::backfill_check,
            commands::backfill_set_target,
            commands::backfill_set_project,
            commands::backfill_back,
            commands::backfill_start,
            commands::backfill_pause,
            commands::backfill_resume,
            commands::backfill_retry,
            commands::backfill_close,
        ])
        .setup(move |app| {
            app.set_activation_policy(ActivationPolicy::Accessory);
            let handle = app.handle().clone();
            let (core, signals) = Core::new(handle.clone(), paths);
            app.manage(core.clone());
            panel::build(&handle)?;
            tray::build(&handle)?;
            core.emit_from(signals);
            // With the plugins in: the shortcut, the machine's facts, the notification's action, the wake observer.
            core.start_machine();
            if let Err(error) = notify::init(&handle) {
                eprintln!("dit: notifications can't report their actions: {error}");
            }
            wake::observe(&handle);
            if has_updater {
                let updates = update::Updates::new(handle.clone(), core.clone());
                app.manage(updates.clone());
                updates.watch();
            }
            // A link that opened the app is read first; the listener catches the ones that come while it runs. All
            // wait in the core for the daemon's launch catch-up.
            let links = app.deep_link();
            for url in links.get_current().ok().flatten().unwrap_or_default() {
                core.link(url.as_str());
            }
            links.on_open_url({
                let core = core.clone();
                move |event| {
                    for url in event.urls() {
                        core.link(url.as_str());
                    }
                }
            });
            if let Some(server) = server {
                core.serve(server.serve(Arc::new(Answering {
                    core: core.clone(),
                    app: handle.clone(),
                })));
            }
            // The Keychain may ask, and the daemon's first look at the repos takes a while: neither holds the bar.
            thread::spawn({
                let core = core.clone();
                move || core.launch()
            });
            // A plain `kill` ends the app as quitting does, so the socket and the port file are removed.
            let mut signals = Signals::new([SIGTERM, SIGINT])?;
            thread::spawn(move || {
                if signals.forever().next().is_some() {
                    handle.exit(0);
                }
            });
            Ok(())
        })
        .build(context)
        .expect("dit could not start its window system");

    app.run(|app, event| match event {
        // The panel closing is not the app ending; only an exit someone asked for is.
        RunEvent::ExitRequested {
            code: None, api, ..
        } => api.prevent_exit(),
        RunEvent::Exit => {
            if let Some(core) = app.try_state::<Arc<Core>>() {
                core.shutdown();
            }
        }
        _ => {}
    });
}
