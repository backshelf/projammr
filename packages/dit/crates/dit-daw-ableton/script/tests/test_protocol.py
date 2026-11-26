import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dit"))

import protocol  # noqa: E402
import tracks  # noqa: E402


class Obj(object):
    def __init__(self, **fields):
        self.__dict__.update(fields)


def device(name, cls="Eq8"):
    return Obj(name=name, class_name=cls)


def track(name, devices=(), **fields):
    base = dict(name=name, devices=list(devices), color_index=3, is_foldable=False, has_midi_input=False, group_track=None)
    base.update(fields)
    return Obj(**base)


def song(**fields):
    base = dict(
        tracks=[], return_tracks=[], master_track=track("Master"), file_path="", tempo=120.0,
        root_note=0, scale_name="Minor", signature_numerator=4, signature_denominator=4,
        is_playing=False, record_mode=False,
    )
    base.update(fields)
    return Obj(**base)


class PortFile(unittest.TestCase):
    def test_reads_port_and_nonce(self):
        self.assertEqual(protocol.parse_port_file("5123\nabc\n"), (5123, "abc"))

    def test_refuses_anything_else(self):
        for text in ["", "5123", "x\nabc", "0\nabc", "70000\nabc", "5123\n  \n"]:
            with self.assertRaises(ValueError, msg=text):
                protocol.parse_port_file(text)


class Wire(unittest.TestCase):
    def test_a_message_is_one_compact_json_line(self):
        data = protocol.encode({"type": "closed"})
        self.assertEqual(data, b'{"type":"closed"}\n')

    def test_hello_carries_the_nonce_the_live_version_and_the_script_version(self):
        self.assertEqual(
            protocol.hello("n", "12.4.6"),
            {"type": "hello", "nonce": "n", "live": "12.4.6", "script": protocol.SCRIPT_VERSION},
        )

    def test_backoff_runs_1_2_4_then_5_seconds_and_resets(self):
        backoff = protocol.Backoff()
        self.assertEqual([backoff.next() for _ in range(6)], [1.0, 2.0, 4.0, 5.0, 5.0, 5.0])
        backoff.reset()
        self.assertEqual(backoff.next(), 1.0)

    def test_inbox_splits_lines_across_reads_and_caps_a_line(self):
        inbox = protocol.Inbox()
        self.assertEqual(inbox.feed(b'{"a":1}\n{"b"'), [b'{"a":1}'])
        self.assertEqual(inbox.feed(b':2}\n'), [b'{"b":2}'])
        with self.assertRaises(ValueError):
            inbox.feed(b"x" * (protocol.MAX_LINE + 1))


class Outbox(unittest.TestCase):
    def test_flush_sends_what_the_socket_takes_and_keeps_the_rest_without_blocking(self):
        outbox = protocol.Outbox()
        outbox.push(b"abcdef")
        outbox.push(b"gh")
        sent = []

        def take_four(data):
            sent.append(data[:4])
            return min(4, len(data))

        outbox.flush(take_four)  # a short write ends the pass: the socket is full
        self.assertEqual(outbox.pending(), 4)
        outbox.flush(take_four)
        outbox.flush(take_four)
        self.assertEqual(outbox.pending(), 0)
        self.assertEqual(b"".join(sent), b"abcdefgh")

    def test_a_socket_that_would_block_leaves_everything_queued(self):
        outbox = protocol.Outbox()
        outbox.push(b"abc")

        def blocked(data):
            raise BlockingIOError()

        outbox.flush(blocked)
        self.assertEqual(outbox.pending(), 3)

    def test_an_app_that_never_reads_overflows_instead_of_growing_without_bound(self):
        outbox = protocol.Outbox()
        outbox.push(b"x" * (protocol.MAX_OUTBOX - 1))
        outbox.push(b"yy")
        self.assertTrue(outbox.overflowed)
        self.assertEqual(outbox.pending(), 0)


