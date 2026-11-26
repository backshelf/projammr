use std::time::Duration;

use serde_json::{Value, json};

use super::machines::hub_name;
use super::test_support::*;
use super::*;

const MIB: usize = 1024 * 1024;

fn config_path() -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("dit").join("config.toml");
    (dir, path)
}

fn studio() -> Machine {
    Machine {
        id: "0123456789abcdef0123456789abcdef".to_string(),
        name: "Studio iMac".to_string(),
        platform: "macOS".to_string(),
        app_version: "0.4.0".to_string(),
    }
}

fn view(open_session_id: Value) -> String {
    json!({
        "id": "0123456789abcdef0123456789abcdef",
        "name": "Studio iMac",
        "platform": "macOS",
        "appVersion": "0.4.0",
        "lastSeenAt": "2026-10-21T09:00:00.000Z",
        "online": true,
        "openSessionId": open_session_id,
    })
    .to_string()
}

#[test]
fn machine_id_is_made_once_and_stays_the_same() {
    let (_dir, path) = config_path();

    let first = machine_id_at(&path).unwrap();
    let second = machine_id_at(&path).unwrap();

    assert_eq!(first, second);
    assert_eq!(first.len(), 32);
    assert!(
        first
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    );
    assert_eq!(
        UserConfig::load(&path).unwrap().machine_id.as_deref(),
        Some(first.as_str())
    );
}

#[test]
fn machine_id_keeps_the_rest_of_the_config() {
    let (_dir, path) = config_path();
    UserConfig {
        instance: Some(Instance::parse("https://projammr.example.com").unwrap()),
        machine: Some("Studio iMac".to_string()),
        ..Default::default()
    }
    .save(&path)
    .unwrap();

    let id = machine_id_at(&path).unwrap();

    let config = UserConfig::load(&path).unwrap();
    assert_eq!(config.machine_id, Some(id));
    assert_eq!(config.machine.as_deref(), Some("Studio iMac"));
    assert_eq!(
        config.instance,
        Some(Instance::parse("https://projammr.example.com").unwrap())
    );
}

#[test]
fn machine_id_keeps_a_valid_stored_id() {
    let (_dir, path) = config_path();
    let stored = "Studio_iMac-0123456789".to_string();
    UserConfig {
        machine_id: Some(stored.clone()),
        ..Default::default()
    }
    .save(&path)
    .unwrap();

    assert_eq!(machine_id_at(&path).unwrap(), stored);
}

#[test]
fn machine_id_replaces_a_malformed_stored_id() {
    for bad in [
        "short".to_string(),
        "has spaces in it, sixteen+".to_string(),
        "x".repeat(65),
        String::new(),
    ] {
        let (_dir, path) = config_path();
        UserConfig {
            machine_id: Some(bad.clone()),
            ..Default::default()
        }
        .save(&path)
        .unwrap();

        let id = machine_id_at(&path).unwrap();

        assert_ne!(id, bad);
        assert_eq!(id.len(), 32);
        assert_eq!(machine_id_at(&path).unwrap(), id);
    }
}

#[test]
fn a_forgotten_machine_id_is_made_anew_and_the_rest_of_the_config_stays() {
    let (_dir, path) = config_path();
    UserConfig {
        machine: Some("Studio iMac".to_string()),
        ..Default::default()
    }
    .save(&path)
    .unwrap();
    let first = machine_id_at(&path).unwrap();

    forget_machine_id(&path).unwrap();

    assert_eq!(UserConfig::load(&path).unwrap().machine_id, None);
    assert_eq!(
        UserConfig::load(&path).unwrap().machine.as_deref(),
        Some("Studio iMac")
    );
    assert_ne!(machine_id_at(&path).unwrap(), first);
}

