import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import build


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.header = Path(tempfile.mkdtemp()) / 'rig-pairing.h'
        self.header.write_text('#define ENTROPI_RIG_KEY "x"\n')

    def test_each_role_gets_the_rig_header_and_its_own_define(self):
        path = self.header.resolve().as_posix()
        self.assertEqual(build.compile_flags('primary', self.header), f'-include{path} -DENTROPI_USB_STEREO_TEST=1')
        self.assertEqual(build.compile_flags('primary', self.header, usb=False), f'-include{path}')
        self.assertEqual(build.compile_flags('secondary', self.header), f'-include{path} -DENTROPI_SECONDARY_CAMERA=1')
        self.assertEqual(build.compile_flags('secondary', self.header, usb=False), f'-include{path} -DENTROPI_SECONDARY_CAMERA=1')
        with self.assertRaises(ValueError):
            build.compile_flags('third', self.header)

    def test_a_header_path_with_spaces_is_refused(self):
        spaced = Path(tempfile.mkdtemp()) / 'rig pairing.h'
        spaced.write_text('')
        with self.assertRaisesRegex(ValueError, 'mellomrom'):
            build.compile_flags('primary', spaced)

    def test_the_compile_command_targets_one_build_folder_per_role(self):
        command = build.compile_command('arduino-cli', 'secondary', '-DENTROPI_SECONDARY_CAMERA=1')
        self.assertEqual(command[:5], ['arduino-cli', 'compile', '--fqbn', build.FQBN, '--build-path'])
        self.assertTrue(command[5].replace('\\', '/').endswith('device/build/secondary'))
        self.assertEqual(command[6:8], ['--build-property', 'compiler.cpp.extra_flags=-DENTROPI_SECONDARY_CAMERA=1'])
        self.assertTrue(command[-1].replace('\\', '/').endswith('device/EntropiCamera'))

    def test_an_unpaired_build_needs_an_explicit_choice(self):
        calls = []
        with self.assertRaisesRegex(ValueError, 'Riggheaderen manglar'):
            build.build('secondary', None, run=lambda command, **kwargs: calls.append(command))
        self.assertEqual(calls, [])

    def test_the_ui_is_generated_before_compiling_and_a_failure_stops_the_build(self):
        calls = []
        def run(command, **kwargs):
            calls.append(command)
            return subprocess.CompletedProcess(command, 1 if 'compile' in command else 0)
        with self.assertRaisesRegex(RuntimeError, 'Bygginga feila'):
            build.build('primary', self.header, cli='arduino-cli', run=run)
        self.assertTrue(calls[0][-1].replace('\\', '/').endswith('device/build-ui.py'))
        self.assertIn('compile', calls[1])


if __name__ == '__main__':
    unittest.main()
