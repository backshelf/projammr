//! A scripted instance on a loopback port, and a signed-in connection to it, for the tests of everything that talks
//! to an instance.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;

use super::{Client, Instance, Remote, Token};

/// The session token `remote_to` holds.
pub const TOKEN: &str = "session-token-secret";

/// A request the mock server was sent.
pub struct Recorded {
    /// The request's method, as sent: `GET`, `PUT`, ...
    pub method: String,
    /// The request target: the path and any query.
    pub path: String,
    /// The request's headers, in the order and case they were sent in.
    pub headers: Vec<(String, String)>,
    /// The request's body; empty when it had none.
    pub body: Vec<u8>,
}

impl Recorded {
    /// The value of the header `name`, whatever the case it was sent in.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    /// The request's body as JSON; panics when it is not.
    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap()
    }

    /// The request's path without its query.
    pub fn path_only(&self) -> &str {
        self.path.split('?').next().unwrap_or(&self.path)
    }
}

/// What the mock server answers a request with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reply {
    /// The status code.
    pub status: u16,
    /// The `Location` header, for a redirect.
    pub location: Option<String>,
    /// The `Content-Type` header.
    pub content_type: String,
    /// The body, written as bytes as they are.
    pub body: Vec<u8>,
    /// Headers besides `Content-Type`, `Content-Length` and `Location`.
    pub headers: Vec<(String, String)>,
}

impl Reply {
    /// An answer of `status` whose body is the JSON `text`.
    pub fn json(status: u16, text: impl Into<String>) -> Self {
        Reply {
            status,
            location: None,
            content_type: "application/json".to_string(),
            body: text.into().into_bytes(),
            headers: Vec::new(),
        }
    }

    /// An answer of `status` whose body is `body`, as `application/octet-stream`.
    pub fn bytes(status: u16, body: Vec<u8>) -> Self {
        Reply {
            status,
            location: None,
            content_type: "application/octet-stream".to_string(),
            body,
            headers: Vec::new(),
        }
    }

    /// The same answer with the header `name: value` added.
    pub fn with_header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }
}

/// A scripted HTTP server on a loopback port: it answers the requests it is sent with `replies` in order, closing
/// each connection, and records every request. Once the replies run out the port closes.
pub struct MockServer {
    /// The server's origin, `http://127.0.0.1:<port>`.
    pub url: String,
    requests: Arc<Mutex<Vec<Recorded>>>,
}

impl MockServer {
    /// A server that answers with each of `replies` as JSON, in order.
    pub fn start(replies: Vec<(u16, String)>) -> Self {
        Self::start_replies(
            replies
                .into_iter()
                .map(|(status, body)| Reply::json(status, body))
                .collect(),
        )
    }

    /// Like `start`, with the `Location` header a reply may carry.
    pub fn start_with(
        replies: impl IntoIterator<Item = (u16, Option<String>, String)> + Send + 'static,
    ) -> Self {
        Self::start_replies(
            replies
                .into_iter()
                .map(|(status, location, body)| Reply {
                    location,
                    ..Reply::json(status, body)
                })
                .collect(),
        )
    }

    /// A server that answers with each of `replies` in order, writing their bodies as bytes.
    pub fn start_replies(replies: Vec<Reply>) -> Self {
        let (listener, url, requests) = bind();
        let recorded = Arc::clone(&requests);
        thread::spawn(move || {
            for reply in replies {
                let (mut stream, _) = listener.accept().unwrap();
                recorded.lock().unwrap().push(read_request(&stream));
                write_reply(&mut stream, &reply);
            }
        });
        MockServer { url, requests }
    }

    /// A server that answers every request with what `handler` makes of it, until the process ends. Connections are
    /// served one at a time and closed after each reply.
    pub fn route(mut handler: impl FnMut(&Recorded) -> Reply + Send + 'static) -> Self {
        let (listener, url, requests) = bind();
        let recorded = Arc::clone(&requests);
        thread::spawn(move || {
            for stream in listener.incoming() {
                let mut stream = stream.unwrap();
                let request = read_request(&stream);
                let reply = handler(&request);
                recorded.lock().unwrap().push(request);
                write_reply(&mut stream, &reply);
            }
        });
        MockServer { url, requests }
    }

    /// The server's `host:port`.
    pub fn host(&self) -> &str {
        self.url.strip_prefix("http://").unwrap()
    }

    /// Every request the server has been sent so far, in order.
    pub fn requests(&self) -> std::sync::MutexGuard<'_, Vec<Recorded>> {
        self.requests.lock().unwrap()
    }

    /// Whether the server has been sent `requests` requests within `within`, checking every 10 ms.
    pub fn wait_for(&self, requests: usize, within: Duration) -> bool {
        let deadline = Instant::now() + within;
        loop {
            if self.requests().len() >= requests {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
}

/// A loopback listener, its origin and the list its requests are recorded in.
fn bind() -> (TcpListener, String, Arc<Mutex<Vec<Recorded>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    (listener, url, Arc::new(Mutex::new(Vec::new())))
}

/// Writes `reply` and closes the connection. A client that hung up before the end of a long body is not an error.
fn write_reply(stream: &mut TcpStream, reply: &Reply) {
    let mut head = format!(
        "HTTP/1.1 {} Mock\r\nContent-Type: {}\r\n",
        reply.status, reply.content_type
    );
    if let Some(location) = &reply.location {
        head.push_str(&format!("Location: {location}\r\n"));
    }
    for (name, value) in &reply.headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str(&format!(
        "Content-Length: {}\r\nConnection: close\r\n\r\n",
        reply.body.len()
    ));
    let _ = stream
        .write_all(head.as_bytes())
        .and_then(|()| stream.write_all(&reply.body));
}

fn read_request(stream: &TcpStream) -> Recorded {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap().to_string();
    let path = parts.next().unwrap().to_string();
    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        let (key, value) = line.split_once(':').unwrap();
        headers.push((key.trim().to_string(), value.trim().to_string()));
    }
    let length = headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("content-length"))
        .map_or(0, |(_, value)| value.parse().unwrap());
    let mut body = vec![0; length];
    reader.read_exact(&mut body).unwrap();
    Recorded {
        method,
        path,
        headers,
        body,
    }
}

/// A connection to `server` as the machine "Studio iMac", holding `TOKEN`.
pub fn remote_to(server: &MockServer) -> Remote {
    let instance = Instance::parse(&server.url).unwrap();
    Remote::new(
        Client::new(instance, "Studio iMac".to_string()),
        Token::new(TOKEN.to_string()),
    )
}

/// Like [`remote_to`], sending `machine_id` with every request.
pub fn remote_as(server: &MockServer, machine_id: &str) -> Remote {
    let instance = Instance::parse(&server.url).unwrap();
    Remote::new(
        Client::new(instance, "Studio iMac".to_string())
            .with_machine_id(Some(machine_id.to_string())),
        Token::new(TOKEN.to_string()),
    )
}
