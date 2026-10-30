import io
import unittest
from unittest.mock import patch
from PIL import Image
from bridge import Rig
from test_bridge import SerialLink


class MonoTests(unittest.TestCase):
    def setUp(self):
        image = io.BytesIO()
        Image.new('RGB', (32, 24), 'gray').save(image, format='JPEG')
        self.frame = image.getvalue()
        self.photo = b'PHOTO_BEGIN %d\n' % len(self.frame) + self.frame + b'PHOTO_END\n'
        self.rig = Rig('COM13', timeout=.03)
        self.rig.identities = ('c0b62c0d5020', 'c443180d5020')

    def link(self, error='PEER_OFFLINE', photo=None):
        return SerialLink({b'stereo-snap\n': b'PAIR_ERROR ' + error.encode() + b'\n',
                           b'camera-photo\n': self.photo if photo is None else photo})

    def test_unavailable_peer_uses_a_fresh_primary_photo_with_honest_status(self):
        for error in ('PEER_OFFLINE', 'PEER_ID_OR_SENSOR'):
            link = self.link(error)
            with patch.object(self.rig, 'connection', return_value=link):
                record = self.rig.capture(allow_mono=True)
                self.assertEqual(record['frames'], [self.frame])
                self.assertEqual(record['size'], (32, 24))
                self.assertEqual(record['fallback_reason'], 'PAIR_ERROR ' + error)
                self.assertIsNone(record['timing'])
                self.assertTrue(self.rig.status()['camera_ready'])
                self.assertIsNone(self.rig.status()['peer'])
                self.assertFalse(self.rig.status(1)['camera_ready'])
                self.assertFalse(self.rig.status(1)['stream_ready'])
                self.assertEqual(link.commands, [b'stereo-snap\n', b'camera-photo\n'])

    def test_strict_stereo_call_does_not_reuse_cached_mono(self):
        link = self.link()
        with patch.object(self.rig, 'connection', return_value=link):
            self.rig.capture(allow_mono=True)
            with self.assertRaisesRegex(RuntimeError, 'PEER_OFFLINE'):
                self.rig.capture(float('inf'))
        self.assertEqual(link.commands, [b'stereo-snap\n', b'camera-photo\n', b'stereo-snap\n'])

    def test_busy_transport_and_capture_failures_are_not_hidden(self):
        for error in ('BUSY', 'SERIAL', 'CAPTURE', 'RESOLUTION', 'PEER_HEADERS'):
            link = self.link(error)
            with patch.object(self.rig, 'connection', return_value=link):
                with self.assertRaisesRegex(RuntimeError, error):
                    self.rig.capture(allow_mono=True)
            self.assertEqual(link.commands, [b'stereo-snap\n'])
            self.assertIsNone(self.rig.current)

    def test_invalid_primary_image_preserves_the_previous_capture(self):
        link = self.link()
        with patch.object(self.rig, 'connection', return_value=link):
            previous = self.rig.capture(allow_mono=True)
        broken = self.link(photo=b'PHOTO_BEGIN 4\n\xff\xd8\xff\xd9PHOTO_END\n')
        with patch.object(self.rig, 'connection', return_value=broken):
            with self.assertRaises(OSError):
                self.rig.capture(allow_mono=True)
        self.assertIs(self.rig.current, previous)

    def test_next_capture_restores_stereo_when_peer_returns(self):
        link = self.link()
        with patch.object(self.rig, 'connection', return_value=link):
            self.rig.capture(allow_mono=True)
            link.responses[b'stereo-snap\n'] = b'PAIR_BEGIN %d %d\n' % (len(self.frame), len(self.frame)) + self.frame * 2 + b'PAIR_END\n'
            record = self.rig.capture(allow_mono=True)
            self.assertEqual(len(record['frames']), 2)
            self.assertIsNone(record['fallback_reason'])
            self.assertTrue(self.rig.status(1)['camera_ready'])
            self.assertEqual(self.rig.status()['peer']['camera_id'], self.rig.identities[1])


if __name__ == '__main__':
    unittest.main()
