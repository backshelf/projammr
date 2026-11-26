//! The cli's side of the socket.

use std::io::{self, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::Duration;

use crate::IpcError;
use crate::protocol::{Body, Done, Frame, Op, Request, Run, VERSION};
use crate::wire::{MAX_ANSWER_BYTES, read_line, write_line};

/// How long [`Client::ping`] and [`Client::show_panel`] wait for the app to answer.
pub const OP_TIMEOUT: Duration = Duration::from_secs(3);

/// A connection to a running dit app. Requests run one at a time.
pub struct Client {
    reader: BufReader<UnixStream>,
    writer: UnixStream,
    next_id: u64,
    op_timeout: Duration,
}

impl Client {
    fn set_timeout(&self, timeout: Option<Duration>) -> Result<(), IpcError> {
        // The timeouts belong to the socket, which the reader and the writer share.
        let stream = self.reader.get_ref();
        stream
            .set_read_timeout(timeout)
            .and_then(|()| stream.set_write_timeout(timeout))
            .map_err(|e| IpcError::io("connect to the dit app", e))
    }

    /// `error`, or the timeout error a read or write that ran out of time is.
    fn timed_out(&self, error: IpcError) -> IpcError {
        match error {
            IpcError::Io { source, .. }
                if matches!(
                    source.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) =>
            {
                IpcError::io(
                    "ask the dit app",
                    io::Error::new(
                        io::ErrorKind::TimedOut,
                        format!("it did not answer within {:?}", self.op_timeout),
                    ),
                )
            }
            other => other,
        }
    }

    /// Connects to the socket at `path`. `None` when nothing listens there: no socket, a socket file a crashed
    /// app left behind, or a path too long for a socket, which no app could have bound. Any other failure is an
    /// error, never a reason to run without the app.
    pub fn connect(path: &Path) -> Result<Option<Client>, IpcError> {
        let stream = match UnixStream::connect(path) {
            Ok(stream) => stream,
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::NotFound
                        | io::ErrorKind::ConnectionRefused
                        | io::ErrorKind::InvalidInput
                ) =>
            {
                return Ok(None);
            }
            Err(error) => {
                return Err(IpcError::io(
                    format!("connect to the dit app at {}", path.display()),
                    error,
                ));
            }
        };
        let writer = stream
            .try_clone()
            .map_err(|e| IpcError::io("connect to the dit app", e))?;
        Ok(Some(Client {
            reader: BufReader::new(stream),
            writer,
            next_id: 1,
            op_timeout: OP_TIMEOUT,
        }))
    }

    /// Runs `run` in the app. What the command writes to stderr is written to `stderr` as it arrives; the rest is
    /// the returned [`Done`].
    pub fn run(&mut self, run: Run, stderr: &mut dyn Write) -> Result<Done, IpcError> {
        match self.request(Body::Run(run), stderr)? {
            Frame::Done { done, .. } => Ok(done),
            other => Err(unexpected(&other)),
        }
    }

    /// Succeeds when the app is there and speaks this protocol version. Gives up with a
    /// [`io::ErrorKind::TimedOut`] error when the app does not answer within the operation timeout.
    pub fn ping(&mut self) -> Result<(), IpcError> {
        self.op(Op::Ping)
    }

    /// Asks the app to show its panel. Gives up with a [`io::ErrorKind::TimedOut`] error when the app does not
    /// answer within the operation timeout.
    pub fn show_panel(&mut self) -> Result<(), IpcError> {
        self.op(Op::ShowPanel)
    }

    /// Sets how long [`Client::ping`] and [`Client::show_panel`] wait for the app, in place of
    /// [`OP_TIMEOUT`]. `run` is not bound by it. After a timeout the connection holds no usable answer: drop it.
    pub fn with_op_timeout(mut self, timeout: Duration) -> Client {
        self.op_timeout = timeout;
        self
    }

    /// An operation is a question the app answers at once, so a wedged app is told from a busy one by the silence.
    fn op(&mut self, op: Op) -> Result<(), IpcError> {
        let bound = self.set_timeout(Some(self.op_timeout));
        let answer = bound.and_then(|()| self.request(Body::Op { op }, &mut io::sink()));
        // A later `run` is unbounded again.
        let _ = self.set_timeout(None);
        match answer.map_err(|error| self.timed_out(error))? {
            Frame::Ok { ok: true, .. } => Ok(()),
            other => Err(unexpected(&other)),
        }
    }

    /// Sends `body` and returns the frame that ends it, passing stderr frames on.
    fn request(&mut self, body: Body, stderr: &mut dyn Write) -> Result<Frame, IpcError> {
        let id = self.next_id;
        self.next_id += 1;
        write_line(
            &mut self.writer,
            &Request {
                v: VERSION,
                id,
                body,
            },
        )
        .map_err(|e| IpcError::io("send to the dit app", e))?;
        loop {
            let frame: Frame =
                read_line(&mut self.reader, MAX_ANSWER_BYTES)?.ok_or(IpcError::Closed)?;
            if frame.id() != id {
                return Err(IpcError::Protocol(format!(
                    "an answer to request {} while waiting for {id}",
                    frame.id()
                )));
            }
            match frame {
                // A closed stderr must not strand the command: its result still matters.
                Frame::Stderr { text, .. } => {
                    let _ = stderr.write_all(text.as_bytes());
                    let _ = stderr.flush();
                }
                Frame::Error { error, .. } => return Err(IpcError::Refused(error)),
                end @ (Frame::Done { .. } | Frame::Ok { .. }) => return Ok(end),
            }
        }
    }
}

fn unexpected(frame: &Frame) -> IpcError {
    IpcError::Protocol(format!("{frame:?}"))
}
