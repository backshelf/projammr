"""dit's control surface: tells the dit app which set Live has open.

Enable it once in Live > Settings > Link, Tempo & MIDI > Control Surface > dit. It only ever connects out to the
dit app on 127.0.0.1, reads Live's object model and writes nothing to the set. Everything runs from a scheduled
tick on Live's own thread, so nothing here may block: sockets are non-blocking and every tick returns at once.
"""

import errno
import os
import select
import socket
import time

try:
    from ableton.v2.control_surface import ControlSurface
except ImportError:  # older Live
    from _Framework.ControlSurface import ControlSurface

from . import protocol

# Live's scheduler counts in ticks of about 100 ms.
TICK = 1
TRACK_EVERY = 10
PORT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "port")


def create_instance(c_instance):
    return DitSurface(c_instance)


def _live_version():
    try:
        import Live

        app = Live.Application.get_application()
        return "%d.%d.%d" % (app.get_major_version(), app.get_minor_version(), app.get_bugfix_version())
    except Exception:
        return "unknown"


class DitSurface(ControlSurface):
    def __init__(self, c_instance):
        super(DitSurface, self).__init__(c_instance)
        self._sock = None
        self._connected = False
        self._backoff = protocol.Backoff()
        self._retry_at = 0.0
        self._outbox = protocol.Outbox()
        self._inbox = protocol.Inbox()
        self._reporter = protocol.Reporter()
        self._ticks = 0
        self._alive = True
        self.schedule_message(TICK, self._tick)

    def disconnect(self):
        self._alive = False
        if self._connected:
            self._outbox.push(protocol.encode(self._reporter.closed()))
            self._send_pending()
        self._drop()
        super(DitSurface, self).disconnect()

    # The tick: never raises, always reschedules, never waits.
    def _tick(self):
        if not self._alive:
            return
        try:
            self._step()
        except Exception as error:  # a broken tick must not take Live's thread with it
            self.log_message("dit: %s" % (error,))
            self._drop()
        if self._alive:
            self.schedule_message(TICK, self._tick)

    def _step(self):
        self._ticks += 1
        now = time.time()
        if self._sock is None:
            if now >= self._retry_at:
                self._begin_connect(now)
            return
        if not self._connected:
            self._finish_connect(now)
            return
        self._read()
        if self._sock is None:
            return
        messages = self._reporter.poll(
            self.song(), int(now * 1000), with_tracks=self._ticks % TRACK_EVERY == 0
        )
        for message in messages:
            self._outbox.push(protocol.encode(message))
        if self._outbox.overflowed:
            self._outbox.overflowed = False
            self._reporter.reset()
        self._send_pending()

    def _begin_connect(self, now):
        try:
            with open(PORT_FILE) as handle:
                port, nonce = protocol.parse_port_file(handle.read())
        except (OSError, ValueError):
            self._retry_at = now + self._backoff.next()
            return
        self._nonce = nonce
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setblocking(False)
        code = sock.connect_ex(("127.0.0.1", port))
        if code not in (0, errno.EINPROGRESS, errno.EWOULDBLOCK, errno.EAGAIN):
            sock.close()
            self._retry_at = now + self._backoff.next()
            return
        self._sock = sock

    def _finish_connect(self, now):
        _, writable, _ = select.select([], [self._sock], [], 0)
        if not writable:
            return
        if self._sock.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR) != 0:
            self._drop()
            self._retry_at = now + self._backoff.next()
            return
        self._connected = True
        self._backoff.reset()
        self._reporter.reset()
        self._outbox.push(protocol.encode(protocol.hello(self._nonce, _live_version())))

    def _read(self):
        readable, _, _ = select.select([self._sock], [], [], 0)
        if not readable:
            return
        try:
            data = self._sock.recv(65536)
        except (BlockingIOError, InterruptedError):
            return
        if not data:
            self._drop()
            return
        self._inbox.feed(data)  # the app's greeting is the only thing it says; nothing here acts on it

    def _send_pending(self):
        self._outbox.flush(self._sock.send)

    def _drop(self):
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
        self._sock = None
        self._connected = False
        self._inbox = protocol.Inbox()
        self._outbox = protocol.Outbox()
        self._retry_at = time.time() + self._backoff.next()
