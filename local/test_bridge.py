import io
import json
import itertools
import types
import unittest
from unittest.mock import Mock, patch
from PIL import Image
from bridge import Rig


class Link:
    def __init__(self, data):
        self.buffer = io.BytesIO(data)

    def read(self, length):
        return self.buffer.read(min(length, 37))


class SerialLink(Link):
    def __init__(self, responses):
        super().__init__(b'')
        self.responses = responses
        self.commands = []
        self.rates = []
        self.baudrate = 460800

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def reset_input_buffer(self):
        self.buffer = io.BytesIO()

    def write(self, command):
        self.commands.append(command)
        self.rates.append(self.baudrate)
        self.buffer = io.BytesIO(self.responses.get((self.baudrate, command), self.responses.get(command, b'')))


class PairTests(unittest.TestCase):
    def setUp(self):
        self.frames = []
        for color in ('red', 'blue'):
            data = io.BytesIO()
            Image.new('RGB', (32, 24), color).save(data, format='JPEG')
            self.frames.append(data.getvalue())
        self.payload = ('noise\nPAIR_BEGIN %d %d\n' % tuple(map(len, self.frames))).encode() + b''.join(self.frames) + b'PAIR_END\n'

    def test_chunked_pair(self):
        frames, dimensions = Rig.read_pair(Link(self.payload), 1)
        self.assertEqual(frames, self.frames)
        self.assertEqual(dimensions, (32, 24))

    def test_pair_metadata_keeps_separate_clocks(self):
        timing = {'id': 'a' * 32, 'left_camera_id': 'c0b62c0d5020', 'right_camera_id': 'c443180d5020', 'coordinator_camera_id': 'c0b62c0d5020', 'hardware_synchronized': False}
        timing.update({key: index * 100 for index, key in enumerate(('left_capture_us', 'right_capture_us', 'left_capture_duration_us', 'right_capture_duration_us', 'peer_requested_us', 'peer_headers_received_us', 'peer_request_started_us', 'peer_response_ready_us'))})
        metadata = {}
        frames, dimensions = Rig.read_pair(Link(b'PAIR_META ' + json.dumps(timing).encode() + b'\n' + self.payload), 1, metadata)
        self.assertEqual(metadata, timing)
        self.assertEqual(frames, self.frames)
        self.assertEqual(dimensions, (32, 24))

    def test_invalid_pair_metadata_cannot_commit_frames(self):
        with self.assertRaises(ValueError):
            Rig.read_pair(Link(b'PAIR_META {}\n' + self.payload), 1, {})

    def test_truncated_frame(self):
        with self.assertRaises(ValueError):
            Rig.read_pair(Link(self.payload[:200]), .01)

    def test_bad_trailer(self):
        with self.assertRaises(ValueError):
            Rig.read_pair(Link(self.payload[:-9] + b'BAD_END!!'), 1)

    def test_peer_failure(self):
        with self.assertRaisesRegex(RuntimeError, 'PEER_OFFLINE'):
            Rig.read_pair(Link(b'PAIR_ERROR PEER_OFFLINE\n'), 1)

    def test_excessive_length(self):
        with self.assertRaises(ValueError):
            Rig.read_pair(Link(b'PAIR_BEGIN 999999999 10\n'), 1)

    def test_secondary_role_rejected_before_capture(self):
        rig = Rig('COM15')
        link = SerialLink({b'rig-check\n': b'Rig: own=c443180d5020 expected_peer=c0b62c0d5020 configured=1 primary=0 peer=http://192.168.4.1\n'})
        with patch.object(rig, 'connection', return_value=link):
            with self.assertRaisesRegex(RuntimeError, 'COM15.*sekund.*c0b62c0d5020.*--serial'):
                rig.capture()
        self.assertEqual(link.commands, [b'rig-check\n'])
        self.assertEqual(link.rates, [460800])
        self.assertIsNone(rig.baudrate)
        self.assertIsNone(rig.identities)
        self.assertIsNone(rig.current)

    def test_fresh_capture_identifies_primary_without_nested_lock(self):
        rig = Rig('COM13')
        link = SerialLink({
            b'rig-check\n': b'Rig: own=c0b62c0d5020 expected_peer=c443180d5020 configured=1 primary=1 peer=http://192.168.4.2\n',
            b'stereo-snap\n': self.payload,
        })
        with patch.object(rig, 'connection', return_value=link):
            record = rig.capture()
        self.assertEqual(link.commands, [b'rig-check\n', b'stereo-snap\n'])
        self.assertEqual(rig.identities, ('c0b62c0d5020', 'c443180d5020'))
        self.assertEqual(rig.baudrate, 460800)
        self.assertEqual(link.rates, [460800, 460800])
        self.assertEqual(record['frames'], self.frames)

    def test_primary_identification_without_connected_peer(self):
        rig = Rig('COM13')
        link = SerialLink({b'rig-check\n': b'Rig: own=c0b62c0d5020 expected_peer=c443180d5020 configured=1 primary=1 peer= udp=1\n'})
        with patch.object(rig, 'connection', return_value=link):
            self.assertEqual(rig.identify(), ('c0b62c0d5020', 'c443180d5020'))

    def test_legacy_fallback_caches_baudrate_for_reopened_capture(self):
        rig = Rig('COM13')
        identity = b'Rig: own=c0b62c0d5020 expected_peer=c443180d5020 configured=1 primary=1 peer= udp=1\n'
        link = SerialLink({(115200, b'rig-check\n'): identity})
        with patch('bridge.time.monotonic', side_effect=itertools.count(0, .25)):
            self.assertEqual(rig.identify_link(link), ('c0b62c0d5020', 'c443180d5020'))
        self.assertEqual(link.rates, [460800, 115200])
        self.assertEqual(rig.baudrate, 115200)
        reopened = SerialLink({b'stereo-snap\n': self.payload})
        opened = []
        reopened.open = lambda: opened.append((reopened.baudrate, reopened.port, reopened.dtr, reopened.rts))
        def connection(**settings):
            reopened.baudrate = settings['baudrate']
            return reopened
        with patch.dict('sys.modules', {'serial': types.SimpleNamespace(Serial=connection)}):
            record = rig.capture()
        self.assertEqual(opened, [(115200, 'COM13', False, False)])
        self.assertEqual(reopened.commands, [b'stereo-snap\n'])
        self.assertEqual(reopened.rates, [115200])
        self.assertEqual(record['frames'], self.frames)

    def test_legacy_secondary_rejected_without_capture_or_caching_baudrate(self):
        rig = Rig('COM15')
        link = SerialLink({(115200, b'rig-check\n'): b'Rig: own=c443180d5020 expected_peer=c0b62c0d5020 configured=1 primary=0 peer= udp=1\n'})
        with patch.object(rig, 'connection', return_value=link), patch('bridge.time.monotonic', side_effect=itertools.count(0, .25)):
            with self.assertRaisesRegex(RuntimeError, 'sekundærkameraet'):
                rig.capture()
        self.assertEqual(link.commands, [b'rig-check\n', b'rig-check\n'])
        self.assertEqual(link.rates, [460800, 115200])
        self.assertIsNone(rig.baudrate)
        self.assertIsNone(rig.current)

    def test_no_identity_probes_both_rates_and_never_captures(self):
        rig = Rig('COM13')
        link = SerialLink({})
        with patch.object(rig, 'connection', return_value=link), patch('bridge.time.monotonic', side_effect=itertools.count(0, .25)) as clock:
            with self.assertRaisesRegex(RuntimeError, 'Ingen stadfesta kameraparing'):
                rig.capture()
        self.assertEqual(link.commands, [b'rig-check\n', b'rig-check\n'])
        self.assertEqual(link.rates, [460800, 115200])
        self.assertGreaterEqual(clock.call_count * .25, 10)
        self.assertIsNone(rig.baudrate)
        self.assertIsNone(rig.identities)

    def test_serial_io_error_does_not_trigger_baud_fallback(self):
        rig = Rig('COM13')
        link = SerialLink({})
        link.read = Mock(side_effect=OSError('USB disconnected'))
        with self.assertRaisesRegex(OSError, 'USB disconnected'):
            rig.identify_link(link)
        self.assertEqual(link.rates, [460800])
        self.assertIsNone(rig.baudrate)


if __name__ == '__main__':
    unittest.main()
