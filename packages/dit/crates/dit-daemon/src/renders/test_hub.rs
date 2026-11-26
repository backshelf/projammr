//! A scripted hub of one session for the tests of everything that adds a render to it.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use dit_core::remote::Remote;
use dit_core::remote::test_support::{MockServer, Reply, remote_to};
use serde_json::json;

/// What a scripted hub has been asked and what it holds.
#[derive(Default)]
pub struct Hub {
    /// Fingerprint to asset id: what the hub already holds.
    pub assets: BTreeMap<String, i64>,
    pub lookups: usize,
    pub uploads: usize,
    pub accepts: usize,
    /// The hub's session has no track to render into.
    pub no_track: bool,
    /// Fail the next request whose path ends with this, with this status.
    pub fail: Option<(&'static str, u16)>,
}

/// A hub of one session (5, in project 3, with track "Canopy") and three saves, at 1 s, 4 s and 9 s.
pub fn hub() -> (MockServer, Arc<Mutex<Hub>>, Remote) {
    let state = Arc::new(Mutex::new(Hub::default()));
    let shared = state.clone();
    let server = MockServer::route(move |request| {
        let mut hub = shared.lock().unwrap();
        let path = request.path_only().to_string();
        if let Some((_, status)) = hub.fail.filter(|(suffix, _)| path.ends_with(suffix)) {
            hub.fail = None;
            return Reply::json(status, r#"{"error":"The hub is busy"}"#);
        }
        match (request.method.as_str(), path.as_str()) {
            ("GET", "/api/sessions/5") => Reply::json(
                200,
                r#"{"id":5,"projectId":3,"track":{"id":9,"title":"Canopy"}}"#,
            ),
            ("GET", "/api/sessions/5/commits") => Reply::json(
                200,
                r#"[{"saves":[{"id":30,"fileUpdatedAt":"1970-01-01T00:00:01.000Z"},{"id":31,"fileUpdatedAt":"1970-01-01T00:00:04.000Z"}]},{"saves":[{"id":32,"fileUpdatedAt":"1970-01-01T00:00:09.000Z"}]}]"#,
            ),
            ("POST", "/api/assets/lookup") => {
                hub.lookups += 1;
                let print = request.json()["fingerprints"][0]
                    .as_str()
                    .unwrap()
                    .to_string();
                match hub.assets.get(&print) {
                    Some(id) => Reply::json(
                        200,
                        json!([{"fingerprint": print, "assetId": id, "name": "x.wav", "sessionIds": []}])
                            .to_string(),
                    ),
                    None => Reply::json(200, "[]"),
                }
            }
            ("POST", "/api/assets/upload") => {
                hub.uploads += 1;
                let text = String::from_utf8_lossy(&request.body).into_owned();
                let from = text.find("name=\"fingerprint\"\r\n\r\n").unwrap() + 23;
                let print = text[from..].split("\r\n").next().unwrap().to_string();
                let id = 77 + hub.assets.len() as i64;
                hub.assets.insert(print, id);
                Reply::json(201, json!({"id": id}).to_string())
            }
            ("POST", "/api/sessions/5/renders") => {
                hub.accepts += 1;
                if hub.no_track {
                    Reply::json(
                        409,
                        r#"{"error":"The session has no track to render into","code":"session_has_no_track"}"#,
                    )
                } else {
                    Reply::json(201, r#"{"trackId":9,"attached":true}"#)
                }
            }
            other => panic!("unexpected request {other:?}"),
        }
    });
    let remote = remote_to(&server);
    (server, state, remote)
}