class Tracks(unittest.TestCase):
    def test_describes_tracks_returns_and_master_with_groups_and_device_kinds(self):
        group = track("Drums", is_foldable=True)
        kick = track("Kick", [device("EQ Eight"), device("Serum", "PluginDevice")], group_track=group)
        midi = track("Keys", [device("Wavetable")], has_midi_input=True)
        ret = track("Reverb A", [device("Reverb")])
        s = song(tracks=[group, kick, midi], return_tracks=[ret])

        described = tracks.describe_tracks(s)

        self.assertEqual([t["kind"] for t in described], ["group", "audio", "midi", "return", "master"])
        self.assertEqual([t["id"] for t in described], [0, 1, 2, 3, 4])
        self.assertEqual(described[1]["groupId"], 0)
        self.assertIsNone(described[0]["groupId"])
        self.assertEqual(
            described[1]["devices"],
            [{"name": "EQ Eight", "kind": "live"}, {"name": "Serum", "kind": "vst3"}],
        )
        self.assertEqual(described[0]["color"], 3)
        json.dumps(described)

    def test_device_kinds(self):
        for cls, kind in [("AuPluginDevice", "au"), ("MxDeviceInstrument", "m4l"), ("Compressor2", "live")]:
            self.assertEqual(tracks.device_kind(Obj(class_name=cls)), kind)


class Reporting(unittest.TestCase):
    def kinds(self, messages):
        return [m["type"] for m in messages]

    def test_the_first_poll_says_everything_and_a_quiet_poll_says_nothing(self):
        reporter = protocol.Reporter()
        s = song(file_path="/p/Song Project/Song.als", tracks=[track("A")])

        first = reporter.poll(s, 1000)

        self.assertEqual(self.kinds(first), ["document", "tracks", "song", "transport"])
        self.assertEqual(first[0], {"type": "document", "path": "/p/Song Project/Song.als", "at": 1000})
        self.assertEqual(reporter.poll(s, 2000), [])

    def test_an_unsaved_set_is_a_null_path_and_a_save_as_is_a_new_document(self):
        reporter = protocol.Reporter()
        s = song(file_path="")
        self.assertIsNone(reporter.poll(s, 1)[0]["path"])
        s.file_path = "/p/B.als"
        self.assertEqual(reporter.poll(s, 2), [{"type": "document", "path": "/p/B.als", "at": 2}])

    def test_transport_and_song_changes_are_reported_alone(self):
        reporter = protocol.Reporter()
        s = song()
        reporter.poll(s, 1)
        s.is_playing = True
        self.assertEqual(reporter.poll(s, 2, with_tracks=False), [{"type": "transport", "playing": True, "recording": False}])
        s.tempo = 124.0
        self.assertEqual(self.kinds(reporter.poll(s, 3, with_tracks=False)), ["song"])

    def test_tracks_are_skipped_when_not_asked_for_and_sent_when_they_change(self):
        reporter = protocol.Reporter()
        s = song(tracks=[track("A")])
        reporter.poll(s, 1)
        s.tracks = [track("A"), track("B")]
        self.assertEqual(reporter.poll(s, 2, with_tracks=False), [])
        self.assertEqual(self.kinds(reporter.poll(s, 3)), ["tracks"])

    def test_a_live_without_root_note_leaves_it_null(self):
        reporter = protocol.Reporter()
        s = song()
        del s.root_note
        del s.scale_name
        message = [m for m in reporter.poll(s, 1) if m["type"] == "song"][0]
        self.assertIsNone(message["rootNote"])
        self.assertIsNone(message["scaleName"])
        self.assertEqual(message["signature"], [4, 4])

    def test_reset_makes_the_next_poll_say_everything_again(self):
        reporter = protocol.Reporter()
        s = song()
        reporter.poll(s, 1)
        reporter.reset()
        self.assertEqual(self.kinds(reporter.poll(s, 2)), ["document", "tracks", "song", "transport"])


if __name__ == "__main__":
    unittest.main()
