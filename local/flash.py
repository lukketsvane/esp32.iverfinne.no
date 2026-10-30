import argparse
import hashlib
import json
import os
import re
import struct
import subprocess
from datetime import datetime, timezone
from pathlib import Path

FLASH_SIZE = 0x400000
TABLE_OFFSET = 0x8000
APP_OFFSET = 0x10000
PROTECTED = (0x8000, 0x6000)
CAMERAS = {'primary': 'c0b62c0d5020', 'secondary': 'c443180d5020'}


def mac_of(camera_id):
    # /status reports the efuse MAC as a little-endian integer; esptool prints it byte by byte.
    if not re.fullmatch('[0-9a-f]{12}', camera_id or ''):
        raise ValueError('Ugyldig kamera-ID')
    return ':'.join(camera_id[i:i + 2] for i in range(10, -1, -2))


def find_esptool():
    root = Path(os.environ.get('LOCALAPPDATA', '')) / 'Arduino15/packages/esp32/tools/esptool_py'
    found = sorted(root.glob('*/esptool.exe')) + sorted(root.glob('*/esptool'))
    if not found:
        raise FileNotFoundError('Fann ikkje esptool; oppgi han med --esptool')
    return found[-1]


def check_build(image, role, allow_unpaired=False):
    # arduino-cli writes the flags next to the image; a mismatch here would put the wrong role on the board.
    options = Path(image).with_name('build.options.json')
    if not options.exists():
        raise ValueError('Fann ikkje build.options.json ved biletet; bygg med local/build.py')
    built = json.loads(options.read_text(encoding='utf-8'))
    if built.get('fqbn') != 'esp32:esp32:esp32cam:PartitionScheme=huge_app':
        raise ValueError('Biletet er ikkje bygd for ESP32-CAM med huge_app')
    flags = re.search(r'compiler\.cpp\.extra_flags=([^,]*)', built.get('customBuildProperties', ''))
    flags = flags.group(1) if flags else ''
    if ('-DENTROPI_SECONDARY_CAMERA=1' in flags) != (role == 'secondary'):
        raise ValueError('Biletet er bygd for ' + ('kamera 2' if role == 'primary' else 'primærkameraet') + '; ingenting er skrive')
    if '-include' not in flags and not allow_unpaired:
        raise ValueError('Biletet manglar riggheaderen og vil ikkje para seg; bruk --allow-unpaired om det er meininga')
    return flags


def app_partition_size(table):
    for i in range(0, len(table) - 31, 32):
        magic, kind, _subtype, offset, size, _name, _flags = struct.unpack('<HBBII16sI', table[i:i + 32])
        if magic == 0x50aa and kind == 0 and offset == APP_OFFSET:
            return size
    raise ValueError('Fann ikkje app-partisjonen på 0x10000')


