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
from urllib.parse import parse_qs, urlparse
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
        self.sensor_controls = [{}, {}]
        self.sensor_checked = [0, 0]

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
        return self.capture(float('inf'), allow_mono=True)

    def capture(self, max_age=0, allow_mono=False):
        # A USB pair takes seconds; readers of a fresh pair must not queue behind the next one.
        record = self.current
        if record and (allow_mono or len(record['frames']) == 2) and time.time() - record['created'] < max_age:
            return record
        with self.lock:
            if self.current and (allow_mono or len(self.current['frames']) == 2) and time.time() - self.current['created'] < max_age:
                return self.current
            with self.connection() as link:
                if not self.identities:
                    self.identify_link(link)
                fallback = None
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
                    except RuntimeError as error:
                        if not allow_mono or str(error) not in ('PAIR_ERROR PEER_OFFLINE', 'PAIR_ERROR PEER_ID_OR_SENSOR'):
                            raise
                        fallback = str(error)
                        link.reset_input_buffer()
                        link.write(b'camera-photo\n')
                        frame = self.read_photo(link, self.timeout)
                        with Image.open(io.BytesIO(frame)) as image:
                            image.load()
                            size = image.size
                        frames, metadata = [frame], {}
                        break
                if metadata and (metadata['left_camera_id'], metadata['right_camera_id']) != self.identities:
                    raise ValueError('Stereoparet kjem frå feil kamera')
            record = {'id': uuid.uuid4().hex, 'created': time.time(), 'frames': frames, 'size': size, 'timing': metadata or None, 'fallback_reason': fallback}
            self.current = record
            self.history[record['id']] = record
            while len(self.history) > 8:
                del self.history[next(iter(self.history))]
            return record

    def control(self, variable, value, side=0):
        if variable not in ('brightness', 'ae_level') or type(value) is not int or not -2 <= value <= 2 or type(side) is not int or side not in (0, 1):
            raise ValueError('Ugyldig sensorinnstilling')
        with self.lock, self.connection() as link:
            if not self.identities:
                self.identify_link(link)
            link.reset_input_buffer()
            command = 'peer-control' if side else 'camera-control'
            link.write(f'{command} {variable} {value}\n'.encode('ascii'))
            end = time.monotonic() + min(self.timeout, 10)
            data = b''
            while time.monotonic() < end:
                data = (data + link.read(4096))[-16000:]
                match = re.search(rb'(?:^|\n)CONTROL_STATUS ([^\r\n]+)\r?\n', data)
                if not match:
                    continue
                reply = json.loads(match[1])
                if not isinstance(reply, dict) or reply.get('camera_id') != self.identities[side] or reply.get('var') != variable or type(reply.get('value')) is not int or reply['value'] != value:
                    raise RuntimeError('Sensorinnstillinga vart ikkje stadfesta av rett kamera')
                if reply.get('ok') is not True:
                    raise RuntimeError(reply.get('error') or 'Sensorinnstillinga vart ikkje teken i bruk')
                self.sensor_controls[side][variable] = value
                self.sensor_checked[side] = time.monotonic()
                self.current = None
                return reply
            raise TimeoutError('Kameraet stadfesta ikkje sensorinnstillinga')

    def read_sensor_status(self, side):
        if time.monotonic() - self.sensor_checked[side] < 5 or not self.lock.acquire(blocking=False):
            return
        try:
            self.sensor_checked[side] = time.monotonic()
            with self.connection() as link:
                link.reset_input_buffer()
                link.write(b'peer-check\n' if side else b'camera-check\n')
                prefix = rb'PEER_STATUS ' if side else rb'CAMERA_STATUS '
                end = time.monotonic() + min(self.timeout, 3)
                data = b''
                while time.monotonic() < end:
                    data = (data + link.read(4096))[-16000:]
                    match = re.search(rb'(?:^|\n)' + prefix + rb'([^\r\n]+)\r?\n', data)
                    if not match:
                        continue
                    status = json.loads(match[1])
                    if isinstance(status, dict) and status.get('camera_id') == self.identities[side] and status.get('camera_ready') is True:
                        self.sensor_controls[side].update({key: value for key, value in status.items() if key in ('brightness', 'ae_level') and type(value) is int and -2 <= value <= 2})
                    break
        except (ValueError, OSError, RuntimeError):
            pass
        finally:
            self.lock.release()

    def status(self, side=0):
        record = self.current or next(reversed(tuple(self.history.values())), None) or self.latest()
        ready = side < len(record['frames'])
        if ready:
            self.read_sensor_status(side)
        return {'camera_id': self.identities[side], 'camera_ready': ready, 'stream_ready': ready,
                'peer': {'camera_id': self.identities[1-side]} if len(record['frames']) == 2 else None, 'transport': 'usb',
                'last_error': record.get('fallback_reason', '') if not ready else '',
                'hardware_synchronized': False, 'width': record['size'][0], 'height': record['size'][1], **self.sensor_controls[side]}


