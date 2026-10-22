export function inferenceSize(width, height) {
  if (!(width > 0 && height > 0)) throw new Error('Ugyldig kamerabilete.');
  const scale = 420 / Math.max(width, height);
  return { width: Math.max(140, Math.round(width * scale / 14) * 14), height: Math.max(140, Math.round(height * scale / 14) * 14) };
}

export function pointStride(width, height, budget = 42000) {
  let stride = Math.max(2, Math.ceil(Math.sqrt(width * height / budget)));
  while (Math.ceil(width / stride) * Math.ceil(height / stride) > budget) stride++;
  return stride;
}

export function normalizedImage(rgba, width, height) {
  const count = width * height;
  if (!Number.isInteger(count) || count <= 0 || rgba.length !== count * 4) throw new Error('Ugyldig kamerabilete.');
  const result = new Float32Array(count * 3);
  const mean = [.485, .456, .406], std = [.229, .224, .225];
  for (let i = 0; i < count; i++) {
    const alpha = rgba[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) result[c * count + i] = ((rgba[i * 4 + c] * alpha / 255 + 1 - alpha) - mean[c]) / std[c];
  }
  return result;
}

function bilinear(data, width, height, x, y) {
  x = Math.max(0, Math.min(width - 1, x)); y = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
  const a = x - x0, b = y - y0;
  return data[y0 * width + x0] * (1 - a) * (1 - b) + data[y0 * width + x1] * a * (1 - b)
    + data[y1 * width + x0] * (1 - a) * b + data[y1 * width + x1] * a * b;
}

export function imageToPointCloud({ rgba, width, height, depth, depthWidth, depthHeight, stride = 2, focalEstimate }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || rgba.length !== width * height * 4) throw new Error('Ugyldig kamerabilete.');
  if (!Number.isInteger(depthWidth) || !Number.isInteger(depthHeight) || depthWidth < 2 || depthHeight < 2 || depth.length !== depthWidth * depthHeight) throw new Error('Ugyldig djupnekart.');
  if (!Number.isInteger(stride) || stride < 1) throw new Error('Ugyldig punktavstand.');
  const sorted = Array.from(depth).filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length < depth.length * .95) throw new Error('Djupneberekninga gav ugyldige punkt.');

  const low = sorted[Math.floor((sorted.length - 1) * .02)], high = sorted[Math.floor((sorted.length - 1) * .98)];
  const span = high - low;
  const count = Math.ceil(width / stride) * Math.ceil(height / stride);
  const positions = new Float32Array(count * 3), colors = new Uint8Array(count * 3);
  const focal = focalEstimate ?? Math.max(width, height) * .95;
  if (!Number.isFinite(focal) || focal <= 0) throw new Error('Ugyldig kamerageometri.');
  let used = 0, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let y = 0; y < height; y += stride) for (let x = 0; x < width; x += stride) {
    const pixel = (y * width + x) * 4;
    if (rgba[pixel + 3] < 128) continue;
    const value = bilinear(depth, depthWidth, depthHeight, (x + .5) * depthWidth / width - .5, (y + .5) * depthHeight / height - .5);
    if (!Number.isFinite(value)) continue;
    const inverse = span > 1e-6 ? Math.max(0, Math.min(1, (value - low) / span)) : .5;
    const distance = 1 / (.5 + inverse * 1.1);
    const point = [(x + .5 - width / 2) / focal * distance, -(y + .5 - height / 2) / focal * distance, -distance];
    for (let c = 0; c < 3; c++) {
      positions[used * 3 + c] = point[c];
      colors[used * 3 + c] = rgba[pixel + c];
      min[c] = Math.min(min[c], point[c]); max[c] = Math.max(max[c], point[c]);
    }
    used++;
  }
  if (!used) throw new Error('Ingen punkt kunne lagast.');
  const center = min.map((v, c) => (v + max[c]) / 2);
  for (let i = 0; i < used; i++) for (let c = 0; c < 3; c++) positions[i * 3 + c] -= center[c];
  return { positions: positions.subarray(0, used * 3), colors: colors.subarray(0, used * 3), count: used, sourceWidth: width, sourceHeight: height,
    radius: Math.hypot(...max.map((v, c) => (v - min[c]) / 2)), estimated: true, units: 'relative', focalEstimate: focal, center, stride };
}

export function gaussianSplats(cloud) {
  if (!Number.isInteger(cloud.count) || cloud.count <= 0 || cloud.positions.length !== cloud.count * 3 || cloud.colors.length !== cloud.count * 3) throw new Error('Ugyldig punktsky.');
  const bytes = new Uint8Array(cloud.count * 32), view = new DataView(bytes.buffer);
  for (let i = 0; i < cloud.count; i++) {
    const distance = -(cloud.positions[i * 3 + 2] + cloud.center[2]);
    const scale = distance * cloud.stride / cloud.focalEstimate * .6;
    if (!Number.isFinite(scale) || scale <= 0) throw new Error('Ugyldig Gaussian-storleik.');
    for (let c = 0; c < 3; c++) {
      const position = cloud.positions[i * 3 + c];
      if (!Number.isFinite(position)) throw new Error('Ugyldig Gaussian-posisjon.');
      view.setFloat32(i * 32 + c * 4, position, true);
      view.setFloat32(i * 32 + 12 + c * 4, scale, true);
      bytes[i * 32 + 24 + c] = cloud.colors[i * 3 + c];
    }
    bytes.set([230,255,128,128,128], i * 32 + 27);
  }
  return bytes;
}
