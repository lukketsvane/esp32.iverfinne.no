import json
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path

from flash import APP_OFFSET, FLASH_SIZE, Flasher, mac_of


def partition_table(app_size):
    nvs = struct.pack('<HBBII16sI', 0x50aa, 1, 2, 0x9000, 0x5000, b'nvs', 0)
    app = struct.pack('<HBBII16sI', 0x50aa, 0, 0, APP_OFFSET, app_size, b'app0', 0)
    return nvs + app + b'\xff' * (0x1000 - 64)


class FakeBoard:
    def __init__(self, mac='20:50:0d:2c:b6:c0', app_size=0x300000, corrupt_first_write=False):
        self.flash = bytearray(b'\xff' * FLASH_SIZE)
        self.flash[0x8000:0x9000] = partition_table(app_size)
        self.flash[0x9000:0x9010] = b'saved settings!!'
        self.flash[APP_OFFSET:APP_OFFSET + 8] = b'\xe9old-app'
        self.mac, self.corrupt, self.calls = mac, corrupt_first_write, []

    def __call__(self, command, stdout, **kwargs):
        args = command[command.index('--after') + 2:]
        verb = args[0]
        self.calls.append(verb)
        if verb == 'read-mac':
            stdout.write('Chip is ESP32-D0WD-V3\nMAC: ' + self.mac + '\n')
        elif verb == 'read-flash':
            offset, size = int(args[1], 16), int(args[2], 16)
            Path(args[3]).write_bytes(bytes(self.flash[offset:offset + size]))
        elif verb == 'write-flash':
            offset, data = int(args[1], 16), Path(args[2]).read_bytes()
            if self.corrupt:
                self.corrupt, data = False, data[:-1] + b'\x00'
            self.flash[offset:offset + len(data)] = data
        elif verb == 'verify-flash':
            offset, data = int(args[1], 16), Path(args[2]).read_bytes()
            if bytes(self.flash[offset:offset + len(data)]) != data:
                stdout.write('Verification failed\n')
                return subprocess.CompletedProcess(command, 2)
        return subprocess.CompletedProcess(command, 0)


class FlashTests(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        self.image = self.folder / 'app.bin'
        self.image.write_bytes(b'\xe9' + bytes(range(256)) * 32)

    def flasher(self, board):
        return Flasher('esptool', 'COM13', self.folder / 'out', run=board)

    def test_camera_ids_map_to_the_mac_esptool_prints(self):
        self.assertEqual(mac_of('c0b62c0d5020'), '20:50:0d:2c:b6:c0')
        self.assertEqual(mac_of('c443180d5020'), '20:50:0d:18:43:c4')
        with self.assertRaises(ValueError):
            mac_of('COM13')

    def test_without_write_only_identity_and_backup_touch_the_board(self):
        board = FakeBoard()
        before = bytes(board.flash)
        record = self.flasher(board).flash(self.image, 'c0b62c0d5020')
        self.assertEqual(board.calls, ['read-mac', 'read-flash'])
        self.assertEqual(bytes(board.flash), before)
        self.assertFalse(record['written'])
        self.assertEqual((self.folder / 'out/before.bin').read_bytes(), before)

    def test_the_wrong_camera_is_refused_before_any_backup_or_write(self):
        board = FakeBoard(mac='20:50:0d:18:43:c4')
        with self.assertRaisesRegex(RuntimeError, 'COM13 er ikkje kameraet c0b62c0d5020'):
            self.flasher(board).flash(self.image, 'c0b62c0d5020', write=True)
        self.assertEqual(board.calls, ['read-mac'])

    def test_a_good_write_is_verified_read_back_and_keeps_settings(self):
        board = FakeBoard()
        settings = bytes(board.flash[0x8000:0xe000])
        record = self.flasher(board).flash(self.image, 'c0b62c0d5020', write=True)
        self.assertEqual(board.calls, ['read-mac', 'read-flash', 'write-flash', 'verify-flash', 'read-flash', 'read-flash'])
        data = self.image.read_bytes()
        self.assertEqual(bytes(board.flash[APP_OFFSET:APP_OFFSET + len(data)]), data)
        self.assertEqual(bytes(board.flash[0x8000:0xe000]), settings)
        self.assertTrue(record['written'] and record['readback_verified'] and record['settings_preserved'])
        self.assertTrue(json.loads((self.folder / 'out/verification.json').read_text())['written'])

    def test_a_failed_write_restores_the_previous_app(self):
        board = FakeBoard(corrupt_first_write=True)
        before = bytes(board.flash)
        with self.assertRaisesRegex(RuntimeError, 'skriven tilbake og kontrollert'):
            self.flasher(board).flash(self.image, 'c0b62c0d5020', write=True)
        self.assertEqual(board.calls[-2:], ['write-flash', 'verify-flash'])
        self.assertEqual(bytes(board.flash), before)

    def test_an_image_larger_than_the_app_partition_is_never_written(self):
        board = FakeBoard(app_size=0x1000)
        with self.assertRaisesRegex(ValueError, 'større enn app-partisjonen'):
            self.flasher(board).flash(self.image, 'c0b62c0d5020', write=True)
        self.assertNotIn('write-flash', board.calls)

    def test_a_file_that_is_not_an_esp32_image_is_rejected_without_touching_the_board(self):
        board = FakeBoard()
        self.image.write_bytes(b'PK\x03\x04' + b'\x00' * 400)
        with self.assertRaisesRegex(ValueError, 'ikkje eit ESP32-appbilete'):
            self.flasher(board).flash(self.image, 'c0b62c0d5020', write=True)
        self.assertEqual(board.calls, [])


if __name__ == '__main__':
    unittest.main()