class Depth:
    variants = {'small': 'Small', 'base': 'Base', 'large': 'Large'}

    def __init__(self, size, model='small', device='auto'):
        if model not in self.variants or device not in ('auto', 'cpu', 'cuda'):
            raise ValueError('Ukjend djupnemodell eller prosessor')
        if not isinstance(size, int) or size < 140 or size > 1540 or size % 14:
            raise ValueError('Djupneoppløysinga må vere eit multiplum av 14 mellom 140 og 1540')
        self.size = size
        self.model_name = 'Depth Anything V2 ' + self.variants[model]
        self.model_id = 'depth-anything/Depth-Anything-V2-' + self.variants[model] + '-hf'
        self.requested_device = device
        self.device = None
        self.fallback_reason = None
        self.revision = None
        self.lock = threading.Lock()
        self.processor = self.model = None
        self.cache = {}

    def cpu_fallback(self, torch, model):
        model.to('cpu')
        self.device = 'cpu'
        self.fallback_reason = 'CUDA-minnet var fullt; bereknar på CPU'
        torch.cuda.empty_cache()

    def predict(self, data):
        key = hashlib.sha256(data).hexdigest()
        with self.lock:
            if key in self.cache:
                return self.cache[key]
            with Image.open(io.BytesIO(data)) as original:
                if original.width < 2 or original.height < 2 or original.width * original.height > 16777216:
                    raise ValueError('Biletet har ugyldig storleik')
                image = original.convert('RGB')
            import torch
            from transformers import AutoImageProcessor, AutoModelForDepthEstimation
            if self.model is None:
                available = torch.cuda.is_available()
                if self.requested_device == 'cuda' and not available:
                    raise RuntimeError('CUDA er ikkje tilgjengeleg i Python-miljøet; bruk --depth-device cpu')
                self.device = 'cuda' if available and self.requested_device != 'cpu' else 'cpu'
                processor = AutoImageProcessor.from_pretrained(self.model_id, local_files_only=True)
                model = AutoModelForDepthEstimation.from_pretrained(self.model_id, local_files_only=True).eval()
                try:
                    model.to(self.device)
                except torch.cuda.OutOfMemoryError:
                    if self.requested_device != 'auto':
                        raise
                    self.cpu_fallback(torch, model)
                self.processor, self.model = processor, model
                self.revision = getattr(model.config, '_commit_hash', None)
                torch.set_num_threads(min(8, os.cpu_count() or 1))
            inputs = self.processor(images=image, return_tensors='pt', size={'height': self.size, 'width': self.size})
            with torch.inference_mode():
                try:
                    inputs = {name: value.to(self.device) for name, value in inputs.items()}
                    predicted = self.model(**inputs).predicted_depth.cpu()
                except torch.cuda.OutOfMemoryError:
                    if self.device != 'cuda' or self.requested_device != 'auto':
                        raise
                    inputs = {name: value.to('cpu') for name, value in inputs.items()}
                    self.cpu_fallback(torch, self.model)
                    predicted = self.model(**inputs).predicted_depth.cpu()
                depth = torch.nn.functional.interpolate(predicted.unsqueeze(1), size=(image.height, image.width), mode='bicubic', align_corners=False)[0, 0]
                if not torch.isfinite(depth).all():
                    raise ValueError('Djupnemodellen gav ugyldige verdiar')
            metadata = {'model': self.model_name, 'device': self.device, 'revision': self.revision,
                        'input_size': self.size, 'fallback_reason': self.fallback_reason}
            result = (depth.cpu().numpy().astype('<f4').tobytes(), image.width, image.height, metadata)
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
                record = self.server.rig.capture(allow_mono=True)
                return self.json({'id': record['id'], 'left': '/api/frame/' + record['id'] + '/left',
                                  'right': '/api/frame/' + record['id'] + '/right' if len(record['frames']) == 2 else None, 'captured_at': record['created'],
                                  'fallback_reason': record.get('fallback_reason'),
                                  'transport': 'usb', 'hardware_synchronized': False, 'timing': record.get('timing')})
            if self.path == '/api/depth':
                length = int(self.headers.get('Content-Length', 0))
                if not 0 < length <= 16 * 1024 * 1024 or self.headers.get('Content-Type', '').split(';')[0] not in ('image/jpeg', 'image/png', 'image/webp'):
                    return self.json({'error': 'Ugyldig bilete'}, 400)
                data = self.rfile.read(length)
                if len(data) != length:
                    return self.json({'error': 'Ufullstendig bilete'}, 400)
                depth, width, height, metadata = self.server.depth.predict(data)
                return self.send(depth, 'application/octet-stream', headers={'X-Depth-Width': width, 'X-Depth-Height': height,
                                 'X-Depth-Polarity': 'near', 'X-Depth-Model': metadata['model'], 'X-Depth-Input-Size': metadata['input_size'],
                                 'X-Depth-Device': metadata['device'], 'X-Depth-Revision': metadata['revision'] or '',
                                 'X-Depth-Fallback': metadata['fallback_reason'] or ''})
            self.json({'error': 'Not found'}, 404)
        except Exception as error:
            self.json({'error': str(error)}, 503)

    def do_GET(self):
        path = urlparse(self.path).path
        try:
            if path in ('/status', '/peer/status'):
                return self.json(self.server.rig.status(int(path.startswith('/peer/'))))
            if path == '/api/health':
                return self.json({'service': 'ENTROPI', 'port': self.server.rig.port, 'depth_model': self.server.depth.model_name,
                                  'depth_input_size': self.server.depth.size, 'depth_device': self.server.depth.device,
                                  'depth_revision': self.server.depth.revision, 'depth_fallback': self.server.depth.fallback_reason,
                                  'paired': bool(self.server.rig.current and len(self.server.rig.current['frames']) == 2)})
            if path.startswith('/api/frame/'):
                _, _, _, identity, eye = path.split('/')
                record = self.server.rig.history.get(identity)
                if record is None or eye not in ('left', 'right') or eye == 'right' and len(record['frames']) < 2:
                    return self.json({'error': 'Opptaket er ikkje tilgjengeleg'}, 404)
                return self.send(record['frames'][eye == 'right'], 'image/jpeg')
            if path == '/preview':
                return self.send(self.server.rig.preview(), 'image/jpeg')
            if path == '/peer/preview':
                record = self.server.rig.latest()
                if len(record['frames']) < 2:
                    return self.json({'error': record.get('fallback_reason')}, 503)
                return self.send(record['frames'][1], 'image/jpeg')
            if path in ('/capture', '/peer/capture'):
                record = self.server.rig.capture(20, allow_mono=True)
                if path.startswith('/peer/') and len(record['frames']) < 2:
                    return self.json({'error': record.get('fallback_reason')}, 503)
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
            if path in ('/control', '/peer/control'):
                if not self.allowed():
                    return self.json({'error': 'Origin rejected'}, 403)
                try:
                    query = parse_qs(urlparse(self.path).query, keep_blank_values=True)
                    if set(query) != {'var', 'val'} or any(len(items) != 1 for items in query.values()) or not re.fullmatch('-?[0-9]+', query['val'][0]):
                        raise ValueError('Ugyldig sensorinnstilling')
                    reply = self.server.rig.control(query['var'][0], int(query['val'][0]), int(path.startswith('/peer/')))
                except ValueError as error:
                    return self.json({'error': str(error)}, 400)
                return self.json(reply)
            if '..' in path.split('/') or not (path.startswith(('/vendor/', '/pointcloud/')) or path in ('/favicon.svg', '/style.css')):
                return self.json({'error': 'Not found'}, 404)
            super().do_GET()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception as error:
            self.json({'error': str(error)}, 503)


def warm_up(rig):
    try:
        rig.capture(allow_mono=True)
    except Exception as error:
        print('Første opptak feila: ' + str(error), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--serial', required=True)
    parser.add_argument('--port', type=int, default=19305)
    parser.add_argument('--inference-size', type=int, default=770)
    parser.add_argument('--depth-model', choices=tuple(Depth.variants), default='small')
    parser.add_argument('--depth-device', choices=('auto', 'cpu', 'cuda'), default='auto')
    parser.add_argument('--cache')
    args = parser.parse_args()
    if args.cache:
        os.environ['HF_HOME'] = args.cache
    depth = Depth(args.inference_size, args.depth_model, args.depth_device)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    server.root = Path(__file__).resolve().parents[1]
    server.rig = Rig(args.serial)
    server.rig.identify()
    threading.Thread(target=warm_up, args=(server.rig,), daemon=True).start()
    server.depth = depth
    print('ENTROPI http://127.0.0.1:' + str(args.port), flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
