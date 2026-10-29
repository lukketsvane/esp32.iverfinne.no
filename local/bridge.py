import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
import uuid

from PIL import Image


class FrameError(ValueError):
    pass


class Rig:
    def __init__(self, port, timeout=35):
        self.port = port
        self.timeout = timeout
        self.lock = threading.Lock()
        self.current = None
        self.history = {}
        self.identities = None
        self.baudrate = None
        self.preview_supported = None
        self.probe_timeout = 4

    def connection(self):
        import serial
        link = serial.Serial(port=None, baudrate=self.baudrate or 460800, timeout=.25, write_timeout=2)
        link.dtr = False
        link.rts = False
        link.port = self.port
        link.open()
        return link

    def identify(self):
        with self.lock, self.connection() as link:
            return self.identify_link(link)

    def identify_link(self, link):
        for baudrate in (self.baudrate,) if self.baudrate else (460800, 115200):
            link.baudrate = baudrate
            link.reset_input_buffer()
            link.write(b'rig-check\n')
            end = time.monotonic() + 5
            data = b''
            while time.monotonic() < end:
                data = (data + link.read(4096))[-16000:]
                match = re.search(rb'Rig: own=([0-9a-f]{12}) expected_peer=([0-9a-f]{12}) configured=1 primary=([01]) ', data)
                if match:
                    own, peer, primary = (x.decode() for x in match.groups())
                    if primary != '1':
                        raise RuntimeError(f'{self.port} er sekundærkameraet {own}. Bruk USB-porten til primærkameraet {peer} med --serial.')
                    self.identities = (own, peer)
                    self.baudrate = baudrate
                    return self.identities
        raise RuntimeError('Ingen stadfesta kameraparing på ' + self.port)

    @staticmethod
    def read_pair(link, timeout, metadata=None):
        end = time.monotonic() + timeout
        line = b''
        while time.monotonic() < end:
            byte = link.read(1)
            if byte != b'\n':
                line = (line + byte)[-4096:]
                continue
            if b'PAIR_ERROR ' in line:
                raise RuntimeError(line.decode('ascii', 'replace').strip())
            if line.startswith(b'PAIR_META '):
                value = json.loads(line[len(b'PAIR_META '):])
                if not isinstance(value, dict) or not re.fullmatch('[a-f0-9]{32}', value.get('id', '')) or not all(re.fullmatch('[a-f0-9]{12}', value.get(key, '')) for key in ('left_camera_id', 'right_camera_id')) or value['left_camera_id'] == value['right_camera_id'] or value.get('hardware_synchronized') is not False:
                    raise ValueError('Ugyldige stereometadata')
                timing_keys = ('left_capture_us', 'right_capture_us', 'left_capture_duration_us', 'right_capture_duration_us', 'peer_requested_us', 'peer_headers_received_us', 'peer_request_started_us', 'peer_response_ready_us')
                if value.get('coordinator_camera_id') != value['left_camera_id'] or not all(type(value.get(key)) is int and 0 <= value[key] <= 9007199254740991 for key in timing_keys):
                    raise ValueError('Ugyldige opptakstider')
                if metadata is not None:
                    metadata.clear()
                    metadata.update(value)
                line = b''
                continue
            match = re.search(rb'PAIR_BEGIN (\d+) (\d+)$', line.strip())
            line = b''
            if match:
                sizes = tuple(map(int, match.groups()))
                if not all(4 <= n <= 2 * 1024 * 1024 for n in sizes):
                    raise ValueError('Ugyldig stereoparstorleik')
                frames = []
                for size in sizes:
                    frame = bytearray()
                    while len(frame) < size and time.monotonic() < end:
                        frame.extend(link.read(min(8192, size - len(frame))))
                    if len(frame) != size or not frame.startswith(b'\xff\xd8') or not frame.endswith(b'\xff\xd9'):
                        raise FrameError('Ufullstendig JPEG frå kameraet')
                    frames.append(bytes(frame))
                trailer = bytearray()
                while len(trailer) < 9 and time.monotonic() < end:
                    trailer.extend(link.read(9 - len(trailer)))
                if trailer != b'PAIR_END\n':
                    raise FrameError('Stereoparet manglar sluttmarkør')
                dims = []
                for frame in frames:
                    try:
                        with Image.open(io.BytesIO(frame)) as image:
                            dims.append(image.size)
                            image.verify()
                    except (OSError, SyntaxError) as error:
                        raise FrameError('Skadd JPEG frå kameraet') from error
                if dims[0] != dims[1]:
                    raise ValueError('Kameraa har ulik oppløysing')
                return frames, dims[0]
        raise TimeoutError('Kameraet svarte ikkje med eit stereopar')

    @staticmethod
    def read_photo(link, timeout):
        end = time.monotonic() + timeout
        line = b''
        while time.monotonic() < end:
            byte = link.read(1)
            if byte != b'\n':
                line = (line + byte)[-4096:]
                continue
            if b'PHOTO_ERROR ' in line:
                raise RuntimeError(line.decode('ascii', 'replace').strip())
            match = re.search(rb'PHOTO_BEGIN (\d+)$', line.strip())
            line = b''
            if match:
                size = int(match.group(1))
                if not 4 <= size <= 2 * 1024 * 1024:
                    raise ValueError('Ugyldig biletstorleik')
                frame = bytearray()
                while len(frame) < size and time.monotonic() < end:
                    frame.extend(link.read(min(8192, size - len(frame))))
                if len(frame) != size or not frame.startswith(b'\xff\xd8') or not frame.endswith(b'\xff\xd9'):
                    raise FrameError('Ufullstendig JPEG frå kameraet')
                trailer = bytearray()
                while len(trailer) < 10 and time.monotonic() < end:
                    trailer.extend(link.read(10 - len(trailer)))
                if trailer != b'PHOTO_END\n':
                    raise FrameError('Biletet manglar sluttmarkør')
                return bytes(frame)
        raise TimeoutError('Kameraet svarte ikkje med eit førehandsbilete')

    def preview(self):
        # One small primary frame takes about a second over USB; firmware without camera-preview gets the cached pair.
        if self.preview_supported is not False:
            with self.lock, self.connection() as link:
                if not self.identities:
                    self.identify_link(link)
                link.reset_input_buffer()
                link.write(b'camera-preview\n')
                try:
                    frame = self.read_photo(link, self.timeout if self.preview_supported else self.probe_timeout)
                    self.preview_supported = True
                    return frame
                except TimeoutError:
                    if self.preview_supported:
                        raise
                    self.preview_supported = False
        return self.capture(15)['frames'][0]

    def latest(self):
        # Any pair answers identity, size and camera-2 checks; one being captured is waited for, never repeated.
        return self.capture(float('inf'))

    def capture(self, max_age=0):
        # A USB pair takes seconds; readers of a fresh pair must not queue behind the next one.
        record = self.current
        if record and time.time() - record['created'] < max_age:
            return record
        with self.lock:
            if self.current and time.time() - self.current['created'] < max_age:
                return self.current
            with self.connection() as link:
                if not self.identities:
                    self.identify_link(link)
                for attempt in range(2):
                    link.reset_input_buffer()
                    link.write(b'stereo-snap\n')
                    metadata = {}
                    try:
                        frames, size = self.read_pair(link, self.timeout, metadata)
                        break
                    except FrameError:
                        if attempt:
                            raise
                if metadata and (metadata['left_camera_id'], metadata['right_camera_id']) != self.identities:
                    raise ValueError('Stereoparet kjem frå feil kamera')
            record = {'id': uuid.uuid4().hex, 'created': time.time(), 'frames': frames, 'size': size, 'timing': metadata or None}
            self.current = record
            self.history[record['id']] = record
            while len(self.history) > 8:
                del self.history[next(iter(self.history))]
            return record

    def status(self, side=0):
        record = self.latest()
        return {'camera_id': self.identities[side], 'camera_ready': True, 'stream_ready': True,
                'peer': {'camera_id': self.identities[1-side]}, 'transport': 'usb',
                'hardware_synchronized': False, 'width': record['size'][0], 'height': record['size'][1]}


