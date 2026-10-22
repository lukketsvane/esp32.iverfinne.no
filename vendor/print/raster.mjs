const ATKINSON_NEIGHBOURS = [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]];

export function ditherRGBA(rgba, width, height) {
  if (rgba.length !== width * height * 4) throw new Error('Biletdata manglar.');
  const values = new Float32Array(width * height);
  const pixels = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const n = i * 4, alpha = rgba[n + 3] / 255;
    values[i] = (.2126 * rgba[n] + .7152 * rgba[n + 1] + .0722 * rgba[n + 2]) * alpha + 255 * (1 - alpha);
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, white = values[i] >= 128;
    pixels[i] = white ? 0 : 1;
    const error = (values[i] - (white ? 255 : 0)) / 8;
    for (const [dx, dy] of ATKINSON_NEIGHBOURS) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < width && ny < height) values[ny * width + nx] += error;
    }
  }
  return pixels;
}
