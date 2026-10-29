import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import numpy as np

import fit_rig

ROOT = Path(__file__).resolve().parents[1]
LEFT = np.array([-.33, .85, 129., -2.5e-05, -9.7e-05, 1.])
RIGHT = np.array([-.41, .85, 128., -1.5e-04, -6.2e-05, 1.])


def partner(left, right, pl, disparity):
    # Right points on the same rectified row, `disparity` profile pixels along the baseline.
    a, b, c, d, e, f = right
    u = pl[:, 0] - disparity
    y = fit_rig.rows_at(left, pl)
    return np.stack([u, (y * (d * u + f) - a * u - c) / (b - e * y)], 1)


class FitRigTest(unittest.TestCase):
    def test_profile_frame_matches_the_app_rectification(self):
        # The app samples source column `origin` on source row H-1-x for working pixel (x, y); the fit's
        # (u, v) frame must put that same source pixel on the same rectified row.
        width, height = 160, 120
        script = f'''
import {{prepareFixedStereo}} from {json.dumps((ROOT / 'pointcloud/stereo-rig.mjs').as_uri())};
const w={width},h={height},data=new Uint8ClampedArray(w*h*4);
for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set([x,y,0,255],(y*w+x)*4);
const p=prepareFixedStereo({{width:w,height:h,data}},{{width:w,height:h,data}},{{id:'t',width:640,height:480,left:{json.dumps(LEFT.tolist())},right:{json.dumps(RIGHT.tolist())}}});
const out=[];for(let y=3;y<p.height;y+=7)for(let x=2;x<p.width;x+=7){{const i=(y*p.width+x)*4;if(p.left[i+3])out.push([x,y,p.left[i],p.left[i+1],p.left[i+3]])}}
console.log(JSON.stringify(out));'''
        sampled = json.loads(subprocess.run(['node', '--input-type=module', '-e', script], check=True, capture_output=True, text=True).stdout)
        self.assertGreater(len(sampled), 200)
        for x, y, column, row, alpha in sampled:
            self.assertEqual(alpha, 255)
            self.assertEqual(row, height - 1 - x)
            point = fit_rig.rotated(np.array([[column, row]], float), (width, height))
            expected = (y + .5) * 640 / width - .5
            self.assertLess(abs(fit_rig.rows_at(LEFT, point)[0] - expected), 640 / width * 1.01)

    def test_fit_recovers_shared_rows_from_noisy_matches(self):
        rng = np.random.default_rng(4)
        pl = np.stack([rng.uniform(80, 470, 900), rng.uniform(10, 630, 900)], 1)
        pr = partner(LEFT, RIGHT, pl, rng.uniform(6, 60, 900))
        pr += rng.normal(0, .2, pr.shape)
        pr[:60] = rng.uniform(0, 480, (60, 2))
        left, right, inl, inr = fit_rig.fit_points(pl, pr)
        clean = slice(60, None)
        error = np.abs(fit_rig.row_error(left, right, pl[clean], pr[clean]))
        self.assertLess(np.median(error), .3)
        self.assertLess(np.percentile(error, 95), 1.)
        centre = np.array([[239.5, 319.5]])
        slope = fit_rig.row_slope(left, centre)[0]
        self.assertGreater(slope, .5)
        self.assertLessEqual(slope, 1 + 1e-9)
        self.assertEqual(left[5], 1.)
        self.assertEqual(right[5], 1.)
        rows = fit_rig.rows_at(left, np.array([[239.5, 0.], [239.5, 639.]]))
        self.assertTrue(-160 < rows[0] < 320 < rows[1] < 800)

    def test_too_few_matches_are_refused(self):
        with self.assertRaisesRegex(ValueError, 'sikre samsvar'):
            fit_rig.fit_points(np.zeros((20, 2)), np.zeros((20, 2)))

    def test_written_profile_round_trips_and_keeps_the_rest(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'stereo-rig.mjs'
            shutil.copy(fit_rig.PROFILE, path)
            before = path.read_text(encoding='utf-8')
            fit_rig.write_profile(LEFT * 2, RIGHT / 3, 'entropi-test-rig', path)
            left, right = fit_rig.load_profile(path)
            np.testing.assert_allclose(left, LEFT * 2)
            np.testing.assert_allclose(right, RIGHT / 3)
            after = path.read_text(encoding='utf-8')
            self.assertIn("id:'entropi-test-rig'", after)
            strip = lambda text: [line for line in text.splitlines() if 'left:Object' not in line and "id:'" not in line]
            self.assertEqual(strip(before), strip(after))


if __name__ == '__main__':
    unittest.main()