#[test]
fn beat_puts_the_machine_and_what_it_has_open() {
    let server = MockServer::start(vec![(200, view(json!(12)))]);
    let remote = remote_to(&server);
    let presence = Presence {
        open_session_id: Some(12),
        repo_ids: vec![3, 4],
    };

    let answer = beat(&remote, &studio(), &presence).unwrap();

    assert_eq!(
        answer,
        MachineView {
            id: studio().id,
            name: "Studio iMac".to_string(),
            online: true,
            open_session_id: Some(12),
        }
    );
    let requests = server.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].method, "PUT");
    assert_eq!(
        requests[0].path,
        "/api/machines/0123456789abcdef0123456789abcdef"
    );
    assert_eq!(
        requests[0].header("authorization"),
        Some(format!("Bearer {TOKEN}").as_str())
    );
    assert_eq!(requests[0].header("content-type"), Some("application/json"));
    assert_eq!(
        requests[0].json(),
        json!({
            "name": "Studio iMac",
            "platform": "macOS",
            "appVersion": "0.4.0",
            "openSessionId": 12,
            "repoIds": [3, 4],
        })
    );
}

#[test]
fn register_beats_with_nothing_open_and_no_repos() {
    let server = MockServer::start(vec![(200, view(Value::Null))]);

    let answer = register(&remote_to(&server), &studio()).unwrap();

    assert_eq!(answer.open_session_id, None);
    assert_eq!(
        server.requests()[0].json(),
        json!({
            "name": "Studio iMac",
            "platform": "macOS",
            "appVersion": "0.4.0",
            "openSessionId": null,
            "repoIds": [],
        })
    );
}

#[test]
fn the_hubs_name_is_trimmed_and_cut_to_64_utf16_units_on_whole_characters() {
    assert_eq!(hub_name("  Studio iMac \n"), "Studio iMac");
    assert_eq!(hub_name(&"m".repeat(70)), "m".repeat(64));
    assert_eq!(hub_name(&"m".repeat(64)), "m".repeat(64));
    // 33 characters of two units each is 66 units: 32 whole characters fit.
    assert_eq!(hub_name(&"𝄞".repeat(33)), "𝄞".repeat(32));
    // A pair that would end on unit 65 is left out whole, so the cut is one unit short.
    let odd = format!("a{}", "𝄞".repeat(33));
    assert_eq!(hub_name(&odd), format!("a{}", "𝄞".repeat(31)));
    assert_eq!(hub_name(&"é".repeat(70)), "é".repeat(64));
    assert_eq!(hub_name("   "), "");
}

#[test]
fn a_beat_sends_the_name_as_the_hub_stores_it() {
    let server = MockServer::start(vec![(200, view(Value::Null))]);
    let machine = Machine {
        name: format!("  {}  ", "𝄞".repeat(33)),
        ..studio()
    };

    register(&remote_to(&server), &machine).unwrap();

    assert_eq!(server.requests()[0].json()["name"], json!("𝄞".repeat(32)));
}

#[test]
fn a_taken_name_is_a_409_with_its_code() {
    let server = MockServer::start(vec![(
        409,
        json!({ "error": "That name is taken", "code": NAME_TAKEN_CODE }).to_string(),
    )]);

    let error = register(&remote_to(&server), &studio()).unwrap_err();

    assert!(matches!(
        &error,
        RemoteError::Refused { status: 409, code: Some(code), .. } if code == NAME_TAKEN_CODE
    ));
}

#[test]
fn a_refused_token_on_a_beat_is_signed_out() {
    let server = MockServer::start(vec![(401, json!({ "error": "Unauthorized" }).to_string())]);

    let error = beat(&remote_to(&server), &studio(), &Presence::default()).unwrap_err();

    assert!(matches!(error, RemoteError::SignedOut { .. }));
}

