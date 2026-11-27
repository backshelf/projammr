"""The dit script's wire: newline-delimited JSON to the dit app over loopback TCP.

Everything here is pure (no Live, no sockets opened) so `python3 -m unittest` covers it. Python 3.9 compatible.
"""

import json

try:
    from . import tracks
except ImportError:  # run as a top-level module by the tests
    import tracks

SCRIPT_VERSION = "2"
MAX_LINE = 1 << 20
MAX_OUTBOX = 4 << 20


def parse_port_file(text):
    """`<port>\\n<nonce>` as the app writes it; ValueError when it is anything else."""
    lines = text.split("\n")
    if len(lines) < 2:
        raise ValueError("port file needs a port and a nonce")
    port = int(lines[0].strip())
    nonce = lines[1].strip()
    if not 0 < port < 65536 or not nonce:
        raise ValueError("port file is not valid")
    return port, nonce


def encode(message):
    return (json.dumps(message, separators=(",", ":")) + "\n").encode("utf-8")


def hello(nonce, live):
    return {"type": "hello", "nonce": nonce, "live": live, "script": SCRIPT_VERSION}


class Backoff(object):
    """1 s, 2 s, 4 s, then 5 s between attempts to reach the app; `reset` after a connection."""

    DELAYS = (1.0, 2.0, 4.0, 5.0)

    def __init__(self):
        self._failures = 0

    def next(self):
        delay = self.DELAYS[min(self._failures, len(self.DELAYS) - 1)]
        self._failures += 1
        return delay

    def reset(self):
        self._failures = 0


class Outbox(object):
    """Bytes waiting for a non-blocking socket. `flush` never blocks: what the socket will not take stays queued."""

    def __init__(self):
        self._chunks = []
        self._size = 0
        self.overflowed = False

    def push(self, data):
        if self._size + len(data) > MAX_OUTBOX:
            # The app is not reading: drop everything; the caller sends the whole state again once it is.
            self._chunks = []
            self._size = 0
            self.overflowed = True
            return
        self._chunks.append(data)
        self._size += len(data)

    def pending(self):
        return self._size

    def flush(self, send):
        """`send(data)` returns how many bytes it took, or raises BlockingIOError for none."""
        while self._chunks:
            chunk = self._chunks[0]
            try:
                sent = send(chunk)
            except (BlockingIOError, InterruptedError):
                return
            self._size -= sent
            if sent < len(chunk):
                self._chunks[0] = chunk[sent:]
                return
            self._chunks.pop(0)


class Inbox(object):
    """Splits what the app sends into lines. A line past MAX_LINE is ValueError: the connection is dropped."""

    def __init__(self):
        self._buffer = b""

    def feed(self, data):
        self._buffer += data
        lines = self._buffer.split(b"\n")
        self._buffer = lines.pop()
        if len(self._buffer) > MAX_LINE or any(len(line) > MAX_LINE for line in lines):
            raise ValueError("line too long")
        return [line for line in lines if line]


def _optional(song, name):
    try:
        return getattr(song, name)
    except AttributeError:
        return None


class Reporter(object):
    """Compares the song with what was last said and answers with the messages that differ.

    Live has no listener for `file_path`, so the caller polls; every field is read the same way, which keeps
    the script to one cheap pass a tick. `poll(song, now_ms, with_tracks=False)` skips the track walk.
    """

    def __init__(self):
        self.reset()

    def reset(self):
        """Forget what was said, so the next poll says everything again (a new connection)."""
        self._document = False
        self._tracks = None
        self._song = None
        self._transport = None

    def closed(self):
        return {"type": "closed"}

    def poll(self, song, now_ms, with_tracks=True):
        messages = []
        path = str(_optional(song, "file_path") or "") or None
        if path != self._document:
            self._document = path
            messages.append({"type": "document", "path": path, "at": now_ms})
        if with_tracks:
            described = tracks.describe_tracks(song)
            if described != self._tracks:
                self._tracks = described
                messages.append({"type": "tracks", "tracks": described})
        state = {
            "type": "song",
            "tempo": float(_optional(song, "tempo") or 0.0),
            "rootNote": _optional(song, "root_note"),
            "scaleName": _optional(song, "scale_name"),
            "signature": [
                int(_optional(song, "signature_numerator") or 4),
                int(_optional(song, "signature_denominator") or 4),
            ],
        }
        if state != self._song:
            self._song = state
            messages.append(state)
        transport = {
            "type": "transport",
            "playing": bool(_optional(song, "is_playing")),
            "recording": bool(_optional(song, "record_mode")),
        }
        if transport != self._transport:
            self._transport = transport
            messages.append(transport)
        return messages