class Depth:
    def __init__(self, size):
        self.size = size
        self.lock = threading.Lock()
        self.processor = self.model = None
        self.cache = {}

    def predict(self, data):
        key = hashlib.sha256(data).hexdigest()
        with self.lock:
            if key in self.cache:
                return self.cache[key]
            import torch
            from transformers import AutoImageProcessor, AutoModelForDepthEstimation
            if self.model is None:
                name = 'depth-anything/Depth-Anything-V2-Small-hf'
                self.processor = AutoImageProcessor.from_pretrained(name, local_files_only=True)
                self.model = AutoModelForDepthEstimation.from_pretrained(name, local_files_only=True).eval()
                torch.set_num_threads(min(8, os.cpu_count() or 1))
            image = Image.open(io.BytesIO(data)).convert('RGB')
            if image.width * image.height > 20000000:
                raise ValueError('Biletet er for stort')
            inputs = self.processor(images=image, return_tensors='pt', size={'height': self.size, 'width': self.size})
            with torch.inference_mode():
                predicted = self.model(**inputs).predicted_depth
                depth = torch.nn.functional.interpolate(predicted.unsqueeze(1), size=(image.height, image.width), mode='bicubic', align_corners=False)[0, 0]
            result = (depth.cpu().numpy().astype('<f4').tobytes(), image.width, image.height)
            self.cache[key] = result
            while len(self.cache) > 3:
                del self.cache[next(iter(self.cache))]
            return result


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        args[0].settimeout(120)
        super().__init__(*args, directory=str(args[2].root), **kwargs)

    def send(self, body, mime, status=200, headers=None):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for key, value in (headers or {}).items():
            self.send_header(key, str(value))
        self.end_headers()
        self.wfile.write(body)

    def json(self, value, status=200):
        self.send(json.dumps(value).encode(), 'application/json', status)

    def allowed(self):
        origin = self.headers.get('Origin')
        return not origin or urlparse(origin).netloc == self.headers.get('Host')

    def do_POST(self):
        if not self.allowed():
            return self.json({'error': 'Origin rejected'}, 403)
        try:
            if self.path == '/api/capture':
                record = self.server.rig.capture()
                return self.json({'id': record['id'], 'left': '/api/frame/' + record['id'] + '/left',
                                  'right': '/api/frame/' + record['id'] + '/right', 'captured_at': record['created'],
                                  'transport': 'usb', 'hardware_synchronized': False, 'timing': record.get('timing')})
            if self.path == '/api/depth':
                length = int(self.headers.get('Content-Length', 0))
                if not 0 < length <= 16 * 1024 * 1024 or self.headers.get('Content-Type', '').split(';')[0] not in ('image/jpeg', 'image/png', 'image/webp'):
                    return self.json({'error': 'Ugyldig bilete'}, 400)
                data = self.rfile.read(length)
                if len(data) != length:
                    return self.json({'error': 'Ufullstendig bilete'}, 400)
                depth, width, height = self.server.depth.predict(data)
                return self.send(depth, 'application/octet-stream', headers={'X-Depth-Width': width, 'X-Depth-Height': height,
                                 'X-Depth-Polarity': 'near', 'X-Depth-Model': 'Depth Anything V2 Small', 'X-Depth-Input-Size': self.server.depth.size})
            self.json({'error': 'Not found'}, 404)
        except Exception as error:
            self.json({'error': str(error)}, 503)

    def do_GET(self):
        path = urlparse(self.path).path
        try:
            if path in ('/status', '/peer/status'):
                return self.json(self.server.rig.status(int(path.startswith('/peer/'))))
            if path == '/api/health':
                return self.json({'service': 'ENTROPI', 'port': self.server.rig.port, 'depth_model': 'Depth Anything V2 Small',
                                  'depth_input_size': self.server.depth.size, 'paired': bool(self.server.rig.identities)})
            if path.startswith('/api/frame/'):
                _, _, _, identity, eye = path.split('/')
                record = self.server.rig.history.get(identity)
                if record is None or eye not in ('left', 'right'):
                    return self.json({'error': 'Opptaket er ikkje tilgjengeleg'}, 404)
                return self.send(record['frames'][eye == 'right'], 'image/jpeg')
            if path == '/preview':
                return self.send(self.server.rig.preview(), 'image/jpeg')
            if path == '/peer/preview':
                return self.send(self.server.rig.latest()['frames'][1], 'image/jpeg')
            if path in ('/capture', '/peer/capture'):
                record = self.server.rig.capture(20)
                return self.send(record['frames'][path.startswith('/peer/')], 'image/jpeg')
            if path == '/stream':
                self.send_response(200)
                self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=entropi')
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                while True:
                    frame = self.server.rig.preview()
                    self.wfile.write(b'--entropi\r\nContent-Type: image/jpeg\r\nContent-Length: ' + str(len(frame)).encode() + b'\r\n\r\n' + frame + b'\r\n')
                    self.wfile.flush()
                    time.sleep(.3)
            if path == '/':
                html = (self.server.root / 'device/preview/index.html').read_text(encoding='utf-8')
                config = '<script>globalThis.__ENTROPI_RIG_BRIDGE=true;globalThis.__ENTROPI_DEPTH_ENDPOINT="/api/depth";</script>'
                return self.send(html.replace('<head>', '<head>' + config, 1).encode(), 'text/html; charset=utf-8')
            if path == '/control':
                return self.json({'error': 'Sensorinnstillingar er ikkje tilgjengelege over USB'}, 409)
            if '..' in path.split('/') or not (path.startswith(('/vendor/', '/pointcloud/')) or path in ('/favicon.svg', '/style.css')):
                return self.json({'error': 'Not found'}, 404)
            super().do_GET()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception as error:
            self.json({'error': str(error)}, 503)


def warm_up(rig):
    try:
        rig.capture()
    except Exception as error:
        print('Første stereopar feila: ' + str(error), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--serial', required=True)
    parser.add_argument('--port', type=int, default=19305)
    parser.add_argument('--inference-size', type=int, default=770)
    parser.add_argument('--cache')
    args = parser.parse_args()
    if args.cache:
        os.environ['HF_HOME'] = args.cache
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    server.root = Path(__file__).resolve().parents[1]
    server.rig = Rig(args.serial)
    server.rig.identify()
    threading.Thread(target=warm_up, args=(server.rig,), daemon=True).start()
    server.depth = Depth(args.inference_size)
    print('ENTROPI http://127.0.0.1:' + str(args.port), flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
