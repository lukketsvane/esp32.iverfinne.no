import argparse
import json
from datetime import date, datetime
from pathlib import Path
import re
import subprocess
import tempfile

import cv2
import numpy as np
from scipy.optimize import least_squares

# The fixed rig profile in pointcloud/stereo-rig.mjs works in a 640 × 480 sensor frame turned a quarter
# turn: u = 479 - row runs along the stereo baseline and v = column runs across it. Each camera gets one
# projective row function y' = (a u + b v + c) / (d u + e v + f); matching rows have equal y'.
WIDTH, HEIGHT = 640, 480
BAND = .5
PROFILE = Path(__file__).resolve().parents[1] / 'pointcloud' / 'stereo-rig.mjs'


def load_profile(path=PROFILE):
    text = path.read_text(encoding='utf-8')
    rows = {side: np.array(json.loads(re.search(side + r':Object\.freeze\((\[[^\]]+\])\)', text).group(1)), float)
            for side in ('left', 'right')}
    return rows['left'], rows['right']


def rotated(points, size):
    # Photo pixels (column, row) at any 4:3 size → (u, v) in the profile frame.
    width, height = size
    column = (points[:, 0] + .5) * WIDTH / width - .5
    row = (points[:, 1] + .5) * HEIGHT / height - .5
    return np.stack([HEIGHT - 1 - row, column], 1)


def rows_at(profile, points):
    a, b, c, d, e, f = profile
    u, v = points[:, 0], points[:, 1]
    return (a * u + b * v + c) / (d * u + e * v + f)


def row_slope(profile, points):
    # dy'/dv: how many rectified rows one source pixel across the baseline spans.
    a, b, c, d, e, f = profile
    u, v = points[:, 0], points[:, 1]
    denominator = d * u + e * v + f
    return (b * denominator - e * (a * u + b * v + c)) / denominator ** 2


def row_error(left, right, pl, pr):
    # Row mismatch in source pixels, so a fit cannot shrink it by flattening the rows.
    slope = (np.abs(row_slope(left, pl)) + np.abs(row_slope(right, pr))) / 2
    return (rows_at(left, pl) - rows_at(right, pr)) / np.maximum(slope, 1e-6)


def matches(left_path, right_path, ratio=.75):
    left, right = (cv2.imread(str(path), cv2.IMREAD_GRAYSCALE) for path in (left_path, right_path))
    if left is None or right is None or left.shape != right.shape:
        raise ValueError(f'{left_path.name} og {right_path.name} er ikkje eit par med same storleik')
    if abs(left.shape[1] / left.shape[0] - WIDTH / HEIGHT) > .02:
        raise ValueError('Bileta er ikkje 4:3')
    clahe = cv2.createCLAHE(2.0, (8, 8))
    sift = cv2.SIFT_create(nfeatures=8000, contrastThreshold=.02)
    (kl, dl), (kr, dr) = (sift.detectAndCompute(clahe.apply(image), None) for image in (left, right))
    if dl is None or dr is None:
        return np.empty((0, 2)), np.empty((0, 2))
    pairs = cv2.BFMatcher(cv2.NORM_L2).knnMatch(dl, dr, k=2)
    good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < ratio * n.distance]
    size = (left.shape[1], left.shape[0])
    pl = rotated(np.float64([kl[m.queryIdx].pt for m in good]), size)
    pr = rotated(np.float64([kr[m.trainIdx].pt for m in good]), size)
    return pl, pr


def epipolar_inliers(pl, pr, threshold=1.5):
    if len(pl) < 16:
        return np.zeros(len(pl), bool), None
    F, mask = cv2.findFundamentalMat(pl, pr, cv2.FM_RANSAC, threshold, .999, 20000)
    if F is None or F.shape != (3, 3):
        return np.zeros(len(pl), bool), None
    return mask.ravel().astype(bool), F


def flatten(left, right):
    # A shared y' -> y' / (g y' + 1) keeps rows equal; pick g so the left denominator is as flat as it can be,
    # which keeps the working rows evenly spaced instead of stretched toward one edge.
    a, b, c, d, e, f = left / left[5]
    g = -(a * d + b * e) / (a * a + b * b)
    out = []
    for profile in (left, right):
        numerator, denominator = profile[:3], profile[3:]
        out.append(np.concatenate([numerator, g * numerator + denominator]))
    return out[0], out[1]