#[test]
fn remove_deletes_the_machine_with_the_token_and_no_body() {
    let server = MockServer::start_replies(vec![Reply::bytes(204, Vec::new())]);

    remove_machine(&remote_to(&server), &studio().id).unwrap();

    let requests = server.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].method, "DELETE");
    assert_eq!(
        requests[0].path,
        "/api/machines/0123456789abcdef0123456789abcdef"
    );
    assert_eq!(
        requests[0].header("authorization"),
        Some(format!("Bearer {TOKEN}").as_str())
    );
    assert!(requests[0].body.is_empty());
}

#[test]
fn remove_reports_a_machine_the_instance_refuses_and_a_token_it_does_not_know() {
    let server = MockServer::start(vec![
        (404, json!({ "error": "No such machine" }).to_string()),
        (401, json!({ "error": "Unauthorized" }).to_string()),
    ]);
    let remote = remote_to(&server);

    assert!(matches!(
        remove_machine(&remote, &studio().id).unwrap_err(),
        RemoteError::Refused { status: 404, .. }
    ));
    assert!(matches!(
        remove_machine(&remote, &studio().id).unwrap_err(),
        RemoteError::SignedOut { .. }
    ));
}

#[test]
fn platform_names_the_operating_system() {
    assert!(!platform().is_empty());
    if cfg!(target_os = "macos") {
        assert_eq!(platform(), "macOS");
    }
}

#[test]
fn get_bytes_reads_a_body_past_ureqs_default_limit() {
    let body: Vec<u8> = (0..11 * MIB).map(|at| (at % 251) as u8).collect();
    let server = MockServer::start_replies(vec![Reply::bytes(200, body.clone())]);

    let bytes = remote_to(&server).get_bytes("/blob", 20 * MIB).unwrap();

    assert_eq!(bytes.len(), body.len());
    assert!(bytes == body);
    let requests = server.requests();
    assert_eq!(requests[0].method, "GET");
    assert_eq!(requests[0].path, "/api/blob");
    assert_eq!(
        requests[0].header("authorization"),
        Some(format!("Bearer {TOKEN}").as_str())
    );
}

#[test]
fn get_bytes_reads_a_body_of_exactly_the_limit() {
    let server = MockServer::start_replies(vec![Reply::bytes(200, vec![7; 1000])]);

    let bytes = remote_to(&server).get_bytes("/blob", 1000).unwrap();

    assert_eq!(bytes, vec![7; 1000]);
}

#[test]
fn get_bytes_refuses_a_body_over_the_limit() {
    let server = MockServer::start_replies(vec![Reply::bytes(200, vec![0; 11 * MIB])]);

    let error = remote_to(&server).get_bytes("/blob", MIB).unwrap_err();

    assert!(matches!(
        &error,
        RemoteError::Unexpected { detail, .. } if detail == &format!("an answer over the {MIB}-byte limit")
    ));
}

#[test]
fn get_bytes_refuses_a_body_one_byte_over_the_limit() {
    let server = MockServer::start_replies(vec![Reply::bytes(200, vec![0; 1001])]);

    let error = remote_to(&server).get_bytes("/blob", 1000).unwrap_err();

    assert!(matches!(error, RemoteError::Unexpected { .. }));
}

#[test]
fn get_bytes_maps_a_json_refusal_to_refused() {
    let server = MockServer::start(vec![(
        404,
        json!({ "error": "No such blob", "code": "not_found" }).to_string(),
    )]);

    let error = remote_to(&server).get_bytes("/blob", MIB).unwrap_err();

    assert!(matches!(
        &error,
        RemoteError::Refused { status: 404, code: Some(code), message, .. }
            if code == "not_found" && message == "No such blob"
    ));
}

#[test]
fn get_bytes_maps_a_401_to_signed_out() {
    let server = MockServer::start(vec![(401, json!({ "error": "Unauthorized" }).to_string())]);

    let error = remote_to(&server).get_bytes("/blob", MIB).unwrap_err();

    assert!(matches!(error, RemoteError::SignedOut { .. }));
}

