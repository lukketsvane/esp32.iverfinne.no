import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FQBN = 'esp32:esp32:esp32cam:PartitionScheme=huge_app'
DEFAULT_HEADER = ROOT / 'test-results/rig-pairing.h'


def compile_flags(role, header=None, usb=True):
    if role not in ('primary', 'secondary'):
        raise ValueError('Ukjend rolle')
    parts = []
    if header:
        path = Path(header).resolve().as_posix()
        if ' ' in path:
            raise ValueError('Stien til riggheaderen kan ikkje innehalde mellomrom')
        parts.append('-include' + path)
    parts.append('-DENTROPI_SECONDARY_CAMERA=1' if role == 'secondary' else '-DENTROPI_USB_STEREO_TEST=1' if usb else '')
    return ' '.join(part for part in parts if part)


def compile_command(cli, role, flags):
    command = [str(cli), 'compile', '--fqbn', FQBN, '--build-path', str(ROOT / 'device/build' / role)]
    if flags:
        command += ['--build-property', 'compiler.cpp.extra_flags=' + flags]
    return command + [str(ROOT / 'device/EntropiCamera')]


def find_cli():
    found = shutil.which('arduino-cli') or next((str(path) for path in [Path('C:/Program Files/Arduino CLI/arduino-cli.exe')] if path.exists()), None)
    if not found:
        raise FileNotFoundError('Fann ikkje arduino-cli; oppgi han med --cli')
    return found


def build(role, header=None, usb=True, allow_unpaired=False, cli=None, run=subprocess.run):
    if not header and not allow_unpaired:
        raise ValueError('Riggheaderen manglar; eit kamera utan han parar seg ikkje. Bruk --rig-header eller --allow-unpaired.')
    flags = compile_flags(role, header, usb)
    for command in ([sys.executable, str(ROOT / 'device/build-ui.py')], compile_command(cli or find_cli(), role, flags)):
        if run(command, cwd=ROOT).returncode:
            raise RuntimeError('Bygginga feila: ' + ' '.join(command[:2]))
    image = ROOT / 'device/build' / role / 'EntropiCamera.ino.bin'
    info = (ROOT / 'device/EntropiCamera/build_info.h').read_text(encoding='utf-8')
    version = re.search(r'ENTROPI_FIRMWARE_VERSION "([^"]*)"', info)
    return {'role': role, 'image': str(image), 'bytes': image.stat().st_size, 'paired': bool(header),
            'usb_commands': role == 'primary' and usb, 'firmware': version.group(1) if version else 'unknown'}


def main():
    parser = argparse.ArgumentParser(description='Bygg firmware for eitt ENTROPI-kamera.')
    parser.add_argument('--role', choices=('primary', 'secondary'), required=True)
    parser.add_argument('--rig-header', type=Path, default=DEFAULT_HEADER if DEFAULT_HEADER.exists() else None)
    parser.add_argument('--no-usb', action='store_true', help='bygg primærkameraet utan USB-kommandoane for brua')
    parser.add_argument('--allow-unpaired', action='store_true')
    parser.add_argument('--cli')
    args = parser.parse_args()
    print(json.dumps(build(args.role, args.rig_header, not args.no_usb, args.allow_unpaired, args.cli), indent=2))


if __name__ == '__main__':
    main()
