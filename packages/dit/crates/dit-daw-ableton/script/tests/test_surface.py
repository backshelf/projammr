import importlib
import json
import os
import sys
import tempfile
import types
import unittest

SCRIPT_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
if SCRIPT_ROOT not in sys.path:
    sys.path.insert(0, SCRIPT_ROOT)

from test_protocol import song, track  # noqa: E402


def _make_v2_base():
    """Matches ableton.v2.control_surface.ControlSurface: `song` is a property and `log_message` is absent."""

    class ControlSurface(object):
        def __init__(self, c_instance):
            self._c_instance = c_instance
            self.scheduled = []

        @property
        def song(self):
            return self._c_instance.song()

        def schedule_message(self, ticks, callback):
            self.scheduled.append((ticks, callback))

        def disconnect(self):
            pass

    return ControlSurface


def _make_framework_base():
    """Matches legacy _Framework.ControlSurface: `song()` is a method and `log_message` lives on the surface."""

    class ControlSurface(object):
        def __init__(self, c_instance):
            self._c_instance = c_instance
            self.scheduled = []

        def song(self):
            return self._c_instance.song()

        def log_message(self, message):
            self._c_instance.log_message(message)

        def schedule_message(self, ticks, callback):
            self.scheduled.append((ticks, callback))

        def disconnect(self):
            pass

    return ControlSurface


class _CInstance(object):
    def __init__(self, live_song):
        self._song = live_song
        self.logs = []

    def song(self):
        return self._song

    def log_message(self, message):
        self.logs.append(message)


class _FakeSocket(object):
    def __init__(self):
        self.connected_to = None
        self.sent = bytearray()
        self.closed = False

    def setblocking(self, flag):
        pass

    def connect_ex(self, addr):
        self.connected_to = addr
        return 0

    def getsockopt(self, level, optname):
        return 0

    def send(self, data):
        self.sent.extend(data)
        return len(data)

    def recv(self, size):
        raise BlockingIOError()

    def close(self):
        self.closed = True


def _load_dit_with(module_path, base_cls):
    """Imports `dit` with only `module_path` providing `ControlSurface`, restoring `sys.modules` on cleanup."""
    saved = {}
    prefixes = ("ableton", "_Framework", "dit")
    for key in list(sys.modules):
        if key == "dit" or key.startswith(("dit.", "ableton.", "_Framework.")) or key in prefixes:
            saved[key] = sys.modules.pop(key)

    parts = module_path.split(".")
    for index in range(1, len(parts) + 1):
        name = ".".join(parts[:index])
        mod = types.ModuleType(name)
        sys.modules[name] = mod
        if index > 1:
            setattr(sys.modules[".".join(parts[: index - 1])], parts[index - 1], mod)
    sys.modules[module_path].ControlSurface = base_cls

    dit_mod = importlib.import_module("dit")

    def restore():
        for key in list(sys.modules):
            if key == "dit" or key.startswith(("dit.", "ableton.", "_Framework.")) or key in prefixes:
                sys.modules.pop(key, None)
        sys.modules.update(saved)

    return dit_mod, restore


def _pump(surface, count):
    for _ in range(count):
        assert surface.scheduled, "tick loop stopped rescheduling"
        _, callback = surface.scheduled.pop(0)
        callback()


class SurfaceCompatibility(unittest.TestCase):
    def _run_connected_poll(self, module_path, base_cls):
        dit_mod, restore = _load_dit_with(module_path, base_cls)
        self.addCleanup(restore)

        sockets = []

        def make_socket(*_args, **_kwargs):
            sock = _FakeSocket()
            sockets.append(sock)
            return sock

        def fake_select(readable, writable, _exceptional, _timeout):
            return ([], list(writable), [])

        orig_socket = dit_mod.socket.socket
        orig_select = dit_mod.select.select
        dit_mod.socket.socket = make_socket
        dit_mod.select.select = fake_select
        self.addCleanup(setattr, dit_mod.socket, "socket", orig_socket)
        self.addCleanup(setattr, dit_mod.select, "select", orig_select)

        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        port_file = os.path.join(tmp.name, "port")
        with open(port_file, "w") as handle:
            handle.write("54321\nabcdef0123456789\n")

        dit_mod.PORT_FILE = port_file
        live_song = song(file_path="/p/Song Project/Song.als", tracks=[track("Kick")])
        c_instance = _CInstance(live_song)
        surface = dit_mod.create_instance(c_instance)
        self.addCleanup(surface.disconnect)

        # Tick 1 begins the connect; tick 2 finishes it and queues hello; tick 3 polls the song and flushes.
        _pump(surface, 3)

        self.assertEqual(len(sockets), 1)
        self.assertEqual(sockets[0].connected_to, ("127.0.0.1", 54321))
        messages = [json.loads(line.decode("utf-8")) for line in bytes(sockets[0].sent).splitlines() if line]
        self.assertEqual([m["type"] for m in messages[:4]], ["hello", "document", "song", "transport"])
        self.assertEqual(messages[0]["nonce"], "abcdef0123456789")
        self.assertEqual(messages[1]["path"], "/p/Song Project/Song.als")
        self.assertTrue(surface.scheduled, "tick loop stayed alive after polling")
        self.assertEqual(c_instance.logs, [])

    def test_connects_and_polls_under_ableton_v2_where_song_is_a_property(self):
        self._run_connected_poll("ableton.v2.control_surface", _make_v2_base())

    def test_connects_and_polls_under_legacy_framework_where_song_is_a_method(self):
        self._run_connected_poll("_Framework.ControlSurface", _make_framework_base())

    def test_step_error_under_ableton_v2_logs_via_c_instance_and_keeps_ticking(self):
        dit_mod, restore = _load_dit_with("ableton.v2.control_surface", _make_v2_base())
        self.addCleanup(restore)

        c_instance = _CInstance(song())
        surface = dit_mod.create_instance(c_instance)
        self.addCleanup(surface.disconnect)

        def boom():
            raise RuntimeError("boom")

        surface._step = boom
        _pump(surface, 1)

        self.assertTrue(surface.scheduled, "tick loop must reschedule after an error")
        self.assertEqual(c_instance.logs, ["dit: boom"])


if __name__ == "__main__":
    unittest.main()