def normalise(left, right, band=BAND, flat=True):
    # The rows are free up to one shared 1D projectivity. Rows increase with v, one working row never
    # spans less than one source pixel at the centre, and the rows both cameras share are fitted into
    # the 640 working rows: band 0 keeps the centre column's shared rows, 1 keeps every shared row.
    if flat:
        left, right = flatten(left, right)
    left, right = left / left[5], right / right[5]
    us = np.linspace(0, HEIGHT - 1, 49)
    spans = []
    for profile in (left, right):
        lo = rows_at(profile, np.stack([us, np.zeros_like(us)], 1))
        hi = rows_at(profile, np.stack([us, np.full_like(us, WIDTH - 1)], 1))
        spans.append((np.minimum(lo, hi), np.maximum(lo, hi)))
    centre = np.array([[(HEIGHT - 1) / 2, (WIDTH - 1) / 2]])
    sign = 1. if row_slope(left, centre)[0] > 0 else -1.
    low, high = np.maximum(spans[0][0], spans[1][0]), np.minimum(spans[0][1], spans[1][1])
    low = (1 - band) * low.mean() + band * low.min()
    high = (1 - band) * high.mean() + band * high.max()
    scale = min((WIDTH - 1) / (high - low), 1 / abs(row_slope(left, centre)[0]))
    middle = (low + high) / 2
    offset = (WIDTH - 1) / 2 - sign * scale * middle
    out = []
    for profile in (left, right):
        numerator, denominator = profile[:3], profile[3:]
        out.append(np.concatenate([sign * scale * numerator + offset * denominator, denominator]))
    return out[0], out[1]


def refine(left, right, pl, pr):
    # Robust least squares on the row mismatch in source pixels. Equal rows survive any shared 1D
    # projectivity, so the left camera's b, c, e and f and the right f stay fixed to hold that gauge.
    params = np.concatenate([left, right])
    free = [0, 3, 6, 7, 8, 9, 10]

    def residual(x):
        moved = params.copy()
        moved[free] = x
        return row_error(moved[:6], moved[6:], pl, pr)

    solved = least_squares(residual, params[free], loss='soft_l1', f_scale=1., x_scale='jac', max_nfev=2000)
    params[free] = solved.x
    return params[:6], params[6:]


def fit_points(pl, pr):
    if len(pl) < 60:
        raise ValueError(f'Berre {len(pl)} sikre samsvar; bruk eit lyst motiv med mange detaljar')
    keep, F = epipolar_inliers(pl, pr)
    pl, pr = pl[keep], pr[keep]
    ok, H1, H2 = cv2.stereoRectifyUncalibrated(pl, pr, F, (HEIGHT, WIDTH))
    if not ok:
        raise ValueError('OpenCV fann inga rektifisering')
    left, right = normalise(H1[1:].ravel(), H2[1:].ravel())
    left, right = normalise(*refine(left, right, pl, pr))
    return left, right, pl, pr


def fit(pairs):
    all_l, all_r, per_pair = [], [], []
    for left_path, right_path in pairs:
        pl, pr = matches(left_path, right_path)
        keep, _ = epipolar_inliers(pl, pr)
        per_pair.append({'pair': str(left_path), 'matches': len(pl), 'inliers': int(keep.sum())})
        all_l.append(pl[keep])
        all_r.append(pr[keep])
    return (*fit_points(np.concatenate(all_l), np.concatenate(all_r)), per_pair)


def report(left, right, pl, pr):
    residual = row_error(left, right, pl, pr)
    disparity = pl[:, 0] - pr[:, 0]
    return {
        'points': int(len(pl)),
        'row_error_px': {q: round(float(np.percentile(np.abs(residual), p)), 3) for q, p in (('median', 50), ('p95', 95))},
        # The app matches left x against right x - d with 1 <= d <= 64 at 240 working columns (2-128 here).
        'disparity_px': {q: round(float(np.percentile(disparity, p)), 1) for q, p in (('p5', 5), ('median', 50), ('p95', 95))},
        'disparity_in_range': round(float(np.mean((disparity >= 2) & (disparity <= 128))), 3),
    }


