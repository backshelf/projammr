//! The `dit-art` scheme: the panel's artwork, which lives on the hub behind the sign-in. The webview asks
//! `dit-art://localhost/static/<asset path>?w=<width>`; Rust fetches `<instance>/static/<asset path>` with the bearer
//! token, which never reaches the webview, and answers with the image. Nothing is cached here, and every failure is
//! a bare 404.

use std::sync::{Arc, LazyLock};
use std::time::Duration;

use tauri::http::{Request, Response};

/// The scheme's name; the panel's CSP lists it in `img-src`.
pub const SCHEME: &str = "dit-art";

/// The largest artwork answer taken, in bytes.
const MAX_BYTES: u64 = 8 * 1024 * 1024;

const TIMEOUT: Duration = Duration::from_secs(20);

/// The widths and encodings the hub serves are small numbers and short names, so the query may carry only these.
const MAX_WIDTH_DIGITS: usize = 5;
const MAX_FORMAT_LEN: usize = 8;

/// The path and query to ask the hub for, or `None` when the request is not for hub artwork: only under `/static/`,
/// with no `.` or `..` segment (however it is percent-encoded), no backslash, no empty segment and no control
/// character, and a query of only `w` (digits) and `format` (letters).
pub fn hub_target(path: &str, query: Option<&str>) -> Option<String> {
    let rest = path.strip_prefix("/static/")?;
    let decoded = percent_decode(rest)?;
    if decoded.is_empty()
        || decoded.chars().any(|c| c == '\\' || c.is_control())
        || decoded
            .split('/')
            .any(|segment| matches!(segment, "" | "." | ".."))
    {
        return None;
    }
    let mut target = format!("/static/{rest}");
    if let Some(query) = query.filter(|query| !query.is_empty()) {
        let mut pairs = Vec::new();
        for pair in query.split('&') {
            let (key, value) = pair.split_once('=')?;
            let fine = match key {
                "w" => {
                    !value.is_empty()
                        && value.len() <= MAX_WIDTH_DIGITS
                        && value.bytes().all(|b| b.is_ascii_digit())
                }
                "format" => {
                    !value.is_empty()
                        && value.len() <= MAX_FORMAT_LEN
                        && value.bytes().all(|b| b.is_ascii_alphabetic())
                }
                _ => false,
            };
            if !fine {
                return None;
            }
            pairs.push(pair);
        }
        target.push('?');
        target.push_str(&pairs.join("&"));
    }
    Some(target)
}

/// `text` with its `%XX` escapes resolved; `None` for a bad escape or bytes that are not UTF-8.
fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' {
            let pair = text.get(at + 1..at + 3)?;
            out.push(u8::from_str_radix(pair, 16).ok()?);
            at += 3;
        } else {
            out.push(bytes[at]);
            at += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// One connection pool for every artwork request. It trusts what the cli's client trusts: the system's certificate
/// store alone.
static AGENT: LazyLock<ureq::Agent> = LazyLock::new(|| {
    let tls = ureq::tls::TlsConfig::builder()
        .provider(ureq::tls::TlsProvider::Rustls)
        .root_certs(ureq::tls::RootCerts::PlatformVerifier)
        .unversioned_rustls_crypto_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .build();
    ureq::Agent::config_builder()
        .tls_config(tls)
        .http_status_as_error(false)
        // A redirect would replay the request without the token.
        .max_redirects(0)
        .timeout_global(Some(TIMEOUT))
        .build()
        .new_agent()
});

/// The image the hub holds at `target` (from [`hub_target`]) and its content type, fetched with `token`.
fn fetch(origin: &str, token: &str, target: &str) -> Option<(Vec<u8>, String)> {
    let mut response = AGENT
        .get(format!("{origin}{target}"))
        .header("Authorization", format!("Bearer {token}"))
        .call()
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let kind = response
        .headers()
        .get("content-type")?
        .to_str()
        .ok()?
        .to_string();
    if !kind.starts_with("image/") {
        return None;
    }
    let body = response
        .body_mut()
        .with_config()
        .limit(MAX_BYTES)
        .read_to_vec()
        .ok()?;
    Some((body, kind))
}

fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(404)
        .body(Vec::new())
        .expect("a bare 404 is a valid response")
}

