import io
import http.client
import json
from pathlib import Path
import threading
from http.server import ThreadingHTTPServer
from contextlib import nullcontext
import types
import unittest
from unittest.mock import Mock, patch
import numpy as np
from PIL import Image
from bridge import Depth, Handler


class Tensor:
    def __init__(self, values, device='cpu'):
        self.values = np.asarray(values, dtype=np.float32)
        self.device = device

    def to(self, device):
        return Tensor(self.values, device)

    def cpu(self):
        return self.to('cpu')

    def numpy(self):
        return self.values

    def unsqueeze(self, axis):
        return Tensor(np.expand_dims(self.values, axis), self.device)

    def __getitem__(self, item):
        return Tensor(self.values[item], self.device)


class DepthTests(unittest.TestCase):
    def setUp(self):
        image = io.BytesIO()
        Image.new('RGB', (32, 24), 'red').save(image, format='JPEG')
        self.photo = image.getvalue()
        self.oom = type('OutOfMemoryError', (RuntimeError,), {})
        self.cuda = types.SimpleNamespace(is_available=Mock(return_value=False), OutOfMemoryError=self.oom, empty_cache=Mock())
        self.interpolate = Mock(side_effect=lambda value, size, **kwargs: Tensor(np.full((1, 1, *size), 6)))
        self.torch = types.SimpleNamespace(cuda=self.cuda, set_num_threads=Mock(), inference_mode=nullcontext,
            nn=types.SimpleNamespace(functional=types.SimpleNamespace(interpolate=self.interpolate)), isfinite=lambda value: np.isfinite(value.values))
        self.prediction = types.SimpleNamespace(predicted_depth=Tensor([[[1, 2], [3, 4]]]))
        self.model = Mock(return_value=self.prediction)
        self.model.eval.return_value = self.model
        self.model.to.return_value = self.model
        self.model.config._commit_hash = 'cached-revision'
        self.processor = Mock(return_value={'pixel_values': Tensor(np.zeros((1, 3, 14, 14)))})
        self.load_processor = Mock(return_value=self.processor)
        self.load_model = Mock(return_value=self.model)
        self.transformers = types.SimpleNamespace(AutoImageProcessor=types.SimpleNamespace(from_pretrained=self.load_processor),
            AutoModelForDepthEstimation=types.SimpleNamespace(from_pretrained=self.load_model))
        self.modules = patch.dict('sys.modules', {'torch': self.torch, 'transformers': self.transformers})
        self.modules.start()
        self.addCleanup(self.modules.stop)

    def test_cached_models_are_loaded_offline_and_default_stays_small(self):
        for variant, label in Depth.variants.items():
            engine = Depth(770, variant)
            depth, width, height, metadata = engine.predict(self.photo)
            self.assertEqual((width, height), (32, 24))
            self.assertEqual(len(depth), 32 * 24 * 4)
            self.assertTrue(np.isfinite(np.frombuffer(depth, dtype='<f4')).all())
            self.assertEqual(engine.model_name, 'Depth Anything V2 ' + label)
            self.assertEqual(engine.device, 'cpu')
            self.assertEqual(engine.revision, 'cached-revision')
            self.assertEqual(metadata, {'model': engine.model_name, 'device': 'cpu', 'revision': 'cached-revision', 'input_size': 770, 'fallback_reason': None})
            self.load_processor.assert_called_with(engine.model_id, local_files_only=True)
            self.load_model.assert_called_with(engine.model_id, local_files_only=True)
        self.assertEqual(Depth(770).model_id, 'depth-anything/Depth-Anything-V2-Small-hf')

    def test_missing_selected_model_never_downloads_or_silently_uses_small(self):
        self.load_model.side_effect = OSError('model missing from local cache')
        engine = Depth(770, 'base')
        with self.assertRaisesRegex(OSError, 'local cache'):
            engine.predict(self.photo)
        self.load_model.assert_called_once_with('depth-anything/Depth-Anything-V2-Base-hf', local_files_only=True)
        self.assertIsNone(engine.model)
        self.assertFalse(engine.cache)

    def test_cuda_auto_moves_model_and_inputs_then_upsamples_on_cpu(self):
        self.cuda.is_available.return_value = True
        engine = Depth(770)
        engine.predict(self.photo)
        self.assertEqual(engine.device, 'cuda')
        self.model.to.assert_called_once_with('cuda')
        self.assertEqual(self.model.call_args.kwargs['pixel_values'].device, 'cuda')
        self.assertEqual(self.interpolate.call_args.args[0].device, 'cpu')
        self.assertIsNone(engine.fallback_reason)

    def test_explicit_cuda_fails_clearly_when_runtime_is_unavailable(self):
        with self.assertRaisesRegex(RuntimeError, 'CUDA er ikkje tilgjengeleg'):
            Depth(770, device='cuda').predict(self.photo)
        self.load_model.assert_not_called()

    def test_explicit_cpu_does_not_use_available_cuda(self):
        self.cuda.is_available.return_value = True
        engine = Depth(770, device='cpu')
        engine.predict(self.photo)
        self.assertEqual(engine.device, 'cpu')
        self.model.to.assert_called_once_with('cpu')

    def test_auto_cuda_out_of_memory_retries_once_on_cpu_and_reports_it(self):
        self.cuda.is_available.return_value = True
        self.model.side_effect = [self.oom('out of memory'), self.prediction]
        engine = Depth(770)
        result = engine.predict(self.photo)
        self.assertEqual(self.model.call_count, 2)
        self.assertEqual(self.model.call_args.kwargs['pixel_values'].device, 'cpu')
        self.assertEqual(engine.device, 'cpu')
        self.assertIn('CUDA-minnet', engine.fallback_reason)
        self.cuda.empty_cache.assert_called_once()
        self.assertIs(engine.predict(self.photo), result)
        self.assertEqual(self.model.call_count, 2)

    def test_cached_predictions_keep_their_execution_metadata_after_cpu_fallback(self):
        self.cuda.is_available.return_value = True
        self.model.side_effect = [self.prediction, self.oom('out of memory'), self.prediction]
        engine = Depth(770)
        first = engine.predict(self.photo)
        second = engine.predict(self.photo + b'another capture')
        cached = engine.predict(self.photo)
        self.assertIs(cached, first)
        self.assertEqual(cached[3]['device'], 'cuda')
        self.assertIsNone(cached[3]['fallback_reason'])
        self.assertEqual(second[3]['device'], 'cpu')
        self.assertIn('CUDA-minnet', second[3]['fallback_reason'])
        self.assertEqual(engine.device, 'cpu')

    def test_auto_can_recover_from_cuda_memory_exhaustion_while_loading(self):
        self.cuda.is_available.return_value = True
        self.model.to.side_effect = [self.oom('out of memory'), self.model]
        engine = Depth(770)
        engine.predict(self.photo)
        self.assertEqual(engine.device, 'cpu')
        self.assertEqual([call.args[0] for call in self.model.to.call_args_list], ['cuda', 'cpu'])

    def test_explicit_cuda_and_nonmemory_failures_are_never_hidden(self):
        self.cuda.is_available.return_value = True
        for device, error in [('cuda', self.oom('out of memory')), ('auto', RuntimeError('driver failed'))]:
            self.model.reset_mock()
            self.model.side_effect = error
            engine = Depth(770, device=device)
            with self.assertRaisesRegex(RuntimeError, str(error)):
                engine.predict(self.photo)
            self.assertEqual(self.model.call_count, 1)
            self.assertIsNone(engine.fallback_reason)
            self.assertFalse(engine.cache)
        self.cuda.empty_cache.assert_not_called()

    def test_nonfinite_depth_is_rejected_without_caching(self):
        self.interpolate.side_effect = lambda value, size, **kwargs: Tensor(np.full((1, 1, *size), np.nan))
        engine = Depth(770)
        with self.assertRaisesRegex(ValueError, 'ugyldige verdiar'):
            engine.predict(self.photo)
        self.assertFalse(engine.cache)

    def test_http_response_and_health_report_the_actual_model_and_device(self):
        engine = Depth(770, 'base', 'cpu')
        engine.predict(self.photo)
        engine.device = 'cuda'
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.root = Path(__file__).resolve().parents[1]
        server.rig = types.SimpleNamespace(port='TEST', identities=('primary', 'secondary'), current={'frames': [self.photo, self.photo]})
        server.depth = engine
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        link = http.client.HTTPConnection(*server.server_address, timeout=2)
        try:
            with patch.object(Handler, 'log_message'):
                link.request('POST', '/api/depth', self.photo, {'Content-Type': 'image/jpeg'})
                response = link.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(response.getheader('X-Depth-Model'), 'Depth Anything V2 Base')
                self.assertEqual(response.getheader('X-Depth-Device'), 'cpu')
                self.assertEqual(response.getheader('X-Depth-Input-Size'), '770')
                self.assertEqual(response.getheader('X-Depth-Revision'), 'cached-revision')
                self.assertEqual(len(response.read()), 32 * 24 * 4)
                link.request('GET', '/api/health')
                health = json.loads(link.getresponse().read())
                self.assertEqual(health['depth_model'], 'Depth Anything V2 Base')
                self.assertEqual(health['depth_device'], 'cuda')
                self.assertEqual(health['depth_revision'], 'cached-revision')
        finally:
            link.close()
            server.shutdown()
            server.server_close()
            thread.join(1)

    def test_invalid_size_model_device_and_photo_fail_before_loading(self):
        for size in [0, 139, 771, 1554, 770.5]:
            with self.assertRaises(ValueError):
                Depth(size)
        for options in [{'model': 'unknown'}, {'device': 'unknown'}]:
            with self.assertRaises(ValueError):
                Depth(770, **options)
        with self.assertRaises(Exception):
            Depth(770).predict(b'not a photograph')
        self.load_model.assert_not_called()


if __name__ == '__main__':
    unittest.main()
