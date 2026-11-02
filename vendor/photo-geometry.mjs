// Geometry is expressed in the oriented image. Crop is applied after this transform.
export function normalizeGeometry(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Ugyldig geometri.');
  const numeric = (key, min, max) => {
    const n = value[key] === undefined ? 0 : value[key];
    if (!Number.isFinite(n) || n < min || n > max) throw new RangeError('Ugyldig geometri: ' + key);
    return n || 0;
  };
  const flag = key => {
    if (value[key] === undefined) return false;
    if (typeof value[key] !== 'boolean') throw new TypeError('Ugyldig spegling.');
    return value[key];
  };
  const turns = numeric('turns', 0, 3);
  if (!Number.isInteger(turns)) throw new RangeError('Ugyldig rotasjon.');
  return {turns, flipX: flag('flipX'), flipY: flag('flipY'), straighten: numeric('straighten', -45, 45),
    skewX: numeric('skewX', -1, 1), skewY: numeric('skewY', -1, 1)};
}

export function geometryNeutral(g) {
  return !g || !(g.turns || g.flipX || g.flipY || g.straighten || g.skewX || g.skewY);
}

export function transformPhotoGeometry(rgba, width, height, geometry) {
  if (geometryNeutral(geometry)) return {data: rgba, width, height};
  const {turns, flipX, flipY, straighten, skewX, skewY} = geometry;
  const outW = turns % 2 ? height : width;
  const outH = turns % 2 ? width : height;
  // Signed strides map oriented pixels to source pixels, with no resampling for exact turns and flips.
  let [origin, dx, dy] = [
    [0, 1, width], [(height - 1) * width, -width, 1],
    [width * height - 1, -1, -width], [width - 1, width, -1]
  ][turns];
  if (flipX) { origin += (outW - 1) * dx; dx = -dx; }
  if (flipY) { origin += (outH - 1) * dy; dy = -dy; }
  const out = new rgba.constructor(rgba.length);
  if (!straighten && !skewX && !skewY) {
    for (let y = 0, dest = 0; y < outH; y++) {
      let src = 4 * (origin + y * dy);
      for (let x = 0; x < outW; x++, src += 4 * dx, dest += 4) {
        out[dest] = rgba[src]; out[dest + 1] = rgba[src + 1];
        out[dest + 2] = rgba[src + 2]; out[dest + 3] = rgba[src + 3];
      }
    }
    return {data: out, width: outW, height: outH};
  }

  // Inverse rotation in pixel units and a projective denominator in normalized units.
  // Fit the four output corners inside the photograph so corrections leave no blank wedges.
  const angle = straighten * Math.PI / 180, cs = Math.cos(angle), sn = Math.sin(angle);
  const xy = sn * outH / outW, yx = -sn * outW / outH, kx = .32 * skewX, ky = .32 * skewY;
  let zoom = 1;
  for (const v of [-1, 1]) for (const u of [-1, 1]) {
    const z = 1 + kx * u + ky * v;
    zoom = Math.max(zoom, Math.abs(cs * u + xy * v) / z, Math.abs(yx * u + cs * v) / z);
  }
  for (let y = 0, dest = 0; y < outH; y++) {
    const v = (2 * y + 1) / outH - 1;
    for (let x = 0; x < outW; x++, dest += 4) {
      const u = (2 * x + 1) / outW - 1, z = zoom * (1 + kx * u + ky * v);
      const sx = Math.max(0, Math.min(outW - 1, ((cs * u + xy * v) / z + 1) * outW / 2 - .5));
      const sy = Math.max(0, Math.min(outH - 1, ((yx * u + cs * v) / z + 1) * outH / 2 - .5));
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      const a = 4 * (origin + x0 * dx + y0 * dy);
      const b = x0 + 1 < outW ? a + 4 * dx : a;
      const c = y0 + 1 < outH ? a + 4 * dy : a;
      const d = c + b - a;
      // Weight unassociated colour by coverage so transparent margins cannot bleed into the image.
      const wa = (1 - fx) * (1 - fy) * rgba[a + 3], wb = fx * (1 - fy) * rgba[b + 3];
      const wc = (1 - fx) * fy * rgba[c + 3], wd = fx * fy * rgba[d + 3], alpha = wa + wb + wc + wd;
      out[dest + 3] = Math.round(alpha);
      if (alpha > 0) {
        for (let i = 0; i < 3; i++)
          out[dest + i] = Math.round((rgba[a + i] * wa + rgba[b + i] * wb + rgba[c + i] * wc + rgba[d + i] * wd) / alpha);
      }
    }
  }
  return {data: out, width: outW, height: outH};
}