#[test]
fn get_bytes_reports_a_redirect() {
    let server = MockServer::start_with(vec![(
        302,
        Some("https://elsewhere.example/api/blob".to_string()),
        String::new(),
    )]);

    let error = remote_to(&server).get_bytes("/blob", MIB).unwrap_err();

    assert!(matches!(error, RemoteError::Redirected { .. }));
}

#[test]
fn a_byte_reply_with_a_header_reaches_the_client_whole() {
    let body = vec![0, 159, 146, 150, 255, 0, 10, 13];
    let server = MockServer::start_replies(vec![
        Reply::bytes(200, body.clone()).with_header("X-Example", "2"),
    ]);

    let response = remote_to(&server)
        .client()
        .get_with("/pack", None, Duration::from_secs(10))
        .unwrap();

    assert_eq!(
        response
            .headers()
            .get("x-example")
            .and_then(|value| value.to_str().ok()),
        Some("2")
    );
    assert_eq!(
        response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("application/octet-stream")
    );
    let mut response = response;
    assert_eq!(response.body_mut().read_to_vec().unwrap(), body);
    assert_eq!(server.requests()[0].header("authorization"), None);
}

#[test]
fn route_answers_each_path_with_its_own_reply() {
    let server = MockServer::route(|request| match request.path_only() {
        "/api/one" => Reply::json(200, json!({ "n": 1 }).to_string()),
        "/api/two" => Reply::bytes(200, vec![2, 2]),
        _ => Reply::json(404, json!({ "error": "No such path" }).to_string()),
    });
    let remote = remote_to(&server);

    let two = remote.get_bytes("/two?since=5", 16).unwrap();
    let one: Value = remote.get("/one").unwrap();
    let again: Value = remote.get("/one").unwrap();
    let missing = remote.get::<Value>("/three").unwrap_err();

    assert_eq!(two, vec![2, 2]);
    assert_eq!(one, json!({ "n": 1 }));
    assert_eq!(again, one);
    assert!(matches!(missing, RemoteError::Refused { status: 404, .. }));
    assert!(server.wait_for(4, Duration::from_secs(5)));
    assert!(!server.wait_for(5, Duration::from_millis(50)));
    assert_eq!(server.requests()[0].path, "/api/two?since=5");
    assert_eq!(server.requests()[0].path_only(), "/api/two");
}

fn not_registered() -> Reply {
    Reply::json(
        409,
        json!({ "error": "This machine is not registered", "code": NOT_REGISTERED_CODE })
            .to_string(),
    )
}

#[test]
fn every_kind_of_request_names_the_machine_by_its_id() {
    let server = MockServer::route(|request| match request.method.as_str() {
        // A delete's answer has no body.
        "DELETE" => Reply::json(200, ""),
        _ => Reply::json(200, "{}"),
    });
    let remote = remote_as(&server, &studio().id);
    let timeout = Duration::from_secs(5);

    let _: Value = remote.get("/a").unwrap();
    remote.delete("/b").unwrap();
    let _: Value = remote.post("/c", &json!({})).unwrap();
    let _: Value = remote.patch("/d", &json!({})).unwrap();
    let _: Value = remote.put("/e", &json!({})).unwrap();
    let _: Value = remote.post_bytes("/f", b"x", timeout).unwrap();
    let _: Value = remote
        .post_stream("/g", "application/octet-stream", 1, &mut &b"x"[..])
        .unwrap();
    remote.get_bytes("/h", 16).unwrap();
    remote.post_for_bytes("/i", &json!({}), 16).unwrap();

    let requests = server.requests();
    assert_eq!(requests.len(), 9);
    for request in requests.iter() {
        assert_eq!(
            request.header("X-Machine-Id"),
            Some(studio().id.as_str()),
            "{} {}",
            request.method,
            request.path
        );
        assert_eq!(request.header("X-Device-Name"), Some("Studio iMac"));
    }
}

#[test]
fn a_machine_with_no_id_sends_no_header() {
    let server = MockServer::start(vec![(200, "{}".to_string())]);

    let _: Value = remote_to(&server).get("/a").unwrap();

    assert_eq!(server.requests()[0].header("X-Machine-Id"), None);
}