/// Answers one request of the scheme. `credentials` gives the instance's origin and the token, when signed in.
pub fn respond(
    request: &Request<Vec<u8>>,
    credentials: impl FnOnce() -> Option<(String, String)>,
) -> Response<Vec<u8>> {
    let uri = request.uri();
    let Some(target) = hub_target(uri.path(), uri.query()) else {
        return not_found();
    };
    let Some((origin, token)) = credentials() else {
        return not_found();
    };
    match fetch(&origin, &token, &target) {
        Some((body, kind)) => Response::builder()
            .status(200)
            .header("Content-Type", kind)
            .header("Cache-Control", "no-store")
            // The panel reads the artwork's pixels for its accent, which a canvas allows only from a response that
            // says any origin may.
            .header("Access-Control-Allow-Origin", "*")
            .body(body)
            .unwrap_or_else(|_| not_found()),
        None => not_found(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_static_path_is_forwarded_as_it_came() {
        assert_eq!(
            hub_target("/static/ab/cd/cover.png", None).as_deref(),
            Some("/static/ab/cd/cover.png")
        );
        assert_eq!(
            hub_target("/static/a%20b/cover.png", Some("w=256")).as_deref(),
            Some("/static/a%20b/cover.png?w=256")
        );
        assert_eq!(
            hub_target("/static/x.png", Some("w=64&format=webp")).as_deref(),
            Some("/static/x.png?w=64&format=webp")
        );
        assert_eq!(
            hub_target("/static/x.png", Some("")).as_deref(),
            Some("/static/x.png")
        );
    }

    #[test]
    fn only_static_is_served() {
        for path in [
            "/",
            "/static",
            "/static/",
            "/api/projects",
            "/api/../static/x.png",
            "/Static/x.png",
            "static/x.png",
            "/other/static/x.png",
        ] {
            assert_eq!(hub_target(path, None), None, "{path}");
        }
    }

    #[test]
    fn no_way_of_writing_dotdot_gets_through() {
        for path in [
            "/static/../api/me",
            "/static/a/../../api/me",
            "/static/a/..",
            "/static/%2e%2e/api/me",
            "/static/%2E%2E/api/me",
            "/static/a/%2e%2e%2fapi",
            "/static/./x.png",
            "/static/a/%2e/x.png",
            "/static/a%2f..%2fb",
            "/static/a\\..\\b",
            "/static/a%5c..%5cb",
        ] {
            assert_eq!(hub_target(path, None), None, "{path}");
        }
    }

    #[test]
    fn empty_segments_bad_escapes_and_control_characters_are_refused() {
        for path in [
            "/static//x.png",
            "/static/a//x.png",
            "/static/a/",
            "/static/%zz",
            "/static/%4",
            "/static/a%00b",
            "/static/a%0ab",
            "/static/%ff",
        ] {
            assert_eq!(hub_target(path, None), None, "{path}");
        }
    }

    #[test]
    fn the_query_may_carry_only_a_width_and_a_format() {
        for query in [
            "token=abc",
            "w=",
            "w=abc",
            "w=-1",
            "w=1234567",
            "format=we/bp",
            "format=",
            "format=webpwebpweb",
            "w=64&x=1",
            "w",
            "w=64&",
        ] {
            assert_eq!(hub_target("/static/x.png", Some(query)), None, "{query}");
        }
    }

    #[test]
    fn a_refused_request_is_a_bare_404_without_asking_for_a_token() {
        let request = Request::builder()
            .uri("dit-art://localhost/static/../api/me")
            .body(Vec::new())
            .unwrap();
        let response = respond(&request, || {
            panic!("the token is never read for a refused path")
        });
        assert_eq!(response.status(), 404);
        assert!(response.body().is_empty());
    }

    #[test]
    fn signed_out_is_a_bare_404() {
        let request = Request::builder()
            .uri("dit-art://localhost/static/x.png")
            .body(Vec::new())
            .unwrap();
        let response = respond(&request, || None);
        assert_eq!(response.status(), 404);
        assert!(response.body().is_empty());
    }

    #[test]
    fn an_unreachable_hub_is_a_bare_404() {
        let request = Request::builder()
            .uri("dit-art://localhost/static/x.png")
            .body(Vec::new())
            .unwrap();
        // Nothing listens on port 1.
        let response = respond(&request, || {
            Some(("http://127.0.0.1:1".to_string(), "secret".to_string()))
        });
        assert_eq!(response.status(), 404);
        assert!(response.body().is_empty());
    }
}