class Flasher:
    def __init__(self, esptool, port, out, run=subprocess.run, baud=460800):
        if baud not in (115200, 230400, 460800):
            raise ValueError('Ugyldig baudrate')
        self.esptool_path, self.port, self.out, self.run = esptool, port, Path(out), run
        self.baud = baud
        self.out.mkdir(parents=True, exist_ok=True)

    def esptool(self, label, args, after='no-reset', baud=None):
        log = self.out / (label + '.log')
        timeout = 300 if baud is not None else 300 * 460800 // self.baud
        with log.open('w', encoding='utf-8') as handle:
            result = self.run([str(self.esptool_path), '--chip', 'esp32', '--port', self.port, '--baud', str(baud or self.baud),
                               '--before', 'default-reset', '--after', after, *args],
                              stdout=handle, stderr=subprocess.STDOUT, text=True, timeout=timeout)
        output = log.read_text(encoding='utf-8', errors='replace')
        if result.returncode:
            raise RuntimeError(label + ' feila: ' + output[-800:])
        return output

    def flash(self, image, camera_id, write=False):
        data = Path(image).read_bytes()
        if len(data) < 0x100 or data[0] != 0xe9:
            raise ValueError('Fila er ikkje eit ESP32-appbilete')
        mac = mac_of(camera_id)
        if mac not in self.esptool('identity', ['read-mac'], baud='115200').lower():
            raise RuntimeError(f'{self.port} er ikkje kameraet {camera_id} ({mac}); ingenting er skrive')
        backup = self.out / 'before.bin'
        self.esptool('backup', ['read-flash', '0x0', hex(FLASH_SIZE), str(backup)], after='no-reset' if write else 'hard-reset')
        original = backup.read_bytes()
        if len(original) != FLASH_SIZE:
            raise RuntimeError('Backupen er ufullstendig; ingenting er skrive')
        size = app_partition_size(original[TABLE_OFFSET:TABLE_OFFSET + 0x1000])
        if len(data) > size:
            raise ValueError('Biletet er større enn app-partisjonen; ingenting er skrive')
        record = {'port': self.port, 'baud': self.baud, 'camera_id': camera_id, 'mac': mac, 'image_bytes': len(data),
                  'image_sha256': hashlib.sha256(data).hexdigest(), 'backup': str(backup),
                  'backup_sha256': hashlib.sha256(original).hexdigest(), 'app_partition_bytes': size, 'written': False}
        if write:
            self.write(data, original, size)
            record.update(written=True, readback_verified=True, settings_preserved=True)
        record['completed_utc'] = datetime.now(timezone.utc).isoformat()
        (self.out / 'verification.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
        return record

    def write(self, data, original, size):
        image = self.out / 'app.bin'
        image.write_bytes(data)
        try:
            self.esptool('write', ['write-flash', hex(APP_OFFSET), str(image)])
            self.esptool('verify', ['verify-flash', hex(APP_OFFSET), str(image)])
            readback = self.out / 'readback.bin'
            self.esptool('readback', ['read-flash', hex(APP_OFFSET), hex(len(data)), str(readback)])
            if readback.read_bytes() != data:
                raise RuntimeError('Tilbakelesinga skil seg frå biletet')
            protected = self.out / 'protected-after.bin'
            self.esptool('settings', ['read-flash', hex(PROTECTED[0]), hex(PROTECTED[1]), str(protected)], after='hard-reset')
            if protected.read_bytes() != original[PROTECTED[0]:PROTECTED[0] + PROTECTED[1]]:
                raise RuntimeError('Partisjonstabellen eller innstillingane endra seg')
        except Exception as error:
            rollback = self.out / 'rollback.bin'
            rollback.write_bytes(original[APP_OFFSET:APP_OFFSET + size])
            try:
                self.esptool('rollback', ['write-flash', hex(APP_OFFSET), str(rollback)])
                self.esptool('rollback-verify', ['verify-flash', hex(APP_OFFSET), str(rollback)], after='hard-reset')
            except Exception as rollback_error:
                raise RuntimeError(f'{error}; tilbakestillinga feila òg: {rollback_error}. Backup: {self.out / "before.bin"}') from error
            raise RuntimeError(f'{error}; den gamle appen er skriven tilbake og kontrollert') from error


def main():
    parser = argparse.ArgumentParser(description='Ta full backup av eitt ENTROPI-kamera og skriv ny app med kontroll.')
    parser.add_argument('--role', choices=sorted(CAMERAS), required=True)
    parser.add_argument('--port', required=True)
    parser.add_argument('--baud', type=int, choices=(115200, 230400, 460800), default=460800)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--camera-id', help='overstyr kamera-ID-en for rolla')
    parser.add_argument('--write', action='store_true', help='skriv appen; utan dette blir berre identitet og backup kontrollerte')
    parser.add_argument('--allow-unpaired', action='store_true')
    parser.add_argument('--esptool', type=Path)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    check_build(args.image, args.role, args.allow_unpaired)
    root = Path(__file__).resolve().parents[1]
    out = args.out or root / 'device/firmware/backups' / (datetime.now().strftime('%Y%m%d-%H%M%S-') + args.role)
    record = Flasher(args.esptool or find_esptool(), args.port, out, baud=args.baud).flash(args.image, args.camera_id or CAMERAS[args.role], args.write)
    print(json.dumps(record, indent=2))


if __name__ == '__main__':
    main()