#[test]
fn an_unregistered_machine_registers_and_the_request_goes_again() {
    let id = studio().id;
    let register_path = format!("/api/machines/{id}");
    let mut answered = false;
    let server = MockServer::route(move |request| match request.method.as_str() {
        "PUT" => Reply::json(200, view(Value::Null)),
        _ if !answered => {
            answered = true;
            not_registered()
        }
        _ => Reply::json(200, json!({ "ok": true }).to_string()),
    });
    let remote = remote_as(&server, &id);

    let answer: Value = remote
        .post("/repos/3/sets", &json!({ "ditSetId": "a" }))
        .unwrap();

    assert_eq!(answer, json!({ "ok": true }));
    let requests = server.requests();
    let seen: Vec<_> = requests
        .iter()
        .map(|request| (request.method.as_str(), request.path.as_str()))
        .collect();
    assert_eq!(
        seen,
        [
            ("POST", "/api/repos/3/sets"),
            ("PUT", register_path.as_str()),
            ("POST", "/api/repos/3/sets"),
        ]
    );
    assert_eq!(requests[1].json()["name"], json!("Studio iMac"));
    assert_eq!(requests[1].json()["platform"], json!(platform()));
    assert_eq!(requests[2].json(), json!({ "ditSetId": "a" }));
    assert_eq!(requests[2].header("X-Machine-Id"), Some(id.as_str()));
}

#[test]
fn a_request_refused_again_after_registering_is_not_sent_a_third_time() {
    let server = MockServer::route(|request| match request.method.as_str() {
        "PUT" => Reply::json(200, view(Value::Null)),
        _ => not_registered(),
    });
    let remote = remote_as(&server, &studio().id);

    let error = remote.get::<Value>("/a").unwrap_err();

    assert!(matches!(
        &error,
        RemoteError::Refused { status: 409, code: Some(code), .. } if code == NOT_REGISTERED_CODE
    ));
    assert_eq!(server.requests().len(), 3);
}

#[test]
fn a_beat_the_instance_calls_unregistered_is_not_answered_with_another_beat() {
    let server = MockServer::route(|_| not_registered());
    let remote = remote_as(&server, &studio().id);

    let error = beat(&remote, &studio(), &Presence::default()).unwrap_err();

    assert!(matches!(error, RemoteError::Refused { status: 409, .. }));
    assert_eq!(server.requests().len(), 1);
}

#[test]
fn other_409s_are_not_retried_and_a_machine_with_no_id_has_nothing_to_register() {
    let taken = MockServer::route(|_| {
        Reply::json(
            409,
            json!({ "error": "Taken", "code": "setTaken" }).to_string(),
        )
    });
    let _ = remote_as(&taken, &studio().id)
        .get::<Value>("/a")
        .unwrap_err();
    assert_eq!(taken.requests().len(), 1);

    let anonymous = MockServer::route(|_| not_registered());
    let error = remote_to(&anonymous).get::<Value>("/a").unwrap_err();
    assert!(matches!(error, RemoteError::Refused { status: 409, .. }));
    assert_eq!(anonymous.requests().len(), 1);
}

#[test]
fn a_name_taken_on_the_registration_is_what_the_request_fails_with() {
    let server = MockServer::route(|request| match request.method.as_str() {
        "PUT" => Reply::json(
            409,
            json!({ "error": "That name is taken", "code": NAME_TAKEN_CODE }).to_string(),
        ),
        _ => not_registered(),
    });

    let error = remote_as(&server, &studio().id)
        .get::<Value>("/a")
        .unwrap_err();

    assert!(matches!(
        &error,
        RemoteError::Refused { status: 409, code: Some(code), .. } if code == NAME_TAKEN_CODE
    ));
    assert_eq!(server.requests().len(), 2);
}