def app_coverage(pairs, profiles, range_=40):
    # Same working size as runStereoDepth: at most 320 × 240, aspect kept.
    with tempfile.TemporaryDirectory() as folder:
        folder = Path(folder)
        files, size = [], None
        for index, (left_path, right_path) in enumerate(pairs):
            names = []
            for eye, path in (('left', left_path), ('right', right_path)):
                image = cv2.cvtColor(cv2.imread(str(path)), cv2.COLOR_BGR2RGBA)
                scale = min(1., 320 / image.shape[1], 240 / image.shape[0])
                size = (round(image.shape[1] * scale), round(image.shape[0] * scale))
                image = cv2.resize(image, size, interpolation=cv2.INTER_AREA)
                name = folder / f'{index}-{eye}.rgba'
                name.write_bytes(image.tobytes())
                names.append(str(name))
            files.append(names)
        job = folder / 'job.json'
        job.write_text(json.dumps({'width': size[0], 'height': size[1], 'pairs': files, 'range': range_,
                                   'profiles': {name: {'left': list(map(float, l)), 'right': list(map(float, r))} for name, (l, r) in profiles.items()}}))
        script = Path(__file__).with_name('rig-coverage.mjs')
        return json.loads(subprocess.run(['node', str(script), str(job)], check=True, capture_output=True, text=True).stdout)


def pair_paths(stems):
    for stem in stems:
        yield Path(stem + '-left.jpg'), Path(stem + '-right.jpg')


def capture(port, count, folder):
    # Sequential USB pairs through the bridge's stereo-snap; the rig should stay still between them.
    from bridge import Rig
    rig = Rig(port, timeout=45)
    with rig.connection() as link:
        rig.identify_link(link)
    folder.mkdir(parents=True)
    stems = []
    for index in range(1, count + 1):
        record = rig.capture()
        for eye, data in zip(('left', 'right'), record['frames']):
            (folder / f'{index}-{eye}.jpg').write_bytes(data)
        stems.append(str(folder / str(index)))
    return stems


def write_profile(left, right, rig_id, path=PROFILE):
    text = path.read_text(encoding='utf-8')
    text = re.sub(r"id:'[^']*'", f"id:'{rig_id}'", text, count=1)
    for side, rows in (('left', left), ('right', right)):
        text = re.sub(side + r':Object\.freeze\(\[[^\]]+\]\)', side + ':Object.freeze([' + ','.join(repr(float(x)) for x in rows) + '])', text, count=1)
    path.write_text(text, encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description='Mål den faste riggprofilen på nytt frå ekte stereopar.')
    parser.add_argument('pairs', nargs='*', help='sti/1 for sti/1-left.jpg og sti/1-right.jpg')
    parser.add_argument('--serial', help='ta nye par via primærkameraet på denne USB-porten')
    parser.add_argument('--count', type=int, default=6)
    parser.add_argument('--write', action='store_true', help='skriv profilen inn i pointcloud/stereo-rig.mjs')
    parser.add_argument('--id', default='entropi-fixed-mount-' + date.today().strftime('%Y%m%d'))
    args = parser.parse_args()
    stems = list(args.pairs)
    if args.serial:
        folder = PROFILE.parents[1] / 'test-results' / ('rig-fit-' + datetime.now().strftime('%Y%m%d-%H%M%S'))
        stems += capture(args.serial, args.count, folder)
    if not stems:
        parser.error('gi stereopar eller --serial')
    pairs = list(pair_paths(stems))
    cv2.setRNGSeed(0)
    old_left, old_right = load_profile()
    left, right, pl, pr, per_pair = fit(pairs)
    result = {'id': args.id, 'pairs': per_pair, 'left': left.tolist(), 'right': right.tolist(),
              'new_profile': report(left, right, pl, pr), 'old_profile': report(old_left, old_right, pl, pr),
              'app_coverage': app_coverage(pairs, {'new': (left, right), 'old': (old_left, old_right)})}
    print(json.dumps(result, indent=2))
    if args.write:
        if result['new_profile']['row_error_px']['p95'] > 2:
            raise SystemExit('Profilen blei ikkje skriven: 95 % av radavvika må vere under 2 px.')
        write_profile(left, right, args.id)


if __name__ == '__main__':
    main()
